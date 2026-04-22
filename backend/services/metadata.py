"""
metadata.py — Salesforce Metadata API interactions.

Key design decisions for real sandbox reliability:
- listMetadata batches 3 types per SOAP call (Salesforce hard limit)
- Concurrent XML retrieval capped at 5 simultaneous requests (avoids 429s)
- Retrieve polling uses 3s intervals with 40 attempts max (2 min timeout)
- All HTTP errors are caught per-component so one failure doesn't abort the whole comparison
- Components are deduplicated before XML fetch (identical timestamps = skip fetch)
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
SOAP_NS = "http://soap.sforce.com/2006/04/metadata"
METADATA_SOAP_PATH = f"/services/Soap/m/{API_VERSION}"

# Salesforce hard limit: max 3 metadata types per listMetadata call
LIST_METADATA_BATCH_SIZE = 3

# Max concurrent XML retrieve requests per org (avoid rate limits)
MAX_CONCURRENT_RETRIEVES = 5

# Supported metadata types grouped by category
SUPPORTED_METADATA_TYPES = [
    # ── Apex ──────────────────────────────────────────────────────────────────
    "ApexClass",
    "ApexTrigger",
    "ApexPage",
    "ApexComponent",
    "ApexEmailNotifications",
    # ── Lightning / UI ────────────────────────────────────────────────────────
    "LightningComponentBundle",
    "AuraDefinitionBundle",
    "FlexiPage",
    "Layout",
    "CompactLayout",
    "CustomTab",
    "CustomApplication",
    "AppMenu",
    "GlobalValueSet",
    "StandardValueSet",
    "CustomPageWebLink",
    # ── Automation ────────────────────────────────────────────────────────────
    "Flow",
    "FlowDefinition",
    "WorkflowRule",
    "WorkflowAlert",
    "WorkflowFieldUpdate",
    "WorkflowTask",
    "WorkflowOutboundMessage",
    "AutoResponseRule",
    "AssignmentRule",
    "EscalationRule",
    "MilestoneType",
    # ── Objects & Fields ─────────────────────────────────────────────────────
    "CustomObject",
    "CustomField",
    "ValidationRule",
    "CustomMetadata",
    "CustomSetting",
    "ExternalObject",
    "PlatformEvent",
    "CustomIndex",
    "FieldSet",
    "RecordType",
    "SharingReason",
    "ListView",
    "WebLink",
    # ── Security & Access ─────────────────────────────────────────────────────
    "Profile",
    "PermissionSet",
    "PermissionSetGroup",
    "MutingPermissionSet",
    "CustomPermission",
    "Role",
    "Group",
    "Queue",
    "SharingRules",
    "SharingCriteriaRule",
    "SharingOwnerRule",
    "Territory2",
    "Territory2Model",
    "Territory2Rule",
    "Territory2Type",
    # ── Integrations & Connectivity ───────────────────────────────────────────
    "ConnectedApp",
    "NamedCredential",
    "ExternalCredential",
    "RemoteSiteSetting",
    "CspTrustedSite",
    "CustomNotificationType",
    "PlatformEventChannel",
    "PlatformEventChannelMember",
    "ExternalDataSource",
    # ── Experience Cloud ──────────────────────────────────────────────────────
    "ExperienceBundle",
    "Network",
    "CustomSite",
    "SiteDotCom",
    "NavigationMenu",
    "ManagedContentType",
    # ── Reports & Dashboards ──────────────────────────────────────────────────
    "Report",
    "Dashboard",
    "ReportType",
    # ── Config & Labels ───────────────────────────────────────────────────────
    "CustomLabel",
    "CustomLabels",
    "Settings",
    "OrgPreferenceSettings",
    "LeadConvertSettings",
    "CaseSettings",
    "EmailServicesFunction",
    "HomePageLayout",
    "HomePageComponent",
    # ── Matching & Duplicate Rules ────────────────────────────────────────────
    "MatchingRule",
    "DuplicateRule",
    # ── Packages ──────────────────────────────────────────────────────────────
    "InstalledPackage",
]


# ---------------------------------------------------------------------------
# SOAP helpers
# ---------------------------------------------------------------------------

def _soap_headers(access_token: str) -> dict[str, str]:
    return {
        "Content-Type": "text/xml; charset=UTF-8",
        "SOAPAction": '""',
        "Authorization": f"Bearer {access_token}",
    }


def _extract_text(xml: str, tag: str) -> str:
    m = re.search(rf"<(?:[^:>]+:)?{re.escape(tag)}[^>]*>(.*?)</(?:[^:>]+:)?{re.escape(tag)}>", xml, re.DOTALL)
    return m.group(1).strip() if m else ""


def _extract_all(xml: str, tag: str) -> list[str]:
    return re.findall(rf"<(?:[^:>]+:)?{re.escape(tag)}[^>]*>(.*?)</(?:[^:>]+:)?{re.escape(tag)}>", xml, re.DOTALL)


def _build_list_metadata_batch_body(metadata_types: list[str]) -> str:
    """Build a listMetadata SOAP body for up to 3 types at once."""
    queries = "\n".join(
        f"      <met:queries><met:type>{t}</met:type></met:queries>"
        for t in metadata_types
    )
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope
    xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
    xmlns:met="{SOAP_NS}">
  <soapenv:Header>
    <met:CallOptions><met:client>SFOrgComparator</met:client></met:CallOptions>
  </soapenv:Header>
  <soapenv:Body>
    <met:listMetadata>
{queries}
      <met:asOfVersion>{API_VERSION}</met:asOfVersion>
    </met:listMetadata>
  </soapenv:Body>
</soapenv:Envelope>"""


