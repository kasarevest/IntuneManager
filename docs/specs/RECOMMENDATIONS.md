# IntuneManager — Backlog Recommendations

**Generated:** 2026-04-10  
**Source:** Critical review of `docs/PROJECT_OVERVIEW.md`, `docs/cyber_dr.md`, and codebase exploration  
**Status:** All items are unimplemented backlog candidates. Jira tickets created in flat Kanban backlog.

This document captures recommendations identified during the Jira backlog restructure. Items are grouped by category and priority. Each item references its Jira ticket where one has been created.

---

## Security Recommendations

These were identified directly from the `cyber_dr.md` threat model and codebase audit.

### SEC-1: IPC Channel Whitelist in preload.ts
**Priority:** High  
**Source:** `cyber_dr.md` — IPC attack surface  
**Jira:** Backlog

**Problem:** `preload.ts` currently exposes `ipcRenderer.invoke` for any channel name. A compromised renderer (e.g., via XSS in a loaded URL) could invoke privileged main-process handlers by guessing channel names.

**Recommendation:** Maintain an explicit allowlist of valid IPC channel names in `preload.ts`. Reject any invoke call whose channel is not in the list with a `console.error` security log.

```typescript
// preload.ts — allowlist pattern
const ALLOWED_CHANNELS = ['ps:run', 'auth:connect', 'settings:get', ...]
contextBridge.exposeInMainWorld('api', {
  invoke: (channel: string, ...args: unknown[]) => {
    if (!ALLOWED_CHANNELS.includes(channel)) {
      console.error(`[Security] Blocked IPC channel: ${channel}`)
      return Promise.reject(new Error('Blocked'))
    }
    return ipcRenderer.invoke(channel, ...args)
  }
})
```

---

### SEC-2: Invalidate Active Sessions on Password Change
**Priority:** High  
**Source:** `cyber_dr.md` — session management  
**Jira:** Backlog

**Problem:** If a user changes their Microsoft password or an admin revokes app consent, existing MSAL tokens remain valid until they expire (up to 1 hour). The app has no mechanism to force re-authentication.

**Recommendation:** On auth errors from Graph API (401/403), clear the token cache and redirect to the login screen rather than showing a generic error. Also expose a "Sign out" action that clears `token_cache.bin` and the in-memory MSAL cache.

---

### SEC-3: Script Diff/Review Before Intune Upload
**Priority:** High  
**Source:** `cyber_dr.md` — supply chain / script injection  
**Jira:** Backlog

**Problem:** AI-generated PowerShell detection/requirement scripts are uploaded to Intune without the administrator reviewing them. A prompt injection or model error could produce a malicious script that runs on managed devices.

**Recommendation:** Before calling the Intune upload API, show the admin a diff-style preview of all generated scripts (detection script, requirement script, install command). Require explicit approval. This is a mandatory gate, not an optional preview.

---

### SEC-4: WinTuner Module Hash Pinning
**Priority:** Medium  
**Source:** `cyber_dr.md` — supply chain security  
**Jira:** Backlog

**Problem:** `Connect-WtWinTuner` pulls the WinTuner PS module from the PowerShell Gallery at runtime with no integrity check. A compromised registry entry or MITM could substitute a malicious module.

**Recommendation:** Pin the expected SHA-256 hash of the WinTuner module version in config. After download, verify the hash before `Import-Module`. Fail loudly if the hash does not match.

---

## Feature Gap Recommendations

Gaps between what the spec describes and what exists in the codebase.

### FEAT-2: Update All — Continue Queue on Individual Failure
**Priority:** Medium  
**Source:** Codebase review — `IntuneManagerUI/server/routes/ai.ts`  
**Jira:** Backlog

**Problem:** If one app fails during "Update All", the entire queue stops. Admins must manually restart the remaining updates.

**Recommendation:** Wrap each app's update job in its own try/catch. Log the failure, emit it to the SSE stream, and continue to the next app. Surface a summary at the end (N succeeded, N failed).

---

### FEAT-3: Multi-Replica SSE Support (Redis Pub/Sub)
**Priority:** Medium  
**Source:** Azure Container Apps deployment — potential scale-to-2 scenarios  
**Jira:** Backlog

**Problem:** SSE job streams are in-memory on a single Express instance. If Container Apps scales to >1 replica, a client may connect to a different replica than the one running the job and receive no events.

**Recommendation:** Publish job log events to a Redis channel keyed by job ID. SSE endpoints subscribe to Redis and forward events. Azure Cache for Redis (Basic tier, ~$16/mo) is sufficient.

---

## New Feature Recommendations

Features not in the current spec that would meaningfully improve the application.

### NF-1: PowerShell Script Preview/Edit Before Packaging
**Priority:** High  
**Jira:** Backlog

**Description:** After AI generates the detection script, requirement script, and install command — but before packaging starts — show the admin a side-by-side editor. Allow inline edits. Track the diff between AI-generated and admin-modified versions in the deployment history.

