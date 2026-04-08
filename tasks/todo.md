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
- [x] DATABASE_URL fixed — SQL admin password reset to alphanumeric-only (special chars broke Prisma URL parser)
- [x] Server startup made non-blocking — `app.listen()` now called before `initializeAuth()` so health probes pass during SQL cold start
- [x] Crash logging added — `uncaughtException` + `unhandledRejection` handlers log errors before exit
- [x] Container App running — revision healthy, serving traffic
- [x] Verification: Container App URL loads React SPA login screen ✓
- [x] Verification: First-run setup screen appears, admin account created ✓
- [x] Verification: Login succeeds, dashboard loads ✓
- [x] Verification: "Not connected to tenant" shown — expected (MSAL.NET broken on Linux, Phase 3 fix)
- [x] Set min-replicas back to 0 (scale-to-zero, cost saving)

---

## Post-Flight Summary

**Result: PASS (Phase 2 complete)**

| Component | Status |
|-----------|--------|
| Docker image builds and pushes to GHCR | ✓ |
| `prisma db push` applies schema to Azure SQL | ✓ |
| `az containerapp update` deploys new image | ✓ |
| Container App serves React SPA at public URL | ✓ |
| Login screen and first-run setup functional | ✓ |
| Dashboard loads (empty — no tenant connected) | ✓ Expected |
| Tenant authentication (Connect-Tenant.ps1) | ✗ Known — Phase 3 |

**Container App URL:** `https://ca-intunemanager-prod.yellowforest-c85ceb60.eastus.azurecontainerapps.io`

**Key lessons captured:** Lesson 011 in `tasks/lessons.md`

**Phase 3 items (COMPLETE):**
- [x] Replace MSAL.NET tenant auth with direct HTTP OAuth2 server-side flow
  - [x] `server/services/graph-auth.ts` — direct HTTP fetch() to MS token endpoint; getAccessToken/getAuthUrl/handleCallback/startDeviceCodeFlow
  - [x] `server/routes/ms-auth.ts` — GET /api/auth/ms-login, GET /api/auth/ms-callback, POST /api/auth/ms-device-code
  - [x] `server/index.ts` — msAuthRouter mounted
  - [x] `server/routes/ps.ts` — all Graph routes pass -AccessToken; connect-tenant simplified; disconnect simplified
  - [x] `server/prisma/schema.prisma` — access_token + refresh_token columns added
  - [x] `IntuneManager/Lib/GraphClient.psm1` — Set-GraphAccessToken + $script:InjectedToken added
  - [x] All 9 Graph-calling PS scripts — -AccessToken param + Set-GraphAccessToken call added
  - [x] `src/contexts/TenantContext.tsx` — connect() redirects to /api/auth/ms-login (OAuth) or POSTs /api/auth/ms-device-code
  - [x] `src/settings/TenantTab.tsx` — device code panel with user code + polling
  - [x] `.github/workflows/deploy-container-app.yml` — passes AZURE_CLIENT_ID/SECRET/REDIRECT_URI
  - [x] Azure AD App Registration created; AZURE_CLIENT_ID + AZURE_CLIENT_SECRET added to GitHub Secrets
  - [x] Fix: added `openid` + `profile` to SCOPES so id_token (and username) returned from Microsoft
  - [x] Fix: tenant-config connected check changed from `!row.username` → `!row.access_token`
  - [x] Push to master → CI/CD deployed ✓
  - [x] Verify: sign-in flow completes, Settings → Tenant shows Connected ✓ with username

