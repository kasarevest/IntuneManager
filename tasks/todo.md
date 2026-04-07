# Task: IntuneManager — Azure Serverless Web Deployment

> Previous entry (PowerShell WPF desktop app) archived below this entry.

---

## Pre-Flight Plan

### Lessons Consulted
- **Lesson 001:** Enhanced Workflow mandatory. Plan Mode, peer-review, post-flight docs. No exceptions.
- **Lesson 003:** Pivot Rule triggered after 4+ on-the-fly adjustments in provisioning (flag errors, quota failures across 3 tiers, architecture change from App Service to serverless). Full re-plan required before any implementation.

### Objective
Deploy IntuneManager as a cloud-hosted web application on Azure using a fully serverless, pay-as-you-go architecture. The app consists of:
- **React SPA** (Vite, `builds/dist-web/`) → Azure Static Web Apps (Free)
- **Express.js API** (Node 20, `server/`) → Azure Container Apps (Consumption, scale-to-zero)
- **Database** (Prisma + SQL Server) → Azure SQL Serverless (East US)
- **File Storage** → Azure Blob Storage (East US)
- **Secrets** → Azure Key Vault (East US)
- **Container Registry** → GitHub Container Registry (GHCR, free)

### Context Pruning (irrelevant to this task — do not read)
- `IntuneManager/Lib/*.psm1` — PowerShell desktop modules, desktop only
- `IntuneManager/UI/` — WPF views, desktop only
- `IntuneManagerUI/electron/` — Electron main process, desktop only
- `IntuneManagerUI/vite.config.ts` — Electron build config (use `vite.web.config.ts`)
- `IntuneManagerUI/electron-builder.yml` — NSIS installer, desktop only

### Region Decision
**Primary region: East US (`eastus`)**
- All resources provisioned in East US for lowest latency to target users and best quota availability on new subscriptions
- Existing uksouth resources (SQL Server, Storage, Key Vault) must be deleted and recreated in East US — they contain no data and are billable even when idle

### Architecture Diagram
```
Browser
  │
  ├─ React SPA (Static Web Apps, Free, East US CDN)
  │    └─ /api/* → proxied to Container Apps FQDN
  │
  └─ Container Apps (Consumption, East US)
       ├─ Express.js server (Node 20, pwsh available)
       ├─ SSE streaming (keepalive ping every 30s ✓ already implemented)
       ├─ PowerShell bridge → spawn('pwsh') [Linux PS7]
       └─ Managed Identity → Key Vault → secrets
            ├─ Azure SQL Serverless (East US)
            ├─ Azure Blob Storage (East US)
            └─ Anthropic API key
```

### Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `powershell.exe` → `pwsh` breaks PS scripts on Linux | High | High | Audit all spawn calls; test MSAL scripts will fail (known — Graph SDK replaces them in Phase 3) |
| Prisma binary target mismatch in Linux container | High | High | Add `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]` to schema.prisma |
| SQL auto-pause 20-60s cold start causes Prisma timeout | Medium | Medium | Set `connectionTimeout=60;loginTimeout=60` in DATABASE_URL |
| Container Apps 240s ingress timeout cuts long SSE streams | Medium | High | SSE keepalive `: ping\n\n` already in events.ts (30s interval) — confirms idle timer reset |
| CORS mismatch: Static Web Apps URL not in Express allow list | High | High | Set `APP_ORIGIN` env var = Static Web Apps URL; ensure CORS middleware reads it |
| `better-sqlite3` in root package.json causes Docker build failure | Low | High | Dockerfile builds from `server/` only — root package.json never installed |
| GitHub Container Registry image not accessible to Container Apps | Low | Medium | Set GHCR package to public or configure Container App with registry credentials |
| Static Web Apps `/api` proxy pointing to wrong Container Apps FQDN | High | High | Use `staticwebapp.config.json` to define proxy; set FQDN after Container App is created |
| Existing uksouth resources still running and billing | High | Low | Delete immediately as first provisioning step |