**Value:** Catches AI errors before they reach devices. Directly addresses SEC-3.

---

### NF-2: Deployment History CSV/JSON Export
**Priority:** Medium  
**Jira:** Backlog

**Description:** Add an Export button to the Deployment History page. Export all visible rows as CSV or JSON. Useful for compliance reporting and audit hand-offs.

---

### NF-3: In-App Notification Badge for Available Updates
**Priority:** Medium  
**Jira:** Backlog

**Description:** Show a badge/count in the sidebar navigation on the InstalledApps page when one or more managed apps have an available update. Poll on app load and refresh every 30 minutes. Clicking the badge navigates to InstalledApps filtered to "Updates Available".

---

### NF-4: Audit Log Viewer Page
**Priority:** Medium  
**Jira:** Backlog

**Description:** A dedicated page showing all significant actions: deployments, updates, group assignments, logins, settings changes. Each row shows: timestamp, action type, actor (tenant/user), target (app name), result (success/failure). Filterable by date range and action type.

**Dependency:** Requires deployment history persistence (issue-005) to be complete first.

---

### NF-5: Dark / Light Theme Toggle
**Priority:** Low  
**Jira:** Backlog

**Description:** Add a theme toggle to the Settings page (General tab). Persist preference in the DB settings table. Default to system preference (`prefers-color-scheme`). CSS variables already partially support this; just needs a class toggle on `<html>`.

---

### NF-6: Bulk Group Assignment After Update All
**Priority:** Medium  
**Jira:** Backlog

**Description:** After "Update All" completes, offer a single modal to reassign groups for all successfully updated apps at once. Currently, each app requires a separate assignment step. Particularly useful when all apps share the same target group.

---

### NF-7: Scheduled Auto-Update Jobs (Cron per App)
**Priority:** Low  
**Jira:** Backlog

**Description:** Allow admins to configure a nightly/weekly auto-update schedule per app (or globally). Use the existing job queue infrastructure. Emit SSE events and record history as normal. Requires a persistent scheduler (node-cron or Azure scheduled trigger).

---

### NF-8: Multi-Tenant Support
**Priority:** Low  
**Jira:** Backlog

**Description:** Allow the app to manage multiple Entra tenants. A tenant switcher in the header/sidebar replaces the current single-tenant MSAL flow. Each tenant gets its own token cache, settings row, and deployment history. Requires schema changes (add `tenant_id` FK to all relevant tables).

---

### NF-9: Health Check / Status Page
**Priority:** Low  
**Jira:** Backlog

**Description:** Expose `GET /status` returning `{ status: 'ok', db: 'ok', version: '...', uptime: N }`. Useful for Azure Container Apps health probes and operator visibility. Should not require authentication.

---

### NF-10: App Category Tags and Filter in App Catalog
**Priority:** Low  
**Jira:** Backlog

**Description:** Allow admins to tag apps in the App Catalog (e.g., "Productivity", "Security", "Development"). Add a tag filter bar above the catalog grid. Tags stored as a JSON array in a new `tags` column on the `app_catalog` table (or equivalent).

---

## Summary Table

| ID | Title | Priority | Category | Jira |
|----|-------|----------|----------|------|
| SEC-1 | IPC channel whitelist in preload.ts | High | Security | Backlog |
| SEC-2 | Invalidate sessions on password change | High | Security | Backlog |
| SEC-3 | Script diff/review before Intune upload | High | Security | Backlog |
| SEC-4 | WinTuner module hash pinning | Medium | Security | Backlog |
| FEAT-2 | Update All — continue on failure | Medium | Feature Gap | Backlog |
| FEAT-3 | Multi-replica SSE via Redis | Medium | Feature Gap | Backlog |
| NF-1 | PS script preview/edit before packaging | High | New Feature | Backlog |
| NF-2 | Deployment History CSV/JSON export | Medium | New Feature | Backlog |
| NF-3 | Update available notification badge | Medium | New Feature | Backlog |
| NF-4 | Audit log viewer page | Medium | New Feature | Backlog |
| NF-5 | Dark/light theme toggle | Low | New Feature | Backlog |
| NF-6 | Bulk group assignment after Update All | Medium | New Feature | Backlog |
| NF-7 | Scheduled auto-update jobs | Low | New Feature | Backlog |
| NF-8 | Multi-tenant support | Low | New Feature | Backlog |
| NF-9 | Health check / status endpoint | Low | New Feature | Backlog |
| NF-10 | App category tags and filter | Low | New Feature | Backlog |

---

## References

- **Threat model:** [docs/cyber_dr.md](../cyber_dr.md)
- **Project overview:** [docs/PROJECT_OVERVIEW.md](../PROJECT_OVERVIEW.md)
- **Issues index:** [docs/specs/ISSUES-INDEX.md](ISSUES-INDEX.md)
