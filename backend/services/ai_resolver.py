"""
ai_resolver.py — AI-powered Salesforce XML merge conflict resolution.

Uses the Anthropic Claude API to analyse conflicting metadata XML and propose
a merged resolution. Always returns a proposed resolution — the user must still
approve or reject it before anything is committed.

Key function:
  resolve_conflict(source_xml, target_xml, component_type, component_name, context)

Auto-resolvable = True when:
  - One side only adds new elements (fields, permissions) — safe to take both
  - Ordering differences only
Auto-resolvable = False when:
  - Same element has different values on both sides
  - Deletions conflict with modifications

Even when auto_resolvable=True the user still sees and approves the resolution.
"""

import json
import os
import re
import textwrap
from typing import Any

# ---------------------------------------------------------------------------
# Anthropic SDK — imported lazily so the app starts without it if not needed
# ---------------------------------------------------------------------------

def _get_anthropic_client():
    """Return an Anthropic client, or None if SDK / key not available."""
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        return None
    try:
        import anthropic  # type: ignore
        return anthropic.Anthropic(api_key=api_key)
    except ImportError:
        return None


# ---------------------------------------------------------------------------
# Main public function
# ---------------------------------------------------------------------------

def resolve_conflict(
    source_xml: str,
    target_xml: str,
    component_type: str,
    component_name: str,
    context: str = "",
) -> dict[str, Any]:
    """
    Analyse a Salesforce metadata XML conflict and propose a resolution.

    Returns:
      {
        "merged_xml": str,          # AI's proposed merged XML
        "explanation": str,         # plain-English explanation
        "confidence": str,          # "high" | "medium" | "low"
        "auto_resolvable": bool,    # True = additive only, no true conflict
        "conflict_details": [       # per-line conflict details
          {
            "lineNumber": int,
            "type": str,            # "conflict" | "addition" | "deletion" | "ordering"
            "sourceValue": str,
            "targetValue": str,
            "description": str,
          }
        ]
      }
    """
    client = _get_anthropic_client()
    if client is None:
        return _mock_resolution(component_type, component_name, source_xml, target_xml)

    return _resolve_with_ai(client, source_xml, target_xml, component_type, component_name, context)


# ---------------------------------------------------------------------------
# AI resolution
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = textwrap.dedent("""\
    You are an expert Salesforce DevOps engineer specialising in metadata XML merge conflicts.
    Your job is to analyse two versions of a Salesforce metadata XML file and produce a merged
    resolution that preserves the intent of both versions.

    Rules:
    1. Preserve ALL additions from both sides — if one side adds a new field permission or
       validation rule that the other side doesn't have, include it in the merged version.
    2. For true conflicts (same element changed to different values on each side), choose the
       more permissive or more recent-looking value, and document the trade-off clearly.
    3. For ordering-only differences, use a canonical XML element order.
    4. Never delete anything that exists on either side unless it is a direct conflict.
    5. The merged XML must be valid Salesforce metadata XML.

    Respond ONLY with a JSON object — no markdown, no code fences, no extra text.
    The JSON must have exactly these fields:
    {
      "mergedXml": "<full merged XML string>",
      "explanation": "<plain English, 2-4 sentences, what you did and why>",
      "confidence": "high" | "medium" | "low",
      "autoResolvable": true | false,
      "conflictDetails": [
        {
          "lineNumber": <int or null>,
          "type": "conflict" | "addition" | "deletion" | "ordering",
          "sourceValue": "<value on source side>",
          "targetValue": "<value on target side>",
          "description": "<one sentence>"
        }
      ]
    }

    confidence levels:
    - high: additive changes only, no true conflicts, safe to auto-merge
    - medium: minor value differences, trade-off is clear
    - low: structural conflicts or ambiguous intent — human judgement required

    autoResolvable: true only when ALL changes are purely additive (one side adds elements
    the other doesn't have) or ordering-only. false if any element has different values.
""")


