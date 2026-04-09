# IntuneManager — Azure AD App Registration Guide

**Audience:** IT Administrator or DevOps engineer setting up IntuneManager Web (hosted/container mode)  
**Last Updated:** 2026-04-09

> **Desktop (Electron) mode:** No App Registration is required. Electron uses the Microsoft Graph PowerShell client ID (`14d82eec-204b-4c2f-b7e8-296a70dab67e`) which is pre-consented in all Microsoft 365 tenants. Skip this guide entirely if you are only using the desktop app.

---

## Overview

IntuneManager Web authenticates to Microsoft Graph using the OAuth 2.0 Authorization Code flow (or Device Code flow for headless environments). To do this, it needs an **Azure AD App Registration** in your tenant — a registered identity that Microsoft trusts to request API access on behalf of your users.

You will need to:
1. Register the application in Azure AD
2. Add the required Microsoft Graph API permissions
3. Create a client secret
4. Configure your redirect URI
5. Grant admin consent
6. Set three environment variables in your deployment

---

## Step 1 — Register the Application

1. Sign in to [portal.azure.com](https://portal.azure.com) with a **Global Administrator** or **Application Administrator** account.
2. Go to **Azure Active Directory** → **App registrations** → **New registration**.
3. Fill in the registration form:

| Field | Value |
|-------|-------|
| **Name** | `IntuneManager Web` (or any name that identifies this deployment) |
| **Supported account types** | `Accounts in any organizational directory (Any Azure AD directory - Multitenant)` |
| **Redirect URI — Platform** | `Web` |
| **Redirect URI — URL** | `https://{your-app-url}/api/auth/ms-callback` — see note below |

4. Click **Register**.

> **Redirect URI:** Replace `{your-app-url}` with the base URL where IntuneManager is hosted.
> - Default Vestmark deployment: `https://ca-intunemanager-prod.yellowforest-c85ceb60.eastus.azurecontainerapps.io/api/auth/ms-callback`
> - Self-hosted: `https://your-domain.com/api/auth/ms-callback`
> - Local development: `http://localhost:8080/api/auth/ms-callback`
>
> The URI must **exactly match** the value you set in the `AZURE_REDIRECT_URI` environment variable (including trailing slash, if any, and the scheme). A mismatch causes `AADSTS50011`.

> **Supported account types — single vs multi-tenant:** `Accounts in any organizational directory` (multitenant) allows any Azure AD work or school account to sign in. This is required to match the `/organizations` authority used in `graph-auth.ts`. If you need to restrict sign-in to only your own tenant, change the authority in `server/services/graph-auth.ts` from `organizations` to your tenant ID, then register as `Accounts in this organizational directory only`.

---

## Step 2 — Copy the Application (Client) ID

After registration, the **Overview** page shows:

| Field | Where to find it | Used as |
|-------|-----------------|---------|
| **Application (client) ID** | App Registration → Overview | `AZURE_CLIENT_ID` environment variable |
| **Directory (tenant) ID** | App Registration → Overview | Reference only (stored automatically after first sign-in) |

Copy the **Application (client) ID** now — you will need it in Step 5.

---

## Step 3 — Add API Permissions

Go to **App registrations** → your app → **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions**.

Add the following permissions:

### Required permissions

| Permission | Purpose | Admin consent required? |
|-----------|---------|------------------------|
| `User.Read` | Read the signed-in user's profile (display name, email, tenant ID for connection status display) | No |
| `DeviceManagementApps.ReadWrite.All` | Create, read, update Intune Win32 app records; upload packages | **Yes** |
| `DeviceManagementConfiguration.Read.All` | Read device configuration policies; provides dashboard stats | **Yes** |
| `GroupMember.Read.All` | List AAD security groups for the post-deployment assignment modal | **Yes** |

> **Note:** `openid`, `profile`, and `offline_access` are added automatically by Microsoft for all web apps. You do not need to add them manually.

### Additional permissions for Devices page actions

If you want the **Sync Updates**, **Sync Drivers**, and **Request Logs** buttons on the Devices page to work, add these as well:

| Permission | Purpose | Admin consent required? |
|-----------|---------|------------------------|
| `DeviceManagementManagedDevices.Read.All` | List managed devices (Devices page table) | **Yes** |
| `DeviceManagementManagedDevices.PrivilegedOperations.All` | Trigger device sync and log collection actions | **Yes** |

> **Without `DeviceManagementManagedDevices.Read.All`**, the Devices page will return a 403 and show no devices. These permissions are not yet in the default SCOPES in `server/services/graph-auth.ts` — to add them, append them to the SCOPES array and redeploy.

### After adding permissions

Your permissions list should look like this:

```
Microsoft Graph (Delegated)
├── User.Read                                               ✓ (no consent needed)
├── DeviceManagementApps.ReadWrite.All                     ⚠ Requires admin consent
├── DeviceManagementConfiguration.Read.All                 ⚠ Requires admin consent
├── GroupMember.Read.All                                   ⚠ Requires admin consent
├── DeviceManagementManagedDevices.Read.All                ⚠ Requires admin consent
└── DeviceManagementManagedDevices.PrivilegedOperations.All ⚠ Requires admin consent
```

The permissions will show a yellow warning icon until admin consent is granted (Step 5).

---

## Step 4 — Create a Client Secret

Go to **App registrations** → your app → **Certificates & secrets** → **Client secrets** → **New client secret**.

| Field | Recommended value |
|-------|------------------|
| **Description** | `IntuneManager production` |
| **Expires** | 24 months (or per your organization's secret rotation policy) |

Click **Add**.

> **Critical:** Copy the **Value** column immediately. It is only shown once. If you navigate away without copying it, you must delete and recreate the secret.

The **Value** is your `AZURE_CLIENT_SECRET`. The **Secret ID** is not needed.

Set a calendar reminder to rotate this secret before it expires. An expired secret causes `AADSTS7000215` and breaks all tenant connections.

---

## Step 5 — Set Environment Variables

Three environment variables must be set in your deployment. All three are required — the server throws `GraphAuthError` on startup if any is missing.

| Variable | Value | Where to get it |
|----------|-------|----------------|
| `AZURE_CLIENT_ID` | The Application (client) ID from Step 2 | App Registration → Overview |
| `AZURE_CLIENT_SECRET` | The client secret value from Step 4 | Certificates & secrets (copy immediately) |
| `AZURE_REDIRECT_URI` | `https://{your-app-url}/api/auth/ms-callback` | Must match exactly what you entered in Step 1 |

### For GitHub Actions / Azure Container Apps (CI/CD deployment)

Add these as **GitHub Secrets** (repo → Settings → Secrets and variables → Actions):

```
AZURE_CLIENT_ID      = <Application ID from Step 2>
AZURE_CLIENT_SECRET  = <Secret value from Step 4>
```

Set `AZURE_REDIRECT_URI` as a plaintext environment variable (it is not sensitive) in the GitHub Actions workflow or via `az containerapp update`:
```
AZURE_REDIRECT_URI = https://ca-intunemanager-prod.yellowforest-c85ceb60.eastus.azurecontainerapps.io/api/auth/ms-callback
```

### For local development / Docker

In your `.env` file (never commit this):
```
AZURE_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZURE_CLIENT_SECRET=your-secret-value-here
AZURE_REDIRECT_URI=http://localhost:8080/api/auth/ms-callback
```

### Additional required environment variables (full list)

These are needed by the server but are not App Registration values:

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | SQL Server connection string | `sqlserver://server.database.windows.net:1433;database=intunemanager;user=admin;password=...;encrypt=true` |
| `APP_SECRET_KEY` | Random 32+ character string for AES-256-CBC token encryption (tokens stored in DB are encrypted with this key) | `openssl rand -base64 32` |
| `PORT` | HTTP port to listen on (optional, defaults to 8080) | `8080` |

> **APP_SECRET_KEY:** If you change this value after users have connected their tenants, all stored tokens become undecryptable and everyone will need to sign in again. Treat it like a database encryption master key — store it in Key Vault or a secrets manager, never rotate it without a migration plan.

---

## Step 6 — Grant Admin Consent

`DeviceManagementApps.ReadWrite.All`, `DeviceManagementConfiguration.Read.All`, `GroupMember.Read.All`, and the `DeviceManagementManagedDevices.*` permissions are **high-privilege** permissions that cannot be granted by regular users. A Global Administrator must consent on behalf of the organization.

### Option A — Grant consent from the portal (recommended)

1. Go to App registrations → your app → **API permissions**
2. Click **Grant admin consent for {your tenant}**
3. Click **Yes** when prompted
4. All permissions should now show a green ✓ badge

### Option B — Consent on first sign-in

If a Global Administrator signs in to IntuneManager for the first time, Microsoft will prompt them with a consent screen listing all requested permissions. Clicking **Accept** grants org-wide admin consent automatically.

### Option C — Admin consent URL

Send this URL to your Global Administrator. When they open it and click **Accept**, consent is granted for the entire organization:

```
https://login.microsoftonline.com/organizations/adminconsent?client_id={AZURE_CLIENT_ID}
```

Replace `{AZURE_CLIENT_ID}` with your Application (client) ID.

---

## Step 7 — Verify the Registration

Use this checklist to confirm everything is set up correctly before users try to connect:

- [ ] App Registration exists in Azure AD with a meaningful name
- [ ] Supported account types: `Accounts in any organizational directory`
- [ ] Redirect URI platform: `Web`; URL ends in `/api/auth/ms-callback`
- [ ] All required API permissions added (minimum: `User.Read`, `DeviceManagementApps.ReadWrite.All`, `DeviceManagementConfiguration.Read.All`, `GroupMember.Read.All`)
- [ ] Client secret created; value copied
- [ ] `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_REDIRECT_URI` set in deployment environment
- [ ] Admin consent granted (green ✓ next to each permission in the portal)
- [ ] Container App redeployed / server restarted with new env vars
- [ ] Sign in test: open IntuneManager → Settings → Tenant → Sign in with Microsoft Account → completes successfully and shows Connected ✓ with username

---

## AADSTS Error Reference

| Error code | Meaning | Fix |
|-----------|---------|-----|
| `AADSTS50011` | Redirect URI mismatch | The URI in the token request doesn't match what's registered. Check `AZURE_REDIRECT_URI` exactly matches the App Registration redirect URI — scheme, host, path, and trailing slash must be identical. |
| `AADSTS65001` | Admin consent required | A user signed in without admin consent being pre-granted. Either grant consent via the portal (Step 6 Option A) or have a Global Admin sign in first. |
| `AADSTS700016` | Application not found in directory | Wrong `AZURE_CLIENT_ID`, or the App Registration was created in a different tenant. Verify the client ID and that "Supported account types" is set to multitenant. |
| `AADSTS7000215` | Invalid client secret | The secret has expired or was entered incorrectly. Regenerate the secret, update `AZURE_CLIENT_SECRET`, and redeploy. |
| `AADSTS7000218` | `client_secret` or `client_assertion` missing | This is caused by `@azure/msal-node` v2.x PKCE auto-injection on confidential clients. IntuneManager uses direct HTTP (`fetch()`) to avoid this — if you see this error, verify `graph-auth.ts` is not importing `@azure/msal-node`. |
| `AADSTS90002` | Tenant not found | The `/organizations` authority requires the user's account to be a work/school account in an Azure AD tenant. Personal Microsoft accounts (`@hotmail.com`, `@outlook.com`) are not supported. |
| Token refresh: `invalid_grant` | Refresh token expired or revoked | User must sign in again. Tokens last ~90 days; they expire earlier if the user changes their password or an admin revokes sessions. |

---

## Rotating the Client Secret

Client secrets expire. When a secret is within 30 days of expiry (or has already expired):

1. Go to App Registration → **Certificates & secrets** → **New client secret**
2. Create a new secret (you can have up to 2 active at once)
3. Copy the new **Value** immediately
4. Update `AZURE_CLIENT_SECRET` in your deployment (GitHub Secret or Key Vault)
5. Redeploy (Container App picks up new env var on next revision)
6. Verify sign-in still works
7. Delete the old secret (App Registration → Certificates & secrets → delete the old row)

> **Never delete the old secret before the new one is live.** Having both active simultaneously ensures zero-downtime rotation.

---

## App Registration Summary Card

Print or save this card for your records after completing setup:

```
IntuneManager Web — App Registration Details
=============================================
Registration name:    IntuneManager Web
Application (client) ID:  [paste here]
Directory (tenant) ID:    [paste here]
Redirect URI:         https://{your-app-url}/api/auth/ms-callback
Secret expiry:        [paste here]
Admin consent:        Granted [date]
Granted by:           [admin UPN]

GitHub Secrets set:
  AZURE_CLIENT_ID     [✓]
  AZURE_CLIENT_SECRET [✓]

Environment variables set on Container App:
  AZURE_REDIRECT_URI  [✓]
  APP_SECRET_KEY      [✓]
  DATABASE_URL        [✓]
```