**Azure AD App Registration steps:**
1. Go to portal.azure.com → Azure Active Directory → App registrations → New registration
2. Name: `IntuneManager Web`, Supported account types: `Accounts in any organizational directory`
3. Redirect URI (Web): `https://ca-intunemanager-prod.yellowforest-c85ceb60.eastus.azurecontainerapps.io/api/auth/ms-callback`
4. After creation: API permissions → Add → Microsoft Graph → Delegated → add: `DeviceManagementApps.ReadWrite.All`, `DeviceManagementConfiguration.Read.All`, `User.Read`
5. Certificates & secrets → New client secret → copy the value immediately
6. Copy the Application (client) ID from the Overview page
7. Add to GitHub Secrets (repo Settings → Secrets → Actions): `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET`

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
| ~~`Connect-Tenant.ps1` uses MSAL.NET (.NET Framework) — fails on Linux pwsh~~ | ~~Phase 2 accepts broken tenant connect~~ | **RESOLVED Phase 3:** replaced with direct HTTP OAuth2 (`fetch()` to MS token endpoint; `@azure/msal-node` removed — caused `AADSTS7000218` via automatic PKCE injection on stateless confidential clients); PS scripts receive token via `-AccessToken` param |
| `IntuneWinAppUtil.exe` Windows-only — not in Linux container | AI agent `build_package` tool will fail | Phase 4c: replaced with native PS7/.NET 8.0 `Create-IntuneWin.ps1` — cross-platform, no new Azure resources |
| In-memory `SSEManager` — single instance only | Fine for initial deployment; breaks if scaled to >1 replica | Phase 5: Azure Service Bus topic for fan-out |
| `prisma db push` instead of `prisma migrate deploy` | No migrations folder yet; data-loss flag accepted | Generate migrations locally (`prisma migrate dev --name init`), commit, switch CI step |

---

### Verification Criteria (Phase 3 — Definition of Done)
- [x] GitHub Actions workflow runs green on push to master
- [x] `https://ca-intunemanager-prod.yellowforest-c85ceb60.eastus.azurecontainerapps.io` loads the React SPA login screen
- [x] `POST /api/auth/login` returns 200 with JWT
- [x] Settings → Tenant: "Sign in with Microsoft Account" redirects to `login.microsoftonline.com`
- [x] After login, browser returns to app; Settings → Tenant shows Connected ✓ with username
- [ ] Apps tab: Intune apps list loads (Graph call with injected token succeeds) — **Phase 4 verify**
- [ ] Devices tab: device list loads — **Phase 4 verify**
- [ ] "Use Device Code" button: shows code + URL panel; completes on authentication — **Phase 4 verify**

---

## Post-Flight Summary

**Result: PASS (Phase 3 complete)**

| Component | Status |
|---|---|
| Azure AD App Registration created | ✓ |
| OAuth2 Authorization Code flow (browser redirect) | ✓ |
| Tokens saved encrypted to Azure SQL (`tenant_config`) | ✓ |
| Settings → Tenant shows Connected with username | ✓ |
| Token auto-refresh on expiry (refresh_token) | ✓ Implemented |
| Device Code flow (UI + background polling) | ✓ Implemented |
| All Graph PS scripts receive -AccessToken | ✓ |

**Bug fixed during Phase 3 verification:**
`openid` + `profile` scopes were missing from the SCOPES constant — Microsoft does not return an `id_token` without `openid`, so `username` was always `null`. The tenant-config connected check (`!row.username`) was also updated to use `!row.access_token` as the authoritative indicator.

**Key lesson captured:** Lesson 013 in `tasks/lessons.md`

---

> **VERIFICATION CHECKPOINT** — Do not proceed past Phase 2 provisioning without user sign-off on the plan above.

---

---

# Task: IntuneManager — Phase 4

## Pre-Flight Plan

### Lessons Consulted
- **Lesson 001:** Enhanced Workflow mandatory. Plan Mode, peer-review, post-flight docs. No exceptions.
- **Lesson 011:** Key Vault RBAC mode (use `az role assignment create`, not `set-policy`); 30s propagation wait; `npm ci` requires lock file.
- **Lesson 013:** Connected check must key on `access_token`, not derived fields.

### Objective
Three workstreams to harden the Azure deployment:
1. **4a — Prisma Migrations:** Replace `prisma db push` with `prisma migrate deploy` — fully automated in CI.
2. **4b — Key Vault Secret References:** Move all runtime secrets from plaintext GitHub Actions `--set-env-vars` into Azure Key Vault references accessed via Managed Identity.
3. **4c — Native PS7 .intunewin Creation:** Replace Windows-only `IntuneWinAppUtil.exe` with a pure PowerShell 7 / .NET 8.0 script that implements the `.intunewin` format natively — no Windows APIs, no new Azure resources.

