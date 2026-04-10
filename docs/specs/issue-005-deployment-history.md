# Issue #005: Deployment History Persistence

**Priority:** MAJOR (Data Loss)  
**Status:** ✅ Completed  
**Completed:** 2026-04-10  
**Created:** 2026-04-02

## Problem Statement

The `app_deployments` table exists in the SQLite schema but is never written to by the AI agent. All deployment history is lost when the log panel is cleared or the app is restarted. There is no audit trail of what was deployed, when, by whom, or what the outcome was.

## Current Behavior

```sql
-- db/schema.sql (table exists but unused)
CREATE TABLE IF NOT EXISTS app_deployments (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id           TEXT NOT NULL UNIQUE,
    app_name         TEXT NOT NULL,
    winget_id        TEXT,
    intune_app_id    TEXT,
    deployed_version TEXT,
    operation        TEXT NOT NULL CHECK(operation IN ('deploy','update')),
    status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK(status IN ('pending','running','success','failed','cancelled')),
    error_message    TEXT,
    intunewin_path   TEXT,
    performed_by     INTEGER REFERENCES users(id),
    started_at       TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at     TEXT,
    log_snapshot     TEXT
);
```

**What's missing:**
- No INSERT when job starts
- No UPDATE when job completes/fails
- No UI to view deployment history
- No way to see "what did I deploy last week?"
- No audit trail for compliance/security review

**Impact:**
- Admins cannot answer: "When did we deploy Chrome 110?"
- No rollback reference: "What version was deployed before this one?"
- No compliance audit: "Show me all deployments in Q1 2026"
- Troubleshooting blind: "Did this deploy succeed? When?"

## Desired Behavior

1. **Record every deployment** — INSERT row when job starts
2. **Update on completion** — UPDATE row with success/failure + timestamp
3. **Store metadata** — app name, version, winget ID, Intune app ID
4. **Capture logs** — store final log snapshot (first 10KB)
5. **Link to user** — record which local user initiated deployment
6. **UI for history** — new "History" page showing deployment table

## Technical Design

### Database Schema (Already Exists)

Schema is correct. No migration needed.

### Insert on Job Start

**In `ai-agent.ts` → `registerAiAgentHandlers`:**

```typescript
ipcMain.handle('ipc:ai:deploy-app', async (_event, req: {
  userRequest: string
  isUpdate?: boolean
  existingAppId?: string
  jobId?: string
  userId?: number  // NEW: from AuthContext
}) => {
  const jobId = req.jobId ?? uuidv4()
  const abortController = new AbortController()
  activeJobs.set(jobId, { id: jobId, abortController, phase: 'analyzing' })
  
  // Extract app name from user request (heuristic)
  const appNameMatch = req.userRequest.match(/deploy\s+([A-Za-z0-9\s\-\.]+)/i)
  const appName = appNameMatch?.[1]?.trim() ?? 'Unknown App'
  
  // INSERT deployment record
  try {
    db.prepare(`
      INSERT INTO app_deployments (
        job_id, app_name, operation, status, performed_by, started_at
      ) VALUES (?, ?, ?, 'pending', ?, datetime('now'))
    `).run(jobId, appName, req.isUpdate ? 'update' : 'deploy', req.userId ?? null)
  } catch (err) {
    console.error('Failed to insert deployment record:', err)
    // Non-fatal — proceed with deployment
  }
  
  // Run async
  runDeployJob(jobId, req, abortController.signal, sendEvent, db).catch(err => {
    updateDeploymentStatus(db, jobId, 'failed', (err as Error).message)
    sendEvent('job:error', { jobId, error: (err as Error).message, phase: 'unknown' })
  }).finally(() => {
    activeJobs.delete(jobId)
  })
  
  return { jobId }
})
```

### Update on Completion

**New helper function:**