def _build_retrieve_body(metadata_type: str, full_name: str) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope
    xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
    xmlns:met="{SOAP_NS}">
  <soapenv:Header>
    <met:CallOptions><met:client>SFOrgComparator</met:client></met:CallOptions>
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


# ---------------------------------------------------------------------------
# List metadata (batched)
# ---------------------------------------------------------------------------

async def list_metadata(
    access_token: str,
    instance_url: str,
    metadata_types: list[str],
) -> list[dict[str, Any]]:
    """
    Retrieve the component inventory for the given metadata types.
    Batches requests in groups of LIST_METADATA_BATCH_SIZE (SF limit = 3).
    Returns a flat list of component dicts.
    """
    endpoint = f"{instance_url}{METADATA_SOAP_PATH}"

    # Split types into batches of 3
    batches = [
        metadata_types[i:i + LIST_METADATA_BATCH_SIZE]
        for i in range(0, len(metadata_types), LIST_METADATA_BATCH_SIZE)
    ]

    async def fetch_batch(client: httpx.AsyncClient, batch: list[str]) -> list[dict]:
        body = _build_list_metadata_batch_body(batch)
        try:
            resp = await client.post(
                endpoint,
                content=body.encode("utf-8"),
                headers=_soap_headers(access_token),
                timeout=60,
            )
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            # Log and skip this batch — non-fatal
            print(f"[list_metadata] HTTP {e.response.status_code} for batch {batch}: {e.response.text[:300]}")
            return []
        except httpx.HTTPError as e:
            print(f"[list_metadata] Network error for batch {batch}: {e}")
            return []

        xml = resp.text
        results = []
        for block in _extract_all(xml, "result"):
            full_name = _extract_text(block, "fullName")
            mtype = _extract_text(block, "type")
            if not full_name or not mtype:
                continue
            results.append({
                "type": mtype,
                "fullName": full_name,
                "lastModifiedDate": _extract_text(block, "lastModifiedDate"),
                "lastModifiedBy": _extract_text(block, "lastModifiedById"),
                "createdDate": _extract_text(block, "createdDate"),
            })
        return results

    # Run all batches concurrently (batches are already small, safe to parallelize)
    async with httpx.AsyncClient(timeout=60) as client:
        batch_results = await asyncio.gather(
            *[fetch_batch(client, b) for b in batches],
            return_exceptions=False,
        )

    flat: list[dict[str, Any]] = []
    for items in batch_results:
        if isinstance(items, list):
            flat.extend(items)

    return flat


