"""
metadata.py — Salesforce Metadata API interactions via REST/SOAP.

Uses httpx for async HTTP, the Metadata SOAP API to list components,
and the Tooling/Metadata REST APIs to fetch raw XML.
"""

import asyncio
import base64
import difflib
import io
import re
import zipfile
from datetime import datetime
from typing import Any, Optional

import httpx

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

API_VERSION = "60.0"
METADATA_SOAP_ENDPOINT = "/services/Soap/m/{version}"
TOOLING_REST_ENDPOINT = "/services/data/v{version}"

SOAP_NS = "http://soap.sforce.com/2006/04/metadata"

# Supported metadata types exposed in the UI
SUPPORTED_METADATA_TYPES = [
    "ApexClass",
    "ApexTrigger",
    "LightningComponentBundle",
    "AuraDefinitionBundle",
    "Flow",
    "CustomObject",
    "CustomField",
    "Profile",
    "PermissionSet",
    "Layout",
    "CustomTab",
    "CustomApplication",
    "ValidationRule",
    "WorkflowRule",
]


# ---------------------------------------------------------------------------
# SOAP helpers
# ---------------------------------------------------------------------------

def _build_list_metadata_body(metadata_type: str) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope
    xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
    xmlns:met="{SOAP_NS}">
  <soapenv:Header>
    <met:CallOptions/>
  </soapenv:Header>
  <soapenv:Body>
    <met:listMetadata>
      <met:queries>
        <met:type>{metadata_type}</met:type>
      </met:queries>
      <met:asOfVersion>{API_VERSION}</met:asOfVersion>
    </met:listMetadata>
  </soapenv:Body>
</soapenv:Envelope>"""


def _build_retrieve_body(access_token: str, metadata_type: str, full_name: str) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope
    xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
    xmlns:met="{SOAP_NS}">
  <soapenv:Header>
    <met:CallOptions/>
  </soapenv:Header>
  <soapenv:Body>
    <met:retrieve>
      <met:retrieveRequest>
        <met:apiVersion>{API_VERSION}</met:apiVersion>
        <met:singlePackage>true</met:singlePackage>
        <met:unpackaged>
          <met:types>
            <met:members>{full_name}</met:members>
            <met:name>{metadata_type}</met:name>
          </met:types>
          <met:version>{API_VERSION}</met:version>
        </met:unpackaged>
      </met:retrieveRequest>
    </met:retrieve>
  </soapenv:Body>
</soapenv:Envelope>"""


def _build_check_retrieve_body(async_process_id: str) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope
    xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
    xmlns:met="{SOAP_NS}">
  <soapenv:Body>
    <met:checkRetrieveStatus>
      <met:asyncProcessId>{async_process_id}</met:asyncProcessId>
      <met:includeZip>true</met:includeZip>
    </met:checkRetrieveStatus>
  </soapenv:Body>
