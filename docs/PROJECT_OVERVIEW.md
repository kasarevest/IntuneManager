# IntuneManager — Project Overview

**Last Updated:** 2026-04-07

## What is IntuneManager?

IntuneManager is an AI-powered desktop application for managing Windows endpoints via Microsoft Intune. It gives IT administrators a unified view of their tenant's device health, application version status, and installed app inventory — without requiring them to navigate multiple blades in the Intune portal.

The three core capabilities are:

1. **Device Health Monitoring** — Real-time compliance state, Windows Update status, driver update status, and diagnostics for every managed Windows device in the tenant. Admins can trigger update syncs and log collection requests directly from the app.

2. **App Version Status & Inventory** — The Installed Apps page shows every Win32 app deployed in the tenant, cross-referenced against the latest version available on winget. Apps that are behind show an amber Update badge. Batch updating (Update All) queues all outdated apps and processes them sequentially.

3. **App Catalog & Packaging** — Admins can discover new applications via AI-curated recommendations or winget search, then package and deploy them to Intune without leaving the app. An AI agent (Claude) handles the full pipeline: finding the installer, writing PowerShell scripts, building the `.intunewin` package, and uploading to Intune via Graph API.

The project consists of two components:

| Component | Location | Purpose |
|-----------|----------|---------|
| `IntuneManagerUI\` | Electron + React desktop app (primary) / Express + React web app (containerised) | Primary user interface |
| `IntuneManager\` | PowerShell module library | PS execution layer (reused by UI via ps-bridge) |

The UI is the active component. The original PowerShell + WPF application was superseded by the Electron rebuild.

The application supports two deployment modes:

| Mode | Build command | Runtime | Hosting |
|------|--------------|---------|---------|
| **Desktop (Electron)** | `npm run build` | Electron, Windows only | Local install |
| **Web (Container)** | `npm run build:web` | Node.js + Express, Linux | Azure Container Apps |

---

## Problem Solved

Managing a Windows endpoint fleet in Intune typically requires navigating across multiple portal blades:

- **Devices** blade → check compliance per device
- **Apps** blade → check deployment status per app
- Repeat the above for every app update cycle
- Manually run IntuneWinAppUtil.exe and upload packages for new apps

IntuneManager consolidates these workflows into a single desktop application:

| Before | After |
|--------|-------|
| Check device compliance in Intune portal per device | Dashboard + Devices page: all devices, compliance badges, attention flags in one view |
| Manually look up latest app versions | Installed Apps: winget version check runs automatically per app on load |
| Update apps one by one through Intune portal | Update All: queues all outdated apps, runs the full pipeline sequentially |
| Package new apps manually (30–60 min each) | App Catalog → Deploy: AI agent handles the entire packaging pipeline |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Electron Main Process (Node.js)                            │
│                                                             │
│  ┌──────────┐  ┌──────────────────┐  ┌───────────────────┐  │
│  │ SQLite   │  │  IPC Handlers    │  │ AI Agent          │  │
│  │ Database │  │  auth.ts         │  │ (Claude API)      │  │
│  │          │  │  ps-bridge.ts    │  │ ai-agent.ts       │  │
│  │ users    │  │  settings.ts     │  │                   │  │
│  │ sessions │  │                  │  │ 3 job runners     │  │
│  │ tenant   │  │                  │  │ 11 tools          │  │
│  └──────────┘  └──────────────────┘  └───────────────────┘  │
│                        │                      │             │
│               contextBridge             spawn PS.exe        │
└────────────────────────│──────────────────────│─────────────┘
                         │                      │
┌────────────────────────▼──────┐  ┌────────────▼────────────┐
│  React Renderer                │  │  PowerShell Bridge       │
│                                │  │                          │
│  Pages:                        │  │  IntuneManager\Lib\      │
│  ├─ Login                      │  │  Auth.psm1               │
│  ├─ FirstRun                   │  │  GraphClient.psm1        │
│  ├─ Dashboard (executive)      │  │  UploadManager.psm1      │
│  ├─ InstalledApps (inventory)  │  │  PackageBuilder.psm1     │
│  ├─ AppCatalog (discovery)     │  │  Logger.psm1             │
│  ├─ Deploy (execution)         │  │                          │
│  ├─ Devices (health)           │  │  ps-scripts/ (18)        │
│  └─ Settings                   │  │  Connect-Tenant.ps1      │
│                                │  │  Get-IntuneApps.ps1      │
│  Contexts:                     │  │  Get-IntuneDevices.ps1   │
│  ├─ AuthContext                │  │  New-Win32App.ps1        │
│  └─ TenantContext (60s poll)   │  │  Upload-App.ps1          │
│                                │  │  Build-Package.ps1       │
│  Hooks:                        │  │  List-IntunewinPackages  │
│  ├─ useAppCatalog              │  │  Invoke-WindowsUpdate    │
│  ├─ useRecommendations         │  │  Invoke-DriverUpdate     │
│  └─ useDeployJob               │  │  Get-DeviceDiagnostics   │
└────────────────────────────────┘  └──────────────────────────┘
```

### Key Design Decisions