# ---------------------------------------------------------------------------
# Retrieve single component XML
# ---------------------------------------------------------------------------

async def get_component_xml(
    access_token: str,
    instance_url: str,
    metadata_type: str,
    full_name: str,
    sem: Optional[asyncio.Semaphore] = None,
) -> str:
    """
    Retrieve the raw XML of a single metadata component via async Metadata API retrieve.
    Uses a semaphore (if provided) to cap concurrent requests.
    Returns empty string on any failure — non-fatal.
    """
    _sem = sem or asyncio.Semaphore(MAX_CONCURRENT_RETRIEVES)
    endpoint = f"{instance_url}{METADATA_SOAP_PATH}"

    async with _sem:
        async with httpx.AsyncClient(timeout=120) as client:
            # Kick off async retrieve
            body = _build_retrieve_body(metadata_type, full_name)
            try:
                resp = await client.post(
                    endpoint,
                    content=body.encode("utf-8"),
                    headers=_soap_headers(access_token),
                )
                resp.raise_for_status()
            except httpx.HTTPError as e:
                print(f"[get_component_xml] Retrieve start failed for {metadata_type}/{full_name}: {e}")
                return ""

            async_id = _extract_text(resp.text, "id")
            if not async_id:
                print(f"[get_component_xml] No async ID returned for {metadata_type}/{full_name}")
                return ""

            # Poll every 3 seconds, up to 40 attempts (2 minute max)
            for attempt in range(40):
                await asyncio.sleep(3)
                poll_body = _build_check_retrieve_body(async_id)
                try:
                    poll_resp = await client.post(
                        endpoint,
                        content=poll_body.encode("utf-8"),
                        headers=_soap_headers(access_token),
                    )
                    poll_resp.raise_for_status()
                except httpx.HTTPError as e:
                    print(f"[get_component_xml] Poll failed for {metadata_type}/{full_name}: {e}")
                    return ""

                xml = poll_resp.text
                status = _extract_text(xml, "status")

                if status in ("Pending", "InProgress", "Queued"):
                    continue

                if status != "Succeeded":
                    error_msg = _extract_text(xml, "message") or _extract_text(xml, "errorStatusCode")
                    print(f"[get_component_xml] Retrieve failed ({status}) for {metadata_type}/{full_name}: {error_msg}")
                    return ""

                zip_b64 = _extract_text(xml, "zipFile")
                if not zip_b64:
                    return ""

                try:
                    zip_bytes = base64.b64decode(zip_b64)
                    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
                        for name in zf.namelist():
                            if name.endswith("package.xml"):
                                continue
                            with zf.open(name) as f:
                                return f.read().decode("utf-8", errors="replace")
                except (zipfile.BadZipFile, Exception) as e:
                    print(f"[get_component_xml] ZIP extract failed for {metadata_type}/{full_name}: {e}")
                    return ""

    return ""


# ---------------------------------------------------------------------------
# Diff helper
# ---------------------------------------------------------------------------

def _compute_diff(source_xml: str, target_xml: str) -> list[dict[str, Any]]:
    source_lines = source_xml.splitlines() if source_xml else []
    target_lines = target_xml.splitlines() if target_xml else []
    diff: list[dict[str, Any]] = []
    matcher = difflib.SequenceMatcher(None, source_lines, target_lines, autojunk=False)

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for idx, line in enumerate(source_lines[i1:i2]):
                diff.append({"line": line, "type": "equal",
                              "sourceLineNum": i1 + idx + 1, "targetLineNum": j1 + idx + 1})
        elif tag == "replace":
            s_chunk, t_chunk = source_lines[i1:i2], target_lines[j1:j2]
            for k in range(max(len(s_chunk), len(t_chunk))):
                sl = s_chunk[k] if k < len(s_chunk) else None
                tl = t_chunk[k] if k < len(t_chunk) else None
                if sl is not None and tl is not None:
                    diff.append({"sourceLine": sl, "targetLine": tl, "type": "changed",
                                 "sourceLineNum": i1 + k + 1, "targetLineNum": j1 + k + 1})
                elif sl is not None:
                    diff.append({"line": sl, "type": "removed",
                                 "sourceLineNum": i1 + k + 1, "targetLineNum": None})
                else:
                    diff.append({"line": tl, "type": "added",
                                 "sourceLineNum": None, "targetLineNum": j1 + k + 1})
        elif tag == "delete":
            for idx, line in enumerate(source_lines[i1:i2]):
                diff.append({"line": line, "type": "removed",
                              "sourceLineNum": i1 + idx + 1, "targetLineNum": None})
        elif tag == "insert":
            for idx, line in enumerate(target_lines[j1:j2]):
                diff.append({"line": line, "type": "added",
                              "sourceLineNum": None, "targetLineNum": j1 + idx + 1})

    return diff