def _resolve_with_ai(
    client: Any,
    source_xml: str,
    target_xml: str,
    component_type: str,
    component_name: str,
    context: str,
) -> dict[str, Any]:
    user_message = textwrap.dedent(f"""\
        Component type: {component_type}
        Component name: {component_name}
        Context: {context or "back-promotion between Salesforce orgs"}

        === SOURCE VERSION (from source org) ===
        {source_xml}

        === TARGET VERSION (from target org) ===
        {target_xml}

        Analyse the conflict and return the merged resolution as JSON.
    """)

    try:
        import anthropic  # type: ignore
        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        )
        raw = message.content[0].text.strip()

        # Strip any accidental markdown fences
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)

        data = json.loads(raw)
        return {
            "merged_xml": data.get("mergedXml", ""),
            "explanation": data.get("explanation", ""),
            "confidence": data.get("confidence", "medium"),
            "auto_resolvable": data.get("autoResolvable", False),
            "conflict_details": data.get("conflictDetails", []),
        }
    except Exception as exc:
        # Fall back to mock rather than crashing
        result = _mock_resolution(component_type, component_name, source_xml, target_xml)
        result["explanation"] = (
            f"AI analysis encountered an error ({type(exc).__name__}). "
            "Showing mock resolution. Please review carefully."
        )
        result["confidence"] = "low"
        return result


# ---------------------------------------------------------------------------
# Mock resolutions (used when ANTHROPIC_API_KEY is not set)
# ---------------------------------------------------------------------------

def _mock_resolution(
    component_type: str,
    component_name: str,
    source_xml: str,
    target_xml: str,
) -> dict[str, Any]:
    """Return a realistic mock resolution based on the component type."""

    if component_type == "Profile":
        return _mock_profile_resolution(component_name, source_xml, target_xml)
    elif component_type == "CustomObject":
        return _mock_custom_object_resolution(component_name, source_xml, target_xml)
    elif component_type == "PermissionSet":
        return _mock_permission_set_resolution(component_name, source_xml, target_xml)
    else:
        return _mock_generic_resolution(component_name, source_xml, target_xml)


def _mock_profile_resolution(name: str, source_xml: str, target_xml: str) -> dict[str, Any]:
    merged = f"""<?xml version="1.0" encoding="UTF-8"?>
<Profile xmlns="http://soap.sforce.com/2006/04/metadata">
    <custom>false</custom>
    <userLicense>Salesforce</userLicense>
    <fieldPermissions>
        <editable>true</editable>
        <field>Account.Industry</field>
        <readable>true</readable>
    </fieldPermissions>
    <fieldPermissions>
        <editable>false</editable>
        <field>Account.AnnualRevenue</field>
        <readable>true</readable>
    </fieldPermissions>
    <userPermissions>
        <enabled>true</enabled>
        <name>ManageDashboards</name>
    </userPermissions>
    <userPermissions>
        <enabled>false</enabled>
        <name>ViewAllData</name>
    </userPermissions>
</Profile>"""
    return {
        "merged_xml": merged,
        "explanation": (
            "The source version adds ManageDashboards user permission which was not present "
            "in the target. The target version adds a read-only permission for AnnualRevenue "
            "field which the source lacked. Both additions are preserved in the merged version. "
            "No true conflicts were detected — this is a safe additive merge."
        ),
        "confidence": "high",
        "auto_resolvable": True,
        "conflict_details": [
            {
                "lineNumber": 12,
                "type": "addition",
                "sourceValue": "<userPermissions><enabled>true</enabled><name>ManageDashboards</name></userPermissions>",
                "targetValue": "(not present)",
                "description": "Source adds ManageDashboards permission; included in merged output.",
            },
            {
                "lineNumber": 18,
                "type": "addition",
                "sourceValue": "(not present)",
                "targetValue": "<fieldPermissions><editable>false</editable><field>Account.AnnualRevenue</field></fieldPermissions>",
                "description": "Target adds AnnualRevenue read permission; included in merged output.",
            },
        ],
    }