### Decisions (locked)
| Question | Decision |
|---|---|
| Packaging approach | **Native PS7/.NET 8.0 script** — implements `.intunewin` format in pure cross-platform code; no ACI, no ACR, no Blob transfer |
| Prisma migrations | **Automated in CI** — bootstrap script generates baseline + marks applied on first run; `migrate deploy` every run thereafter |
| APP_SECRET_KEY | In GitHub Secrets → move to Key Vault; **preserve exact value** to avoid invalidating AES-encrypted tokens in DB |
| ANTHROPIC_API_KEY | Users configure their own via Settings — skip from Key Vault |

### Dependency Graph
```
4a (Prisma Migrations) ── no dependencies; lowest risk; do first
4b (Key Vault)         ── no dependency on 4a; can run in parallel
4c (PS7 packaging)     ── no Azure dependencies; fully independent; do in parallel with 4a/4b

Execution order: 4a ─┐
                 4b ─┤─→ all done
                 4c ─┘
```

### Context Pruning (irrelevant to Phase 4)
- `IntuneManager/Lib/*.psm1` — desktop PS modules; no changes needed
- `IntuneManagerUI/electron/` — Electron main process; no changes needed
- `IntuneManagerUI/src/` — React frontend; no changes needed

### Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Prisma baseline migration generates DROP/ALTER on live DB | Low | High | Bootstrap script uses `--from-empty --to-schema-datamodel` (diff only); inspect `migration.sql` in CI log before trusting |
| CI migration step can't reach Azure SQL (firewall) | Medium | Medium | Azure SQL "Allow Azure Services" covers GHA runners; verify in test step |
| KV secret name format — underscores rejected by Key Vault | Certain | High | KV names use hyphens (`DATABASE-URL`); Container App env vars use underscores — translate at `secretref:` mapping |
| KV RBAC propagation delay → `ForbiddenByRbac` | Medium | High | Wait 30s after `az role assignment create` before first use (Lesson 011) |
| APP_SECRET_KEY stored with wrong value → all DB tokens invalid | High | Critical | Read exact value from GitHub Secrets before storing in KV; verify by checking tenant stays Connected after deploy |
| Workflow `--set-env-vars` re-sets KV-ref vars to plaintext on next deploy | High | High | Remove `--set-env-vars` block from workflow as part of 4b — do not leave it in |
| PS7 `.intunewin` output rejected by Intune (format mismatch) | Low | High | Format is decoded by our own `UploadManager.psm1` — we understand every field; validate against a known-good file from `IntuneWinAppUtil.exe` before shipping |
| AES padding or HMAC scheme differs from what Graph API expects | Low | High | Use `PKCS7` padding and `HMACSHA256` over the encrypted bytes — matches IntuneWinAppUtil source and what `UploadManager.psm1` reads back |
| PS5.1 desktop mode broken by new script | None | High | `Build-Package.ps1` keeps IntuneWinAppUtil.exe as primary path; PS7 fallback is only triggered when the tool is not found |
| SQL public endpoint — security audit flag | Medium | Medium | Already enforced: `encrypt=true`, `trustServerCertificate=false`; enable Azure Defender for SQL; firewall "Allow Azure Services only" |

---

### Checklist

#### Phase 4a — Prisma Migrations (CI-automated) ✓ COMPLETE

- [x] Create `IntuneManagerUI/server/scripts/migrate-bootstrap.mjs`
- [x] Replace `prisma db push` step in CI with `prisma generate → migrate-bootstrap.mjs → prisma migrate deploy`
- [x] Push to master → CI green; bootstrap generates baseline on first run, no-op on subsequent runs
- [x] App functions normally after deploy

**Files changed:** `server/scripts/migrate-bootstrap.mjs` (new) · `.github/workflows/deploy-container-app.yml`

---

#### Phase 4b — Key Vault Secret References ✓ COMPLETE

- [x] MI detected (system-assigned) and `Key Vault Secrets User` RBAC assigned
- [x] 4 secrets stored in `kv-intunemgr-prod`: `DATABASE-URL`, `APP-SECRET-KEY`, `AZURE-CLIENT-ID`, `AZURE-CLIENT-SECRET`
- [x] `az containerapp secret set` with 4 `keyvaultref:` entries
- [x] `az containerapp update` mapping 4 env vars to `secretref:` + `AZURE_REDIRECT_URI` plaintext
- [x] Portal verified: 4 KV refs in Secrets, 4 secretref mappings in Env vars
- [x] App loads and Settings > Tenant shows Connected after migration to KV refs
- [x] `--set-env-vars` removed from CI deploy step (commit 0d30cd8)
- [ ] Delete GitHub Secrets `AZURE_CLIENT_ID` + `AZURE_CLIENT_SECRET` (keep `DATABASE_URL` + `AZURE_CREDENTIALS`)