```typescript
function updateDeploymentStatus(
  db: Database,
  jobId: string,
  status: 'running' | 'success' | 'failed' | 'cancelled',
  errorMessage: string | null = null,
  metadata?: {
    wingetId?: string
    intuneAppId?: string
    deployedVersion?: string
    intunewinPath?: string
    logSnapshot?: string
  }
) {
  try {
    const updates: string[] = ['status = ?', 'completed_at = datetime(\'now\')']
    const params: any[] = [status]
    
    if (errorMessage) {
      updates.push('error_message = ?')
      params.push(errorMessage.substring(0, 1000))  // Limit to 1KB
    }
    if (metadata?.wingetId) {
      updates.push('winget_id = ?')
      params.push(metadata.wingetId)
    }
    if (metadata?.intuneAppId) {
      updates.push('intune_app_id = ?')
      params.push(metadata.intuneAppId)
    }
    if (metadata?.deployedVersion) {
      updates.push('deployed_version = ?')
      params.push(metadata.deployedVersion)
    }
    if (metadata?.intunewinPath) {
      updates.push('intunewin_path = ?')
      params.push(metadata.intunewinPath)
    }
    if (metadata?.logSnapshot) {
      updates.push('log_snapshot = ?')
      params.push(metadata.logSnapshot.substring(0, 10000))  // First 10KB
    }
    
    params.push(jobId)
    
    db.prepare(`
      UPDATE app_deployments 
      SET ${updates.join(', ')} 
      WHERE job_id = ?
    `).run(...params)
  } catch (err) {
    console.error('Failed to update deployment record:', err)
  }
}
```

**In `runDeployJob` success path:**

```typescript
async function runDeployJob(...) {
  // ... existing code ...
  
  // Track metadata during execution
  let capturedMetadata: {
    wingetId?: string
    intuneAppId?: string
    deployedVersion?: string
    intunewinPath?: string
  } = {}
  
  for (const block of response.content) {
    if (block.type === 'tool_use') {
      const result = await executeToolCall(...)
      
      // Capture metadata from tool results
      if (block.name === 'search_winget' && result.success) {
        capturedMetadata.wingetId = result.packageId
      }
      if (block.name === 'get_latest_version' && result.version) {
        capturedMetadata.deployedVersion = result.version
      }
      if (block.name === 'create_intune_app' && result.appId) {
        capturedMetadata.intuneAppId = result.appId
      }
      if (block.name === 'build_package' && result.intunewinPath) {
        capturedMetadata.intunewinPath = result.intunewinPath
      }
    }
  }
  
  // On success
  if (response.stop_reason === 'end_turn') {
    const logSnapshot = messages.map(m => 
      m.content.map(c => c.type === 'text' ? c.text : '').join('\n')
    ).join('\n---\n')
    
    updateDeploymentStatus(db, jobId, 'success', null, {
      ...capturedMetadata,
      logSnapshot
    })
    
    setPhase('done')
    sendEvent('job:complete', { jobId })
    return
  }
}
```

**In `runDeployJob` error path:**

```typescript
runDeployJob(...).catch(err => {
  updateDeploymentStatus(db, jobId, 'failed', (err as Error).message)
  sendEvent('job:error', { jobId, error: (err as Error).message, phase: 'unknown' })
})
```

### History Page UI

**New page:** `src/pages/History.tsx`

