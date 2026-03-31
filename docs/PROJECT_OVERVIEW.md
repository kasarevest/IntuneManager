# IntuneManager — Project Overview

**Last Updated:** 2026-03-31

## What is IntuneManager?

IntuneManager is an AI-powered desktop application for packaging and deploying Windows applications to Microsoft Intune as Win32 apps. It replaces the manual workflow of downloading installers, writing PowerShell scripts, running IntuneWinAppUtil.exe, and uploading through the Intune portal — with a guided, automated pipeline driven by an AI agent (Claude).

The project consists of two components:

| Component | Location | Purpose |
|-----------|----------|---------|
| `IntuneManagerUI\` | Electron + React desktop app | Primary user interface |
| `IntuneManager\` | PowerShell module library | PS execution layer (reused by UI via ps-bridge) |

The UI is the active component. The original PowerShell + WPF application was superseded by the Electron rebuild.

---

## Problem Solved

Packaging a Windows application for Intune requires:
1. Finding the correct installer version and download URL
2. Writing a PowerShell install script with silent arguments, SHA256 verification, and version checking
3. Writing an uninstall script with reboot code propagation
4. Writing a detection script using registry keys
5. Running IntuneWinAppUtil.exe to create a `.intunewin` package
6. Registering the app in the Intune portal with correct metadata
7. Uploading the `.intunewin` using Microsoft Graph API (chunked Azure Blob upload)

This process typically takes 30–60 minutes per application when done manually. IntuneManager reduces this to a single prompt typed into a search field.

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
│  ├─ Devices                    │  │  ps-scripts/ (18)        │
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
The original implementation used PowerShell + WPF (see `IntuneManager\`). This was replaced because WPF requires STA threading for MSAL interactive login, has .NET Framework property compatibility issues, and provides poor support for complex UI patterns (AI log streaming, reactive version checking).

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
| Dashboard | `/dashboard` | Executive summary — charts, stats, alerts, auto-refresh |
| Installed Apps | `/installed-apps` | Inventory of all Win32 apps in the tenant; version checking; updates |
| App Catalog | `/catalog` | Discovery — AI recommendations + winget search; initiate packaging |
| Deploy | `/deploy` | Execution — ready `.intunewin` packages + active job progress panel |
| Devices | `/devices` | Device compliance, update status, diagnostics, action buttons |

**`TenantContext` 60-second polling**
`TenantContext` reads the `tenant_config` SQLite row on app start and every 60 seconds. This keeps the connection status indicator accurate across all page navigations without any per-page reconnect logic.

**`New-Win32App.ps1` — raw JSON via HttpWebRequest**
The app creation script does NOT use `GraphClient.psm1`'s `Invoke-GraphRequest` (which does `$Body | ConvertTo-Json`). Instead it:
1. Reads the JSON body from a temp file written by Node.js (`-BodyJsonPath` parameter)
2. POSTs the raw UTF-8 bytes directly via `[System.Net.HttpWebRequest]`

This bypasses two PS 5.1 serialization bugs: (1) CLI argument mangling of `{ } : [ ] "` characters, and (2) `ConvertTo-Hashtable -> ConvertTo-Json` collapsing single-element arrays like `detectionRules: [{...}]` into plain objects.

**`UploadManager.psm1` — SAS URI polling + inner blob streaming**
The `.intunewin` outer file is a ZIP. The actual content to upload is the inner `IntunePackage.intunewin` entry — not the outer ZIP. After `POST .../contentVersions/{id}/files`, Graph API provisions `azureStorageUri` asynchronously. The upload manager polls `GET .../files/{fileId}` at 5-second intervals (up to 60 seconds) until `azureStorageUri` is populated, then streams the inner encrypted blob in 5 MB chunks directly from the ZIP entry.

---

## Data Model

**SQLite database** (`%AppData%\Roaming\intune-manager-ui\intunemanager.db`)

| Table | Purpose |
|-------|---------|
| `users` | Local application users (not AAD users). Roles: superadmin, admin, viewer |
| `sessions` | UUID session tokens, 8-hour expiry |
| `tenant_config` | Single-row: connected AAD tenant, username, `token_expiry`, `connected_at` |
| `app_settings` | Key-value store: API key (encrypted), paths, default OS version |
| `app_deployments` | Deployment history log (schema defined; not yet fully populated by AI agent) |

