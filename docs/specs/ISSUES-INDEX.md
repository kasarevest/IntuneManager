# IntuneManager Issues Index

**Generated:** 2026-04-02  
**Source:** PEER_REVIEW.md + Development Review

This index tracks all identified issues from the peer review and provides links to detailed specifications for each.

---

## Priority Summary

| Priority | Count | Issues |
|----------|-------|--------|
| CRITICAL | 1 | #001 |
| BLOCKING | 2 | #002, #003 |
| MAJOR | 3 | #004, #005, #006 |
| Medium | 3 | #007, #008, #009 |
| **Total** | **9** | |

---

## CRITICAL Issues

### #001: AAD Group Assignment UI ✅ COMPLETE
**Priority:** CRITICAL (Workflow)  
**Impact:** Apps deploy but aren't assigned to any users/devices. Manual portal work required after every deployment.  
**Spec:** [issue-001-aad-group-assignment.md](issue-001-aad-group-assignment.md)

**Summary:** Post-deployment `AssignmentModal` added. Shows MRU + all AAD security groups with per-group intent toggle. Single `/assign` batch POST to Graph API. GroupAssignmentHistory Prisma model tracks recently-used groups. Triggered from Deploy.tsx after WinTuner deploy or upload-only job success.

**Completed:** 2026-04-09

---

## BLOCKING Issues

### #002: PowerShell Script Timeouts ✅ COMPLETE
**Priority:** BLOCKING (Technical)  
**Impact:** Hung scripts leave jobs in "running" state indefinitely with no recovery path.  
**Spec:** [issue-002-ps-script-timeouts.md](issue-002-ps-script-timeouts.md)

**Summary:** Both `server/services/ps-bridge.ts` and `electron/ipc/ps-bridge.ts` now have `timeoutMs` parameter, `killProc()` helper, and `setTimeout`/`clearTimeout` on close/error/abort. `SCRIPT_TIMEOUTS` constants defined in both files (search=60s, version=30s, download=300s, build=180s, upload=600s, graph=60s, auth=300s, default=120s). All 7 `runPsScript` calls in `ai-agent.ts` `executeToolCall` pass per-script timeouts. IPC handlers for download/build/upload/new-win32-app/update-win32-app/connect-tenant pass explicit timeouts.

**Completed:** 2026-04-09

---

### #003: Claude 20-Iteration Limit Recovery
**Priority:** BLOCKING (Technical)  
**Impact:** Partial state (files, scripts) left on disk with no cleanup when Claude reaches iteration limit.  
**Spec:** [issue-003-claude-iteration-recovery.md](issue-003-claude-iteration-recovery.md)

**Summary:** Track partial progress during deployment. On 20-iteration limit, log which steps succeeded, which failed, and Claude's final reasoning. Enhanced error messages help admins understand what went wrong.

**Recommended Order:** Implement **THIRD** (improves error diagnostics)

---

## MAJOR Issues

### #004: Path Traversal Validation ✅ COMPLETE
**Priority:** MAJOR (Security)  
**Impact:** AI-provided paths not validated; potential arbitrary file write vulnerability.  
**Spec:** [issue-004-path-traversal-validation.md](issue-004-path-traversal-validation.md)

**Summary:** `validatePathInBase()` utility created in `electron/utils/path-validator.ts` and `server/utils/path-validator.ts`. All 4 `generate_*` tool cases in both `electron/ipc/ai-agent.ts` and `server/routes/ai.ts` now validate `source_folder` before any `fs` operation. UNC paths, `..` traversal, and paths outside `sourceRoot` are rejected with `{ success: false, error }` + `console.error` security log.

**Completed:** 2026-04-09

---

### #005: Deployment History Persistence
**Priority:** MAJOR (Data Loss)  
**Impact:** No audit trail; all deployment history lost when log cleared or app restarted.  
**Spec:** [issue-005-deployment-history.md](issue-005-deployment-history.md)

**Summary:** Populate `app_deployments` table during every deployment. Track success/failure, metadata (app name, version, Intune app ID), and log snapshots. Add History page UI.

**Recommended Order:** Implement **FIFTH** (audit compliance, troubleshooting)

---

### #006: Non-Semver Version Comparison
**Priority:** MAJOR (Feature Gap)  
**Impact:** Date-based and quad-part versions (Edge, Chrome, Teams) never show "Update Available".  
**Spec:** [issue-006-non-semver-version-comparison.md](issue-006-non-semver-version-comparison.md)

**Summary:** Enhance `compareVersions()` to detect and compare date-based (`20241201`), quad-part (`132.0.6834.83`), and CalVer formats. Maintain semver compatibility.

**Recommended Order:** Implement **SIXTH** (improves update detection coverage)

---

## Medium Priority Issues

### #007: Settings Path Validation
**Priority:** Medium  
**Impact:** Invalid paths in Settings only discovered during deployment job; no inline feedback.  
**Spec:** [issue-007-settings-path-validation.md](issue-007-settings-path-validation.md)

**Summary:** Add real-time validation to path inputs (IntuneWinAppUtil, Source Root, Output Folder). Show green ✅/yellow ⚠️/red ❌ icons based on path existence and validity.