```typescript
import React, { useState, useEffect } from 'react'
import { ipcGetDeploymentHistory } from '../lib/ipc'

interface DeploymentRecord {
  id: number
  jobId: string
  appName: string
  wingetId: string | null
  intuneAppId: string | null
  deployedVersion: string | null
  operation: 'deploy' | 'update'
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled'
  errorMessage: string | null
  performedBy: string | null
  startedAt: string
  completedAt: string | null
}

export default function History() {
  const [deployments, setDeployments] = useState<DeploymentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'success' | 'failed'>('all')
  
  useEffect(() => {
    const load = async () => {
      const res = await ipcGetDeploymentHistory({ limit: 100, status: filter === 'all' ? undefined : filter })
      if (res.success) setDeployments(res.deployments)
      setLoading(false)
    }
    load()
  }, [filter])
  
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600 }}>Deployment History</h1>
        
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setFilter('all')} className={filter === 'all' ? 'btn-primary' : 'btn-secondary'}>
            All
          </button>
          <button onClick={() => setFilter('success')} className={filter === 'success' ? 'btn-primary' : 'btn-secondary'}>
            Success
          </button>
          <button onClick={() => setFilter('failed')} className={filter === 'failed' ? 'btn-primary' : 'btn-secondary'}>
            Failed
          </button>
        </div>
      </div>
      
      {loading ? (
        <p>Loading...</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>App Name</th>
              <th>Version</th>
              <th>Operation</th>
              <th>Status</th>
              <th>Started</th>
              <th>Duration</th>
              <th>User</th>
            </tr>
          </thead>
          <tbody>
            {deployments.map(d => (
              <tr key={d.id}>
                <td>{d.appName}</td>
                <td>{d.deployedVersion ?? '—'}</td>
                <td><span className="badge">{d.operation}</span></td>
                <td>
                  <span className={`badge badge-${d.status === 'success' ? 'success' : d.status === 'failed' ? 'error' : 'warning'}`}>
                    {d.status}
                  </span>
                </td>
                <td>{new Date(d.startedAt).toLocaleString()}</td>
                <td>
                  {d.completedAt 
                    ? `${Math.round((new Date(d.completedAt).getTime() - new Date(d.startedAt).getTime()) / 1000)}s`
                    : '—'}
                </td>
                <td>{d.performedBy ?? 'System'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
```

### IPC Handler

**In `ps-bridge.ts` or new `history.ts`:**

```typescript
ipcMain.handle('ipc:get-deployment-history', async (_event, req: { 
  limit?: number
  status?: 'success' | 'failed' | 'pending' | 'running'
  since?: string  // ISO date
}) => {
  const limit = req.limit ?? 100
  let query = `
    SELECT 
      d.id, d.job_id as jobId, d.app_name as appName, d.winget_id as wingetId,
      d.intune_app_id as intuneAppId, d.deployed_version as deployedVersion,
      d.operation, d.status, d.error_message as errorMessage,
      d.started_at as startedAt, d.completed_at as completedAt,
      u.username as performedBy
    FROM app_deployments d
    LEFT JOIN users u ON d.performed_by = u.id
    WHERE 1=1
  `
  const params: any[] = []
  
  if (req.status) {
    query += ' AND d.status = ?'
    params.push(req.status)
  }
  if (req.since) {
    query += ' AND d.started_at >= ?'
    params.push(req.since)
  }
  
  query += ' ORDER BY d.started_at DESC LIMIT ?'
  params.push(limit)
  
  const deployments = db.prepare(query).all(...params)
  
  return { success: true, deployments }
})
```

## Acceptance Criteria

- [ ] `app_deployments` table populated on every deploy/update job
- [ ] Status updated from `pending` → `running` → `success`/`failed`
- [ ] Metadata captured: wingetId, intuneAppId, version, intunewin path
- [ ] Error messages stored (truncated to 1KB)
- [ ] Log snapshot stored (first 10KB)
- [ ] History page displays table of deployments
- [ ] Filter by status (All, Success, Failed)
- [ ] Shows username of who initiated deployment
- [ ] Shows duration (started → completed)
- [ ] TypeScript: 0 compile errors
- [ ] Peer review: PASS

## Testing Plan

1. Deploy 3 apps: 7-Zip (success), Chrome (success), FakeApp (fail)
2. Navigate to History page
3. Verify: 3 rows shown, correct statuses
4. Filter: "Success" → shows 2 rows
5. Filter: "Failed" → shows 1 row
6. Check DB: `SELECT * FROM app_deployments` → verify metadata populated
7. Restart app → history persists

## Dependencies

None — schema already exists

## Out of Scope

- **Export history to CSV** — future enhancement
- **Delete old history** — auto-cleanup after 90 days (future)
- **Detailed log viewer** — click row to see full log (future)
- **Search/filter by app name** — basic filter only for now

## References

- SQLite datetime functions: https://www.sqlite.org/lang_datefunc.html
