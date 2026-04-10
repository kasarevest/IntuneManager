# Issue #009: Post-Queue Summary for Update All

**Priority:** Medium  
**Status:** ✅ Completed  
**Completed:** 2026-04-10  
**Created:** 2026-04-02

## Problem Statement

After "Update All" finishes processing N apps, the user is left on the Deploy page with the completion message "All N updates deployed!" but no indication of which apps succeeded, which failed, or any summary statistics. If any app failed mid-queue, there is no list of which apps were skipped.

## Current Behavior

```typescript
// Dashboard.tsx (Update All completion)
if (updateQueueIndex >= updateQueue.length - 1) {
  setJobPhase('done')
  setJobLogs(prev => [...prev, {
    timestamp: new Date().toISOString(),
    level: 'INFO',
    message: `All ${updateQueue.length} updates deployed!`,
    source: 'system'
  }])
  setUpdateQueue([])
  setUpdateQueueIndex(-1)
}
```

**What's missing:**
- No summary of success/failure per app
- No indication if queue stopped early due to failure
- No clickable links to view individual app logs
- No stats: "5 succeeded, 2 failed, 3 skipped"
- No persistence — if user navigates away, summary is lost

## Desired Behavior

1. **Track each app's result** during queue processing
2. **Display summary modal** when queue completes:
   - Total apps in queue
   - Succeeded count (green)
   - Failed count (red)
   - Skipped count (gray) — if queue stopped early
3. **List all apps** with status icons
4. **Link to logs** — click app name to view deployment log (future: open History page filtered to that job)
5. **Persist summary** — store in state, allow review after modal is closed

## Technical Design

### Queue Result Tracking

**New state in Deploy.tsx:**

```typescript
interface QueueItem {
  name: string
  wingetId: string
  currentVersion: string
  latestVersion: string
}

interface QueueResult {
  app: QueueItem
  status: 'success' | 'failed' | 'skipped'
  jobId: string | null
  errorMessage: string | null
  startedAt: string
  completedAt: string | null
}

const [queueResults, setQueueResults] = useState<QueueResult[]>([])
```

### Track Results During Execution

```typescript
useEffect(() => {
  const onJobComplete = (_: any, data: { jobId: string }) => {
    if (data.jobId !== jobId) return
    
    // Record success for current app
    const currentApp = updateQueue[updateQueueIndex]
    if (currentApp) {
      setQueueResults(prev => [...prev, {
        app: currentApp,
        status: 'success',
        jobId,
        errorMessage: null,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      }])
    }
    
    // Advance queue
    if (updateQueueIndex < updateQueue.length - 1) {
      setUpdateQueueIndex(updateQueueIndex + 1)
      // Start next job...
    } else {
      // Queue complete — show summary
      setShowQueueSummary(true)
    }
  }
  
  const onJobError = (_: any, data: { jobId: string; error: string }) => {
    if (data.jobId !== jobId) return
    
    const currentApp = updateQueue[updateQueueIndex]
    if (currentApp) {
      setQueueResults(prev => [...prev, {
        app: currentApp,
        status: 'failed',
        jobId,
        errorMessage: data.error,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      }])
    }
    
    // Stop queue on failure (current behavior)
    // OR: continue with next app (future enhancement)
    setShowQueueSummary(true)
  }
  
  window.electron.on('job:complete', onJobComplete)
  window.electron.on('job:error', onJobError)
  return () => {
    window.electron.off('job:complete', onJobComplete)
    window.electron.off('job:error', onJobError)
  }
}, [jobId, updateQueue, updateQueueIndex])
```

### Summary Modal Component

**New component:** `src/components/QueueSummaryModal.tsx`