> **Note on `tenant_config`:** The `token_expiry` column was added in a migration on first launch after 2026-03-31. Existing DBs that predate this change have the column added automatically via `ALTER TABLE` at startup.

---

## Authentication Model

**Two distinct auth layers:**

1. **Local app auth** — bcrypt password hashing (cost 12), UUID sessions stored in `sessions` table, `sessionStorage` in renderer. Expires after 8 hours or window close.

2. **Microsoft tenant auth** — MSAL.NET via `Auth.psm1`. Uses Microsoft Graph PowerShell client ID (`14d82eec-204b-4c2f-b7e8-296a70dab67e`, pre-consented in all M365 tenants). Supports browser-based interactive login and device code flow. Token cache is DPAPI-encrypted per-user. Token expiry is stored in `tenant_config.token_expiry` and updated on each connect.

---

## AI Agent Design

The AI agent is a Claude tool-use loop in `electron/ipc/ai-agent.ts`.

**Model:** `claude-opus-4-5-20251101`

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

**Generated script patterns** (enforced by system prompt + code):
- `[CmdletBinding()]` on every script
- Path traversal protection: `[IO.Path]::GetFullPath()` + `StartsWith()` check
- SHA256 verification of installer at runtime (when hash provided)
- Version check before install: skip if same or newer installed
- Detection registry: `HKLM:\SOFTWARE\<AppNameNoSpaces>Installer`
- Reboot code propagation: `exit 3010` propagated from installer exit code

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

## Deployment Pipeline (detailed)

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

---

## Devices Feature

The Devices page (`/devices`) pulls all managed devices from `GET /deviceManagement/managedDevices` (Graph beta) and presents:

| Column | Source field |
|--------|-------------|
| Device name | `deviceName` |
| User | `userPrincipalName` |
| OS version | `operatingSystem` + `osVersion` |
| Compliance | `complianceState` → colour-coded badge |
| Windows Update status | Derived from `windowsProtectionState` fields |
| Driver Update status | Derived (Graph has no separate driver-only status on managedDevices; defaults to `unknown`) |
| Diagnostics | `hasDiagnosticData` flag |
| Last sync | `lastSyncDateTime` |

**Per-device actions:**
- **Sync Updates** — calls `syncDevice` Graph action via `Invoke-WindowsUpdate.ps1`
- **Sync Drivers** — calls `syncDevice` Graph action via `Invoke-DriverUpdate.ps1`
- **Request Logs** — calls `createDeviceLogCollectionRequest` via `Get-DeviceDiagnostics.ps1`

**Attention indicators:** A device is flagged as `needsAttention` when it is non-compliant, in grace period, has pending Windows updates, or has pending driver updates. The Devices page shows an amber ⚠ icon per device and a "Show Attention Only" filter.

**Stats tiles** at the top of the Devices page: Total / Compliant / Non-Compliant / Need Attention.

---

## File Structure

```
Intune MSI Prep\
├── IntuneManagerUI\           <- Electron + React application
│   ├── electron\
│   │   ├── main.ts            <- Window creation, DB init, migrations, IPC registration
│   │   ├── preload.ts         <- contextBridge (invoke, on, once, off)
│   │   └── ipc\
│   │       ├── ai-agent.ts    <- Claude tool-use loop + 3 job runners
│   │       ├── auth.ts        <- Local auth (bcrypt, sessions)
│   │       ├── ps-bridge.ts   <- PowerShell spawn + LOG/RESULT protocol + device IPC
│   │       └── settings.ts    <- App settings + dialog handlers (file/folder picker)
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
│   │   │   ├── useRecommendations.ts   <- Module-level AI recommendation cache
│   │   │   └── useDeployJob.ts         <- Job subscription management
│   │   ├── pages\
│   │   │   ├── Login.tsx
│   │   │   ├── FirstRun.tsx
│   │   │   ├── Dashboard.tsx           <- Executive summary (charts, stats, alerts, 60s refresh)
│   │   │   ├── InstalledApps.tsx       <- App inventory (card grid, search, update, details)
│   │   │   ├── AppCatalog.tsx          <- Discovery (AI recs, winget search, initiate packaging)
│   │   │   ├── Deploy.tsx              <- Execution (ready packages, job progress panel)
│   │   │   ├── Devices.tsx             <- Device list with compliance/update/diagnostics actions
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
│   ├── Camtasia\              <- camtasia.msi + scripts + PACKAGE_SETTINGS.md
│   └── EdgeWebView2\          <- bootstrapper + scripts + PACKAGE_SETTINGS.md
│
├── Output\                    <- Generated .intunewin packages
│   ├── Install-Camtasia.intunewin
│   └── Install-EdgeWebView2.intunewin
│
├── IntuneWinAppUtil.exe        <- Microsoft packaging tool
│
├── docs\                      <- All project documentation (this folder)
│   ├── PROJECT_OVERVIEW.md    <- This file
│   ├── USER_MANUAL.md         <- Admin user manual
│   ├── WORKFLOW.md            <- Enhanced Workflow Orchestration rules
│   ├── PEER_REVIEW.md         <- Multi-viewpoint peer review (2026-03-30)
│   └── specs\
│       ├── feature-spec-deploy-page.md      <- Original deploy page feature spec
│       ├── feature-spec-app-catalog.md      <- App Catalog / Deploy refactor spec
│       ├── feature-spec-device-page.md      <- Devices page feature spec
│       ├── feature-spec-dashboard.md        <- Dashboard executive summary spec
│       └── feature-spec-installed-apss-page.md  <- Installed Apps page spec
│
└── tasks\                     <- Internal session tracking
    ├── todo.md                <- Pre/post-flight records per task
    └── lessons.md             <- 8 accumulated lessons
```