### Dependency Graph
```
Step 1 — Cleanup (delete uksouth resources)
  └─ Step 2 — Provision East US resources
       ├─ SQL Server + Serverless DB
       ├─ Blob Storage + containers
       ├─ Key Vault + secrets
       └─ Container Apps Environment
            └─ Step 3 — Code changes (parallel)
                 ├─ 3a. Dockerfile
                 ├─ 3b. ps-bridge.ts: powershell.exe → pwsh
                 ├─ 3c. schema.prisma: binaryTargets
                 ├─ 3d. SQL connection timeout in env
                 └─ 3e. staticwebapp.config.json (API proxy)
                      └─ Step 4 — CI/CD pipelines
                           ├─ 4a. Container Apps workflow (build→push→deploy)
                           └─ 4b. Static Web Apps workflow (swa deploy)
                                └─ Step 5 — Provision Container App + Static Web Apps
                                     └─ Step 6 — Verification
```

### Checklist

#### Phase 1 — Cleanup
- [x] Delete existing SQL database `intunemanager` (uksouth) — handled in provision-azure-v2.ps1
- [x] Delete SQL Server `sql-intunemanager-prod` (uksouth) — handled in provision-azure-v2.ps1
- [x] Delete Storage Account `stintunemgrprod` (uksouth) — handled in provision-azure-v2.ps1
- [x] Delete Key Vault `kv-intunemgr-prod` (uksouth) — handled in provision-azure-v2.ps1
- [x] (Resource group `rg-intunemanager-prod` stays — will hold East US resources)

#### Phase 2 — Provision East US Resources
- [x] Write `provision-azure-v2.ps1` covering full East US serverless stack
- [ ] **RUN** `provision-azure-v2.ps1` — awaiting user execution

#### Phase 3 — Code Changes
- [x] **3a. Dockerfile** — multi-stage: spa-builder → server-builder → runtime with pwsh; peer review fixes applied
- [x] **3b. ps-bridge.ts** — platform-aware: `powershell.exe` on win32, `pwsh` on Linux; taskkill also platform-aware
- [x] **3c. schema.prisma** — `binaryTargets = ["native", "debian-openssl-3.0.x"]` (Debian 12 / node:20-slim)
- [x] **3d. .env.example** — documented `connectionTimeout=60;loginTimeout=60` in DATABASE_URL
- [x] **.dockerignore** — excludes node_modules, builds/, electron/, .env files

#### Phase 4 — CI/CD Pipeline
- [x] **`.github/workflows/deploy-container-app.yml`** — ubuntu-latest; GHCR push; prisma db push; Container Apps deploy
- [x] Removed old `deploy-azure.yml` (App Service)
- [x] Add GitHub secrets: `AZURE_CREDENTIALS` (SP JSON from script output), `DATABASE_URL`

