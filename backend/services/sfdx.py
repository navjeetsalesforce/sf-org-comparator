"""
sfdx.py — Wrapper around the Salesforce `sf` CLI.

All commands use the new unified `sf` CLI (not legacy `sfdx`).
Falls back gracefully when sf is not installed or no orgs are authenticated.
"""

import json
import subprocess
import shutil
from typing import Any


# ---------------------------------------------------------------------------
# Low-level helper
# ---------------------------------------------------------------------------

def run_sfdx(cmd: list[str]) -> dict[str, Any]:
    """
    Run an sf CLI command and return the parsed JSON output.
    Raises RuntimeError with a descriptive message on failure.
    """
    if not shutil.which("sf"):
        raise RuntimeError(
            "Salesforce CLI (`sf`) is not installed or not in PATH. "
            "Install it from https://developer.salesforce.com/tools/salesforcecli"
        )

    full_cmd = ["sf"] + cmd
    try:
        result = subprocess.run(
            full_cmd,
            capture_output=True,
            text=True,
            timeout=120,
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"Command timed out: {' '.join(full_cmd)}")
    except FileNotFoundError:
        raise RuntimeError("`sf` CLI not found. Please install Salesforce CLI.")

    stdout = result.stdout.strip()
    stderr = result.stderr.strip()

    if not stdout:
        if result.returncode != 0:
            raise RuntimeError(
                f"sf command returned no output (exit {result.returncode}): {stderr}"
            )
        return {}

    try:
        data = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"Could not parse sf output as JSON: {exc}\nRaw output: {stdout[:500]}"
        )

    # sf CLI wraps successful results in {"status": 0, "result": {...}}
    # but some commands return the result directly.
    if isinstance(data, dict) and "result" in data:
        return data["result"]

    return data


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def list_orgs() -> list[dict[str, Any]]:
    """
    Return all SFDX-authenticated orgs.

    Output shape per org:
      {
        "alias": str,
        "username": str,
        "instanceUrl": str,
        "isDefault": bool,
        "orgId": str,
      }
    """
    raw = run_sfdx(["org", "list", "--json"])

    orgs: list[dict[str, Any]] = []

    # `sf org list --json` result structure:
    # {
    #   "nonScratchOrgs": [...],
    #   "scratchOrgs": [...],
    #   "sandboxes": [...],   (may be absent in older versions)
    # }
    sections = []
    if isinstance(raw, dict):
        sections.append(raw.get("nonScratchOrgs") or [])
        sections.append(raw.get("scratchOrgs") or [])
        sections.append(raw.get("sandboxes") or [])
    elif isinstance(raw, list):
        sections.append(raw)

    seen_usernames: set[str] = set()
    for section in sections:
        for org in section:
            username = org.get("username", "")
            if not username or username in seen_usernames:
                continue
            seen_usernames.add(username)
            orgs.append(
                {
                    "alias": org.get("alias") or org.get("username", ""),
                    "username": username,
                    "instanceUrl": org.get("instanceUrl", ""),
                    "isDefault": bool(org.get("isDefaultUsername") or org.get("isDefault")),
                    "orgId": org.get("orgId") or org.get("id", ""),
                }
            )

    return orgs


def get_org_access_token(alias: str) -> dict[str, str]:
    """
    Retrieve the current access token and instance URL for an org.

    Returns:
      {
        "accessToken": str,
        "instanceUrl": str,
        "username": str,
      }

    Raises RuntimeError if the org is not found or the token cannot be obtained.
    """
    raw = run_sfdx(["org", "display", "--target-org", alias, "--json"])

    access_token = raw.get("accessToken") or raw.get("access_token", "")
    instance_url = raw.get("instanceUrl") or raw.get("instanceURL", "")
    username = raw.get("username", alias)

    if not access_token:
        raise RuntimeError(
            f"Could not retrieve access token for org '{alias}'. "
            "Make sure the org is authenticated: `sf org login web --alias {alias}`"
        )

    return {
        "accessToken": access_token,
        "instanceUrl": instance_url.rstrip("/"),
        "username": username,
    }