# ---------------------------------------------------------------------------
# Compare two orgs
# ---------------------------------------------------------------------------

async def compare_orgs(
    source_token: str,
    source_url: str,
    target_token: str,
    target_url: str,
    metadata_types: list[str],
) -> list[dict[str, Any]]:
    """
    Compare all components of the given metadata types between two orgs.

    Strategy:
    1. Fetch component lists from both orgs in parallel (batched listMetadata)
    2. Classify each component: identical / different / source_only / target_only
    3. For components present in BOTH orgs:
       - Skip XML fetch if lastModifiedDate is identical (mark as identical without fetching)
       - Only fetch XML for components where dates differ (avoids unnecessary API calls)
    4. Always fetch XML for source_only and target_only components
    5. Use per-org semaphores to cap concurrency at MAX_CONCURRENT_RETRIEVES
    """
    # Step 1: list components from both orgs simultaneously
    source_list, target_list = await asyncio.gather(
        list_metadata(source_token, source_url, metadata_types),
        list_metadata(target_token, target_url, metadata_types),
    )

    source_map: dict[tuple, dict] = {(c["type"], c["fullName"]): c for c in source_list}
    target_map: dict[tuple, dict] = {(c["type"], c["fullName"]): c for c in target_list}
    all_keys = set(source_map.keys()) | set(target_map.keys())

    source_only_keys = [k for k in all_keys if k in source_map and k not in target_map]
    target_only_keys = [k for k in all_keys if k not in source_map and k in target_map]
    both_keys = [k for k in all_keys if k in source_map and k in target_map]

    # Step 2: for components in both orgs, skip XML fetch if timestamps match
    needs_xml_fetch: list[tuple] = []
    date_identical: list[tuple] = []

    for k in both_keys:
        src_date = source_map[k].get("lastModifiedDate", "")
        tgt_date = target_map[k].get("lastModifiedDate", "")
        if src_date and tgt_date and src_date == tgt_date:
            date_identical.append(k)
        else:
            needs_xml_fetch.append(k)

    # Step 3: fetch XML concurrently with per-org semaphores
    src_sem = asyncio.Semaphore(MAX_CONCURRENT_RETRIEVES)
    tgt_sem = asyncio.Semaphore(MAX_CONCURRENT_RETRIEVES)

    async def fetch_src(mtype: str, name: str) -> str:
        return await get_component_xml(source_token, source_url, mtype, name, src_sem)

    async def fetch_tgt(mtype: str, name: str) -> str:
        return await get_component_xml(target_token, target_url, mtype, name, tgt_sem)

    # Build all tasks
    src_xml_tasks: dict[tuple, asyncio.Task] = {}
    tgt_xml_tasks: dict[tuple, asyncio.Task] = {}
    src_only_tasks: dict[tuple, asyncio.Task] = {}
    tgt_only_tasks: dict[tuple, asyncio.Task] = {}

    for k in needs_xml_fetch:
        src_xml_tasks[k] = asyncio.create_task(fetch_src(k[0], k[1]))
        tgt_xml_tasks[k] = asyncio.create_task(fetch_tgt(k[0], k[1]))

    for k in source_only_keys:
        src_only_tasks[k] = asyncio.create_task(fetch_src(k[0], k[1]))

    for k in target_only_keys:
        tgt_only_tasks[k] = asyncio.create_task(fetch_tgt(k[0], k[1]))

    # Wait for all XML fetches
    all_tasks = (
        list(src_xml_tasks.values()) +
        list(tgt_xml_tasks.values()) +
        list(src_only_tasks.values()) +
        list(tgt_only_tasks.values())
    )
    if all_tasks:
        await asyncio.gather(*all_tasks, return_exceptions=True)

    results: list[dict[str, Any]] = []

    # Components where dates matched — no XML fetch needed
    for k in date_identical:
        mtype, name = k
        results.append({
            "type": mtype, "name": name, "status": "identical",
            "sourceLastModified": source_map[k].get("lastModifiedDate", ""),
            "targetLastModified": target_map[k].get("lastModifiedDate", ""),
            "sourceLastModifiedBy": source_map[k].get("lastModifiedBy", ""),
            "targetLastModifiedBy": target_map[k].get("lastModifiedBy", ""),
            "sourceXml": "", "targetXml": "", "diff": [],
            "xmlSkipped": True,  # tells the UI XML wasn't fetched (dates matched)
        })

    # Components where we fetched XML from both
    for k in needs_xml_fetch:
        mtype, name = k
        src_xml = ""
        tgt_xml = ""
        try:
            src_xml = src_xml_tasks[k].result() if not src_xml_tasks[k].exception() else ""
        except Exception:
            pass
        try:
            tgt_xml = tgt_xml_tasks[k].result() if not tgt_xml_tasks[k].exception() else ""
        except Exception:
            pass

        # Normalise whitespace for comparison
        src_norm = re.sub(r'\s+', ' ', src_xml.strip())
        tgt_norm = re.sub(r'\s+', ' ', tgt_xml.strip())
        status = "identical" if src_norm == tgt_norm else "different"
        diff = _compute_diff(src_xml, tgt_xml) if status == "different" else []

        results.append({
            "type": mtype, "name": name, "status": status,
            "sourceLastModified": source_map[k].get("lastModifiedDate", ""),
            "targetLastModified": target_map[k].get("lastModifiedDate", ""),
            "sourceLastModifiedBy": source_map[k].get("lastModifiedBy", ""),
            "targetLastModifiedBy": target_map[k].get("lastModifiedBy", ""),
            "sourceXml": src_xml, "targetXml": tgt_xml, "diff": diff,
            "xmlSkipped": False,
        })

    # Source-only components
    for k in source_only_keys:
        mtype, name = k
        src_xml = ""
        try:
            src_xml = src_only_tasks[k].result() if not src_only_tasks[k].exception() else ""
        except Exception:
            pass
        results.append({
            "type": mtype, "name": name, "status": "source_only",
            "sourceLastModified": source_map[k].get("lastModifiedDate", ""),
            "targetLastModified": "",
            "sourceLastModifiedBy": source_map[k].get("lastModifiedBy", ""),
            "targetLastModifiedBy": "",
            "sourceXml": src_xml, "targetXml": "", "diff": _compute_diff(src_xml, ""),
            "xmlSkipped": False,
        })

    # Target-only components
    for k in target_only_keys:
        mtype, name = k
        tgt_xml = ""
        try:
            tgt_xml = tgt_only_tasks[k].result() if not tgt_only_tasks[k].exception() else ""
        except Exception:
            pass
        results.append({
            "type": mtype, "name": name, "status": "target_only",
            "sourceLastModified": "",
            "targetLastModified": target_map[k].get("lastModifiedDate", ""),
            "sourceLastModifiedBy": "",
            "targetLastModifiedBy": target_map[k].get("lastModifiedBy", ""),
            "sourceXml": "", "targetXml": tgt_xml, "diff": _compute_diff("", tgt_xml),
            "xmlSkipped": False,
        })

    # Sort: different → source_only → target_only → identical
    order = {"different": 0, "source_only": 1, "target_only": 2, "identical": 3}
    results.sort(key=lambda r: (order.get(r["status"], 9), r["type"], r["name"]))

    return results
