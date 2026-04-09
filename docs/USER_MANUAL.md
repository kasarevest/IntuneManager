# IntuneManager — User Manual

**Version:** 1.5 | **Audience:** IT Administrators | **Last Updated:** 2026-04-07

---

## Table of Contents

1. [Overview](#1-overview)
1a. [Deployment Modes](#1a-deployment-modes)
2. [Prerequisites](#2-prerequisites)
3. [First-Time Setup](#3-first-time-setup)
4. [Connecting to Your Microsoft Tenant](#4-connecting-to-your-microsoft-tenant)
5. [Dashboard — Executive Summary](#5-dashboard--executive-summary)
6. [Installed Apps — App Inventory](#6-installed-apps--app-inventory)
7. [App Catalog — Discovering and Packaging Apps](#7-app-catalog--discovering-and-packaging-apps)
8. [Deploy — Deploying to Intune](#8-deploy--deploying-to-intune)
9. [Devices — Device Management](#9-devices--device-management)
10. [Updating an Existing Application](#10-updating-an-existing-application)
11. [Update All — Batch Updates](#11-update-all--batch-updates)
12. [Settings](#12-settings)
13. [Troubleshooting](#13-troubleshooting)
14. [Known Limitations](#14-known-limitations)
15. [Quick Reference](#15-quick-reference)

---

## 1. Overview

IntuneManager is a desktop application that automates the packaging and deployment of Windows applications to Microsoft Intune as Win32 apps.

Instead of manually:
- Finding the correct installer version and download URL
- Writing PowerShell install/uninstall/detection scripts
- Running IntuneWinAppUtil.exe
- Uploading through the Intune portal

You describe the app you want to deploy in plain language (e.g. "7-Zip" or "Google Chrome latest"), and the AI agent handles the rest.

### What IntuneManager does

- Searches winget (Windows Package Manager) for the application
- Downloads the latest stable installer
- Generates install, uninstall, and detection PowerShell scripts following Intune best practices
- Packages everything into a `.intunewin` file
- Creates the app record in Intune via Graph API
- Uploads the package to Intune

### What IntuneManager does NOT do (manual steps still required)

- **Configure supersedence** — If replacing an older version, configure supersedence relationships in Intune portal
- **Set app icons** — Custom icons must be added in Intune portal

### Page structure

IntuneManager has five main pages accessible from the top navigation bar:

| Page | Route | Purpose |
|------|-------|---------|
| **Dashboard** | `/dashboard` | Executive summary — app and device stats, charts, alerts, auto-refresh |
| **Installed Apps** | `/installed-apps` | Inventory of all Win32 apps in your tenant; version checking; updates |
| **App Catalog** | `/catalog` | Discover apps via AI recommendations and winget search; initiate packaging |
| **Deploy** | `/deploy` | View `.intunewin` files ready for upload; monitor active packaging/deployment jobs |
| **Devices** | `/devices` | Device compliance, Windows Update status, driver updates, diagnostics |

Navigation is standardized across all pages: **Dashboard → Installed Apps → App Catalog → Deploy → Devices**

---

## 1a. Deployment Modes

IntuneManager runs in two modes:

| Mode | How to access | Notes |
|------|--------------|-------|
| **Desktop (Electron)** | Double-click `IntuneManager.exe` | Windows only. Full functionality including tenant connect, packaging, and app deployment. |
| **Web (Hosted)** | Open the Container App URL in a browser | Runs on Azure Container Apps (Linux). Tenant authentication via Microsoft OAuth2 is fully functional (Phase 3). App packaging (requires IntuneWinAppUtil.exe, Windows-only) is not yet available in the web container. All read/view features work: Dashboard, Installed Apps, Devices, App Catalog. |

The hosted web URL is:
```
https://ca-intunemanager-prod.yellowforest-c85ceb60.eastus.azurecontainerapps.io
```

The Desktop mode instructions below apply to both modes except where noted.

---

## 2. Prerequisites

Before running IntuneManager for the first time, ensure the following are in place:

### Additional prerequisites for Web (Hosted) mode

The following are required before the hosted web app can connect to your Microsoft tenant.

> **Full setup guide:** See [`docs/TENANT-SETUP.md`](TENANT-SETUP.md) for step-by-step instructions, AADSTS error reference, and a printable summary card.

**Quick summary:**

| Requirement | Detail |
|-------------|--------|
| **Azure AD App Registration** | Register at `portal.azure.com` → Azure Active Directory → App registrations → New registration. Supported accounts: `Accounts in any organizational directory (Multitenant)`. Platform: `Web`. Redirect URI: `{base-url}/api/auth/ms-callback` |
| **API permissions (Delegated)** | Add the following Microsoft Graph delegated permissions — all except `User.Read` require admin consent: |
| | `User.Read` — identity display (no consent needed) |
| | `DeviceManagementApps.ReadWrite.All` — deploy and manage Intune apps |
| | `DeviceManagementConfiguration.Read.All` — read device policies for dashboard |
| | `GroupMember.Read.All` — list AAD groups for post-deployment assignment |
| | `DeviceManagementManagedDevices.Read.All` — list managed devices (Devices page) |
| | `DeviceManagementManagedDevices.PrivilegedOperations.All` — device sync and log actions |
| **Admin consent** | A Global Administrator must grant org-wide consent for all `DeviceManagement*` and `GroupMember` permissions before non-admin users can sign in. Grant via portal → API permissions → "Grant admin consent" button. |
| **Client secret** | Certificates & secrets → New client secret. Copy the **Value** immediately — shown once only. Set expiry reminder. |
| **Environment variables** | Set `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_REDIRECT_URI` in your deployment. See [`docs/TENANT-SETUP.md`](TENANT-SETUP.md) for GitHub Secrets setup and full variable list including `APP_SECRET_KEY` and `DATABASE_URL`. |

---

### Required software (on the machine running IntuneManager)

| Software | Notes |
|----------|-------|
| Windows 10 21H2 or later | 64-bit required |
| PowerShell 5.1 | Included with Windows 10/11 |
| IntuneWinAppUtil.exe | Microsoft packaging tool — see below |
| .NET Framework 4.7.2 or later | Required for MSAL.NET; ships with Windows 10 1803+ |

**IntuneWinAppUtil.exe** is available from Microsoft:
`https://github.com/microsoft/Microsoft-Win32-Content-Prep-Tool`

Download and place it in a location you will configure in Settings (e.g. `C:\Tools\IntuneWinAppUtil.exe`).

### Required access

| Access | Purpose |
|--------|---------|
| Microsoft 365 account with Intune admin permissions | To connect your tenant and deploy apps |
| Anthropic API key | To run the AI packaging agent |
| Internet access | To download installers and call the Anthropic API |

### Claude AI connection

IntuneManager requires at least one of the following:

**Option A — Anthropic API key (Direct)**
1. Go to `https://console.anthropic.com`
2. Sign in and navigate to **API Keys**
3. Create a new key and copy it
4. Enter it in Settings → General → Claude AI Connection → Direct Claude API

**Option B — AWS Bedrock (SSO)**
If your organization provides Claude access through AWS Bedrock:
1. Obtain your AWS Region (e.g. `us-east-1`) and the Bedrock Model ID for Claude (e.g. `anthropic.claude-sonnet-4-5-v1:0`) from your cloud team
2. Enter these in Settings → General → Claude AI Connection → AWS Bedrock (SSO)
3. Click **Login with AWS SSO** to authenticate (requires the AWS CLI to be installed)

Both options can be configured simultaneously; the application uses whichever is available.

---

## 3. First-Time Setup

### Step 1 — Launch the application

Double-click `IntuneManager.exe` (or run `npm run electron:dev` if running from source).

### Step 2 — Create your admin account

On first launch, the application displays a one-time setup screen.

1. A random strong password is generated and displayed on screen
2. Write this password down or save it in your password manager
3. Click **I've saved my password** to confirm
4. On the next screen, log in with:
   - **Username:** `admin`
   - **Password:** the password you just saved

> **Note:** This is a local application account, not your Microsoft 365 account. It controls who can open IntuneManager on this machine.

### Step 3 — Configure Settings

After logging in, click **Settings** in the top bar.

**Settings → General — Claude AI Connection**

Configure at least one Claude connection method. The save button is blocked until one method is configured.

*Method 1 — Direct Claude API (Anthropic):*

| Field | What to enter |
|-------|--------------|
| Anthropic API Key | Your Anthropic API key (starts with `sk-ant-`) |

*Method 2 — AWS Bedrock (SSO):*

| Field | What to enter | Example |
|-------|--------------|---------|
| AWS Region | The AWS region your Bedrock account is in | `us-east-1` |
| Bedrock Model ID | The Claude model ID in your Bedrock account | `anthropic.claude-sonnet-4-5-v1:0` |

After entering region and model ID, click **Login with AWS SSO** to authenticate. This requires the AWS CLI to be installed on this machine.

**Settings → Paths**

| Field | What to enter | Example |
|-------|--------------|---------|
| IntuneWinAppUtil Path | Full path to IntuneWinAppUtil.exe | `C:\Tools\IntuneWinAppUtil.exe` |
| Source Root Path | Folder where app source files will be created | `C:\IntunePackages\Source` |
| Output Folder Path | Folder where .intunewin files will be saved | `C:\IntunePackages\Output` |

Click **Browse** next to each path field to select via file dialog, or type the path directly.

Click **Save** when done.

### Step 4 — Connect your Microsoft tenant

See Section 4 for full instructions.

---

## 4. Connecting to Your Microsoft Tenant

IntuneManager needs to authenticate to your Microsoft 365 / Intune tenant to read and deploy apps.

### How to connect — Desktop (Electron)

1. Click **Settings** → **Tenant**
2. Click **Sign in with Microsoft Account**
   - A browser window opens to `login.microsoft.com`
   - Sign in with your Intune admin credentials
   - Close the browser tab when prompted ("Authentication complete")
3. The Settings page will show your connected username and tenant ID

**Alternative — Device Code (Desktop, if browser popup is blocked)**

1. Click **Use Device Code (for restricted environments)** instead
2. A code is displayed (e.g. `ABCD-1234`)
3. On any device, go to the URL shown on screen (e.g. `https://microsoft.com/devicelogin`)
4. Enter the code and sign in with your Intune admin account
5. IntuneManager polls every 5 seconds and detects the completed login automatically

---

### How to connect — Web (Hosted)

1. Open the Container App URL and log in to IntuneManager
2. Click **Settings** → **Tenant**
3. Click **Sign in with Microsoft Account**
   - The entire browser page navigates to Microsoft's login page (`login.microsoftonline.com`)
   - Sign in with your Intune admin credentials
   - After successful login, the browser returns automatically to IntuneManager
4. The Settings → Tenant page now shows your connected username and tenant ID

> **First-time consent:** On first connection from a new tenant, Microsoft may prompt for admin consent for the required Graph API permissions. This requires a Global Administrator or Intune Administrator account. Once granted, other accounts in the same tenant can sign in without the consent prompt.

**Alternative — Device Code (Web, for restricted environments)**

1. Click **Use Device Code (for restricted environments)** instead
2. A panel appears in the app showing:
   - A verification URL (e.g. `https://microsoft.com/devicelogin`)
   - A short code (e.g. `ABCD-1234`)
3. On any device (phone, another computer), go to the URL and enter the code
4. Sign in with your Intune admin account on that device
5. IntuneManager polls every 5 seconds — the panel closes and shows "Connected" automatically when auth completes

---

### Connection status

The connection status is shown in the top bar of all pages:
- **Green dot** — Connected (shows your username and minutes until token expiry)
- **Red dot** — Not connected

Tokens expire approximately 1 hour after connecting. IntuneManager silently refreshes the token automatically before expiry (no re-login needed) as long as the refresh token is valid (typically 90 days).

The connection status is polled from the database every 60 seconds so it stays accurate as you navigate between pages.

If you see a "Not connected" banner, go to **Settings → Tenant** and sign in again.

---

## 5. Dashboard — Executive Summary

The Dashboard is the executive summary view. It shows charts and summary statistics for your app inventory and device fleet — it does not list individual apps (that is the Installed Apps page).

### What the Dashboard shows

**App Inventory section**
- Total Win32 apps in your Intune tenant
- Published apps (available to devices)
- Pending review apps
- Bar chart showing published vs. pending ratio
- Link to the Installed Apps page for the full app list
- Link to the App Catalog to package new apps

**Device Health section**
- Total managed devices
- Compliant devices
- Non-compliant devices
- Devices in grace period
- Windows Updates needed count
- Driver Updates needed count
- Bar chart showing compliance ratio

**Deployment Readiness section**
- Quick links: Ready to Deploy packages, Deploy New App, App Catalog

**Alerts & Attention Required section**
- Lists devices that are non-compliant, in grace period, or need Windows/driver updates
- Lists "Not connected to tenant" if tenant connection is lost

### Auto-refresh

The Dashboard refreshes its summary data every 60 seconds automatically. You can also click the **Refresh** button in the top bar at any time.

The Refresh button is only active when you are connected to your tenant. If you see "Not connected", connect via Settings → Tenant first.

---

## 6. Installed Apps — App Inventory

The Installed Apps page shows all Win32 apps currently deployed in your Intune tenant.

### Opening the page

Click **Installed Apps** in the top navigation bar from any page.

### Loading apps

Click the **Sync** button in the top right to load your app catalog. The first load may take 10–30 seconds depending on how many apps you have.

### App cards

Each app is shown as a card with:
- App logo (initials-based)
- App name
- Version currently in Intune
- Publishing status badge
- **Update** button (shown in amber when a newer version is available on winget)
- **Details** button — shows the full Intune record fields in a modal

### Version check status

After apps load, IntuneManager checks winget for the latest available version of each app. While checking, individual cards show **checking...**. This runs in the background and does not block the app list.

> **Note:** Version checking only works for apps that have a `PACKAGE_SETTINGS.md` file in your Source Root folder (created when IntuneManager originally packaged the app). Apps packaged outside IntuneManager will show **—** for the latest version.

### Status badges

| Badge | Meaning |
|-------|---------|
| **Current** (green) | Intune version matches or exceeds the latest available winget version |
| **Update** (amber) | A newer version is available on winget |
| **Cloud Only** (grey) | App exists in Intune but no local source folder was found |
| **Unknown** (grey) | Version comparison was not possible (non-standard version format) |

### Searching and filtering

- Use the **Search** box to filter by app name
- Use the **Status** dropdown to show only apps in a specific state (e.g. "Update Available")

### Statistics

The four tiles at the top of the page show:
- **Total Apps** — total Win32 apps in your tenant
- **Current** — apps that are up to date
- **Updates Available** — apps with newer versions on winget
- **Update All (N)** button — starts a batch update of all outdated apps (see Section 11)

---

## 7. App Catalog — Discovering and Packaging Apps

The App Catalog is the starting point for deploying any new application. It is strictly for **discovery and packaging** — actual Intune uploads happen on the Deploy page.

### Opening the App Catalog

Click **App Catalog** in the top navigation bar.

### AI Recommendations

IntuneManager displays a grid of recommended enterprise applications generated by AI. Browse the cards to find common tools your organization may need.

Each app card shows:
- App logo (initials-based)
- App name
- Short description
- Publisher
- **Deploy** button
- **Details** button

Click **Details** to see the winget ID, publisher, description, and version before committing.

### Search

Use the search bar at the top to find any app by name (e.g. "Zoom", "Python", "Adobe Acrobat Reader"). Results come from winget and appear in the same card format.

### Starting a packaging job

Click **Deploy** on any app card to start the packaging pipeline:

1. The page navigates to the **Deploy page** (`/deploy`)
2. The AI agent starts packaging: searches winget → downloads installer → writes scripts → builds `.intunewin`
3. When packaging completes, a confirmation prompt appears:

> **Package created successfully**
> Do you want to deploy this application to Intune now?
> [Yes, Deploy to Intune] [No, keep package only]

**"Yes, Deploy to Intune"** — The agent creates an app record in Intune and uploads the `.intunewin`. The job panel shows upload progress.

**"No, keep package only"** — The `.intunewin` file is saved to your Output folder. It will appear in the **Ready to Deploy** list on the Deploy page and can be uploaded at any time.

---

## 8. Deploy — Deploying to Intune

The Deploy page has two sections:

### Section 1 — Ready to Deploy

Shows all `.intunewin` files currently in your Output folder, each displayed as a card with:
- App name (parsed from the filename)
- Description and publisher (from `PACKAGE_SETTINGS.md` if available)
- **Deploy** button — uploads this package to Intune immediately
- **Details** button — shows full package metadata

Click **Deploy** on a ready package to start `upload-only` mode:
1. Creates the Intune app record via Graph API
2. Uploads the `.intunewin` in 5 MB chunks to Azure Blob Storage
3. Commits the content version in Intune

The job progress panel appears below the ready list while uploading.

> **Note:** The Deploy button is disabled (greyed out) if no `PACKAGE_SETTINGS.md` was found for the package. Hover over the button to see a tooltip explaining why. This file is created automatically when IntuneManager packages the app.

### Section 2 — Job Progress Panel

Appears whenever a packaging or deployment job is running. Shows:

- **Progress stepper** — which phase the job is in
- **Phase label** — what is currently happening
- **Log panel** — detailed log of every action
- **Cancel** button — stops the job immediately
- **Clear** button — dismisses the panel after completion

**Phases during packaging (from App Catalog):**

| Phase | What is happening |
|-------|------------------|
| Analyzing | Claude is interpreting your request |
| Searching | Winget is being queried for the app |
| Downloading | Installer is being downloaded |
| Packaging | Scripts are being written and .intunewin created |
| Done | Package is ready |

**Phases during upload (Deploy button from ready list or after packaging):**

| Phase | What is happening |
|-------|------------------|
| Creating | App record being created in Intune via Graph API |
| Uploading | .intunewin being uploaded to Azure Blob Storage |
| Done | App is live in Intune |

### After deployment — Assign to Groups

After a successful upload, IntuneManager shows an **Assign to Groups** modal automatically.

1. The modal shows your recently used groups (if any) and all AAD security groups in your tenant
2. Check the checkbox next to each group you want to assign the app to
3. Set the **intent** per group using the dropdown:
   - **Required** — force install on all devices/users in the group (default for device groups)
   - **Available** — show in Company Portal (default for user groups)
4. Click **Assign (N)** to apply all assignments in a single Graph API call
5. Click **Skip** to skip for now — you can assign later in the Intune portal

> IntuneManager remembers which groups you have used before and shows them at the top of the list under "Recently used".

---

## 9. Devices — Device Management

The Devices page shows all managed Windows devices in your Intune tenant with their compliance status, update status, and available actions.

### Opening the Devices page

Click **Devices** in the top navigation bar from any page.

### Device table columns

| Column | Description |
|--------|-------------|
| Device name | Computer name as registered in Intune |
| User | Primary user's UPN (email) |
| OS | Operating system and version |
| Compliance | Colour-coded compliance badge |
| Windows Updates | Whether pending Windows updates are detected |
| Driver Updates | Update status (shown as Unknown — see Known Limitations) |
| Diagnostics | Whether diagnostic data is available |
| Last sync | When the device last checked in with Intune |

### Compliance badges

| Badge | Meaning |
|-------|---------|
| **Compliant** (green) | Device meets all compliance policies |
| **Non-compliant** (red) | Device is violating one or more policies |
| **Grace period** (amber) | Device is non-compliant but within the grace period |
| **Unknown** (grey) | Compliance state not yet determined |

### Attention indicators

Devices that need attention are flagged with an amber ⚠ icon. A device is flagged when it is:
- Non-compliant or in grace period, **or**
- Has pending Windows updates, **or**
- Has pending driver updates

The stats tiles at the top of the page show counts for Total / Compliant / Non-Compliant / Need Attention.

Use the **Show Attention Only** toggle to filter the list to flagged devices only.

### Per-device actions

| Button | What it does |
|--------|-------------|
| **Sync Updates** | Triggers a Windows Update sync on the device via `syncDevice` Graph action |
| **Sync Drivers** | Triggers a driver update sync on the device |
| **Request Logs** | Creates a diagnostic log collection request in Intune for the device |

### Searching

Use the **Search** box at the top to filter devices by name.

---

## 10. Updating an Existing Application

### From the Installed Apps page

When an app card shows the amber **Update** button:

1. Click the **Update** button on the card
2. You are taken to the Deploy page with the update pre-configured
3. The AI agent runs the packaging pipeline for the latest version
4. When complete, you are prompted to deploy — click **Yes, Deploy to Intune**
5. IntuneManager updates the existing Intune app record (it does not create a new one)

### From the App Catalog (manual)

You can also trigger an update manually:

1. Open the App Catalog
2. Search for the app by name
3. Click Deploy on the search result

The AI will detect there is an existing Intune app with the same name and update it rather than creating a new record.

---

## 11. Update All — Batch Updates

The **Update All (N)** button on the Installed Apps page runs updates for all apps that show the amber "Update" badge, one after another.

### How it works

1. Click **Update All (N)** — you are taken to the Deploy page
2. A progress badge shows which app is being processed: "2 of 5: Google Chrome"
3. Each app goes through the full packaging pipeline automatically
4. When one app finishes deploying, the next one starts immediately
5. When all apps are done, the message "All N updates deployed!" is shown

### If an app fails

Currently, if one app in the queue fails, the batch stops. The remaining apps are not processed.
- Check the log panel for the error message
- Fix the issue (see Troubleshooting)
- Run Update All again — apps already successfully updated will show as "Current" and not be re-queued

---

## 12. Settings

Access Settings by clicking the **Settings** button in the navigation bar.

### General Tab

**Paths section**

| Setting | Description |
|---------|-------------|
| IntuneWinAppUtil Path | Full path to `IntuneWinAppUtil.exe` |
| Source Root Path | Parent folder where IntuneManager creates app-specific subfolders (e.g. `Source\7-Zip\`) |
| Output Folder Path | Where `.intunewin` files are saved after packaging |

Click **Browse** next to each field to pick a path via the file dialog.

**Claude AI Connection section**

Configure at least one method. Save is blocked until one is configured.

*Method 1 — Direct Claude API*

| Setting | Description |
|---------|-------------|
| Anthropic API Key | Your Anthropic API key. Stored AES-256 encrypted on this machine. Shows "Configured" badge when a key is saved. |

*Method 2 — AWS Bedrock (SSO)*

| Setting | Description |
|---------|-------------|
| AWS Region | The AWS region where your Bedrock account is provisioned (e.g. `us-east-1`) |
| Bedrock Model ID | Claude model ID in your Bedrock account (e.g. `anthropic.claude-sonnet-4-5-v1:0`) |
| Login with AWS SSO | Runs `aws sso login` to authenticate your AWS session. Requires the AWS CLI to be installed. |

Both methods can be configured at the same time. A green "Configured" badge appears next to each method when it has valid settings.

**Defaults section**

| Setting | Description |
|---------|-------------|
| Default Minimum OS | The minimum Windows version used when creating new Intune apps (default: Windows 10 21H2) |
| Log Retention (days) | How long deployment logs are kept |

After changing any setting, click **Save**.

### Tenant Tab

| Control | Description |
|---------|-------------|
| Sign in with Microsoft Account | **Desktop:** opens Microsoft login in a browser window. **Web:** redirects the full browser page to Microsoft login and returns automatically after auth |
| Use Device Code (for restricted environments) | Displays a short code and URL to complete sign-in on another device; polls every 5 seconds for completion |
| Disconnect | Clears the stored tenant connection (revokes local tokens; does not revoke the Azure AD session) |
| Connected status | Shows username, tenant ID, and minutes until token expiry |

### Users Tab (superadmin only)

Manage local application accounts:
- **Create User** — Add another admin or viewer account
- **Delete User** — Remove a user (cannot delete the last superadmin)
- **Change Password** — Update your own password

---

## 13. Troubleshooting

### "Claude API key not configured"

**Symptom:** App Catalog or Deploy page shows this error when starting a job.
**Fix:** Go to Settings → General, configure at least one Claude connection method (Direct API Key or AWS Bedrock), and click Save. Restart if required.

### "AWS SSO login failed" / AWS CLI not found

**Symptom:** Clicking "Login with AWS SSO" shows an error.
**Cause 1:** The AWS CLI is not installed.
**Fix:** Install the AWS CLI from `https://aws.amazon.com/cli/` and retry.
**Cause 2:** Your AWS SSO profile is not configured.
**Fix:** Run `aws configure sso` in a terminal to set up your SSO profile, then click "Login with AWS SSO" again.
**Cause 3:** Your SSO session has expired.
**Fix:** Click "Login with AWS SSO" — this opens a browser window to re-authenticate your session.

### "At least one Claude connection method is required"

**Symptom:** Clicking Save in Settings shows this error.
**Fix:** Either enter a Direct API Key in the Anthropic API Key field, or fill in both the AWS Region and Bedrock Model ID fields before saving.

### "Could not load recommendations" / API credit error

**Symptom:** App Catalog shows "Could not load recommendations: 400 Your credit balance is too low..."
**Fix:** Go to `https://console.anthropic.com`, top up your API credits, then reload the App Catalog page.

### Job stays in "running" state indefinitely

**Symptom:** The job panel shows a phase label but no progress for more than 5 minutes.
**Cause:** A PowerShell script may have hung (network timeout, UAC prompt, etc.)
**Fix:**
1. Click **Cancel** in the job panel
2. Open Task Manager and kill any `powershell.exe` processes that are idle
3. Retry the deployment

### "Not connected" banner appears even after successful login

**Symptom:** After signing in to Microsoft, the banner still shows.
**Cause:** This can happen if the token was immediately expired or the silent refresh failed.
**Fix:** Click **Connect Tenant** in the banner and sign in again.

### Download fails with "SHA256 mismatch"

**Symptom:** The log panel shows `SHA256 mismatch. Expected: ... Actual: ...`
**Cause:** The installer file on the CDN is corrupt or the winget manifest has a stale hash.
**Fix:**
1. Wait 10-15 minutes and retry (CDN propagation delay)
2. If the issue persists, the winget manifest may be outdated — report it to the package maintainer

### "IntuneWinAppUtil.exe not found"

**Symptom:** Build phase fails with a path error.
**Fix:**
1. Go to Settings → Paths
2. Verify the **IntuneWinAppUtil Path** points to the correct `.exe` file
3. If the file is missing, download it from `https://github.com/microsoft/Microsoft-Win32-Content-Prep-Tool`

### Ready to Deploy list shows no apps / Deploy button disabled

**Symptom:** The Deploy page shows no ready packages, or all Deploy buttons appear greyed out.
**Cause 1:** Output folder has no `.intunewin` files yet. Package an app from the App Catalog first.
**Cause 2:** `PACKAGE_SETTINGS.md` could not be found for a package — the Deploy button is disabled with a tooltip explaining why.
**Fix:** Check that the Source Root path in Settings → Paths points to the folder containing your app source subfolders.

### App deployed but not visible in Intune portal

**Symptom:** The deployment shows as successful but the app is not in the Intune portal.
**Cause:** There may be a sync delay in Intune (up to 5 minutes) or the Graph API call failed silently.
**Fix:**
1. Wait 5 minutes and refresh the Intune portal
2. Check the IntuneManager log panel for any errors on the `create_intune_app` or `upload_to_intune` steps
3. If neither resolved it, check the Intune portal under **Apps** → **Monitor** → **App install status** for errors

### Upload fails with HTTP 400 or "commitFileFailed"

**Symptom:** Log panel shows `Upload failed: ... (HTTP 400)` or `Commit failed with state: commitFileFailed`
**Cause:** This was a known bug — now fixed in `UploadManager.psm1`. If you see this error, ensure you are running the latest version of IntuneManager.
**Fix:** Update IntuneManager to the latest version. The upload pipeline has been rewritten to correctly extract sizes from Detection.xml and stream the inner encrypted blob.

### "Maximum tool iterations reached (20)"

**Symptom:** Job ends with this error message.
**Cause:** The AI agent used all 20 allowed steps without completing. This can happen if the AI tries multiple fallback approaches or encounters repeated tool errors.
**Fix:**
1. Review the log panel — check which step the agent was stuck on
2. Verify your Source Root and Output paths are configured and writable
3. Retry the deployment — on a second attempt Claude will often succeed as it has learned from the previous attempt

### Installed Apps / version shows as "—" or "checking..." that never resolves

**Symptom:** Latest Available shows "—" for most apps, or "checking..." that never changes.
**Cause:** "—" means no local `PACKAGE_SETTINGS.md` was found for that app. This is normal for apps packaged outside IntuneManager. "checking..." that doesn't resolve may indicate PowerShell is hanging on winget calls.
**Fix for "checking..." not resolving:**
1. Open PowerShell manually and run: `winget search "AppName"`
2. If winget prompts for agreement, accept it — then retry in IntuneManager
3. Corporate proxy may be blocking winget; configure proxy settings in Windows

### Devices page shows no devices

**Symptom:** The Devices page loads but shows an empty table.
**Cause:** Either you are not connected to your tenant, or your account does not have `DeviceManagementManagedDevices.Read.All` permission.
**Fix:**
1. Verify you are connected (green dot in top bar)
2. In the Intune portal, confirm your account has Intune Administrator or Global Reader permissions
3. If recently connected, wait 1-2 minutes for the Graph API to activate permissions and try again

### Cannot create second user / getting "Forbidden"

**Symptom:** Creating a new user account fails.
**Cause:** Only `superadmin` role accounts can create users.
**Fix:** Sign in with the original admin account (created at first run) to manage users.

---

## 14. Known Limitations

| Limitation | Impact | Workaround |
|-----------|--------|-----------|
| Non-semver versions show "Unknown" | Apps with date-based versions (e.g. OneDrive) won't show update status | Check manually in Intune portal |
| Update All stops on first failure | A failed app stops the entire queue | Fix the failing app, then re-run Update All |
| No app icon automation | Icons must be added in Intune portal | Upload icon manually after deploying |
| Requires internet for every deployment | Apps cannot be packaged offline | No workaround |
| PS script hang = stuck job | No auto-timeout | Click Cancel, kill powershell.exe processes, retry |
| Session ends on window close | Must log in again each launch | By design — session tokens are not persisted |
| Driver update status always "Unknown" | Devices page cannot report driver update status | Check device compliance in Intune portal directly |
| Diagnostics button always active | No check for existing log collection requests | Creating a duplicate request is harmless |
| Web mode: app packaging not available | IntuneWinAppUtil.exe is Windows-only; the Docker container cannot run it | Use the desktop (Electron) app for packaging new apps; web mode supports all read/view/connect features |

---

## 15. Quick Reference

### Deploy a new app

```
App Catalog -> Search for app (or browse recommendations) -> Deploy
-> Deploy page: wait for packaging -> Yes, Deploy to Intune
-> Assign to Groups modal: select groups + intent -> Assign (or Skip)
```

### Deploy a pre-built package

```
Deploy page -> Ready to Deploy list -> Deploy button on package card
-> Wait for upload -> Assign to Groups modal -> Assign (or Skip)
```

### Update an existing app

```
Installed Apps -> Sync -> Click "Update" button on card -> Deploy page
-> Wait for packaging -> Yes, Deploy to Intune -> Assign to Groups modal
```

### Batch update all outdated apps

```
Installed Apps -> Sync -> "Update All (N)" -> Wait for all jobs to complete
-> Go to Intune portal -> Verify each app
```

### Sync device updates

```
Devices -> Find device -> Sync Updates / Sync Drivers
-> Intune queues the action; device executes on next check-in
```

### First-time setup checklist (Desktop)

- [ ] Install IntuneWinAppUtil.exe
- [ ] Launch IntuneManager, save generated password, log in
- [ ] Settings → General → Claude AI Connection: configure Direct API Key **or** AWS Bedrock region + model ID
- [ ] Settings → General → Paths: set IntuneWinAppUtil, Source Root, Output Folder
- [ ] Settings → Tenant: Sign in with Microsoft Account
- [ ] Dashboard → verify stats load
- [ ] Installed Apps → Sync: verify apps load
- [ ] App Catalog: confirm recommendations load
- [ ] Devices: verify device list loads

### First-time setup checklist (Web / Hosted)

- [ ] Create Azure AD App Registration — follow `docs/TENANT-SETUP.md`
- [ ] Add all required API permissions; grant admin consent
- [ ] Add `AZURE_CLIENT_ID` + `AZURE_CLIENT_SECRET` + `APP_SECRET_KEY` to GitHub Secrets / Key Vault
- [ ] Set `AZURE_REDIRECT_URI` in Container App env vars
- [ ] Push to master → CI/CD deploys updated Container App
- [ ] Open Container App URL, save generated password, log in
- [ ] Settings → Tenant: Sign in with Microsoft Account (full-page redirect)
- [ ] Dashboard → verify stats load
- [ ] Installed Apps → Sync: verify apps load
- [ ] Devices: verify device list loads

### Log file locations

| Log | Location |
|-----|----------|
| IntuneManager database | `%AppData%\Roaming\intune-manager-ui\intunemanager.db` |
| Install script log | `%TEMP%\Install-<AppName>.log` (on managed device) |
| Uninstall script log | `%TEMP%\Uninstall-<AppName>.log` (on managed device) |
| IntuneManager session log | `%AppData%\Roaming\intunemanager\session.log` |

---

*For project architecture details, see `docs/PROJECT_OVERVIEW.md`.*
*For known issues and technical patterns, see `tasks/lessons.md`.*
*For workflow and quality standards, see `docs/WORKFLOW.md`.*