#### Phase 5 — Peer Review (COMPLETE)
- [x] Peer-review subagent run — 4 BLOCKING, 1 MAJOR, 2 MINOR found
- [x] BLOCKING 1 fixed: removed `COPY public/ ./public/` (directory doesn't exist)
- [x] BLOCKING 2 fixed: PS scripts COPY changed to direct context COPY (not from spa-builder stage)
- [x] BLOCKING 3 fixed: `prisma migrate deploy` → `prisma db push` (no migrations folder yet)
- [x] BLOCKING 4 fixed: added `id-token: write` permission to workflow
- [x] MAJOR: PowerShell IS required (ps-bridge uses pwsh) — accepted, not a bug
- [x] MINOR: kept `"native"` in binaryTargets (needed for local dev)

#### Phase 6 — Post-Flight (IN PROGRESS)
- [x] Docker image builds successfully and pushes to GHCR on every push to `master`
- [x] Azure Container App `ca-intunemanager-prod` deployed at `https://ca-intunemanager-prod.yellowforest-c85ceb60.eastus.azurecontainerapps.io`
- [x] `tasks/lessons.md` updated with Lesson 008 (Azure Container Apps deployment patterns)
- [x] All documentation updated (PROJECT_OVERVIEW.md, README.md, USER_MANUAL.md, todo.md)
- [ ] **CURRENT BLOCKER** — `prisma db push` fails with `P1000: Authentication failed`
  - Root cause: `DATABASE_URL` GitHub secret has wrong password for `intuneadmin` on `sql-intunemanager-prod` (westus2)
  - Fix: `az sql server update --name sql-intunemanager-prod --resource-group rg-intunemanager-prod --admin-password <NEW>` then update GitHub secret `DATABASE_URL` and re-run workflow
- [ ] Verification: GitHub Actions workflow fully green (all steps including prisma db push)
- [ ] Verification: Container App URL loads React SPA login screen
- [ ] Verification: `POST /api/auth/login` returns 200 with JWT

---

### Side-Effect Audit

**Change 3b — `powershell.exe` → `pwsh`:**
1. MSAL.NET interactive login scripts (`Connect-Tenant.ps1`) will fail on Linux — `pwsh` cannot load `Microsoft.Identity.Client.dll` (it's for .NET Framework, PS7 uses .NET Core). **Known and accepted** — Graph SDK replaces this in Phase 3. Document as technical debt.
2. PS scripts using `$env:APPDATA` or Windows paths will fail silently. Audit all 18 PS scripts for Windows-only env vars.
3. `spawn` arguments format doesn't change — only the binary name. No other code paths affected.

**Change 3c — Prisma binaryTargets:**
1. Adding `linux-musl-openssl-3.0.x` increases `node_modules/.prisma/client/` size by ~15 MB (extra binary). No functional impact.
2. `npx prisma generate` must run inside the Docker build — if Docker build doesn't call `prisma generate`, the binary won't be there at runtime. Ensure Dockerfile includes this step.
3. If base image is `node:20-alpine` (musl libc), use `linux-musl-openssl-3.0.x`. If `node:20-slim` (Debian/glibc), use `debian-openssl-3.0.x`. Must match exactly.

**Change 3a — Dockerfile:**
1. `server/` has `"type": "commonjs"` — compiled output is CJS. Ensure `tsc` runs before `CMD` and output is in `dist/`.
2. `server/prisma/` must be copied into the image for migrations to run. Missing it causes `prisma migrate deploy` to fail.
3. `IntuneWinAppUtil.exe` will not be in the Linux container — packaging feature broken in Phase 2. Document as known limitation in technical debt log.

---

### Technical Debt Log
| Item | Trade-off | Resolution path |
|---|---|---|
| `Connect-Tenant.ps1` uses MSAL.NET (.NET Framework) — fails on Linux pwsh | Phase 2 accepts broken tenant connect; auth flow uses existing DB value | Phase 3: replace with `@azure/identity` + `@microsoft/microsoft-graph-client` |
| `IntuneWinAppUtil.exe` Windows-only — not in Linux container | AI agent `build_package` tool will fail | Phase 3: Azure Container Instance (Windows, pay-per-second) triggered on demand |
| In-memory `SSEManager` — single instance only | Fine for initial deployment; breaks if scaled to >1 replica | Phase 4: Azure Service Bus topic for fan-out |

---

### Verification Criteria (Definition of Done)
- [ ] `https://<static-web-app>.azurestaticapps.net` loads the React SPA login screen
- [ ] `POST /api/auth/login` returns 200 with JWT (default admin credentials)
- [ ] `GET /api/ps/tenant-config` returns `{ isConnected: false }` (DB connected, PS bridge not tested in Phase 2)
- [ ] `GET /api/events` returns `text/event-stream` content-type with ping frames
- [ ] GitHub Actions workflow runs green on push to main

---

> **VERIFICATION CHECKPOINT** — Do not proceed past Phase 2 provisioning without user sign-off on the plan above.

---

---

# Archived: Task — PowerShell + WPF Desktop Application (COMPLETE)

> See git history for original todo.md content. All checklist items completed, peer review PASS, post-flight written.
