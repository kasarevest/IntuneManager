# SCRUM-67 + SCRUM-68: Deployment History Persistence

**Date:** 2026-04-10  
**Tickets:** SCRUM-67 (INSERT on start), SCRUM-68 (UPDATE on finish)  
**Spec:** docs/specs/issue-005-deployment-history.md

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| DB insert throws (duplicate job_id) | Wrap in try/catch; non-fatal — job proceeds regardless |
| updateMany with no matching row | Returns count 0 silently; no error |
| better-sqlite3 .run() throws inside .catch() | Inner try/catch inside helper |
| logLines grows unbounded | Sliced at 10 240 chars at write time only |
| `performed_by` null on desktop | Column allows NULL |
| SQLite CHECK on `operation` | Only pass `'deploy'` or `'update'` literals |

---

## Schema Check — No Migration Needed

`AppDeployment` model in `schema.prisma` already has all required columns:
- job_id, app_name, operation, status (default "pending"), started_at (default now)
- completed_at, error_message, log_snapshot (all optional)
- winget_id, intune_app_id, deployed_version, intunewin_path (optional extras)

SQLite schema in `desktop-app/electron/main.ts` SCHEMA_SQL is identical — same columns, `CREATE TABLE IF NOT EXISTS`.

---

## Files to Change

1. `IntuneManagerUI/server/routes/ai.ts`
2. `desktop-app/electron/ipc/ai-agent.ts`

No schema changes. No PS script changes. No frontend changes.

---

## Checklist

### server/routes/ai.ts

- [ ] Add `logLines: string[]` local + push in `log()` closure in `runDeployJob`
- [ ] Add metadata locals in `runDeployJob`: `capturedAppName`, `capturedWingetId`, `capturedVersion`, `capturedIntuneAppId`, `capturedIntunewinPath`
- [ ] Capture metadata inside tool-call loop (generate_package_settings, create_intune_app, build_package, get_latest_version)
- [ ] INSERT pending row at POST /api/ai/deploy route handler (SCRUM-67)
- [ ] UPDATE to success in `runDeployJob` `end_turn` branch (SCRUM-68)
- [ ] UPDATE to failed in `.catch()` of `runDeployJob` at route handler (SCRUM-68)
- [ ] Same INSERT/UPDATE pattern for `runPackageOnlyJob` route
- [ ] Same INSERT/UPDATE pattern for `runUploadOnlyJob` route

### desktop-app/electron/ipc/ai-agent.ts

- [ ] Add `recordDeploymentStart(db, jobId, appName, operation)` helper
- [ ] Add `recordDeploymentEnd(db, jobId, status, opts?)` helper
- [ ] INSERT in `ipc:ai:deploy-app` handler (SCRUM-67)
- [ ] UPDATE on success + failure in `runDeployJob` desktop path (SCRUM-68)
- [ ] Same for `ipc:ai:package-only` and `ipc:ai:upload-only` handlers

---

## Commit Message

```
feat(SCRUM-67,SCRUM-68): record deployment history on start and completion
```

---

## Post-Flight

- [ ] TypeScript compiles without errors (tsc --noEmit)
- [ ] Update issue-005-deployment-history.md status to Completed
- [ ] Transition SCRUM-67 and SCRUM-68 to Done in Jira

---

## Review

_To be filled after implementation._
