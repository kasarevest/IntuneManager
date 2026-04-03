# Issue #008: Startup Cleanup of Orphaned "Running" Jobs

**Priority:** Medium  
**Status:** Not Started  
**Created:** 2026-04-02

## Problem Statement

The `activeJobs` Map in `ai-agent.ts` is module-level and cleared on app restart. However, the `app_deployments` table in SQLite may still have rows with `status = 'running'` if the app crashed or was force-closed during a deployment. On next launch, these jobs show incorrectly in any UI that displays deployment history.

## Current Behavior

```typescript
// ai-agent.ts
const activeJobs = new Map<string, ActiveJob>()  // In-memory only

// On app start:
// - activeJobs is empty
// - DB still has rows with status='running'

// Result:
// - Jobs appear "stuck" in running state forever
// - User sees "Deployment in progress" but nothing is actually happening
```

**Scenarios that create orphans:**
1. **App crash** — exception in main process, Electron exits
2. **Force close** — user kills via Task Manager
3. **System shutdown** — Windows Update restarts machine
4. **Dev mode** — hot reload during deployment

**Impact:**
- Deployment history inaccurate
- If future UI shows "jobs in progress" count, it will be wrong
- No way to distinguish real running job from orphan

## Desired Behavior

1. **On app startup** — check DB for rows with `status = 'running'` or `status = 'pending'`
2. **Mark orphans as failed** — UPDATE to `status = 'failed'`, set `error_message = 'App restarted while job was running'`
3. **Log cleanup** — console log: "Cleaned up N orphaned jobs"
4. **Preserve completed jobs** — don't touch `status = 'success'` or `status = 'failed'` (already terminal)

## Technical Design

### Cleanup Function

**In `electron/ipc/ai-agent.ts`:**

```typescript
export function cleanupOrphanedJobs(db: Database): void {
  try {
    const orphans = db.prepare(`
      SELECT job_id, app_name, started_at 
      FROM app_deployments 
      WHERE status IN ('running', 'pending')
    `).all() as Array<{ job_id: string; app_name: string; started_at: string }>
    
    if (orphans.length === 0) {
      console.log('[Startup] No orphaned jobs to clean up')
      return
    }
    
    console.log(`[Startup] Found ${orphans.length} orphaned job(s):`, orphans.map(o => o.app_name).join(', '))
    
    const result = db.prepare(`
      UPDATE app_deployments
      SET 
        status = 'failed',
        error_message = 'App restarted while job was running. Job did not complete.',
        completed_at = datetime('now')
      WHERE status IN ('running', 'pending')
    `).run()
    
    console.log(`[Startup] Marked ${result.changes} orphaned job(s) as failed`)
  } catch (err) {
    console.error('[Startup] Failed to clean up orphaned jobs:', err)
    // Non-fatal — app can still start
  }
}
```

### Integration in Main Process

**In `electron/main.ts` → `app.whenReady()`:**

```typescript
app.whenReady().then(() => {
  try {
    db = createDatabase()
    initializeAuth(db)
    
    // Clean up orphaned jobs from previous session
    cleanupOrphanedJobs(db)
    
    // Clean up expired sessions
    try {
      db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run()
    } catch { /* non-fatal */ }
    
    // Register IPC handlers
    registerAuthHandlers(db)
    registerSettingsHandlers(db)
    
    win = createWindow()
    
    registerPsBridgeHandlers(win, db)
    registerAiAgentHandlers(win, db)
  } catch (err) {
    console.error('Startup error:', err)
    app.quit()
  }
})
```

### Optional: Distinguish Crash from Clean Exit

**Enhanced cleanup logic:**

```typescript
// Store a "clean shutdown" flag
let cleanShutdown = false

app.on('before-quit', () => {
  // Mark that we're shutting down cleanly
  try {
    fs.writeFileSync(
      path.join(app.getPath('userData'), 'clean-shutdown.flag'),
      Date.now().toString(),
      'utf8'
    )
    cleanShutdown = true
  } catch { /* ignore */ }
})

export function cleanupOrphanedJobs(db: Database): void {
  const flagPath = path.join(app.getPath('userData'), 'clean-shutdown.flag')
  let wasCleanShutdown = false
  
  try {
    if (fs.existsSync(flagPath)) {
      const timestamp = fs.readFileSync(flagPath, 'utf8')
      const age = Date.now() - parseInt(timestamp, 10)
      wasCleanShutdown = age < 10000  // Clean shutdown within last 10 seconds
      fs.unlinkSync(flagPath)
    }
  } catch { /* ignore */ }
  
  const orphans = db.prepare(`
    SELECT job_id, app_name, started_at 
    FROM app_deployments 
    WHERE status IN ('running', 'pending')
  `).all() as Array<{ job_id: string; app_name: string; started_at: string }>
  
  if (orphans.length === 0) return
  
  const errorMessage = wasCleanShutdown
    ? 'App was closed while job was running. Job did not complete.'
    : 'App crashed or was force-closed while job was running. Job did not complete.'
  
  console.log(`[Startup] Found ${orphans.length} orphaned job(s). Clean shutdown: ${wasCleanShutdown}`)
  
  db.prepare(`
    UPDATE app_deployments
    SET 
      status = 'failed',
      error_message = ?,
      completed_at = datetime('now')
    WHERE status IN ('running', 'pending')
  `).run(errorMessage)
}
```

## Acceptance Criteria

- [ ] `cleanupOrphanedJobs` function called on app startup (before IPC handlers registered)
- [ ] All rows with `status = 'running'` or `status = 'pending'` updated to `status = 'failed'`
- [ ] Error message: "App restarted while job was running. Job did not complete."
- [ ] Console log: "Marked N orphaned job(s) as failed"
- [ ] Completed jobs (success/failed) not touched
- [ ] TypeScript: 0 compile errors
- [ ] Peer review: PASS

## Testing Plan

### Test 1: No Orphans (Baseline)
1. Start app with clean DB (no running jobs)
2. Check console: "No orphaned jobs to clean up"
3. Verify: no DB updates

### Test 2: Orphan from Crash
1. Start deployment of app
2. Force kill Electron via Task Manager (during "Downloading...")
3. Restart app
4. Check console: "Found 1 orphaned job(s): AppName"
5. Check DB: `SELECT * FROM app_deployments` → status changed to `failed`

### Test 3: Multiple Orphans
1. Start 3 deployments in parallel (if supported)
2. Kill app
3. Restart
4. Check console: "Marked 3 orphaned job(s) as failed"

### Test 4: Clean Shutdown
1. Start deployment
2. Let it run for 10 seconds
3. Close app normally (File → Exit or close window)
4. Restart
5. Verify: job still marked as failed (same behavior)

## Edge Cases

**Race condition:** Job completes just as app is shutting down
- **Mitigation:** `before-quit` event fires first, then `close` event. Job update happens before DB close.

**Multiple rapid restarts:**
- Cleanup is idempotent — running it twice does nothing (no `running` rows left)

## Dependencies

None — uses existing DB and app lifecycle events

## Migration Notes

No schema changes. Existing `app_deployments` rows with `status = 'running'` will be cleaned up on first startup after this feature ships.

## Out of Scope

- **Resume orphaned jobs** — don't auto-restart; user must manually retry
- **Orphan notification** — UI toast: "Previous deployment was interrupted"
- **Job timeout detection** — if job started >24 hours ago, mark as timeout (separate issue)

## References

- Electron app lifecycle: https://www.electronjs.org/docs/latest/api/app#events
- SQLite UPDATE: https://www.sqlite.org/lang_update.html
