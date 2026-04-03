# Issue #002: PowerShell Script Timeouts

**Priority:** BLOCKING (Technical)  
**Status:** Not Started  
**Created:** 2026-04-02

## Problem Statement

`runPsScript` in `electron/ipc/ps-bridge.ts` has no timeout mechanism. If a PowerShell script hangs (network issue, modal dialog, UAC prompt), the IPC call never resolves and the job stays in "running" state indefinitely. There is no upper bound.

## Current Behavior

```typescript
// ps-bridge.ts (simplified)
function runPsScript(scriptName: string, args: string[]) {
  const ps = spawn('powershell.exe', ['-File', scriptPath, ...args])
  
  ps.stdout.on('data', (chunk) => { /* ... */ })
  ps.stderr.on('data', (chunk) => { /* ... */ })
  ps.on('close', (code) => resolve({ exitCode: code, result, logs }))
  
  // NO TIMEOUT — if process hangs, this promise never resolves
}
```

**Scenarios that trigger indefinite hang:**
1. Network-dependent script (download) hits unresponsive server
2. Script triggers UAC prompt (blocks on user input)
3. Script opens modal dialog (e.g. MSI installer without /qn flag)
4. Infinite loop in PS script logic (rare but possible)
5. OS scheduling issue (process suspended, never resumed)

**Impact:**
- User sees job stuck at "Downloading..." or "Packaging..." forever
- No error message, no recovery path
- Only fix: kill `powershell.exe` manually via Task Manager
- Multiple hung jobs accumulate over time

## Desired Behavior

1. Every PS script call has a **configurable timeout**
2. If script exceeds timeout:
   - Kill the PowerShell process (force terminate)
   - Emit `job:error` with clear message: "Script timed out after Xs"
   - Clean up any partial state (temp files, spawned processes)
3. Different timeout defaults per script type:
   - **Download scripts:** 300s (5 minutes)
   - **Query scripts:** 60s (1 minute)
   - **Build scripts:** 180s (3 minutes)
   - **Upload scripts:** 600s (10 minutes — large files)

## Technical Design

### Updated `runPsScript` Signature

```typescript
async function runPsScript(
  scriptName: string,
  args: string[],
  onLog?: (msg: string, level: string) => void,
  options?: {
    interactive?: boolean
    timeout?: number  // NEW: timeout in milliseconds (default: 120000)
  }
): Promise<{ exitCode: number; result: any; logs: string[] }>
```

### Implementation

```typescript
async function runPsScript(
  scriptName: string,
  args: string[],
  onLog?: (msg: string, level: string) => void,
  options?: { interactive?: boolean; timeout?: number }
): Promise<{ exitCode: number; result: any; logs: string[] }> {
  const timeout = options?.timeout ?? 120000  // Default 2 minutes
  
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', [
      '-ExecutionPolicy', 'Bypass',
      options?.interactive ? '' : '-NonInteractive',
      '-File', scriptPath,
      ...args
    ].filter(Boolean))
    
    let resolved = false
    const logs: string[] = []
    let result: any = null
    
    // Timeout handler
    const timeoutHandle = setTimeout(() => {
      if (resolved) return
      resolved = true
      
      // Force kill the process tree
      try {
        spawn('taskkill', ['/F', '/T', '/PID', ps.pid.toString()])
      } catch { /* ignore */ }
      
      reject(new Error(`PowerShell script timed out after ${timeout}ms: ${scriptName}`))
    }, timeout)
    
    ps.stdout.on('data', (chunk) => {
      const lines = chunk.toString().split('\n')
      for (const line of lines) {
        if (line.startsWith('LOG:')) {
          const match = line.match(/^LOG:\[(\w+)\]\s*(.*)/)
          if (match) {
            const [, level, msg] = match
            logs.push(`[${level}] ${msg}`)
            onLog?.(msg, level)
          }
        } else if (line.startsWith('RESULT:')) {
          try {
            result = JSON.parse(line.substring(7))
          } catch { /* ignore malformed */ }
        }
      }
    })
    
    ps.stderr.on('data', (chunk) => {
      logs.push(`[STDERR] ${chunk.toString()}`)
    })
    
    ps.on('close', (code) => {
      if (resolved) return  // Timeout already fired
      resolved = true
      clearTimeout(timeoutHandle)
      resolve({ exitCode: code ?? -1, result, logs })
    })
    
    ps.on('error', (err) => {
      if (resolved) return
      resolved = true
      clearTimeout(timeoutHandle)
      reject(err)
    })
  })
}
```