```typescript
interface QueueSummaryModalProps {
  results: QueueResult[]
  onClose: () => void
}

export default function QueueSummaryModal({ results, onClose }: QueueSummaryModalProps) {
  const successCount = results.filter(r => r.status === 'success').length
  const failedCount = results.filter(r => r.status === 'failed').length
  const skippedCount = results.filter(r => r.status === 'skipped').length
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 700 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ fontSize: 20, fontWeight: 600 }}>Update All Summary</h2>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        
        {/* Summary Stats */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
          <div className="card" style={{ flex: 1, textAlign: 'center', padding: 16 }}>
            <div style={{ fontSize: 32, fontWeight: 600, color: 'var(--success)' }}>{successCount}</div>
            <div style={{ fontSize: 14, color: 'var(--text-400)' }}>Succeeded</div>
          </div>
          <div className="card" style={{ flex: 1, textAlign: 'center', padding: 16 }}>
            <div style={{ fontSize: 32, fontWeight: 600, color: 'var(--error)' }}>{failedCount}</div>
            <div style={{ fontSize: 14, color: 'var(--text-400)' }}>Failed</div>
          </div>
          {skippedCount > 0 && (
            <div className="card" style={{ flex: 1, textAlign: 'center', padding: 16 }}>
              <div style={{ fontSize: 32, fontWeight: 600, color: 'var(--text-400)' }}>{skippedCount}</div>
              <div style={{ fontSize: 14, color: 'var(--text-400)' }}>Skipped</div>
            </div>
          )}
        </div>
        
        {/* Detailed Results Table */}
        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>App Name</th>
                <th>Version</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {results.map((result, idx) => {
                const duration = result.completedAt
                  ? Math.round((new Date(result.completedAt).getTime() - new Date(result.startedAt).getTime()) / 1000)
                  : null
                
                return (
                  <tr key={idx}>
                    <td>
                      {result.status === 'success' && <span style={{ color: 'var(--success)' }}>✓</span>}
                      {result.status === 'failed' && <span style={{ color: 'var(--error)' }}>✗</span>}
                      {result.status === 'skipped' && <span style={{ color: 'var(--text-400)' }}>⊘</span>}
                    </td>
                    <td>
                      <strong>{result.app.name}</strong>
                      {result.errorMessage && (
                        <div style={{ fontSize: 12, color: 'var(--error)', marginTop: 4 }}>
                          {result.errorMessage.substring(0, 100)}...
                        </div>
                      )}
                    </td>
                    <td>
                      <span style={{ color: 'var(--text-400)' }}>{result.app.currentVersion}</span>
                      {' → '}
                      <span style={{ color: 'var(--success)' }}>{result.app.latestVersion}</span>
                    </td>
                    <td>{duration ? `${duration}s` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        
        <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
          <button className="btn-primary" onClick={() => {
            // Future: navigate to History page
            onClose()
          }}>
            View History
          </button>
        </div>
      </div>
    </div>
  )
}
```

### Integration in Deploy.tsx

```typescript
export default function Deploy() {
  const [showQueueSummary, setShowQueueSummary] = useState(false)
  const [queueResults, setQueueResults] = useState<QueueResult[]>([])
  
  // ... existing state and logic ...
  
  return (
    <div style={{ padding: 24 }}>
      {/* Existing Deploy UI */}
      
      {showQueueSummary && (
        <QueueSummaryModal
          results={queueResults}
          onClose={() => {
            setShowQueueSummary(false)
            setUpdateQueue([])
            setUpdateQueueIndex(-1)
            setQueueResults([])
          }}
        />
      )}
    </div>
  )
}
```

## Acceptance Criteria

- [ ] `QueueResult[]` state tracks each app's outcome during Update All
- [ ] Summary modal appears when queue completes (success or failure)
- [ ] Modal shows:
  - Success count (green)
  - Failed count (red)
  - Skipped count (gray) — if queue stopped early
- [ ] Detailed table lists all apps with status icons
- [ ] Error messages shown for failed apps (truncated to 100 chars)
- [ ] Duration column shows seconds per app
- [ ] "Close" button dismisses modal and clears queue
- [ ] TypeScript: 0 compile errors
- [ ] Peer review: PASS

## Testing Plan

### Test 1: All Succeed
1. Queue 3 apps for update
2. All deploy successfully
3. Verify modal shows:
   - "3 Succeeded, 0 Failed, 0 Skipped"
   - All 3 rows with green ✓

### Test 2: Mixed Success/Failure
1. Queue 5 apps
2. Apps 1-3 succeed, app 4 fails (download error)
3. Verify modal shows:
   - "3 Succeeded, 1 Failed, 1 Skipped"
   - Apps 1-3: green ✓
   - App 4: red ✗ + error message
   - App 5: gray ⊘ (skipped)

### Test 3: All Fail (First App)
1. Queue 5 apps
2. First app fails immediately (wrong app name)
3. Verify modal shows:
   - "0 Succeeded, 1 Failed, 4 Skipped"
   - App 1: red ✗ + error
   - Apps 2-5: gray ⊘

### Test 4: Duration Tracking
1. Queue 2 apps: 7-Zip (fast) + Chrome (slow download)
2. Verify modal shows reasonable durations:
   - 7-Zip: ~30s
   - Chrome: ~120s

## Future Enhancements (Out of Scope)

- **Export summary to CSV** — download results as spreadsheet
- **Retry failed apps** — button in modal: "Retry N failed"
- **Continue on failure** — don't stop queue when one app fails
- **Link to job logs** — click app name → opens History page filtered to that jobId
- **Email summary** — send results to admin's email
- **Persist summary** — store in DB, allow review later

## Dependencies

None — pure React state management

## Migration Notes

No breaking changes. Existing Update All behavior unchanged; summary is additive.

## References

- React modal patterns: https://reactjs.org/docs/portals.html