**Files changed:** `.github/workflows/deploy-container-app.yml` · `scripts/setup-keyvault-refs.ps1` (new — one-time setup script)

---

#### Phase 4c — Native PS7 .intunewin Creation ✓ DEPLOYED

- [x] Create `IntuneManagerUI/electron/ps-scripts/Create-IntuneWin.ps1` (pure PS7/.NET 8.0)
- [x] Update `Build-Package.ps1`: PS7 fallback to `Create-IntuneWin.ps1` when exe not found
- [x] Push to master → CI/CD deployed
- [ ] **Test:** trigger packaging job from web UI → verify `.intunewin` produced → upload completes → app appears in Intune

**Files changed:** `electron/ps-scripts/Create-IntuneWin.ps1` (new) · `electron/ps-scripts/Build-Package.ps1`

---

### Verification Criteria (Phase 4 — Definition of Done)
- [x] **4a:** `prisma migrate deploy` runs green in CI; baseline registered; no data loss
- [x] **4b:** Container App env vars sourced from KV; no plaintext secrets in workflow; tenant Connected
- [ ] **4b:** GitHub Secrets `AZURE_CLIENT_ID` + `AZURE_CLIENT_SECRET` deleted
- [ ] **4c:** Packaging job from web UI → `Create-IntuneWin.ps1` runs on Linux → `.intunewin` produced → upload completes → app appears in Intune

---

> **VERIFICATION CHECKPOINT** — Do not begin Phase 4 implementation without user sign-off on this plan.

---

---

# Task: WinTuner UI Integration — COMPLETE

## Objective
Wire 4 new WinTuner server endpoints to the React UI:
1. **InstalledApps** — "WinTuner Updates Available (N)" banner with inline per-app Update/Update All
2. **AppCatalog** — Replace direct navigate with deploy modal: assignment picker + Quick Deploy (WinTuner) + AI Deploy
3. **Deploy** — Handle `?wtDeploy=WINGET_ID&assignment=VALUE` URL param via `startWtDeployJob()`

## Checklist
- [x] `src/types/ipc.ts` — WtUpdateItem, WtUpdatesRes, WtPackage/Deploy/UpdateApp Req+Res types
- [x] `src/lib/api.ts` — ipcPsGetWtUpdates, ipcPsWtPackage, ipcPsWtDeploy, ipcPsWtUpdateApp
- [x] `InstalledApps.tsx` — WinTuner updates panel (yellow border, per-app rows, Update All)
- [x] `AppCatalog.tsx` — Deploy modal with assignment select + Quick Deploy + AI Deploy paths
- [x] `Deploy.tsx` — startWtDeployJob() with onJobLog SSE streaming, phase transitions, wtMode flag
- [x] Peer review — 2 BLOCKING issues identified and fixed:
  - Cancel button hidden for WinTuner jobs (AI cancel endpoint incompatible with PS-level jobIds)
  - handleWtUpdateAll race guard (if(wtUpdatingId) return)

## Side-Effect Audit
1. AppCatalog: `handleCardDeploy` now opens a modal instead of navigating directly — users who expect immediate navigate on click will see one extra modal step
2. InstalledApps: two extra API calls on mount (ipcPsGetWtUpdates + ipcSettingsGet) — minor latency; non-blocking; fail silently with error state
3. Deploy: `?wtDeploy` check added before `?package` — no conflict; disjoint params; no existing caller uses wtDeploy

## Post-Flight
- Peer review subagent ran; 2 real issues fixed (cancel button, race guard)
- Reviewed issues dismissed: HTTP blocking is async/non-blocking in JS; path separator is server-side Linux only; `/tmp` fallback is Linux container only; existing `handleUpdateApp` route still works via `?name=` param
- Files changed: 5 (types, api, InstalledApps, AppCatalog, Deploy)

---

---

# Archived: Task — PowerShell + WPF Desktop Application (COMPLETE)

> See git history for original todo.md content. All checklist items completed, peer review PASS, post-flight written.