**Recommended Order:** Implement **SEVENTH** (UX improvement)

---

### #008: Startup Cleanup of Orphaned Jobs
**Priority:** Medium  
**Impact:** Jobs stuck in "running" state after app crash/restart; inaccurate history.  
**Spec:** [issue-008-startup-cleanup-orphaned-jobs.md](issue-008-startup-cleanup-orphaned-jobs.md)

**Summary:** On app startup, find all DB rows with `status = 'running'` or `'pending'` and mark as `'failed'` with message "App restarted while job was running."

**Recommended Order:** Implement **EIGHTH** (data integrity)

---

### #009: Update All Post-Queue Summary
**Priority:** Medium  
**Impact:** No indication of which apps succeeded/failed after Update All completes.  
**Spec:** [issue-009-update-all-summary.md](issue-009-update-all-summary.md)

**Summary:** After Update All finishes, show modal with summary stats (N succeeded, N failed, N skipped) and detailed table of each app's status + error messages.

**Recommended Order:** Implement **NINTH** (UX polish)

---

## Implementation Strategy

### Phase 1: Critical Path (Weeks 1-2)
Issues that block core workflow or pose technical risks:
1. **#001 AAD Group Assignment** — removes manual portal work
2. **#002 PS Script Timeouts** — prevents system hangs
3. **#003 Claude Iteration Recovery** — improves error diagnostics

**Deliverable:** Apps can be fully deployed and assigned without leaving IntuneManager. No more hung jobs.

---

### Phase 2: Security & Data (Weeks 3-4)
Issues that improve security posture and data persistence:
4. **#004 Path Traversal Validation** — security hardening
5. **#005 Deployment History** — audit trail + History page

**Deliverable:** System is production-ready with full audit logging and security validation.

---

### Phase 3: Feature Completeness (Week 5)
Issues that improve feature coverage and accuracy:
6. **#006 Non-Semver Version Comparison** — covers Edge, Chrome, Teams

**Deliverable:** Version checking works for all major enterprise apps.

---

### Phase 4: Polish (Week 6)
Nice-to-have UX improvements:
7. **#007 Settings Path Validation** — inline feedback
8. **#008 Orphaned Jobs Cleanup** — data integrity
9. **#009 Update All Summary** — batch operation reporting

**Deliverable:** UI feels polished and professional; edge cases handled gracefully.

---

## Estimated Effort

| Issue | Estimated Time | Complexity |
|-------|---------------|------------|
| #001 AAD Groups | 2-3 days | Medium (new PS script + Graph API + React modal) |
| #002 PS Timeouts | 1 day | Low (add timeout to existing function) |
| #003 Claude Recovery | 1-2 days | Medium (state tracking + error formatting) |
| #004 Path Validation | 1 day | Low (utility function + validation checks) |
| #005 Deployment History | 2-3 days | Medium (DB inserts/updates + History page) |
| #006 Version Compare | 1-2 days | Medium (parser logic + unit tests) |
| #007 Path Validation UI | 1 day | Low (React hook + inline feedback) |
| #008 Orphaned Jobs | 0.5 days | Low (startup cleanup function) |
| #009 Update Summary | 1 day | Low (modal component + state tracking) |
| **Total** | **11-15 days** | **(~3 weeks with testing/review)** |

---

## Notes

- **Peer review required** for all CRITICAL and BLOCKING issues before deployment
- **Unit tests required** for #006 (version comparison logic)
- **Security audit required** for #004 (path validation)
- **Database migration** for #005 (schema already exists; just populate)
- **Breaking changes:** None — all issues are additive or bug fixes

---

## Quick Start: Tackling Your First Issue

**If you're ready to start coding:**

1. **Read the spec:** Open [issue-001-aad-group-assignment.md](issue-001-aad-group-assignment.md)
2. **Create a feature branch:** `git checkout -b feat/aad-group-assignment`
3. **Follow the Technical Design section** — it has code snippets ready to use
4. **Run TypeScript:** `npx tsc --noEmit` (ensure 0 errors)
5. **Test according to Testing Plan** in the spec
6. **Peer review:** Run peer-review subagent before committing
7. **Commit and push:** Use conventional commit format
8. **Mark issue as complete** in this index

---

## Progress Tracking

Use this checklist to track implementation:

- [x] #001 AAD Group Assignment — Complete 2026-04-09
- [x] #002 PS Script Timeouts — Complete 2026-04-09
- [ ] #003 Claude Iteration Recovery
- [x] #004 Path Traversal Validation — Complete 2026-04-09
- [ ] #005 Deployment History
- [ ] #006 Non-Semver Version Comparison
- [ ] #007 Settings Path Validation
- [ ] #008 Orphaned Jobs Cleanup
- [ ] #009 Update All Summary

---

## References

- **Source Review:** [docs/PEER_REVIEW.md](../PEER_REVIEW.md)
- **Project Overview:** [docs/PROJECT_OVERVIEW.md](../PROJECT_OVERVIEW.md)
- **Workflow Guidelines:** [docs/WORKFLOW.md](../WORKFLOW.md)