</soapenv:Envelope>"""


def _soap_headers(access_token: str) -> dict[str, str]:
    return {
        "Content-Type": "text/xml; charset=UTF-8",
        "SOAPAction": '""',
        "Authorization": f"Bearer {access_token}",
    }


def _extract_text(xml: str, tag: str) -> str:
    m = re.search(rf"<{tag}[^>]*>(.*?)</{tag}>", xml, re.DOTALL)
    return m.group(1).strip() if m else ""


def _extract_all(xml: str, tag: str) -> list[str]:
    return re.findall(rf"<{tag}[^>]*>(.*?)</{tag}>", xml, re.DOTALL)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def list_metadata(
    access_token: str,
    instance_url: str,
    metadata_types: list[str],
) -> list[dict[str, Any]]:
    """
    Call listMetadata for each requested type and return a flat list of components.

    Each item:
      {
        "type": str,
        "fullName": str,
        "lastModifiedDate": str (ISO),
        "lastModifiedBy": str,
        "createdDate": str (ISO),
      }
    """
    endpoint = (
        f"{instance_url}{METADATA_SOAP_ENDPOINT.format(version=API_VERSION)}"
    )

    async def fetch_type(client: httpx.AsyncClient, mtype: str) -> list[dict]:
        body = _build_list_metadata_body(mtype)
        try:
            resp = await client.post(
                endpoint,
                content=body,
                headers=_soap_headers(access_token),
                timeout=60,
            )
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            # Non-fatal: return empty list for this type
            return []

        xml = resp.text
        results = []
        for block in _extract_all(xml, "result"):
            full_name = _extract_text(block, "fullName")
            if not full_name:
                continue
            results.append(
                {
                    "type": mtype,
                    "fullName": full_name,
                    "lastModifiedDate": _extract_text(block, "lastModifiedDate"),
                    "lastModifiedBy": _extract_text(block, "lastModifiedById"),
                    "createdDate": _extract_text(block, "createdDate"),
                }
            )
        return results

    async with httpx.AsyncClient() as client:
        tasks = [fetch_type(client, t) for t in metadata_types]
        results_nested = await asyncio.gather(*tasks)

    flat: list[dict[str, Any]] = []
    for items in results_nested:
        flat.extend(items)

    return flat


async def get_component_xml(
    access_token: str,
    instance_url: str,
    metadata_type: str,
    full_name: str,
) -> str:
    """
    Retrieve the raw XML of a single metadata component.
    Returns the XML string, or an empty string if retrieval fails.
    """
    endpoint = (
        f"{instance_url}{METADATA_SOAP_ENDPOINT.format(version=API_VERSION)}"
    )

    async with httpx.AsyncClient() as client:
        # Step 1: kick off async retrieve
        body = _build_retrieve_body(access_token, metadata_type, full_name)
        try:
            resp = await client.post(
                endpoint,
                content=body,
                headers=_soap_headers(access_token),
                timeout=60,
            )
            resp.raise_for_status()
        except httpx.HTTPError:
            return ""

        async_id = _extract_text(resp.text, "id")
        if not async_id:
            return ""

        # Step 2: poll until done
        for _ in range(30):
            await asyncio.sleep(2)
            poll_body = _build_check_retrieve_body(async_id)
            try:
                poll_resp = await client.post(
                    endpoint,
                    content=poll_body,
                    headers=_soap_headers(access_token),
                    timeout=60,
                )
                poll_resp.raise_for_status()
            except httpx.HTTPError:
                return ""

            xml = poll_resp.text
            status = _extract_text(xml, "status")

            if status in ("Pending", "InProgress", "Queued"):
                continue

            if status != "Succeeded":
                return ""

            zip_b64 = _extract_text(xml, "zipFile")
            if not zip_b64:
                return ""

            zip_bytes = base64.b64decode(zip_b64)
            try:
                with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
                    for name in zf.namelist():
                        # Find the component file (skip package.xml)
                        if name.endswith("package.xml"):
                            continue
                        with zf.open(name) as f:
                            return f.read().decode("utf-8", errors="replace")
            except zipfile.BadZipFile:
                return ""

    return ""


def _compute_diff(source_xml: str, target_xml: str) -> list[dict[str, Any]]:
    """
    Produce a line-by-line diff between two XML strings.
    Returns list of {line, type: "equal"|"added"|"removed"|"changed", lineNum}.
    """
    source_lines = source_xml.splitlines(keepends=False) if source_xml else []
    target_lines = target_xml.splitlines(keepends=False) if target_xml else []

    diff: list[dict[str, Any]] = []
    matcher = difflib.SequenceMatcher(None, source_lines, target_lines, autojunk=False)

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for idx, line in enumerate(source_lines[i1:i2]):
                diff.append({"line": line, "type": "equal", "sourceLineNum": i1 + idx + 1, "targetLineNum": j1 + idx + 1})
        elif tag == "replace":
            s_chunk = source_lines[i1:i2]
            t_chunk = target_lines[j1:j2]
            max_len = max(len(s_chunk), len(t_chunk))
            for k in range(max_len):
                s_line = s_chunk[k] if k < len(s_chunk) else None
                t_line = t_chunk[k] if k < len(t_chunk) else None
                if s_line is not None and t_line is not None:
                    diff.append({"sourceLine": s_line, "targetLine": t_line, "type": "changed",
                                 "sourceLineNum": i1 + k + 1, "targetLineNum": j1 + k + 1})
                elif s_line is not None:
                    diff.append({"line": s_line, "type": "removed", "sourceLineNum": i1 + k + 1, "targetLineNum": None})
                else:
                    diff.append({"line": t_line, "type": "added", "sourceLineNum": None, "targetLineNum": j1 + k + 1})
        elif tag == "delete":
            for idx, line in enumerate(source_lines[i1:i2]):
                diff.append({"line": line, "type": "removed", "sourceLineNum": i1 + idx + 1, "targetLineNum": None})
        elif tag == "insert":
            for idx, line in enumerate(target_lines[j1:j2]):
                diff.append({"line": line, "type": "added", "sourceLineNum": None, "targetLineNum": j1 + idx + 1})

    return diff


async def compare_orgs(
    source_token: str,
    source_url: str,
    target_token: str,
    target_url: str,
    metadata_types: list[str],
) -> list[dict[str, Any]]:
    """
    Compare components between two orgs for the given metadata types.

    Returns list of ComparisonResult:
      {
        "type": str,
        "name": str,
        "status": "identical" | "different" | "source_only" | "target_only",
        "sourceLastModified": str,
        "targetLastModified": str,
        "sourceLastModifiedBy": str,
        "targetLastModifiedBy": str,
        "sourceXml": str,
        "targetXml": str,
        "diff": [...],
      }
    """
    # Fetch component lists from both orgs in parallel
    source_list, target_list = await asyncio.gather(
        list_metadata(source_token, source_url, metadata_types),
        list_metadata(target_token, target_url, metadata_types),
    )

    # Build lookup maps: (type, fullName) → metadata dict
    source_map: dict[tuple, dict] = {(c["type"], c["fullName"]): c for c in source_list}
    target_map: dict[tuple, dict] = {(c["type"], c["fullName"]): c for c in target_list}

    all_keys = set(source_map.keys()) | set(target_map.keys())

    # Fetch XML in parallel for components present in both orgs (up to 50 at a time)
    both_keys = [k for k in all_keys if k in source_map and k in target_map]
    source_only_keys = [k for k in all_keys if k in source_map and k not in target_map]
    target_only_keys = [k for k in all_keys if k not in source_map and k in target_map]

    # Fetch XML concurrently (semaphore to avoid hammering the API)
    sem = asyncio.Semaphore(10)

    async def fetch_xml(token: str, url: str, mtype: str, name: str) -> str:
        async with sem:
            return await get_component_xml(token, url, mtype, name)

    async with httpx.AsyncClient():
        # Kick off all XML fetches concurrently
        source_xml_tasks = {
            k: asyncio.create_task(fetch_xml(source_token, source_url, k[0], k[1]))
            for k in both_keys
        }
        target_xml_tasks = {
            k: asyncio.create_task(fetch_xml(target_token, target_url, k[0], k[1]))
            for k in both_keys
        }
        source_only_xml_tasks = {
            k: asyncio.create_task(fetch_xml(source_token, source_url, k[0], k[1]))
            for k in source_only_keys
        }
        target_only_xml_tasks = {
            k: asyncio.create_task(fetch_xml(target_token, target_url, k[0], k[1]))
            for k in target_only_keys
        }

        all_tasks = (
            list(source_xml_tasks.values())
            + list(target_xml_tasks.values())
            + list(source_only_xml_tasks.values())
            + list(target_only_xml_tasks.values())
        )
        await asyncio.gather(*all_tasks, return_exceptions=True)

    results: list[dict[str, Any]] = []

    for k in both_keys:
        mtype, name = k
        src_xml = source_xml_tasks[k].result() if not source_xml_tasks[k].exception() else ""
        tgt_xml = target_xml_tasks[k].result() if not target_xml_tasks[k].exception() else ""
        status = "identical" if src_xml.strip() == tgt_xml.strip() else "different"
        diff = _compute_diff(src_xml, tgt_xml) if status == "different" else []
        results.append(
            {
                "type": mtype,
                "name": name,
                "status": status,
                "sourceLastModified": source_map[k].get("lastModifiedDate", ""),
                "targetLastModified": target_map[k].get("lastModifiedDate", ""),
                "sourceLastModifiedBy": source_map[k].get("lastModifiedBy", ""),
                "targetLastModifiedBy": target_map[k].get("lastModifiedBy", ""),
                "sourceXml": src_xml,
                "targetXml": tgt_xml,
                "diff": diff,
            }
        )

    for k in source_only_keys:
        mtype, name = k
        src_xml = source_only_xml_tasks[k].result() if not source_only_xml_tasks[k].exception() else ""
        results.append(
            {
                "type": mtype,
                "name": name,
                "status": "source_only",
                "sourceLastModified": source_map[k].get("lastModifiedDate", ""),
                "targetLastModified": "",
                "sourceLastModifiedBy": source_map[k].get("lastModifiedBy", ""),
                "targetLastModifiedBy": "",
                "sourceXml": src_xml,
                "targetXml": "",
                "diff": _compute_diff(src_xml, ""),
            }
        )

    for k in target_only_keys:
        mtype, name = k
        tgt_xml = target_only_xml_tasks[k].result() if not target_only_xml_tasks[k].exception() else ""
        results.append(
            {
                "type": mtype,
                "name": name,
                "status": "target_only",
                "sourceLastModified": "",
                "targetLastModified": target_map[k].get("lastModifiedDate", ""),
                "sourceLastModifiedBy": "",
                "targetLastModifiedBy": target_map[k].get("lastModifiedBy", ""),
                "sourceXml": "",
                "targetXml": tgt_xml,
                "diff": _compute_diff("", tgt_xml),
            }
        )

    # Sort: different first, then source_only, target_only, identical
    order = {"different": 0, "source_only": 1, "target_only": 2, "identical": 3}
    results.sort(key=lambda r: (order.get(r["status"], 9), r["type"], r["name"]))

    return results