### Timeout Configuration per Script

**In `ai-agent.ts` (tool execution):**

```typescript
const SCRIPT_TIMEOUTS = {
  'Search-Winget.ps1': 60_000,         // 60s
  'Search-Chocolatey.ps1': 60_000,     // 60s
  'Get-LatestVersion.ps1': 30_000,     // 30s
  'Download-File.ps1': 300_000,        // 5 minutes
  'Build-Package.ps1': 180_000,        // 3 minutes
  'Upload-App.ps1': 600_000,           // 10 minutes
  'New-Win32App.ps1': 60_000,          // 60s
  'Get-IntuneApps.ps1': 120_000,       // 2 minutes
  'Get-IntuneDevices.ps1': 120_000,    // 2 minutes
  'Connect-Tenant.ps1': 300_000,       // 5 minutes (includes browser login)
} as const

async function executeToolCall(toolName: string, input: any, ...) {
  switch (toolName) {
    case 'download_app': {
      const result = await runPsScript('Download-File.ps1', args, onLog, {
        timeout: SCRIPT_TIMEOUTS['Download-File.ps1']
      })
      // ...
    }
    // ... other cases
  }
}
```

### Error Handling in UI

**Deploy.tsx:**

```typescript
useEffect(() => {
  const onJobError = (_: any, data: { jobId: string; error: string; phase: string }) => {
    if (data.jobId !== jobId) return
    
    let userMessage = data.error
    
    // Timeout-specific messaging
    if (data.error.includes('timed out')) {
      userMessage = `Operation timed out. The script took too long to complete. 
                     This may be due to network issues or a hung process.`
    }
    
    setError(userMessage)
    setPhase('error')
  }
  
  window.electron.on('job:error', onJobError)
  return () => window.electron.off('job:error', onJobError)
}, [jobId])
```

## Acceptance Criteria

- [ ] `runPsScript` accepts optional `timeout` parameter (milliseconds)
- [ ] Default timeout: 120s (2 minutes)
- [ ] On timeout: PS process is killed via `taskkill /F /T`
- [ ] On timeout: Promise rejects with clear error message
- [ ] `executeToolCall` in `ai-agent.ts` uses script-specific timeouts
- [ ] Timeout errors display user-friendly message in Deploy page
- [ ] TypeScript: 0 compile errors
- [ ] Test: manually trigger timeout (add `Start-Sleep 200` to a script)
- [ ] Peer review: PASS

## Testing Plan

### Test 1: Short Timeout Trigger
1. Add `Start-Sleep -Seconds 10` to `Search-Winget.ps1`
2. Set timeout to 5000ms (5 seconds)
3. Run a deployment
4. Verify: after 5s, job shows error "Script timed out after 5000ms"
5. Verify: `powershell.exe` process no longer in Task Manager

### Test 2: Normal Operation Under Timeout
1. Deploy an app normally (timeout: 300s for download)
2. Verify: completes successfully before timeout
3. Check logs: no timeout-related messages

### Test 3: Large Download
1. Deploy an app with 500MB installer
2. Timeout: 600s (10 minutes)
3. Verify: completes successfully (may take 3-5 minutes)

### Test 4: Process Tree Cleanup
1. Create a script that spawns child processes
2. Trigger timeout
3. Verify: parent + all child processes terminated

## Dependencies

- Windows `taskkill.exe` command (standard on all Windows)
- Node.js `child_process.spawn` (already in use)

## Migration Notes

**Breaking change:** Existing long-running operations may now timeout.
- **Mitigation:** Timeouts are generous (5-10 minutes for slow operations)
- **Escape hatch:** User can increase timeout in Settings (future enhancement)

## Out of Scope

- **User-configurable timeouts in UI** — fixed per-script defaults for now
- **Retry logic** — timeout is terminal; no auto-retry
- **Progress indicators** — PS scripts don't report % progress (future: add progress protocol)

## References

- Node.js `child_process.spawn`: https://nodejs.org/api/child_process.html#child_processspawncommand-args-options
- Windows `taskkill` command: https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill
