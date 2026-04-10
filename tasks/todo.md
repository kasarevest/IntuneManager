# Jira Sprint — 15 In Progress Tickets
**Date:** 2026-04-10

---

## Pre-flight Assessment

**SCRUM-69 — ALREADY DONE.** The SCRUM-67/68 implementation already captures
app_name, winget_id, intune_app_id, deployed_version, intunewin_path, log_snapshot.
Closing immediately, no code needed.

**Tier 3 — Deferred (architectural / out of scope for one session):**
- SCRUM-110: Session invalidation — requires JWT vs. session-table architecture decision
- SCRUM-111: PS script review gate — requires mid-job pause/resume (new bidirectional protocol)
- SCRUM-123: Multi-tenant — full graph-auth overhaul + DB schema migration

---

## Tier 1 — High Value, Low Risk

### SCRUM-96 + SCRUM-97: Startup Orphan Cleanup
**Files:** `server/index.ts` (startup chain), `server/routes/ai.ts` (add 'running' write)
- [ ] Add `status: 'running'` update to DB when job enters the AI loop (so cleanup catches real in-flight jobs)
- [ ] In `server/index.ts` startup, after existing init: mark all `status='running'` rows as `status='failed'`, `error_message='Server restarted while job was running'`
- [ ] Verify WHERE clause does NOT touch 'success' or 'failed' rows

### SCRUM-70 + SCRUM-71: Deployment History Page
**Files:** `server/routes/deployments.ts` (new), `server/index.ts` (register router),
         `src/pages/DeploymentHistory.tsx` (new), `src/App.tsx` (route), nav (link)
- [ ] `GET /api/deployments?status=all|success|failed` — Prisma query on app_deployments, ordered by started_at desc, paginate 50/page
- [ ] `DeploymentHistory.tsx` — table with columns: Date, App Name, Operation, Version, Status, Duration
- [ ] Status filter tabs: All | Success | Failed
- [ ] Add "History" nav link

### SCRUM-125: App Category Filter in App Catalog
**Files:** `src/pages/AppCatalog.tsx`
- [ ] `category` field already exists on AI recommendation objects — extract unique values
- [ ] Add category filter select/tabs above the catalog grid
- [ ] Filter is client-side (data already loaded)

### SCRUM-120: Dark/Light Theme Toggle
**Files:** `src/styles/global.css`, `src/pages/settings/GeneralTab.tsx` (or Settings.tsx),
         `server/routes/settings.ts`
- [ ] Add `[data-theme="light"]` CSS override block in global.css
- [ ] On load: read `theme` from app_settings, apply `document.documentElement.dataset.theme`
- [ ] Settings toggle: save to DB, apply immediately

### SCRUM-118: Update Badge on Sidebar
**Files:** `src/components/` or layout component with nav
- [ ] Add a lightweight hook that reads wt_detected_updates count
- [ ] Show badge count on the InstalledApps nav item when count > 0

---

## Tier 2 — Medium Complexity

### SCRUM-114: Update All Continue on Failure
**Files:** `src/pages/Deploy.tsx`
- [ ] In Update All queue's `onJobError` handler: instead of stopping, mark item as failed, advance queue index, continue
- [ ] Track per-item outcome in a `updateResults` ref

### SCRUM-99: Update All Summary Modal
**Files:** `src/pages/Deploy.tsx` (or new `UpdateSummaryModal.tsx`)
- [ ] After queue completes (`allDone` branch), show modal with N succeeded / N failed / N skipped
- [ ] Depends on SCRUM-114 tracking per-item results

### SCRUM-119: Audit Log Page
**Files:** `src/pages/AuditLog.tsx` (new), reuse `/api/deployments` route from SCRUM-70
- [ ] Richer display than history: shows all operations with full metadata
- [ ] Can share the same API route as SCRUM-70

### SCRUM-112: WinTuner Hash Pinning
**Files:** `src/pages/settings/GeneralTab.tsx`, `server/routes/ps.ts`, PS scripts
- [ ] Add `wintuner_expected_hash` setting field in UI
- [ ] Pass hash to WinTuner PS calls for verification

---

## Risk Register

| Risk | Mitigation |
|------|-----------|
| Running status write in ai.ts changes flow order | Non-blocking `.catch()` — same pattern as SCRUM-67 |
| History route exposes sensitive data | Must use `requireAuth` middleware |
| Category filter values are inconsistent AI strings | Normalize to set or allow freeform; no crash risk |
| Theme toggle breaks existing CSS | Test contrast; use `[data-theme="light"]` override only |
| Update All queue ref management | Reuse existing `updateQueueRef` pattern; don't rewrite |

---

## Commit Plan

```
feat(SCRUM-96,SCRUM-97): mark orphaned running jobs as failed on startup
feat(SCRUM-70,SCRUM-71): add deployment history page with status filter
feat(SCRUM-125): add category filter to app catalog
feat(SCRUM-120): add dark/light theme toggle to settings
feat(SCRUM-118): show update badge on installed apps nav item
feat(SCRUM-114,SCRUM-99): continue Update All on failure + summary modal
feat(SCRUM-119): add audit log page
feat(SCRUM-112): WinTuner module hash pinning
```

---

## Post-Flight
- [ ] Close SCRUM-69 (already done)
- [ ] Transition all completed tickets to Done in Jira
- [ ] Update spec statuses
- [ ] git push

---

## Progress

- [x] SCRUM-96/97 Startup cleanup
- [x] SCRUM-70/71 History page
- [x] SCRUM-125 Category filter
- [x] SCRUM-120 Theme toggle + SCRUM-92/93/94 Path validation
- [x] SCRUM-118 Update badge
- [x] SCRUM-114/99/100/101 Update All continue + summary modal
- [x] SCRUM-119 Audit Log
- [x] SCRUM-112 WinTuner hash

## Post-Flight

- [x] SCRUM-69 — closed (already implemented by SCRUM-67/68)
- [ ] Transition all completed tickets to Done in Jira
- [x] git push