**Electron + React (not WPF)**
The original implementation used PowerShell + WPF (see `IntuneManager\`). This was replaced because WPF requires STA threading for MSAL interactive login, has .NET Framework property compatibility issues, and provides poor support for complex UI patterns (streaming AI logs, reactive version checking, live device status).

**PowerShell modules preserved as the execution layer**
The PS modules (`Auth.psm1`, `GraphClient.psm1`, `UploadManager.psm1`) contain battle-tested Graph API logic, DPAPI token caching, and chunked Azure Blob upload code. Rather than rewriting this in TypeScript, Electron spawns `powershell.exe` as a child process.

**Claude as the packaging agent**
Rather than hardcoding a rigid wizard for each installer type, Claude is given 11 tools and a system prompt describing the packaging workflow. It decides which tools to call based on the user's natural-language request. This handles MSI, NSIS EXE, Inno Setup, MSIX, and other installer types without per-type code branches.

**Three pipeline modes**
```
ipc:ai:deploy-app    -> runDeployJob       -> 12 steps (search -> download -> scripts -> build -> create -> upload)
ipc:ai:package-only  -> runPackageOnlyJob  -> 10 steps (search -> download -> scripts -> build; NO upload)
ipc:ai:upload-only   -> runUploadOnlyJob   ->  2 steps (create Intune record + upload existing .intunewin)
```
The package-only + upload-only split allows the admin to review the package before it enters production.

**Five-page navigation model**
Navigation is standardised across all pages as: Dashboard → Installed Apps → App Catalog → Deploy → Devices. Each page has a single, focused responsibility:

| Page | Route | Responsibility |
|------|-------|----------------|
| Dashboard | `/dashboard` | Executive summary — app inventory stats, device health stats, alerts, auto-refresh |
| Installed Apps | `/installed-apps` | App inventory with live winget version checking; Update and Update All actions |
| App Catalog | `/catalog` | Discovery — AI recommendations (DB-cached, background refresh) + winget search |
| Deploy | `/deploy` | Execution — ready `.intunewin` packages + active job progress panel |
| Devices | `/devices` | Device health — compliance badges, update status, attention flags, action buttons |

**`TenantContext` 60-second polling**
`TenantContext` reads the `tenant_config` SQLite row on app start and every 60 seconds. This keeps the connection status indicator accurate across all page navigations without any per-page reconnect logic.

**Recommendations DB cache + background refresh**
AI recommendations are persisted to `app_settings` (`recommendations_cache` key) after each Claude call. On subsequent loads the cached list is returned immediately (instant display), and a background Claude call refreshes the list and pushes updated results to the renderer via `ipc:ai:recommendations-updated`. This eliminates the 3–8 second wait on every App Catalog visit.

**Dual Claude connection (Direct API + AWS Bedrock SSO)**
Settings → General now supports two Claude connection methods:
1. **Direct Anthropic API key** — `claude_api_key_encrypted` stored AES-256-CBC in `app_settings`. The masked key is displayed on load; the raw key is only sent to Anthropic.
2. **AWS Bedrock via SSO** — `aws_region` + `aws_bedrock_model_id` stored in `app_settings`. A "Login with AWS SSO" button runs `aws sso login` via `ipc:aws:sso-login`. At least one method must be configured before Settings can be saved.

The `claudeApiKeyConfigured` flag is derived server-side (electron/ipc/settings.ts) — if the encrypted row exists, the flag is `true` even though the displayed value is masked. This prevents the validation logic from misreading a masked key as "unconfigured".

**`New-Win32App.ps1` — raw JSON via HttpWebRequest**
The app creation script does NOT use `GraphClient.psm1`'s `Invoke-GraphRequest` (which does `$Body | ConvertTo-Json`). Instead it:
1. Reads the JSON body from a temp file written by Node.js (`-BodyJsonPath` parameter)
2. POSTs the raw UTF-8 bytes directly via `[System.Net.HttpWebRequest]`

This bypasses two PS 5.1 serialization bugs: (1) CLI argument mangling of `{ } : [ ] "` characters, and (2) `ConvertTo-Hashtable -> ConvertTo-Json` collapsing single-element arrays like `detectionRules: [{...}]` into plain objects.

**`UploadManager.psm1` — SAS URI polling + inner blob streaming**
The `.intunewin` outer file is a ZIP. The actual content to upload is the inner `IntunePackage.intunewin` entry — not the outer ZIP. After `POST .../contentVersions/{id}/files`, Graph API provisions `azureStorageUri` asynchronously. The upload manager polls `GET .../files/{fileId}` at 5-second intervals (up to 60 seconds) until `azureStorageUri` is populated, then streams the inner encrypted blob in 5 MB chunks directly from the ZIP entry.

---

## Web Deployment Architecture

The application is deployable as a containerised web app via a multi-stage Docker build and GitHub Actions CI/CD pipeline.

### Azure Resources

| Resource | Name | Region | Purpose |
|----------|------|--------|---------|
| Container Apps Environment | `cae-intunemanager-prod` | East US | Hosts the container |
| Container App | `ca-intunemanager-prod` | East US | Express + React SPA, scale-to-zero |
| Azure SQL Serverless | `sql-intunemanager-prod` | West US 2 | Prisma ORM, auto-pauses after 60 min idle |
| Azure Blob Storage | `stintunemgrprod` | East US | Source/output file storage |
| Azure Key Vault | `kv-intunemgr-prod` | East US | Runtime secrets |
| GitHub Container Registry | `ghcr.io/<owner>/intunemanager` | — | Container image registry (free) |

> SQL Server is in West US 2 because East US and East US 2 had no serverless SQL quota available on the subscription at provisioning time.

### Container App URL

```
https://ca-intunemanager-prod.yellowforest-c85ceb60.eastus.azurecontainerapps.io
```

### Docker Build (Multi-Stage)

```
IntuneManagerUI/Dockerfile
  Stage 1 — spa-builder (node:20-slim)
    npm install --ignore-scripts (skips electron-rebuild)
    npm run build:web
    Output: /build/builds/dist-web/

  Stage 2 — server-builder (node:20-slim)
    npm install
    npx prisma generate  (generates Linux binary: debian-openssl-3.0.x)
    npm run build        (TypeScript → dist/)
    Output: /build/server/dist/, /build/server/node_modules/

  Stage 3 — runtime (node:20-slim)
    apt-get install powershell  (pwsh 7 — required for ps-bridge.ts)
    COPY server/dist/, server/node_modules/, server/prisma/
    COPY electron/ps-scripts/   (PowerShell bridge scripts)
    COPY builds/dist-web/       (React SPA static files)
    CMD node server/dist/index.js
    EXPOSE 8080
```

**Key `.dockerignore` rule:** `electron/` is excluded except for `!electron/ps-scripts/` — ps-scripts must be included for the PowerShell bridge.

### CI/CD Pipeline

`.github/workflows/deploy-container-app.yml` runs on every push to `master`:

```
1. Log in to GHCR
2. docker/setup-buildx-action (required for GHA cache backend)
3. docker build --push → ghcr.io/<owner>/intunemanager:latest + sha-<sha>
4. actions/setup-node + npm install (server deps)
5. npx prisma db push --skip-generate --accept-data-loss
6. azure/login (AZURE_CREDENTIALS secret)
7. az containerapp update --image ... --set-env-vars AZURE_CLIENT_ID/SECRET/REDIRECT_URI
```

**Required GitHub Secrets:**
- `AZURE_CREDENTIALS` — Service principal JSON (`az ad sp create-for-rbac --json-auth`)
- `DATABASE_URL` — Full SQL Server connection string:
  `sqlserver://sql-intunemanager-prod.database.windows.net:1433;database=intunemanager;user=intuneadmin;password=<PWD>;encrypt=true;trustServerCertificate=false;connectionTimeout=60;loginTimeout=60`
- `AZURE_CLIENT_ID` — Azure AD App Registration Application (client) ID
- `AZURE_CLIENT_SECRET` — Azure AD App Registration client secret value

### Database (Web Mode)

In web mode the application uses **Azure SQL Server** via Prisma ORM instead of SQLite.

The Prisma schema (`server/prisma/schema.prisma`) uses `provider = "sqlserver"` with:
```prisma
binaryTargets = ["native", "debian-openssl-3.0.x"]
```
- `native` — used for local development (any OS)
- `debian-openssl-3.0.x` — used inside the Docker container (node:20-slim / Debian 12)

Schema is applied using `prisma db push` (not `migrate deploy`) because no `prisma/migrations/` folder exists yet. Migration to `prisma migrate deploy` is Phase 3 technical debt.

### PowerShell Bridge in Web Mode

`server/services/ps-bridge.ts` selects the PowerShell binary at runtime:

```typescript
const psBin = process.platform === 'win32' ? 'powershell.exe' : 'pwsh'
```

On Linux (Container Apps) it spawns `pwsh` (PowerShell 7, installed in the Docker runtime stage). On Windows (desktop Electron) it spawns `powershell.exe` (5.1). Kill also uses platform-appropriate commands (`kill -9` vs `taskkill /f /t`).

**Phase 3 change:** PS scripts no longer manage MSAL authentication. `server/services/graph-auth.ts` calls `getAccessToken()` before each Graph PS call and passes the token as `-AccessToken` to the script. `GraphClient.psm1` checks `$script:InjectedToken` first, falling back to `Get-ValidAccessToken` (MSAL.NET, desktop only) only when no injected token is present. `Connect-Tenant.ps1` and `Get-AuthStatus.ps1` are no longer called from the web server.

### Server-Side Caching (Web Mode)

In web mode the server uses `server/services/cache.ts` (Prisma-backed) instead of SQLite:

```typescript
// Reads/writes AppSetting table rows (key-value store)
getCached(key: string): Promise<Record<string, unknown> | null>
saveCache(key: string, data: Record<string, unknown>): Promise<void>
```

This replaces the `better-sqlite3` cache that was used in the Electron version.

---

## Feature Details

### Device Health Monitoring

The Devices page (`/devices`) pulls all managed devices from `GET /deviceManagement/managedDevices` (Graph beta) and presents:

| Column | Source field |
|--------|-------------|
| Device name | `deviceName` |
| User | `userPrincipalName` |
| OS version | `operatingSystem` + `osVersion` |
| Compliance | `complianceState` → colour-coded badge |
| Windows Update status | Derived from `windowsProtectionState` fields |
| Driver Update status | Derived (Graph has no separate driver-only status; defaults to `unknown`) |
| Diagnostics | `hasDiagnosticData` flag |
| Last sync | `lastSyncDateTime` |

**Compliance badges:** Compliant (green) / Non-compliant (red) / Grace period (amber) / Unknown (grey)

**Attention indicators:** A device is flagged as `needsAttention` when it is non-compliant, in grace period, has pending Windows updates, or has pending driver updates. The page shows an amber ⚠ icon per device and a "Show Attention Only" filter toggle.

**Per-device actions:**
- **Sync Updates** — calls `syncDevice` Graph action via `Invoke-WindowsUpdate.ps1`
- **Sync Drivers** — calls `syncDevice` Graph action via `Invoke-DriverUpdate.ps1`
- **Request Logs** — calls `createDeviceLogCollectionRequest` via `Get-DeviceDiagnostics.ps1`

**Stats tiles** at the top: Total / Compliant / Non-Compliant / Need Attention.

---

### App Version Status & Inventory

The Installed Apps page (`/installed-apps`) shows all Win32 apps in the tenant with live version checking:

**Two-phase loading:**
- Phase 1 — Graph API: fetches all Win32 apps immediately and renders cards
- Phase 2 — winget: runs concurrent `winget show` calls per app to resolve the latest available version; rows update reactively as results arrive

**Version comparison:** Compares the version string in Intune against the latest winget version. Uses semver comparison; non-semver versions (date-based, build-stamp) return `'unknown'`.

**Status badges:**

| Badge | Meaning |
|-------|---------|
| Current (green) | Intune version matches or exceeds the latest winget version |
| Update (amber) | A newer version is available on winget |
| Cloud Only (grey) | App in Intune but no local `PACKAGE_SETTINGS.md` found |
| Unknown (grey) | Version comparison not possible (non-standard version format) |

**Update actions:**
- **Update** button on a single card — navigates to Deploy page, triggers packaging pipeline for the latest version
- **Update All (N)** — queues all outdated apps and runs them sequentially; shows progress badge "2 of 5: Google Chrome"

**Version check scope:** Only apps that have a `PACKAGE_SETTINGS.md` in the Source Root folder (created by IntuneManager during the original packaging run) can be version-checked. Apps packaged outside IntuneManager show `—`.

---

### App Catalog & Packaging

The App Catalog (`/catalog`) is the starting point for deploying any new application.

**AI Recommendations:** 50 enterprise-common apps generated by Claude, displayed as a browsable card grid. Recommendations are cached in SQLite and shown instantly on load; a background Claude refresh updates the list without blocking the UI.

**Winget Search:** Search bar queries `winget search` in real time (500 ms debounce). Results appear as cards in the same format as AI recommendations.

**Packaging pipeline (when Deploy is clicked on a card):**

```
Step  Tool                    What happens
----  ----------------------  --------------------------------------------------
1     search_winget           Find exact package ID in winget catalog
2     get_latest_version      Confirm latest stable version string
3     (fallback)              search_chocolatey if winget has no match
4     download_app            Download installer to Source\<AppName>\
                              SHA256 verification if hash available in manifest
5     generate_install_script Write Install-<App>.ps1 with silent args,
                              version check, registry key, reboot propagation
6     generate_uninstall_script Write Uninstall-<App>.ps1
7     generate_detect_script  Write Detect-<App>.ps1
8     generate_package_settings Write PACKAGE_SETTINGS.md (metadata for future updates)
9     build_package           Run IntuneWinAppUtil.exe -> Output\Install-<App>.intunewin
10    [package-complete event -- admin sees "Deploy to Intune?" prompt]
11    create_intune_app       POST to Graph: create win32LobApp record with detection script
12    upload_to_intune        Chunked Azure Blob upload via UploadManager.psm1
                              SAS URI refresh on HTTP 403 after 8+ minutes
```

**Generated script patterns** (enforced by system prompt):
- `[CmdletBinding()]` on every script
- Path traversal protection: `[IO.Path]::GetFullPath()` + `StartsWith()` check
- SHA256 verification of installer at runtime (when hash provided)
- Version check before install: skip if same or newer installed
- Detection registry: `HKLM:\SOFTWARE\<AppNameNoSpaces>Installer`
- Reboot code propagation: `exit 3010` propagated from installer exit code

---

### Dashboard — Executive Summary

The Dashboard (`/dashboard`) provides an at-a-glance view of both app inventory and device fleet health. It does not list individual apps or devices (those are on their respective pages).

**App Inventory section:** Total Win32 apps, published count, pending review count, bar chart, links to Installed Apps and App Catalog.

**Device Health section:** Total managed devices, compliant count, non-compliant count, grace period count, Windows Updates needed, Driver Updates needed, compliance ratio bar chart.

**Deployment Readiness section:** Quick links to ready packages, Deploy New App, App Catalog.

**Alerts & Attention Required:** Lists non-compliant devices, devices in grace period, devices needing updates, and tenant connection loss.

**Auto-refresh:** Dashboard refreshes every 60 seconds automatically.

---

## Data Model

**SQLite database** (`%AppData%\Roaming\intune-manager-ui\intunemanager.db`)

| Table | Purpose |
|-------|---------|
| `users` | Local application users (not AAD users). Roles: superadmin, admin, viewer |
| `sessions` | UUID session tokens, 8-hour expiry |
| `tenant_config` | Single-row: connected AAD tenant, username, `token_expiry`, `connected_at` |
| `app_settings` | Key-value store: API key (encrypted), paths, default OS version, `recommendations_cache`, `aws_region`, `aws_bedrock_model_id` |
| `app_deployments` | Deployment history log (schema defined; not yet fully populated by AI agent) |

> **Note on `tenant_config`:** The `token_expiry` column was added in a migration on first launch after 2026-03-31. Existing DBs that predate this change have the column added automatically via `ALTER TABLE` at startup.

> **Note on `recommendations_cache`:** Stored as a JSON string in `app_settings`. Written after every successful Claude recommendations call. Read on App Catalog load to return results instantly; refreshed in the background.

---

## Authentication Model

**Two distinct auth layers:**

1. **Local app auth** — bcrypt password hashing (cost 12), UUID sessions stored in `sessions` table, `sessionStorage` in renderer. Expires after 8 hours or window close.

2. **Microsoft tenant auth** — Two implementations depending on deployment mode:
   - **Desktop (Electron):** MSAL.NET via `Auth.psm1` (Microsoft Graph PowerShell client ID `14d82eec-204b-4c2f-b7e8-296a70dab67e`, pre-consented in M365 tenants). Browser-based interactive login and device code flow. Token cache is DPAPI-encrypted per-user.
   - **Web (Container Apps):** `@azure/msal-node` `ConfidentialClientApplication` via `server/services/graph-auth.ts`. Supports OAuth2 Authorization Code Flow (full-page browser redirect) and Device Code Flow. Tokens are AES-256-CBC encrypted (keyed by `APP_SECRET_KEY`) and stored in `tenant_config.access_token` / `tenant_config.refresh_token`. Auto-refreshes when token has less than 5 minutes remaining. Requires an Azure AD App Registration (`AZURE_CLIENT_ID` + `AZURE_CLIENT_SECRET` env vars).

---

## AI Agent Design

The AI agent is a Claude tool-use loop in `electron/ipc/ai-agent.ts`.

**Model:** `claude-sonnet-4-5` (Direct API) or AWS Bedrock model ID (if Bedrock SSO is configured)

**Tools available:**

| Tool | What it does |
|------|-------------|
| `search_winget` | Runs `winget search` via PS |
| `search_chocolatey` | Runs `choco search` via PS (fallback) |
| `get_latest_version` | Runs `winget show` to confirm version |
| `download_app` | Downloads installer via PS with optional SHA256 check |
| `generate_install_script` | Writes `Install-<App>.ps1` to source folder |
| `generate_uninstall_script` | Writes `Uninstall-<App>.ps1` to source folder |
| `generate_detect_script` | Writes `Detect-<App>.ps1` to source folder |
| `generate_package_settings` | Writes `PACKAGE_SETTINGS.md` to source folder |
| `build_package` | Calls `IntuneWinAppUtil.exe` via PS |
| `create_intune_app` | POSTs to Graph API to create app record |
| `upload_to_intune` | Calls `UploadManager.psm1` chunked upload |

---

## PS Bridge Protocol

PowerShell scripts communicate with Electron using stdout conventions:

```
LOG:[INFO] Installing application...      -> streaming log entry
LOG:[ERROR] File not found: ...           -> streaming error
RESULT:{"success":true,"appId":"..."}     -> terminal return value (JSON)
```

`runPsScript()` in `ps-bridge.ts` parses these conventions and:
- Forwards `LOG:` lines to the job's event stream
- Parses `RESULT:` as the return value
- Kills the process with `taskkill /f /t` on cancellation

---

## File Structure

```
IntuneManager\
├── IntuneManagerUI\           <- Electron + React application (desktop) / Express + React web app (container)
│   ├── Dockerfile             <- Multi-stage Docker build (spa-builder → server-builder → runtime with pwsh)
│   ├── .dockerignore          <- Excludes node_modules, builds/, electron/ (except ps-scripts/)
│   ├── vite.web.config.ts     <- Vite config for web-only build (no Electron plugins)
│   ├── electron\
│   │   ├── main.ts            <- Window creation, DB init, migrations, IPC registration
│   │   ├── preload.ts         <- contextBridge (invoke, on, once, off)
│   │   └── ipc\
│   │       ├── ai-agent.ts    <- Claude tool-use loop + 3 job runners + recommendations cache
│   │       ├── auth.ts        <- Local auth (bcrypt, sessions)
│   │       ├── ps-bridge.ts   <- PowerShell spawn (platform-aware: pwsh/powershell.exe) + LOG/RESULT protocol
│   │       └── settings.ts    <- App settings + dialog handlers + aws_region/aws_bedrock_model_id
│   ├── electron\ps-scripts\   <- 18 PS bridge scripts
│   │   ├── Connect-Tenant.ps1          <- MSAL silent + interactive login
│   │   ├── Disconnect-Tenant.ps1
│   │   ├── Get-AuthStatus.ps1
│   │   ├── Get-IntuneApps.ps1          <- List Win32 apps from tenant
│   │   ├── Get-IntuneDevices.ps1       <- List managed devices with compliance/update data
│   │   ├── Invoke-WindowsUpdate.ps1    <- Trigger syncDevice action (Windows Update)
│   │   ├── Invoke-DriverUpdate.ps1     <- Trigger syncDevice action (Driver Update)
│   │   ├── Get-DeviceDiagnostics.ps1   <- createDeviceLogCollectionRequest
│   │   ├── Search-Winget.ps1
│   │   ├── Search-Chocolatey.ps1
│   │   ├── Get-LatestVersion.ps1
│   │   ├── Download-File.ps1
│   │   ├── Build-Package.ps1           <- IntuneWinAppUtil.exe orchestration (8-path fallback)
│   │   ├── Get-PackageSettings.ps1     <- Parse PACKAGE_SETTINGS.md (incl. wingetId)
│   │   ├── List-IntunewinPackages.ps1  <- Scan output folder; fuzzy-match source folders
│   │   ├── New-Win32App.ps1            <- Create Intune app record via HttpWebRequest
│   │   ├── Upload-App.ps1             <- Trigger chunked upload via UploadManager.psm1
│   │   └── Update-Win32App.ps1        <- PATCH existing Intune app record
│   ├── src\
│   │   ├── App.tsx            <- Router + RequireAuth guard
│   │   ├── contexts\
│   │   │   ├── AuthContext.tsx         <- Local session management
│   │   │   └── TenantContext.tsx       <- Tenant status + 60s DB polling
│   │   ├── hooks\
│   │   │   ├── useAppCatalog.ts        <- Two-phase: apps immediately, winget versions reactively
│   │   │   ├── useRecommendations.ts   <- DB cache + background refresh + session cache
│   │   │   └── useDeployJob.ts         <- Job subscription management
│   │   ├── pages\
│   │   │   ├── Login.tsx
│   │   │   ├── FirstRun.tsx
│   │   │   ├── Dashboard.tsx           <- Executive summary (charts, stats, alerts, 60s refresh)
│   │   │   ├── InstalledApps.tsx       <- App inventory (version checking, update badges, Update All)
│   │   │   ├── AppCatalog.tsx          <- Discovery (AI recs cached, winget search, initiate packaging)
│   │   │   ├── Deploy.tsx              <- Execution (ready packages, job progress panel)
│   │   │   ├── Devices.tsx             <- Device health (compliance, update status, actions)
│   │   │   └── Settings.tsx
│   │   ├── components\
│   │   │   ├── AppCard.tsx             <- App card (initials, name, publisher, buttons)
│   │   │   ├── AppCatalogTable.tsx     <- App table (version checking, update badge)
│   │   │   ├── LogPanel.tsx            <- Streaming job log
│   │   │   └── ProgressStepper.tsx     <- Step indicator
│   │   ├── types\
│   │   │   ├── app.ts                  <- DeviceRow + AppRow interfaces
│   │   │   └── ipc.ts                  <- All IPC request/response types
│   │   └── lib\ipc.ts                  <- Typed IPC wrappers (all channels)
│   ├── db\schema.sql          <- SQLite schema (incl. token_expiry in tenant_config)
│   ├── server\                <- Express.js API server (web deployment)
│   │   ├── index.ts           <- Express app, CORS, static SPA serving in production
│   │   ├── prisma\
│   │   │   └── schema.prisma  <- Prisma schema (sqlserver provider, debian-openssl-3.0.x binary)
│   │   ├── services\
│   │   │   ├── ps-bridge.ts   <- Server-side PowerShell spawn (platform-aware)
│   │   │   ├── cache.ts       <- Prisma-backed key-value cache (replaces better-sqlite3 in web mode)
│   │   │   ├── graph-auth.ts  <- @azure/msal-node OAuth2 service (getAuthUrl/handleCallback/startDeviceCodeFlow/getAccessToken)
│   │   │   └── encryption.ts  <- AES-256-CBC encrypt/decrypt (keyed by APP_SECRET_KEY)
│   │   ├── routes\
│   │   │   ├── auth.ts        <- Local auth endpoints (login, session, users)
│   │   │   ├── ms-auth.ts     <- Microsoft OAuth2 endpoints (ms-login, ms-callback, ms-device-code)
│   │   │   ├── ps.ts          <- PS bridge endpoints (Graph routes inject -AccessToken)
│   │   │   ├── settings.ts    <- App settings endpoints
│   │   │   ├── ai.ts          <- AI agent endpoints
│   │   │   └── events.ts      <- SSE streaming endpoint
│   │   └── package.json
│   └── package.json
│
├── IntuneManager\             <- PS module library (used by UI via ps-bridge)
│   ├── Lib\
│   │   ├── Auth.psm1          <- MSAL 4.43.2, DPAPI token cache
│   │   ├── GraphClient.psm1   <- Graph API, 429 retry, pagination, error body capture
│   │   ├── UploadManager.psm1 <- Chunked Azure Blob upload; inner blob streaming; SAS URI poll
│   │   ├── PackageBuilder.psm1<- IntuneWinAppUtil.exe orchestration
│   │   ├── PackageParser.psm1 <- PACKAGE_SETTINGS.md parser
│   │   └── Logger.psm1        <- Thread-safe logging
│   └── Assets\
│       └── Microsoft.Identity.Client.dll  <- MSAL 4.43.2 net461
│
├── Source\                    <- Per-app source folders (created by AI agent)
├── Output\                    <- Generated .intunewin packages
├── IntuneWinAppUtil.exe        <- Microsoft packaging tool
│
├── .github\
│   └── workflows\
│       └── deploy-container-app.yml  <- CI/CD: build → push GHCR → prisma db push → Container Apps deploy
├── provision-azure-v2.ps1     <- Full East US serverless provisioning script
├── provision-azure-fixes.ps1  <- Targeted fix script (SQL westus2, KV RBAC, SP rotation)
├── docs\                      <- All project documentation
│   ├── PROJECT_OVERVIEW.md    <- This file
│   ├── USER_MANUAL.md         <- Admin user manual
│   ├── WORKFLOW.md            <- Enhanced Workflow Orchestration rules
│   ├── PEER_REVIEW.md         <- Multi-viewpoint peer review (2026-03-30)
│   └── specs\
│       ├── feature-spec-deploy-page.md
│       ├── feature-spec-app-catalog.md
│       ├── feature-spec-device-page.md
│       ├── feature-spec-dashboard.md
│       └── feature-spec-installed-apss-page.md
│
└── tasks\                     <- Internal session tracking
    ├── todo.md
    └── lessons.md
```

---

## Dependencies

### Runtime (Electron — Desktop)
| Package | Version | Purpose |
|---------|---------|---------|
| `@anthropic-ai/sdk` | ^0.36.3 | Claude API client |
| `better-sqlite3` | ^11.9.1 | SQLite (native, Electron 32 compatible) |
| `bcryptjs` | ^2.4.3 | Password hashing (pure JS, no native build) |
| `react` | ^18.3.1 | UI framework |
| `react-router-dom` | ^6.26.2 | Client-side routing (HashRouter) |
| `uuid` | ^10.0.0 | Session token generation |

### Runtime (Express Server — Web / Container)
| Package | Version | Purpose |
|---------|---------|---------|
| `express` | ^4 | HTTP server |
| `@prisma/client` | ^6 | SQL Server ORM |
| `@anthropic-ai/sdk` | ^0.36.3 | Claude API client |
| `@azure/msal-node` | ^2.16 | Microsoft OAuth2 (Authorization Code + Device Code flows) |
| `bcryptjs` | ^2.4.3 | Password hashing |
| `jsonwebtoken` | ^9 | JWT session tokens |
| `cors` | ^2 | CORS middleware |

### PowerShell
| Library | Version | Purpose |
|---------|---------|---------|
| MSAL.NET | 4.43.2 net461 | Microsoft authentication (last PS 5.1 compatible version) |
| PowerShell 7 (`pwsh`) | 7.x | Linux runtime for ps-bridge in Docker container |

### Build
| Package | Purpose |
|---------|---------|
| `electron` ^32 | Desktop shell |
| `vite` ^5 | Renderer bundler |
| `electron-builder` ^25 | NSIS installer creation |
| `typescript` ^5.6 | Type checking |
| `prisma` (CLI) | Schema generation + db push |

---

## Known Limitations (as of 2026-04-06)

1. **No group assignment** — Apps deployed to Intune are not assigned to any AAD group. Manual assignment in Intune portal required after each deployment.

2. **No deployment history UI** — The `app_deployments` table exists but is not populated by the AI agent; deployment history is not visible in the app.

3. **Non-semver version comparison returns 'unknown'** — Apps with date-based or non-standard version strings will not show "Update Available" status.

4. **N concurrent winget calls** — `useAppCatalog` fires one `winget.exe` process per Intune app during version checking. With 100+ apps this can be resource-intensive.

5. **No timeout on PS scripts** — A hung PowerShell script will hold a job in "running" state indefinitely. Click Cancel and kill any idle `powershell.exe` processes to recover.

6. **Update All stops on first failure** — If one app in the batch queue fails, the remaining apps are not processed.

7. **No IPC channel whitelist** — `preload.ts` accepts any channel string. Identified in peer review as a security hardening opportunity.

8. **Claude API key encryption uses MachineGuid** — Identified in peer review; DPAPI (`ProtectedData.Protect`) would be stronger. Current implementation is obfuscation, not strong encryption.

9. **Driver update status always 'unknown'** — Graph API `managedDevices` does not expose a dedicated driver update status field. The Devices page shows 'Unknown' for all devices.

10. **Device diagnostics shows 'Request Logs' regardless of prior requests** — No polling of existing log collection request status; the button always triggers a new request.

11. ~~**Web mode: tenant authentication broken**~~ — **Resolved in Phase 3.** See Resolved Issues.

12. **Web mode: `IntuneWinAppUtil.exe` unavailable** — The packaging binary is Windows-only and is not included in the Docker image. The `build_package` AI agent tool will fail in the web container. Resolution: Phase 3 will spawn an Azure Container Instance (Windows, pay-per-second) on demand for packaging jobs.

13. **Web mode: in-memory SSEManager** — `SSEManager` holds active SSE connections in process memory. If Container Apps scales to more than one replica, SSE events will only reach clients connected to the same replica. Resolution: Phase 4 will use Azure Service Bus for fan-out.

14. **SQL Server in West US 2, everything else in East US** — Introduced cross-region latency (~30 ms). Azure SQL Serverless had no quota in East US or East US 2 on this subscription at provisioning time.

---

## Resolved Issues

- **`tenant_config` row never written after connect** — Fixed: `token_expiry` column was missing from `db/schema.sql`. `better-sqlite3` threw on the INSERT, silently caught, so the row was never persisted. Fixed by adding the column to the schema and adding an `ALTER TABLE` migration in `electron/main.ts` for existing DBs. *(2026-03-31)*

- **Dashboard shows "Not connected" after navigation** — Fixed in two parts: (1) `TenantContext` now polls the DB every 60 seconds via `setInterval`, keeping all pages' connection status current without per-page polling; (2) `Dashboard.tsx` simplified — removed stale `hasFetched` + `reconnectAttempted` refs and manual reconnect logic; connection state now driven entirely by `TenantContext`. *(2026-03-31)*

- **SAS URI not returned from Graph API** — Fixed in `UploadManager.psm1`: added poll loop after `New-ContentFile` to wait up to 60 seconds for `azureStorageUri` to be provisioned asynchronously. *(2026-03-30)*

- **HTTP 400 on app creation** — Fixed in `New-Win32App.ps1` and `ai-agent.ts`: corrected `minimumSupportedWindowsRelease` enum values (`windows10_21H2` not `W10_21H2`), switched to temp file JSON passing (bypasses PS 5.1 CLI arg mangling), rewrote script to POST raw JSON via `HttpWebRequest` (prevents single-element array collapse). *(2026-03-30)*

- **commitFileFailed after block list PUT** — Fixed in `UploadManager.psm1`: `size` field was outer ZIP size (wrong); corrected to `UnencryptedContentSize` from Detection.xml. `sizeEncrypted` corrected to `ZipArchiveEntry.Length` of inner blob. Upload now streams the inner `IntunePackage.intunewin` entry from the ZIP, not the outer file. *(2026-03-30)*

- **Block list XML malformed (operator precedence)** — Fixed in `UploadManager.psm1`: `-join` was binding to the string suffix not the ForEach pipeline. Extracted to `$blockEntries` variable first. *(2026-03-30)*

- **Graph error bodies swallowed** — Fixed in `GraphClient.psm1`: added `StreamReader` on error response stream to capture and surface Graph API error JSON in exception messages. `Commit-ContentFile` rewritten to use `HttpWebRequest` directly for the same reason. *(2026-03-30)*

- **PS 5.1 parse error in List-IntunewinPackages.ps1** — Em dash `—` (U+2014) in a string without UTF-8 BOM caused PS 5.1 to misread the file as Windows-1252 ANSI, corrupting the string terminator. Fixed: replaced em dash with `-`; file re-saved with UTF-8 BOM. *(2026-03-31)*

- **Upload pipeline reliability (peer review 2026-03-31)** — Applied 1 BLOCKING + 5 MAJOR + 1 MINOR fixes: StreamReader disposal in `Get-IntunewinMetadata`, `stream.Read()` error wrapping, SAS URI unchanged-after-refresh guard, `FileEncryptionInfo` structure guard before commit, error stream disposal in `Commit-ContentFile`, null status code label in `Invoke-GraphRequest`. *(2026-03-31)*

- **Deploy button silently did nothing for packages without PACKAGE_SETTINGS.md** — Fixed: button is now disabled (not hidden) when `packageSettings` is null, with a tooltip explaining why. *(2026-03-30)*

- **PACKAGE_SETTINGS.md not found due to filename/folder name mismatch** — Fixed in `List-IntunewinPackages.ps1`: 4-level fuzzy matching (exact → normalized → prefix → substring). *(2026-03-30)*

- **App Catalog recommendations slow to load** — Fixed: recommendations are now persisted to `app_settings` (`recommendations_cache`) after each Claude call. Subsequent loads return the cache immediately; Claude refresh runs in the background and pushes updated results via `ipc:ai:recommendations-updated`. *(2026-03-31)*

- **Settings only supported a single Claude API key** — Fixed: Settings → General now supports two connection methods — Direct Anthropic API key or AWS Bedrock (SSO). Save is blocked with a clear error if neither method is configured. `aws_region` and `aws_bedrock_model_id` added to `app_settings`. `ipc:aws:sso-login` handler added to `ps-bridge.ts` to run `aws sso login`. *(2026-04-01)*

---

### Phase 3 Resolved Issues *(2026-04-07)*

- **Web mode: tenant authentication broken** — Fixed: `Connect-Tenant.ps1` used MSAL.NET (`.NET Framework`) which cannot load on Linux `pwsh`. Replaced with server-side `@azure/msal-node` `ConfidentialClientApplication`. New endpoints: `GET /api/auth/ms-login` (OAuth2 redirect), `GET /api/auth/ms-callback` (token exchange), `POST /api/auth/ms-device-code` (device code flow). Tokens encrypted with AES-256-CBC and stored in `TenantConfig.access_token` / `TenantConfig.refresh_token`. Graph-calling PS scripts receive token via `-AccessToken` parameter; `GraphClient.psm1` uses `$script:InjectedToken` when set. **Prerequisite:** Azure AD App Registration required (`AZURE_CLIENT_ID` + `AZURE_CLIENT_SECRET` GitHub Secrets). *(2026-04-07)*

---

### Web Deployment Resolved Issues *(2026-04-06)*

- **`powershell.exe` hardcoded in ps-bridge.ts** — Fixed: `const psBin = process.platform === 'win32' ? 'powershell.exe' : 'pwsh'`. Kill signal also platform-aware (`kill -9` on Linux vs `taskkill /f /t` on Windows). Both `electron/ipc/ps-bridge.ts` and `server/services/ps-bridge.ts` updated.

- **Prisma binary not found in Linux container** — Fixed: added `binaryTargets = ["native", "debian-openssl-3.0.x"]` to `server/prisma/schema.prisma`. `native` covers local dev; `debian-openssl-3.0.x` covers `node:20-slim` (Debian 12) in Docker.

- **`better-sqlite3` cache in server code** — Fixed: `server/services/cache.ts` created using Prisma `AppSetting` table as a key-value store. Import in `server/routes/ps.ts` updated.

- **GHA Docker cache export fails (no Buildx driver)** — Fixed: added `docker/setup-buildx-action@v3` step before `docker/build-push-action@v5` in the workflow. Required for the GHA cache backend.

- **`npm ci` fails — no package-lock.json** — Fixed: changed all `npm ci` to `npm install` in the Dockerfile and workflow. Project has no lock files.

- **`electron/ps-scripts/` excluded by `.dockerignore`** — Fixed: `.dockerignore` includes `electron/` (to exclude Electron binaries/config) but adds `!electron/ps-scripts/` exception so PowerShell bridge scripts are available in the container.

- **`prisma migrate deploy` fails — no migrations folder** — Fixed: changed to `prisma db push --skip-generate --accept-data-loss` in the CI/CD workflow. No `prisma/migrations/` folder exists yet.

- **`COPY public/ ./public/` in Dockerfile — directory doesn't exist** — Fixed: removed that line. The public folder is not used; React SPA is at `builds/dist-web/`.

- **App Service Plan quota = 0 across all tiers** — Pivoted to Azure Container Apps (Consumption). Container Apps uses no VM quota — scale-to-zero, pay per request.

- **Key Vault RBAC mode — `az keyvault set-policy` rejected** — Fixed: new Azure Key Vaults default to RBAC authorization. Used `az role assignment create --role "Key Vault Secrets Officer"` for the admin account and `"Key Vault Secrets User"` for the Container App Managed Identity instead.

- **Azure SQL blocked in East US / East US 2** — Provisioned in West US 2 (`westus2`) where quota was available.
