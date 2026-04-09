# Cybersecurity Design Review Request
## IntuneManager — Automated Application Update Feature

**Submitted by:** IntuneManager Engineering
**Date:** 2026-04-09
**Review type:** Cybersecurity Design Review
**Status:** Awaiting approval

---

## 1. About This Document

This document is submitted to the Cybersecurity team as part of the design review process for a new feature in IntuneManager. The cybersecurity team has not previously reviewed this application. This document therefore begins with a full introduction to the platform before describing the specific change under review.

---

## 2. Application Overview

### 2.1 What is IntuneManager?

IntuneManager is an internal IT administration tool that gives administrators a unified interface for managing Windows endpoint applications through Microsoft Intune. It consolidates workflows that would otherwise require navigating multiple blades in the Microsoft Intune portal.

**Primary users:** IT administrators responsible for managing Windows endpoints across the organisation.

**Core capabilities:**

| Capability | Description |
|------------|-------------|
| App inventory & version checking | Displays every Win32 application deployed in the Intune tenant, cross-referenced against the latest version available on WinGet (Microsoft's open-source package repository) |
| Automated app packaging & deployment | An AI agent (powered by Claude) handles the full packaging pipeline — finding the installer, writing detection and install scripts, building the `.intunewin` package, and uploading to Intune |
| Device health monitoring | Real-time compliance state, Windows Update status, and diagnostics for every managed device in the tenant |
| Group assignment management | Assigns deployed applications to Azure AD security groups directly from the tool |

### 2.2 Business Context

Managing a Windows endpoint fleet in Intune typically requires:
- Navigating multiple Intune portal blades to check compliance and app versions
- Manually packaging each application using Microsoft's `IntuneWinAppUtil.exe` tool (30–60 minutes per app)
- Updating apps one by one through the portal

IntuneManager reduces this to a single interface, with AI-assisted packaging and update management.

### 2.3 Deployment Modes

The application supports two deployment modes:

| Mode | Hosting | Runtime | Used by |
|------|---------|---------|---------|
| **Desktop (Electron)** | Local Windows machine | Electron 32 + Node.js | Administrators running on-prem or via VPN |
| **Web (Containerised)** | Azure Container Apps | Node.js 20 + Express | Administrators accessing via browser |

The web deployment is the active and primary mode. The desktop Electron build remains supported for local use.

**Live URL (web):**
```
https://ca-intunemanager-prod.yellowforest-c85ceb60.eastus.azurecontainerapps.io
```

---

## 3. Platform Architecture

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  ADMINISTRATOR BROWSER / ELECTRON DESKTOP                           │
│  React SPA (Vite, TypeScript)                                       │
│  Pages: Dashboard | Installed Apps | App Catalog | Deploy | Devices │
└──────────────────────────┬──────────────────────────────────────────┘
                           │  HTTPS / JWT-authenticated API calls
                           │
┌──────────────────────────▼──────────────────────────────────────────┐
│  EXPRESS.JS SERVER  (Node 20 — Azure Container Apps, East US)       │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ Auth routes  │  │ PS routes    │  │ AI Agent routes          │  │
│  │ JWT sessions │  │ Graph proxy  │  │ Claude tool-use loop     │  │
│  │ bcrypt users │  │ ps-bridge.ts │  │ 11 packaging tools       │  │
│  └──────────────┘  └──────┬───────┘  └──────────────────────────┘  │
│                           │                                         │
│  ┌────────────────────────▼────────────────────────────────────┐    │
│  │  PowerShell Bridge (pwsh 7, spawned as child process)       │    │
│  │  Receives -AccessToken injected per call from server        │    │
│  │  Communicates via stdout: LOG:[LEVEL] / RESULT:{json}       │    │
│  └─────────────────────────────────────────────────────────────┘    │
└──────────┬─────────────────────────────────┬────────────────────────┘
           │                                 │
┌──────────▼──────────┐          ┌───────────▼──────────────────────┐
│  Azure SQL Server   │          │  Microsoft Graph API (Intune)    │
│  (West US 2,        │          │  - Manage Win32 apps             │
│  Serverless)        │          │  - Device management             │
│  Prisma ORM         │          │  - AAD group assignments         │
│  - users            │          │                                  │
│  - sessions         │          │  Auth: OAuth2 Authorization Code │
│  - tenant_config    │          │  or Device Code Flow             │
│  - app_deployments  │          │  Token: AES-256-CBC encrypted,   │
│  - wt_detected_     │          │  stored in tenant_config table   │
│    updates          │          └──────────────────────────────────┘
└─────────────────────┘
           │
┌──────────▼──────────┐
│  Azure Key Vault    │
│  (East US)          │
│  - DATABASE_URL     │
│  - APP_SECRET_KEY   │
│  - AZURE_CLIENT_ID  │
│  - AZURE_CLIENT_    │
│    SECRET           │
│  Access via MI RBAC │
└─────────────────────┘
```

### 3.2 Azure Infrastructure

| Resource | Name | Region | Purpose |
|----------|------|--------|---------|
| Container Apps Environment | `cae-intunemanager-prod` | East US | Hosts the containerised application |
| Container App | `ca-intunemanager-prod` | East US | Express server + React SPA, scales to zero |
| Azure SQL Serverless | `sql-intunemanager-prod` | West US 2 | Primary database (Prisma ORM) |
| Azure Blob Storage | `stintunemgrprod` | East US | App installer source files and packaged output |
| Azure Key Vault | `kv-intunemgr-prod` | East US | Runtime secrets (accessed via Managed Identity) |
| GitHub Container Registry | `ghcr.io/...` | — | Docker image registry |

### 3.3 CI/CD Pipeline

Every push to the `master` branch triggers a GitHub Actions workflow:

1. Docker image is built and pushed to GitHub Container Registry (GHCR)
2. Database schema migrations are applied via `prisma migrate deploy`
3. Azure Container App is updated with the new image

Secrets (database credentials, OAuth client credentials, app encryption key) are stored in Azure Key Vault and referenced by the Container App via Managed Identity — they are not stored in GitHub Actions or environment variable plaintext.

---

## 4. Security Architecture

### 4.1 Authentication — Application Layer

Administrators log into IntuneManager using a local account (username + password). This is separate from their Microsoft identity.

| Control | Implementation |
|---------|---------------|
| Password hashing | bcrypt, cost factor 12 |
| Session tokens | UUID tokens, stored server-side in `sessions` table, 8-hour expiry |
| Session transport | HTTP-only (JWT in Authorization header); not stored in browser localStorage |
| Role-based access | Three roles: `superadmin`, `admin`, `viewer` — enforced on all API routes via `requireAuth` middleware |

### 4.2 Authentication — Microsoft Tenant (Graph API)

To call the Microsoft Intune Graph API, the application authenticates as an Azure AD App Registration on behalf of the signed-in administrator. Two flows are supported:

| Flow | Trigger | Use case |
|------|---------|---------|
| OAuth2 Authorization Code | Browser redirects to `login.microsoftonline.com` | Standard interactive sign-in |
| Device Code Flow | User visits a URL on a secondary device | Headless or restricted browser environments |

**Token handling:**
- Access and refresh tokens are AES-256-CBC encrypted (key: `APP_SECRET_KEY` from Key Vault) before being written to the `tenant_config` database table
- Tokens are decrypted server-side only, on demand, immediately before each API call
- Tokens are never returned to the browser
- Automatic refresh is performed when the access token has less than 5 minutes remaining
- The Graph access token is injected into each PowerShell script call as a parameter (`-AccessToken`) — PS scripts do not perform their own authentication

### 4.3 Secrets Management

| Secret | Storage | Access |
|--------|---------|--------|
| `DATABASE_URL` | Azure Key Vault | Container App Managed Identity (Key Vault Secrets User role) |
| `APP_SECRET_KEY` (token encryption key) | Azure Key Vault | Container App Managed Identity |
| `AZURE_CLIENT_ID` | Azure Key Vault | Container App Managed Identity |
| `AZURE_CLIENT_SECRET` | Azure Key Vault | Container App Managed Identity |
| Anthropic API key | Azure SQL (`app_settings`) | AES-256-CBC encrypted at rest |

Secrets are not present in the Docker image, the GitHub repository, or any GitHub Actions logs.

### 4.4 Network Security

- All traffic between the browser and the Container App is over HTTPS (enforced by Azure Container Apps ingress)
- Azure SQL enforces `encrypt=true; trustServerCertificate=false` on all connections
- The Container App is exposed only via the Azure-managed ingress endpoint; no direct port exposure
- PowerShell scripts run as child processes inside the container — they do not open outbound ports; they make HTTPS calls to Microsoft Graph and WinGet APIs

### 4.5 Input Validation and Injection Prevention

| Risk | Mitigation |
|------|-----------|
| Path traversal in PS script arguments | Server validates all file paths against an allowlist of permitted base paths before passing to PowerShell (Issue #004 control) |
| Command injection via PS arguments | All parameters are passed as named PS arguments (`-ArgName value`), not interpolated into command strings |
| JSON mangling in PS | Request bodies requiring complex JSON are written to a temp file; PS reads the file path — raw PS CLI argument expansion is not used for JSON payloads |
| SQL injection | All database access is via Prisma ORM parameterised queries — no raw SQL |
| XSS | React renders all dynamic content via the virtual DOM — no `dangerouslySetInnerHTML` usage |

### 4.6 PowerShell Bridge Protocol

All PowerShell scripts communicate results to Node via stdout using a structured protocol:

```
LOG:[INFO] Message        →  forwarded to job event stream
LOG:[ERROR] Failure       →  forwarded as error log
RESULT:{"success":true}   →  terminal JSON return value (one line, at end of script)
```

Scripts are spawned as child processes with a configurable timeout. If a script exceeds its timeout, the process is killed (`kill -9` on Linux). Scripts do not have persistent state between calls.

### 4.7 Microsoft Graph API Permissions

The Azure AD App Registration (`AZURE_CLIENT_ID`) requires the following delegated permissions:

| Permission | Purpose |
|------------|---------|
| `DeviceManagementApps.ReadWrite.All` | Create, read, and update Win32 apps in Intune |
| `DeviceManagementConfiguration.Read.All` | Read device management configuration |
| `GroupMember.Read.All` | Read AAD group membership for assignment |
| `User.Read` | Read the signed-in user's profile |
| `openid`, `profile`, `offline_access` | OpenID Connect identity claims + refresh tokens |

All permissions are **delegated** (on behalf of the authenticated admin user) — the application does not use application permissions.

---

## 5. Feature Under Review — Automated Application Update Behavior

### 5.1 Summary

This feature introduces age-based update logic to the **Installed Apps** page of IntuneManager. Previously, all available application updates required the administrator to manually click an "Update" button. This change automates updates for applications where an available update has been known to the system for more than 7 days, while continuing to require manual action for more recently detected updates.

### 5.2 Business Justification

Administrators managing large application fleets found that stable, long-available updates were going unapplied because there was no automated mechanism to act on them. This feature reduces manual workload for updates that have been available long enough to be considered stable, while preserving administrator control over newly released updates that may not yet be fully validated.

### 5.3 How the Feature Works

**Detection tracking (new):**
A new database table (`wt_detected_updates`) records the first time IntuneManager detects an available update for each application version. The key is `(packageId, latestVersion)` — i.e., a new record is created only when a new version is available. The detection timestamp (`first_seen_at`) is immutable after creation.

**Age calculation:**
Each time the Installed Apps page loads, the server calculates how many days have elapsed since each update was first detected (`daysKnown = floor((now - first_seen_at) / 86400000)`).

**Update rules:**

| Condition | Behavior | UI shown to admin |
|-----------|----------|-------------------|
| No update available | No action | Nothing |
| Update detected ≤ 7 days ago | No automatic action | "Update App" button |
| Update detected > 7 days ago | Automatic update triggered | "↻ Updating..." → "✓ Updated" |
| Update fails (any case) | Original app and assignments unchanged | "↺ Retry" button |

**Update execution:**
Each automatic update calls the existing `POST /api/ps/wt-update-app` endpoint — the same endpoint used for manual updates. The only difference is that `updateType: 'auto'` is passed in the request body, which triggers an additional audit log write. The underlying update mechanism (`Update-WtApp.ps1`) is unchanged.

**Assignment preservation:**
The WinTuner PowerShell pipeline uses the `-KeepAssignments` flag when deploying the replacement app version. This instructs the Intune Graph API to copy all existing group assignments from the current version to the new version. No assignments are removed or require reconfiguration.

### 5.4 Data Flow for an Automated Update

```
1. Admin loads the Installed Apps page (authenticated session)

2. Browser → GET /api/ps/wt-updates  [JWT required]
   Server:
   a. Fetches decrypted Graph access token from tenant_config
   b. Spawns Get-WtUpdates.ps1 with -AccessToken
   c. WinTuner queries Intune Graph API for apps with newer WinGet versions
   d. For each result: upserts (packageId, latestVersion) into wt_detected_updates
      — INSERT on first detection, no-op on subsequent calls
   e. Calculates daysKnown for each item from first_seen_at
   f. Returns enriched list: { name, versions, graphId, daysKnown, autoUpdateEligible }

3. Browser receives list
   — Items with autoUpdateEligible = true are immediately marked 'Updating'
   — Items with autoUpdateEligible = false show 'Update App' button

4. For each auto-eligible item:
   Browser → POST /api/ps/wt-update-app  [JWT required]
   Body: { packageId, graphId, packageFolder, updateType: 'auto',
           currentVersion, latestVersion }
   
   Server:
   a. Validates packageFolder path against permitted base paths
   b. Fetches decrypted Graph access token
   c. Spawns Update-WtApp.ps1 with:
      -PackageId, -GraphId, -PackageFolder, -AccessToken
   d. PowerShell: New-WtWingetPackage | Deploy-WtWin32App -KeepAssignments
      — Downloads new version from WinGet
      — Deploys to Intune via Graph API (replaces existing app, keeps assignments)
   e. Fire-and-forget: writes audit row to app_deployments
   f. Returns { success: true/false }

5. Browser updates UI state per item: 'updated' or 'error'
```

### 5.5 Audit Record

Every automatic update attempt writes a row to the `app_deployments` table:

| Field | Value |
|-------|-------|
| `job_id` | `auto-upd-{graphId}-{timestamp}` (unique per operation) |
| `operation` | `wt-auto-update` |
| `app_name` | WinGet package ID |
| `intune_app_id` | Intune Graph object ID |
| `deployed_version` | New version string |
| `status` | `completed` or `failed` |
| `error_message` | Error detail if failed |
| `completed_at` | UTC timestamp |
| `log_snapshot` | JSON: `{ "previousVersion": "...", "newVersion": "..." }` |

The audit log write is non-blocking (fire-and-forget). A failure to write the audit record does not affect the update operation or its reported outcome to the administrator.

---

## 6. Security Considerations for Review

The following items are raised for explicit cybersecurity team review and sign-off.

### 6.1 Automated Action Without Per-Operation Admin Confirmation

**Item:** Applications with updates detected more than 7 days ago are updated automatically when an administrator opens the Installed Apps page, without a confirmation dialog for each individual app.

**Controls in place:**
- The administrator must be authenticated (JWT-validated session) for the page to load
- The 7-day threshold is evaluated server-side — it cannot be bypassed or shortened by browser manipulation
- Auto-update only applies to WinTuner-managed apps (those already deployed via IntuneManager) — it does not affect apps deployed outside this tool
- If any update fails, the original version and all assignments remain intact in Intune
- All auto-update activity is recorded in the `app_deployments` audit table

**Question for reviewers:** Is automated application update activity, triggered by an authenticated administrator session, acceptable under the organisation's change management policy? Does the 7-day threshold require formal configuration control?

### 6.2 No Per-Update Change Advisory Board (CAB) Approval

**Item:** Automatic updates do not go through a CAB or change ticket workflow before execution.

**Note:** The feature is designed for routine maintenance updates of already-deployed applications (e.g., updating Google Chrome from 120.x to 121.x). It is not intended for new application deployments or configuration changes. Reviewers should confirm whether this class of change requires CAB approval under current policy.

### 6.3 Dependency on WinTuner Module Integrity

**Item:** The update pipeline relies on the WinTuner PowerShell module (`Install-Module WinTuner`) installed inside the Docker container image at build time.

**Controls in place:**
- The module version is pinned at container build time via the Dockerfile
- The container image is built from a controlled GitHub Actions pipeline and stored in a private GitHub Container Registry
- The container image is immutable once deployed; it is replaced only via a new CI/CD run triggered by a push to `master`

**Residual risk:** If the WinTuner module source (PowerShell Gallery) were compromised between builds, a malicious module version could be incorporated into a future image. Supply chain controls for the module dependency are not currently implemented (no hash pinning of the module).

### 6.4 Audit Log Not Exported to SIEM

**Item:** Automatic update audit records are stored in Azure SQL (`app_deployments` table) but are not currently exported to a SIEM or central log management platform.

**Impact:** Auto-update activity is auditable via direct database query, but is not visible in real-time security monitoring tooling.

**Question for reviewers:** Is local Azure SQL audit retention sufficient, or is SIEM integration required before this feature can be approved?

### 6.5 Graph API Delegated Permissions Scope

**Item:** The automatic update process uses the existing `DeviceManagementApps.ReadWrite.All` Graph API permission. This permission allows reading and modifying all Win32 app records in the Intune tenant — not just those managed by IntuneManager.

**This is an existing permission, not introduced by this feature.** It is noted here for completeness so reviewers have a full picture of the application's privilege level.

---

## 7. Existing Security Controls (Platform-Wide)

For reference, the following security controls are already in place across the IntuneManager platform and are not changed by this feature.

| Control | Detail |
|---------|--------|
| Transport encryption | All traffic over HTTPS; Azure SQL with `encrypt=true` |
| Authentication | bcrypt passwords (cost 12); JWT sessions with 8-hour expiry |
| Secrets management | All runtime secrets in Azure Key Vault; accessed via Managed Identity |
| Token encryption | Microsoft Graph tokens AES-256-CBC encrypted at rest |
| Graph token isolation | Tokens decrypted server-side only; never sent to browser |
| Path traversal protection | All PS script file paths validated against permitted base paths |
| SQL injection prevention | All DB access via Prisma ORM parameterised queries |
| Role-based access | Three roles enforced on all API routes |
| Container immutability | Images built by CI/CD pipeline; not modified after deployment |
| Network boundary | Container App accessible only via Azure-managed HTTPS ingress |

---

## 8. Out of Scope for This Change

The following items are **not** part of this feature and are noted to set clear review boundaries:

- Rollback or version history for auto-updated applications
- Administrator notification (email, Teams message) on auto-update
- Configurable auto-update threshold (currently fixed at 7 days server-side)
- Audit log export to external SIEM
- CAB integration or ticketing workflow
- Any change to Graph API permissions or OAuth scopes
- Any change to device management functionality

---

## 9. Review Checklist

| Item | Reviewer sign-off |
|------|------------------|
| Automated update without per-op confirmation is acceptable under change management policy | |
| 7-day threshold does / does not require formal configuration control | |
| CAB approval is / is not required for routine Win32 app version updates | |
| Azure SQL audit retention is sufficient / SIEM integration required | |
| WinTuner module supply chain risk is accepted / requires hash pinning | |
| Overall design is approved / requires changes before deployment | |

---

*For technical questions about this design, contact the IntuneManager Engineering team.*