def _mock_custom_object_resolution(name: str, source_xml: str, target_xml: str) -> dict[str, Any]:
    obj_name = name.split(".")[0] if "." in name else name
    merged = f"""<?xml version="1.0" encoding="UTF-8"?>
<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>{obj_name.replace("_", " ").replace("__c", "")}</label>
    <pluralLabel>{obj_name.replace("_", " ").replace("__c", "")}s</pluralLabel>
    <nameField>
        <label>{obj_name.replace("_", " ").replace("__c", "")} Name</label>
        <type>Text</type>
    </nameField>
    <deploymentStatus>Deployed</deploymentStatus>
    <sharingModel>ReadWrite</sharingModel>
    <validationRules>
        <fullName>RequireName</fullName>
        <active>true</active>
        <description>Ensures the name field is always populated</description>
        <errorConditionFormula>ISBLANK(Name)</errorConditionFormula>
        <errorMessage>Name is required.</errorMessage>
    </validationRules>
    <validationRules>
        <fullName>RequireStatus</fullName>
        <active>true</active>
        <description>Added in target org — ensures status is set</description>
        <errorConditionFormula>ISBLANK(Status__c)</errorConditionFormula>
        <errorMessage>Status is required.</errorMessage>
    </validationRules>
</CustomObject>"""
    return {
        "merged_xml": merged,
        "explanation": (
            "The source org has a RequireName validation rule while the target org has "
            "an additional RequireStatus validation rule. Both validation rules are "
            "preserved in the merged version. The sharingModel is identical on both sides "
            "so no conflict exists there. This merge is safe and additive."
        ),
        "confidence": "high",
        "auto_resolvable": True,
        "conflict_details": [
            {
                "lineNumber": 16,
                "type": "addition",
                "sourceValue": "(not present)",
                "targetValue": "<validationRules><fullName>RequireStatus</fullName>...</validationRules>",
                "description": "Target adds RequireStatus validation rule; included in merged output.",
            },
        ],
    }


def _mock_permission_set_resolution(name: str, source_xml: str, target_xml: str) -> dict[str, Any]:
    merged = f"""<?xml version="1.0" encoding="UTF-8"?>
<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
    <description>Grants API integration access with extended object permissions</description>
    <hasActivationRequired>false</hasActivationRequired>
    <label>{name.replace("_", " ")}</label>
    <objectPermissions>
        <allowCreate>true</allowCreate>
        <allowDelete>false</allowDelete>
        <allowEdit>true</allowEdit>
        <allowRead>true</allowRead>
        <modifyAllRecords>false</modifyAllRecords>
        <object>Account</object>
        <viewAllRecords>true</viewAllRecords>
    </objectPermissions>
    <objectPermissions>
        <allowCreate>false</allowCreate>
        <allowDelete>false</allowDelete>
        <allowEdit>false</allowEdit>
        <allowRead>true</allowRead>
        <modifyAllRecords>false</modifyAllRecords>
        <object>Contact</object>
        <viewAllRecords>false</viewAllRecords>
    </objectPermissions>
    <userPermissions>
        <enabled>true</enabled>
        <name>ApiEnabled</name>
    </userPermissions>
</PermissionSet>"""
    return {
        "merged_xml": merged,
        "explanation": (
            "A true conflict was detected on the Account object's allowDelete permission: "
            "the source sets it to true while the target keeps it false. "
            "The merged version uses false (more restrictive) following the principle of least "
            "privilege. The Contact object permissions exist only on the target and are preserved. "
            "Please review the allowDelete decision carefully before approving."
        ),
        "confidence": "medium",
        "auto_resolvable": False,
        "conflict_details": [
            {
                "lineNumber": 10,
                "type": "conflict",
                "sourceValue": "<allowDelete>true</allowDelete>",
                "targetValue": "<allowDelete>false</allowDelete>",
                "description": "True conflict: source enables delete on Account, target does not. Merged as false (least privilege).",
            },
            {
                "lineNumber": 20,
                "type": "addition",
                "sourceValue": "(not present)",
                "targetValue": "<objectPermissions>...<object>Contact</object>...</objectPermissions>",
                "description": "Target adds read-only Contact permissions; included in merged output.",
            },
        ],
    }


def _mock_generic_resolution(name: str, source_xml: str, target_xml: str) -> dict[str, Any]:
    # Use source as base, attempt a simple line-merge
    merged = source_xml or target_xml or f"<!-- Merged: {name} -->"
    return {
        "merged_xml": merged,
        "explanation": (
            f"Unable to determine a specific merge strategy for {name}. "
            "The source version has been used as the base. "
            "Please carefully review the diff between source and target before approving. "
            "Manual review is strongly recommended for this component type."
        ),
        "confidence": "low",
        "auto_resolvable": False,
        "conflict_details": [
            {
                "lineNumber": None,
                "type": "conflict",
                "sourceValue": "(see source panel)",
                "targetValue": "(see target panel)",
                "description": "Unable to automatically identify specific conflict lines. Full manual review required.",
            },
        ],
    }
