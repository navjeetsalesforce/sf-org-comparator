# SF Org Comparator

Built by the Salesforce GDC Team. Compare metadata between two Salesforce orgs, create back-promotion PRs, and resolve conflicts with AI assistance.

Compare metadata between two Salesforce orgs using SFDX CLI stored authentication — no JWT files, no passwords, no extra setup.

---

## Quick Start

### 1. Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Python | ≥ 3.11 | [python.org](https://python.org) |
| Node.js | ≥ 18 | [nodejs.org](https://nodejs.org) |
| Salesforce CLI | latest | `npm install -g @salesforce/cli` |

### 2. Authenticate your orgs (one time)

```bash
sf org login web --alias dev-sandbox
sf org login web --alias production
```

### 3. Start the tool

```bash
chmod +x start.sh
./start.sh
```

Open **http://localhost:5175**

---

## Demo mode (no Salesforce auth needed)

Toggle **Demo mode** in the UI (or add `?mock=true` to API calls) to see realistic mock comparison data covering all 4 statuses with 20+ components — no orgs required.

---

## Features

| Feature | Description |
|---------|-------------|
| Org selector | Reads SFDX-authenticated orgs via `sf org list` |
| 14 metadata types | ApexClass, ApexTrigger, LWC, Aura, Flow, CustomObject, CustomField, Profile, PermissionSet, Layout, CustomTab, CustomApplication, ValidationRule, WorkflowRule |
| Diff table | Status badges: Identical / Different / Source Only / Target Only |
| Side-by-side XML diff | Split and unified view with line-level diff highlighting |
| Validate on target | Runs checkonly deploy via `sf project deploy start --dry-run` |
| Create GitHub PR | Creates a back-promotion PR with package.xml on a new branch |
| Export package.xml | Downloads a valid Salesforce package.xml for selected components |
| Dark theme | Matches Salesforce DevOps Dashboard design |

---

## Architecture

```
sf-org-comparator/
├── backend/                  FastAPI (Python)
│   ├── main.py               All API routes
│   └── services/
│       ├── sfdx.py           sf CLI wrapper
│       └── metadata.py       Metadata API (SOAP) + diffing
└── frontend/                 React + TypeScript + Vite
    └── src/
        ├── App.tsx
        └── components/
            ├── OrgSelector.tsx
            ├── MetadataFilter.tsx
            ├── ComparatorTable.tsx
            ├── XmlDiffViewer.tsx
            └── ActionPanel.tsx
```

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/orgs` | List SFDX-authenticated orgs |
| GET | `/api/metadata/types` | List supported metadata types |
| POST | `/api/compare?mock=true` | Compare two orgs |
| GET | `/api/component?org=X&type=Y&name=Z` | Get raw XML of a component |
| POST | `/api/validate` | Checkonly deploy (dry run) |
| POST | `/api/pr` | Create GitHub back-promotion PR |

---

## GitHub PR creation

Export `GITHUB_TOKEN` before starting the backend:

```bash
export GITHUB_TOKEN=ghp_your_token_here
./start.sh
```

The token needs `repo` scope on the target repository.

---

## License

MIT — built as an open-source alternative to Copado's Org Comparator.
