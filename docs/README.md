# IntuneManager — Documentation Index

All project documentation lives in this `docs/` folder.

---

## Core Documentation

| File | Audience | Description |
|------|----------|-------------|
| [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) | Developers / Contributors | Architecture, design decisions, data model, pipeline details, file structure, dependencies, web deployment (Azure Container Apps), known limitations, resolved issues |
| [USER_MANUAL.md](USER_MANUAL.md) | IT Administrators | Step-by-step guide: setup, connecting tenant, Dashboard, Installed Apps, App Catalog, Deploy page, Devices page, update workflows, settings, troubleshooting |
| [WORKFLOW.md](WORKFLOW.md) | All contributors | Enhanced Workflow Orchestration rules: planning triggers, peer review pattern, self-improvement loop, flight checklist, core principles |

---

## Deployment

The application runs as an **Electron desktop app** (Windows) or a **containerised web app** (Azure Container Apps, Linux).

| Mode | Entry point | Registry | Hosting |
|------|-------------|----------|---------|
| Desktop | `npm run build` → `IntuneManager.exe` | N/A | Local |
| Web | `.github/workflows/deploy-container-app.yml` → `ghcr.io/<owner>/intunemanager:latest` | GHCR | Azure Container Apps (East US) |

Container App URL: `https://ca-intunemanager-prod.yellowforest-c85ceb60.eastus.azurecontainerapps.io`

CI/CD pushes to `master` branch trigger an automatic build and deploy.

**Required GitHub Secrets for web deployment:**

| Secret | Purpose |
|--------|---------|
| `AZURE_CREDENTIALS` | Service principal JSON for `az login` |
| `DATABASE_URL` | Azure SQL connection string (sqlserver://) |
| `AZURE_CLIENT_ID` | Azure AD App Registration client ID (Phase 3 tenant auth) |
| `AZURE_CLIENT_SECRET` | Azure AD App Registration client secret (Phase 3 tenant auth) |

---

## Reviews

| File | Description |
|------|-------------|
| [PEER_REVIEW.md](PEER_REVIEW.md) | Multi-viewpoint peer review (2026-03-30): Endpoint Admin + Senior Developer + Security Engineer + UI/UX. 5 CRITICAL, 15 MAJOR, 14 MINOR, 6 INFO issues catalogued. 1 MINOR resolved post-review (token_expiry schema fix, 2026-03-31). |

---

## Feature Specifications

| File | Description |
|------|-------------|
| [specs/feature-spec-deploy-page.md](specs/feature-spec-deploy-page.md) | Original Deploy page feature spec: AI recommendations, search, deploy/package workflow decoupling |
| [specs/feature-spec-app-catalog.md](specs/feature-spec-app-catalog.md) | App Catalog + Deploy page refactor spec: separation of discovery vs. execution, Ready to Deploy list, workflow routing |
| [specs/feature-spec-device-page.md](specs/feature-spec-device-page.md) | Devices page feature spec: managed device list, compliance badges, update sync actions, diagnostics, attention indicators |
| [specs/feature-spec-dashboard.md](specs/feature-spec-dashboard.md) | Dashboard executive summary spec: charts, stat cards, alerts panel, auto-refresh, link to Installed Apps |
| [specs/feature-spec-installed-apss-page.md](specs/feature-spec-installed-apss-page.md) | Installed Apps page spec: app inventory card grid, version checking, Update All queue |

---

## Session Tracking (tasks/)

These files live in `tasks/` (not `docs/`) because they are working documents updated per session:

| File | Description |
|------|-------------|
| `tasks/todo.md` | Pre-flight / post-flight records for every task. Full audit trail of what was planned, implemented, and verified. |
| `tasks/lessons.md` | Accumulated lessons with anti-patterns, heuristics, and reusable technical patterns. Query by keyword at session start. |

---

## Quick Navigation

**I want to understand the codebase** → [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)

**I want to use the app** → [USER_MANUAL.md](USER_MANUAL.md)

**I want to understand quality standards** → [WORKFLOW.md](WORKFLOW.md)

**I want to see what peer review found** → [PEER_REVIEW.md](PEER_REVIEW.md)

**I want to understand a feature's original design intent** → [specs/](specs/)

**I want to avoid repeating past mistakes** → `tasks/lessons.md`