---

## Dependencies

### Runtime (Electron)
| Package | Version | Purpose |
|---------|---------|---------|
| `@anthropic-ai/sdk` | ^0.36.3 | Claude API client |
| `better-sqlite3` | ^11.9.1 | SQLite (native, Electron 32 compatible) |
| `bcryptjs` | ^2.4.3 | Password hashing (pure JS, no native build) |
| `react` | ^18.3.1 | UI framework |
| `react-router-dom` | ^6.26.2 | Client-side routing (HashRouter) |
| `uuid` | ^10.0.0 | Session token generation |

### PowerShell
| Library | Version | Purpose |
|---------|---------|---------|
| MSAL.NET | 4.43.2 net461 | Microsoft authentication (last PS 5.1 compatible version) |

### Build
| Package | Purpose |
|---------|---------|
| `electron` ^32 | Desktop shell |
| `vite` ^5 | Renderer bundler |
| `electron-builder` ^25 | NSIS installer creation |
| `typescript` ^5.6 | Type checking |

---

## Known Limitations (as of 2026-03-31)

1. **No group assignment** — Apps are deployed to Intune but not assigned to any AAD group. Manual assignment in Intune portal required after each deployment.

2. **No deployment history UI** — The `app_deployments` table exists but is not populated by the AI agent; deployment history is not visible in the app.

3. **Non-semver version comparison returns 'unknown'** — Apps with date-based or non-standard version strings will not show "Update Available" status.

4. **N concurrent winget calls** — `useAppCatalog` fires one `winget.exe` process per Intune app during version checking. With 100+ apps this can be resource-intensive.

5. **No timeout on PS scripts** — A hung PowerShell script will hold a job in "running" state indefinitely. Click Cancel and kill any idle `powershell.exe` processes to recover.

6. **Update All stops on first failure** — If one app in the batch queue fails, the remaining apps are not processed.

7. **No IPC channel whitelist** — `preload.ts` accepts any channel string. Identified in peer review as a security hardening opportunity.

8. **Claude API key encryption uses MachineGuid** — Identified in peer review; DPAPI (`ProtectedData.Protect`) would be stronger. Current implementation is obfuscation, not strong encryption.

9. **Driver update status always 'unknown'** — Graph API `managedDevices` does not expose a dedicated driver update status field. The Devices page shows 'Unknown' for driver update status on all devices.

10. **Device diagnostics shows 'Request Logs' regardless of prior requests** — There is no polling of existing log collection request status; the button always triggers a new request.

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

- **Deploy button silently did nothing for packages without PACKAGE_SETTINGS.md** — Fixed: button is now disabled (not hidden) when `packageSettings` is null, with a tooltip explaining why. Guard retained in `startUploadOnlyJob` as defence-in-depth. *(2026-03-30)*

- **PACKAGE_SETTINGS.md not found due to filename/folder name mismatch** — Fixed in `List-IntunewinPackages.ps1`: 4-level fuzzy matching (exact → normalized → prefix → substring) handles cases like `Notepad++` → `NotepadPlusPlus`. Bold markdown field parsing (`| **Field** |`) also added. *(2026-03-30)*
