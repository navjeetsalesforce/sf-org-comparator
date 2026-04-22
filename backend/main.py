"""
main.py — Salesforce Org Comparator FastAPI backend.

Routes:
  GET  /api/orgs                          List all SFDX-authenticated orgs
  GET  /api/metadata/types                List supported metadata types
  POST /api/compare                       Compare two orgs
  GET  /api/component                     Get raw XML of a single component
  POST /api/validate                      Run checkonly deploy to target org
  POST /api/pr                            Create GitHub PR for selected components
  POST /api/conflicts/analyse             AI-powered conflict analysis
  POST /api/conflicts/apply               Commit approved resolutions to PR branch
  GET  /api/conflicts/status/{pr_number}  Conflict status of a PR
"""

import asyncio
import json
import os
import subprocess
import textwrap
from datetime import datetime, timedelta
from typing import Any, Optional
import random

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from services import sfdx, metadata as meta_svc
from services import ai_resolver

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(
    title="SF Org Comparator",
    description="Compare Salesforce orgs using SFDX CLI auth",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class CompareRequest(BaseModel):
    sourceOrg: str
    targetOrg: str
    metadataTypes: list[str] = meta_svc.SUPPORTED_METADATA_TYPES


class ValidateRequest(BaseModel):
    targetOrg: str
    components: list[dict[str, str]]  # [{type, name}, ...]


class PRRequest(BaseModel):
    components: list[dict[str, str]]  # [{type, name}, ...]
    sourceOrg: str
    targetOrg: str
    githubRepo: str = "navjeetshekhawat/sf-org-comparator"


class ConflictComponent(BaseModel):
    type: str
    name: str
    sourceXml: str
    targetXml: str


class AnalyseConflictsRequest(BaseModel):
    components: list[ConflictComponent]
    conflictContext: str = ""


class ApprovedResolution(BaseModel):
    type: str
    name: str
    proposedXml: str


class ApplyResolutionsRequest(BaseModel):
    approvedResolutions: list[ApprovedResolution]
    branch: str
    repo: str


# ---------------------------------------------------------------------------
# Mock data helpers
# ---------------------------------------------------------------------------

_MOCK_DATE_BASE = datetime(2024, 1, 15)

def _mock_date(offset_days: int = 0) -> str:
    return (_MOCK_DATE_BASE + timedelta(days=offset_days)).strftime("%Y-%m-%dT%H:%M:%S.000Z")

def _apex_class_xml(class_name: str, version: str = "src") -> str:
    return textwrap.dedent(f"""\
        <?xml version="1.0" encoding="UTF-8"?>
        <ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">
            <apiVersion>60.0</apiVersion>
            <status>Active</status>
        </ApexClass>
        <!-- {class_name} {version} -->
    """)

def _flow_xml(flow_name: str, label: str = "My Flow") -> str:
    return textwrap.dedent(f"""\
        <?xml version="1.0" encoding="UTF-8"?>
        <Flow xmlns="http://soap.sforce.com/2006/04/metadata">
            <apiVersion>60.0</apiVersion>
            <label>{label}</label>
            <processMetadataValues>
                <name>BuilderType</name>
                <value><stringValue>LightningFlowBuilder</stringValue></value>
            </processMetadataValues>
            <processType>AutoLaunchedFlow</processType>
            <start>
                <locationX>176</locationX>
                <locationY>134</locationY>
            </start>
            <status>Active</status>
        </Flow>
    """)

def _profile_xml(profile_name: str, extra_perm: bool = False) -> str:
    extra = "    <userPermissions>\n        <enabled>true</enabled>\n        <name>ManageDashboards</name>\n    </userPermissions>\n" if extra_perm else ""
    return textwrap.dedent(f"""\
        <?xml version="1.0" encoding="UTF-8"?>
        <Profile xmlns="http://soap.sforce.com/2006/04/metadata">
            <custom>false</custom>
            <userLicense>Salesforce</userLicense>
            <fieldPermissions>
                <editable>true</editable>
                <field>Account.Industry</field>
                <readable>true</readable>
            </fieldPermissions>
        {extra}</Profile>
    """)

def _lwc_xml(name: str) -> str:
    return textwrap.dedent(f"""\
        <?xml version="1.0" encoding="UTF-8"?>
        <LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">
            <apiVersion>60.0</apiVersion>
            <isExposed>true</isExposed>
            <targets>
                <target>lightning__AppPage</target>
                <target>lightning__RecordPage</target>
            </targets>
        </LightningComponentBundle>
    """)

def _validation_xml(rule_name: str, active: bool = True) -> str:
    return textwrap.dedent(f"""\
        <?xml version="1.0" encoding="UTF-8"?>
        <ValidationRule xmlns="http://soap.sforce.com/2006/04/metadata">
            <fullName>{rule_name}</fullName>
            <active>{str(active).lower()}</active>
            <description>Validates {rule_name}</description>
            <errorConditionFormula>ISBLANK(Name)</errorConditionFormula>
            <errorMessage>Name is required.</errorMessage>
        </ValidationRule>
    """)

def _diff_lines(src: str, tgt: str) -> list[dict]:
    import difflib
    s_lines = src.splitlines()
    t_lines = tgt.splitlines()
    diff = []
    matcher = difflib.SequenceMatcher(None, s_lines, t_lines, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for idx, line in enumerate(s_lines[i1:i2]):
                diff.append({"line": line, "type": "equal", "sourceLineNum": i1+idx+1, "targetLineNum": j1+idx+1})
        elif tag == "replace":
            sc, tc = s_lines[i1:i2], t_lines[j1:j2]
            for k in range(max(len(sc), len(tc))):
                sl = sc[k] if k < len(sc) else None
                tl = tc[k] if k < len(tc) else None
                if sl and tl:
                    diff.append({"sourceLine": sl, "targetLine": tl, "type": "changed", "sourceLineNum": i1+k+1, "targetLineNum": j1+k+1})
                elif sl:
                    diff.append({"line": sl, "type": "removed", "sourceLineNum": i1+k+1, "targetLineNum": None})
                else:
                    diff.append({"line": tl, "type": "added", "sourceLineNum": None, "targetLineNum": j1+k+1})
        elif tag == "delete":
            for idx, line in enumerate(s_lines[i1:i2]):
                diff.append({"line": line, "type": "removed", "sourceLineNum": i1+idx+1, "targetLineNum": None})
        elif tag == "insert":
            for idx, line in enumerate(t_lines[j1:j2]):
                diff.append({"line": line, "type": "added", "sourceLineNum": None, "targetLineNum": j1+idx+1})
    return diff

MOCK_RESULTS: list[dict[str, Any]] = [
    # ----- ApexClass -----
    {
        "type": "ApexClass", "name": "AccountService",
        "status": "different",
        "sourceLastModified": _mock_date(0), "targetLastModified": _mock_date(-5),
        "sourceLastModifiedBy": "dev@myorg.com", "targetLastModifiedBy": "admin@prodorg.com",
        "sourceXml": _apex_class_xml("AccountService", "v2"),
        "targetXml": _apex_class_xml("AccountService", "v1"),
    },
    {
        "type": "ApexClass", "name": "LeadConversionHelper",
        "status": "source_only",
        "sourceLastModified": _mock_date(-2), "targetLastModified": "",
        "sourceLastModifiedBy": "dev@myorg.com", "targetLastModifiedBy": "",
        "sourceXml": _apex_class_xml("LeadConversionHelper"),
        "targetXml": "",
    },
    {
        "type": "ApexClass", "name": "OpportunityController",
        "status": "identical",
        "sourceLastModified": _mock_date(-10), "targetLastModified": _mock_date(-10),
        "sourceLastModifiedBy": "admin@myorg.com", "targetLastModifiedBy": "admin@prodorg.com",
        "sourceXml": _apex_class_xml("OpportunityController"),
        "targetXml": _apex_class_xml("OpportunityController"),
    },
    {
        "type": "ApexClass", "name": "CaseEscalationBatch",
        "status": "different",
        "sourceLastModified": _mock_date(-1), "targetLastModified": _mock_date(-8),
        "sourceLastModifiedBy": "dev@myorg.com", "targetLastModifiedBy": "admin@prodorg.com",
        "sourceXml": _apex_class_xml("CaseEscalationBatch", "updated"),
        "targetXml": _apex_class_xml("CaseEscalationBatch", "old"),
    },
    {
        "type": "ApexClass", "name": "EmailNotificationService",
        "status": "identical",
        "sourceLastModified": _mock_date(-15), "targetLastModified": _mock_date(-15),
        "sourceLastModifiedBy": "ci@myorg.com", "targetLastModifiedBy": "ci@prodorg.com",
        "sourceXml": _apex_class_xml("EmailNotificationService"),
        "targetXml": _apex_class_xml("EmailNotificationService"),
    },
    # ----- ApexTrigger -----
    {
        "type": "ApexTrigger", "name": "AccountTrigger",
        "status": "different",
        "sourceLastModified": _mock_date(-3), "targetLastModified": _mock_date(-12),
        "sourceLastModifiedBy": "dev@myorg.com", "targetLastModifiedBy": "admin@prodorg.com",
        "sourceXml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<ApexTrigger xmlns=\"http://soap.sforce.com/2006/04/metadata\">\n    <apiVersion>60.0</apiVersion>\n    <status>Active</status>\n    <!-- new routing logic -->\n</ApexTrigger>",
        "targetXml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<ApexTrigger xmlns=\"http://soap.sforce.com/2006/04/metadata\">\n    <apiVersion>59.0</apiVersion>\n    <status>Active</status>\n</ApexTrigger>",
    },
    {
        "type": "ApexTrigger", "name": "OpportunityTrigger",
        "status": "target_only",
        "sourceLastModified": "", "targetLastModified": _mock_date(-20),
        "sourceLastModifiedBy": "", "targetLastModifiedBy": "admin@prodorg.com",
        "sourceXml": "",
        "targetXml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<ApexTrigger xmlns=\"http://soap.sforce.com/2006/04/metadata\">\n    <apiVersion>58.0</apiVersion>\n    <status>Active</status>\n    <!-- legacy trigger pending retirement -->\n</ApexTrigger>",
    },
    # ----- LightningComponentBundle -----
    {
        "type": "LightningComponentBundle", "name": "accountDashboard",
        "status": "different",
        "sourceLastModified": _mock_date(-1), "targetLastModified": _mock_date(-6),
        "sourceLastModifiedBy": "ux@myorg.com", "targetLastModifiedBy": "admin@prodorg.com",
        "sourceXml": _lwc_xml("accountDashboard") + "<!-- exposed to more targets -->",
        "targetXml": _lwc_xml("accountDashboard"),
    },
    {
        "type": "LightningComponentBundle", "name": "caseTimeline",
        "status": "source_only",
        "sourceLastModified": _mock_date(-4), "targetLastModified": "",
        "sourceLastModifiedBy": "ux@myorg.com", "targetLastModifiedBy": "",
        "sourceXml": _lwc_xml("caseTimeline"),
        "targetXml": "",
    },
    {
        "type": "LightningComponentBundle", "name": "navBar",
        "status": "identical",
        "sourceLastModified": _mock_date(-30), "targetLastModified": _mock_date(-30),
        "sourceLastModifiedBy": "admin@myorg.com", "targetLastModifiedBy": "admin@prodorg.com",
        "sourceXml": _lwc_xml("navBar"),
        "targetXml": _lwc_xml("navBar"),
    },
    # ----- Flow -----
    {
        "type": "Flow", "name": "Lead_Qualification_Flow",
        "status": "different",
        "sourceLastModified": _mock_date(-2), "targetLastModified": _mock_date(-9),
        "sourceLastModifiedBy": "ba@myorg.com", "targetLastModifiedBy": "admin@prodorg.com",
        "sourceXml": _flow_xml("Lead_Qualification_Flow", "Lead Qualification v2"),
        "targetXml": _flow_xml("Lead_Qualification_Flow", "Lead Qualification v1"),
    },
    {
        "type": "Flow", "name": "Onboarding_Welcome_Email",
        "status": "source_only",
        "sourceLastModified": _mock_date(-7), "targetLastModified": "",
        "sourceLastModifiedBy": "ba@myorg.com", "targetLastModifiedBy": "",
        "sourceXml": _flow_xml("Onboarding_Welcome_Email", "Onboarding Welcome Email"),
        "targetXml": "",
    },
    {
        "type": "Flow", "name": "Case_Routing_Flow",
        "status": "identical",
        "sourceLastModified": _mock_date(-14), "targetLastModified": _mock_date(-14),
        "sourceLastModifiedBy": "admin@myorg.com", "targetLastModifiedBy": "admin@prodorg.com",
        "sourceXml": _flow_xml("Case_Routing_Flow", "Case Routing"),
        "targetXml": _flow_xml("Case_Routing_Flow", "Case Routing"),
    },
    # ----- Profile -----
    {
        "type": "Profile", "name": "Sales_Rep",
        "status": "different",
        "sourceLastModified": _mock_date(-3), "targetLastModified": _mock_date(-11),
        "sourceLastModifiedBy": "admin@myorg.com", "targetLastModifiedBy": "admin@prodorg.com",
        "sourceXml": _profile_xml("Sales_Rep", extra_perm=True),
        "targetXml": _profile_xml("Sales_Rep", extra_perm=False),
    },
    {
        "type": "Profile", "name": "System_Administrator",
        "status": "identical",
        "sourceLastModified": _mock_date(-20), "targetLastModified": _mock_date(-20),
        "sourceLastModifiedBy": "admin@myorg.com", "targetLastModifiedBy": "admin@prodorg.com",
        "sourceXml": _profile_xml("System_Administrator"),
        "targetXml": _profile_xml("System_Administrator"),
    },
    # ----- PermissionSet -----
    {
        "type": "PermissionSet", "name": "API_Integration_Access",
        "status": "source_only",
        "sourceLastModified": _mock_date(-1), "targetLastModified": "",
        "sourceLastModifiedBy": "admin@myorg.com", "targetLastModifiedBy": "",
        "sourceXml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<PermissionSet xmlns=\"http://soap.sforce.com/2006/04/metadata\">\n    <description>Grants API integration access</description>\n    <hasActivationRequired>false</hasActivationRequired>\n    <label>API Integration Access</label>\n</PermissionSet>",
        "targetXml": "",
    },
    # ----- ValidationRule -----
    {
        "type": "ValidationRule", "name": "Account.RequireIndustry",
        "status": "different",
        "sourceLastModified": _mock_date(-5), "targetLastModified": _mock_date(-18),
        "sourceLastModifiedBy": "admin@myorg.com", "targetLastModifiedBy": "admin@prodorg.com",
        "sourceXml": _validation_xml("RequireIndustry", active=True),
        "targetXml": _validation_xml("RequireIndustry", active=False),
    },
    {
        "type": "ValidationRule", "name": "Opportunity.RequireCloseDate",
        "status": "target_only",
        "sourceLastModified": "", "targetLastModified": _mock_date(-25),
        "sourceLastModifiedBy": "", "targetLastModifiedBy": "admin@prodorg.com",
        "sourceXml": "",
        "targetXml": _validation_xml("RequireCloseDate", active=True),
    },
    # ----- Layout -----
    {
        "type": "Layout", "name": "Account-Account Layout",
        "status": "different",
        "sourceLastModified": _mock_date(-4), "targetLastModified": _mock_date(-13),
        "sourceLastModifiedBy": "ux@myorg.com", "targetLastModifiedBy": "admin@prodorg.com",
        "sourceXml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Layout xmlns=\"http://soap.sforce.com/2006/04/metadata\">\n    <layoutSections>\n        <label>Account Information</label>\n        <!-- new fields added -->\n    </layoutSections>\n</Layout>",
        "targetXml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Layout xmlns=\"http://soap.sforce.com/2006/04/metadata\">\n    <layoutSections>\n        <label>Account Information</label>\n    </layoutSections>\n</Layout>",
    },
    # ----- CustomObject -----
    {
        "type": "CustomObject", "name": "Revenue_Goal__c",
        "status": "source_only",
        "sourceLastModified": _mock_date(-6), "targetLastModified": "",
        "sourceLastModifiedBy": "dev@myorg.com", "targetLastModifiedBy": "",
        "sourceXml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<CustomObject xmlns=\"http://soap.sforce.com/2006/04/metadata\">\n    <label>Revenue Goal</label>\n    <pluralLabel>Revenue Goals</pluralLabel>\n    <nameField>\n        <label>Revenue Goal Name</label>\n        <type>Text</type>\n    </nameField>\n    <deploymentStatus>Deployed</deploymentStatus>\n    <sharingModel>ReadWrite</sharingModel>\n</CustomObject>",
        "targetXml": "",
    },
    # ----- WorkflowRule -----
    {
        "type": "WorkflowRule", "name": "Case.EscalateHighPriority",
        "status": "identical",
        "sourceLastModified": _mock_date(-22), "targetLastModified": _mock_date(-22),
        "sourceLastModifiedBy": "admin@myorg.com", "targetLastModifiedBy": "admin@prodorg.com",
        "sourceXml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<WorkflowRule xmlns=\"http://soap.sforce.com/2006/04/metadata\">\n    <fullName>EscalateHighPriority</fullName>\n    <active>true</active>\n    <criteriaItems>\n        <field>Case.Priority</field>\n        <operation>equals</operation>\n        <value>High</value>\n    </criteriaItems>\n    <triggerType>onCreateOrTriggeringUpdate</triggerType>\n</WorkflowRule>",
        "targetXml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<WorkflowRule xmlns=\"http://soap.sforce.com/2006/04/metadata\">\n    <fullName>EscalateHighPriority</fullName>\n    <active>true</active>\n    <criteriaItems>\n        <field>Case.Priority</field>\n        <operation>equals</operation>\n        <value>High</value>\n    </criteriaItems>\n    <triggerType>onCreateOrTriggeringUpdate</triggerType>\n</WorkflowRule>",
    },
]

# Populate diff for mock results
for _r in MOCK_RESULTS:
    _r["diff"] = _diff_lines(_r["sourceXml"], _r["targetXml"])


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/api/orgs")
async def get_orgs(mock: bool = False):
    """List all SFDX-authenticated orgs. Returns mock orgs if sf CLI not available."""
    if mock:
        return _mock_orgs()
    try:
        orgs = sfdx.list_orgs()
        if not orgs:
            return _mock_orgs()
        return orgs
    except RuntimeError as exc:
        # Return mock orgs so the UI is always demonstrable
        return _mock_orgs()


def _mock_orgs():
    return [
        {
            "alias": "dev-sandbox",
            "username": "dev@myorg.com.sandbox",
            "instanceUrl": "https://myorg--dev.sandbox.my.salesforce.com",
            "isDefault": True,
            "orgId": "00D000000000001",
        },
        {
            "alias": "staging",
            "username": "dev@myorg.com.staging",
            "instanceUrl": "https://myorg--staging.sandbox.my.salesforce.com",
            "isDefault": False,
            "orgId": "00D000000000002",
        },
        {
            "alias": "production",
            "username": "admin@myorg.com",
            "instanceUrl": "https://myorg.my.salesforce.com",
            "isDefault": False,
            "orgId": "00D000000000003",
        },
    ]


@app.get("/api/metadata/types")
async def get_metadata_types():
    """Return the list of supported metadata types."""
    return {"types": meta_svc.SUPPORTED_METADATA_TYPES}


@app.post("/api/compare")
async def compare_orgs(body: CompareRequest, mock: bool = False):
    """
    Compare two orgs. Add ?mock=true to return realistic demo data without Salesforce auth.
    """
    if mock or body.sourceOrg.startswith("mock") or body.targetOrg.startswith("mock"):
        filtered = [
            r for r in MOCK_RESULTS
            if not body.metadataTypes or r["type"] in body.metadataTypes
        ]
        return {
            "results": filtered,
            "summary": _build_summary(filtered),
            "mock": True,
        }

    try:
        src_auth = sfdx.get_org_access_token(body.sourceOrg)
        tgt_auth = sfdx.get_org_access_token(body.targetOrg)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        results = await meta_svc.compare_orgs(
            source_token=src_auth["accessToken"],
            source_url=src_auth["instanceUrl"],
            target_token=tgt_auth["accessToken"],
            target_url=tgt_auth["instanceUrl"],
            metadata_types=body.metadataTypes,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Comparison failed: {exc}")

    return {
        "results": results,
        "summary": _build_summary(results),
        "mock": False,
    }


def _build_summary(results: list[dict]) -> dict:
    summary = {"total": len(results), "identical": 0, "different": 0, "source_only": 0, "target_only": 0}
    for r in results:
        s = r.get("status", "")
        if s in summary:
            summary[s] += 1
    return summary


@app.get("/api/component")
async def get_component(
    org: str = Query(..., description="Org alias or username"),
    type: str = Query(..., description="Metadata type"),
    name: str = Query(..., description="Component full name"),
    mock: bool = False,
):
    """Retrieve raw XML of a single metadata component from an org."""
    if mock:
        for r in MOCK_RESULTS:
            if r["type"] == type and r["name"] == name:
                return {"xml": r["sourceXml"], "mock": True}
        return {"xml": "", "mock": True}

    try:
        auth = sfdx.get_org_access_token(org)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    xml = await meta_svc.get_component_xml(
        auth["accessToken"], auth["instanceUrl"], type, name
    )
    return {"xml": xml, "mock": False}


@app.post("/api/validate")
async def validate_components(body: ValidateRequest, mock: bool = False):
    """
    Run a checkonly deploy of selected components to the target org.
    Returns per-component pass/fail status.
    """
    if mock:
        return _mock_validation(body.components)

    # Build a temporary package.xml and run sf project deploy start --dry-run
    import tempfile, os
    with tempfile.TemporaryDirectory() as tmpdir:
        pkg_xml = _build_package_xml(body.components)
        pkg_path = os.path.join(tmpdir, "package.xml")
        with open(pkg_path, "w") as f:
            f.write(pkg_xml)

        try:
            result = sfdx.run_sfdx([
                "project", "deploy", "start",
                "--target-org", body.targetOrg,
                "--manifest", pkg_path,
                "--dry-run",
                "--json",
            ])
        except RuntimeError as exc:
            return {
                "success": False,
                "error": str(exc),
                "components": [
                    {"type": c["type"], "name": c["name"], "status": "unknown", "error": str(exc)}
                    for c in body.components
                ],
            }

    deploy_result = result.get("deployResult") or result
    success = deploy_result.get("success", False)
    component_failures = deploy_result.get("details", {}).get("componentFailures") or []
    failures_by_name = {
        (f.get("componentType", ""), f.get("fullName", "")): f.get("problem", "Unknown error")
        for f in (component_failures if isinstance(component_failures, list) else [component_failures])
    }

    components_out = []
    for c in body.components:
        key = (c["type"], c["name"])
        if key in failures_by_name:
            components_out.append({"type": c["type"], "name": c["name"], "status": "failed", "error": failures_by_name[key]})
        else:
            components_out.append({"type": c["type"], "name": c["name"], "status": "passed", "error": None})

    return {"success": success, "components": components_out}


def _mock_validation(components: list[dict]) -> dict:
    results = []
    for i, c in enumerate(components):
        if i % 5 == 3:  # Simulate one failure for demo
            results.append({"type": c["type"], "name": c["name"], "status": "failed",
                            "error": "Test coverage is 0%, at least 75% test coverage is required."})
        else:
            results.append({"type": c["type"], "name": c["name"], "status": "passed", "error": None})
    overall = all(r["status"] == "passed" for r in results)
    return {"success": overall, "components": results, "mock": True}


@app.post("/api/pr")
async def create_pr(body: PRRequest):
    """
    Create a GitHub pull request for selected components.
    Requires GITHUB_TOKEN environment variable.
    """
    github_token = os.environ.get("GITHUB_TOKEN", "")
    if not github_token:
        raise HTTPException(
            status_code=400,
            detail="GITHUB_TOKEN environment variable is not set. "
                   "Export it before starting the backend: export GITHUB_TOKEN=ghp_...",
        )

    repo = body.githubRepo
    branch_name = f"back-promote/{body.sourceOrg}-to-{body.targetOrg}-{int(datetime.utcnow().timestamp())}"

    # Build a human-readable component list for the PR body
    type_groups: dict[str, list[str]] = {}
    for c in body.components:
        type_groups.setdefault(c["type"], []).append(c["name"])

    component_md = "\n".join(
        f"**{mtype}**: {', '.join(names)}" for mtype, names in sorted(type_groups.items())
    )
    pkg_xml = _build_package_xml(body.components)

    pr_body = textwrap.dedent(f"""\
        ## Back-Promotion: `{body.sourceOrg}` → `{body.targetOrg}`

        ### Components
        {component_md}

        ### package.xml
        ```xml
        {pkg_xml}
        ```

        ---
        *Created by SF Org Comparator*
    """)

    async with httpx.AsyncClient() as client:
        # Check if repo exists and get default branch
        repo_resp = await client.get(
            f"https://api.github.com/repos/{repo}",
            headers={"Authorization": f"token {github_token}", "Accept": "application/vnd.github.v3+json"},
        )
        if repo_resp.status_code == 404:
            raise HTTPException(status_code=400, detail=f"GitHub repo '{repo}' not found.")
        repo_data = repo_resp.json()
        default_branch = repo_data.get("default_branch", "main")

        # Get the SHA of the default branch
        ref_resp = await client.get(
            f"https://api.github.com/repos/{repo}/git/ref/heads/{default_branch}",
            headers={"Authorization": f"token {github_token}", "Accept": "application/vnd.github.v3+json"},
        )
        if ref_resp.status_code != 200:
            raise HTTPException(status_code=400, detail=f"Could not get default branch SHA: {ref_resp.text}")
        base_sha = ref_resp.json()["object"]["sha"]

        # Create new branch
        branch_resp = await client.post(
            f"https://api.github.com/repos/{repo}/git/refs",
            json={"ref": f"refs/heads/{branch_name}", "sha": base_sha},
            headers={"Authorization": f"token {github_token}", "Accept": "application/vnd.github.v3+json"},
        )
        if branch_resp.status_code not in (200, 201, 422):
            raise HTTPException(status_code=400, detail=f"Could not create branch: {branch_resp.text}")

        # Commit package.xml to new branch
        content_b64 = base64.b64encode(pkg_xml.encode()).decode()
        file_resp = await client.put(
            f"https://api.github.com/repos/{repo}/contents/package.xml",
            json={
                "message": f"chore: back-promote {len(body.components)} component(s) from {body.sourceOrg} to {body.targetOrg}",
                "content": content_b64,
                "branch": branch_name,
            },
            headers={"Authorization": f"token {github_token}", "Accept": "application/vnd.github.v3+json"},
        )

        # Create PR
        pr_resp = await client.post(
            f"https://api.github.com/repos/{repo}/pulls",
            json={
                "title": f"Back-promote: {body.sourceOrg} → {body.targetOrg} ({len(body.components)} components)",
                "body": pr_body,
                "head": branch_name,
                "base": default_branch,
            },
            headers={"Authorization": f"token {github_token}", "Accept": "application/vnd.github.v3+json"},
        )

    if pr_resp.status_code not in (200, 201):
        raise HTTPException(status_code=400, detail=f"PR creation failed: {pr_resp.text}")

    pr_data = pr_resp.json()
    return {
        "success": True,
        "prUrl": pr_data.get("html_url", ""),
        "prNumber": pr_data.get("number"),
        "branch": branch_name,
    }


def _build_package_xml(components: list[dict]) -> str:
    import xml.etree.ElementTree as ET
    from collections import defaultdict

    type_groups: dict[str, list[str]] = defaultdict(list)
    for c in components:
        type_groups[c["type"]].append(c["name"])

    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<Package xmlns="http://soap.sforce.com/2006/04/metadata">']
    for mtype in sorted(type_groups.keys()):
        lines.append("    <types>")
        for member in sorted(type_groups[mtype]):
            lines.append(f"        <members>{member}</members>")
        lines.append(f"        <name>{mtype}</name>")
        lines.append("    </types>")
    lines.append("    <version>60.0</version>")
    lines.append("</Package>")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Conflict resolution endpoints
# ---------------------------------------------------------------------------

@app.post("/api/conflicts/analyse")
async def analyse_conflicts(body: AnalyseConflictsRequest):
    """
    Analyse a set of conflicting Salesforce metadata components using AI.

    For each component, the AI produces:
      - A proposed merged XML
      - A plain-English explanation of what it did and why
      - A confidence level (high / medium / low)
      - Per-line conflict details
      - Whether the conflict is auto-resolvable (additive only)

    The response status for every resolution is "pending" — the user must
    approve or reject each one before anything can be committed.

    If ANTHROPIC_API_KEY is not set, returns realistic mock resolutions so
    the feature is always demonstrable in demo mode.
    """
    demo_mode = not bool(os.environ.get("ANTHROPIC_API_KEY", ""))

    resolutions = []
    for comp in body.components:
        try:
            result = ai_resolver.resolve_conflict(
                source_xml=comp.sourceXml,
                target_xml=comp.targetXml,
                component_type=comp.type,
                component_name=comp.name,
                context=body.conflictContext,
            )
        except Exception as exc:
            result = {
                "merged_xml": comp.sourceXml,
                "explanation": f"Analysis failed: {exc}. Using source XML as fallback.",
                "confidence": "low",
                "auto_resolvable": False,
                "conflict_details": [],
            }

        resolutions.append({
            "type": comp.type,
            "name": comp.name,
            "sourceXml": comp.sourceXml,
            "targetXml": comp.targetXml,
            "proposedXml": result["merged_xml"],
            "explanation": result["explanation"],
            "confidence": result["confidence"],
            "autoResolvable": result["auto_resolvable"],
            "conflictLines": result.get("conflict_details", []),
            "status": "pending",
            "demoMode": demo_mode,
        })

    return {
        "resolutions": resolutions,
        "demoMode": demo_mode,
        "totalCount": len(resolutions),
    }


@app.post("/api/conflicts/apply")
async def apply_resolutions(body: ApplyResolutionsRequest):
    """
    Commit approved conflict resolutions to a GitHub PR branch.

    This endpoint is only called AFTER the user has reviewed and approved
    individual resolutions in the UI. It commits each resolved XML file
    to the specified branch via the GitHub API.

    Requires GITHUB_TOKEN environment variable.
    """
    github_token = os.environ.get("GITHUB_TOKEN", "")
    if not github_token:
        raise HTTPException(
            status_code=400,
            detail=(
                "GITHUB_TOKEN environment variable is not set. "
                "Export it before starting the backend: export GITHUB_TOKEN=ghp_..."
            ),
        )

    if not body.approvedResolutions:
        raise HTTPException(status_code=400, detail="No approved resolutions provided.")

    repo = body.repo
    branch = body.branch
    committed_files: list[str] = []
    errors: list[str] = []

    async with httpx.AsyncClient() as client:
        headers = {
            "Authorization": f"token {github_token}",
            "Accept": "application/vnd.github.v3+json",
        }

        for resolution in body.approvedResolutions:
            # Derive the file path in the repo from type and name
            file_path = _component_to_file_path(resolution.type, resolution.name)
            content_b64 = base64.b64encode(resolution.proposedXml.encode()).decode()

            # Check if file already exists (to get its SHA for update)
            existing_sha: Optional[str] = None
            check_resp = await client.get(
                f"https://api.github.com/repos/{repo}/contents/{file_path}",
                headers=headers,
                params={"ref": branch},
            )
            if check_resp.status_code == 200:
                existing_sha = check_resp.json().get("sha")

            payload: dict[str, Any] = {
                "message": (
                    f"fix(conflict): resolve {resolution.type}/{resolution.name} merge conflict\n\n"
                    f"AI-suggested resolution approved by user. Review carefully before merging."
                ),
                "content": content_b64,
                "branch": branch,
            }
            if existing_sha:
                payload["sha"] = existing_sha

            put_resp = await client.put(
                f"https://api.github.com/repos/{repo}/contents/{file_path}",
                json=payload,
                headers=headers,
            )

            if put_resp.status_code in (200, 201):
                committed_files.append(file_path)
            else:
                errors.append(
                    f"{resolution.type}/{resolution.name}: {put_resp.status_code} {put_resp.text[:200]}"
                )

    if errors and not committed_files:
        raise HTTPException(
            status_code=500,
            detail=f"All commits failed: {'; '.join(errors)}",
        )

    return {
        "success": True,
        "committedFiles": committed_files,
        "errors": errors,
        "message": (
            f"Committed {len(committed_files)} resolved file(s) to branch '{branch}'. "
            "Merge the PR on GitHub when you are ready."
        ),
    }


@app.get("/api/conflicts/status/{pr_number}")
async def get_conflict_status(pr_number: int, repo: str = Query(...)):
    """
    Return the conflict status of a GitHub PR — which files have conflicts,
    which are resolved, and which are still pending.

    Requires GITHUB_TOKEN environment variable.
    """
    github_token = os.environ.get("GITHUB_TOKEN", "")
    if not github_token:
        raise HTTPException(
            status_code=400,
            detail="GITHUB_TOKEN environment variable is not set.",
        )

    async with httpx.AsyncClient() as client:
        headers = {
            "Authorization": f"token {github_token}",
            "Accept": "application/vnd.github.v3+json",
        }

        # Get PR details
        pr_resp = await client.get(
            f"https://api.github.com/repos/{repo}/pulls/{pr_number}",
            headers=headers,
        )
        if pr_resp.status_code == 404:
            raise HTTPException(status_code=404, detail=f"PR #{pr_number} not found in {repo}.")
        if pr_resp.status_code != 200:
            raise HTTPException(status_code=400, detail=f"GitHub API error: {pr_resp.text[:200]}")

        pr_data = pr_resp.json()

        # Get PR files
        files_resp = await client.get(
            f"https://api.github.com/repos/{repo}/pulls/{pr_number}/files",
            headers=headers,
        )
        files = files_resp.json() if files_resp.status_code == 200 else []

    return {
        "prNumber": pr_number,
        "prUrl": pr_data.get("html_url", ""),
        "title": pr_data.get("title", ""),
        "state": pr_data.get("state", ""),
        "mergeable": pr_data.get("mergeable"),
        "mergeableState": pr_data.get("mergeable_state", ""),
        "files": [
            {
                "filename": f.get("filename", ""),
                "status": f.get("status", ""),
                "additions": f.get("additions", 0),
                "deletions": f.get("deletions", 0),
                "hasConflict": f.get("status") == "modified" and pr_data.get("mergeable") is False,
            }
            for f in files
        ],
        "totalFiles": len(files),
    }


def _component_to_file_path(component_type: str, component_name: str) -> str:
    """Convert a Salesforce metadata type + name into a repo file path."""
    TYPE_DIRS = {
        "ApexClass": ("classes", "cls-meta.xml"),
        "ApexTrigger": ("triggers", "trigger-meta.xml"),
        "LightningComponentBundle": ("lwc", "js-meta.xml"),
        "AuraDefinitionBundle": ("aura", "cmp-meta.xml"),
        "Flow": ("flows", "flow-meta.xml"),
        "CustomObject": ("objects", "object-meta.xml"),
        "Profile": ("profiles", "profile-meta.xml"),
        "PermissionSet": ("permissionsets", "permissionset-meta.xml"),
        "Layout": ("layouts", "layout-meta.xml"),
        "ValidationRule": ("objects", "validationRule-meta.xml"),
        "WorkflowRule": ("workflows", "workflow-meta.xml"),
    }
    folder, suffix = TYPE_DIRS.get(component_type, ("metadata", "xml"))
    safe_name = component_name.replace("/", "_").replace("\\", "_")
    return f"force-app/main/default/{folder}/{safe_name}/{safe_name}.{suffix}"


# Health check
@app.get("/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}


import base64  # needed for PR creation — ensure it's imported at module level
