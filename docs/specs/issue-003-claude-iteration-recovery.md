# Issue #003: Claude 20-Iteration Limit Recovery

**Priority:** BLOCKING (Technical)  
**Status:** ✅ Completed  
**Created:** 2026-04-02  
**Completed:** 2026-04-10

## Problem Statement

`runDeployJob` and `runPackageOnlyJob` have a 20-iteration cap on Claude tool-use loops. If Claude uses all 20 iterations without completing (e.g. due to persistent tool error), the job throws `'Maximum tool iterations reached (20). Deployment may be incomplete.'`. The `.intunewin` may or may not have been built. Partial state (downloaded files, written scripts) is left on disk with no cleanup and no indication of what succeeded.

## Current Behavior

```typescript
// ai-agent.ts (simplified)
let iterations = 0
while (iterations++ < 20) {
  const response = await anthropic.messages.create({ /* ... */ })
  
  for (const block of response.content) {
    if (block.type === 'tool_use') {
      const result = await executeToolCall(block.name, block.input, ...)
      // Tool may fail repeatedly, consuming iterations
    }
  }
  
  if (response.stop_reason === 'end_turn') break
}

if (iterations >= 20) {
  throw new Error('Maximum tool iterations reached (20). Deployment may be incomplete.')
}
```

**Scenarios that trigger 20-iteration limit:**
1. **Download URL 404** — Claude retries with different URLs, burns 10+ iterations
2. **SHA256 mismatch** — Downloaded file corrupt, Claude re-downloads, repeats
3. **Installer type misdetection** — MSI flags don't work, Claude tries EXE flags, repeats
4. **Graph API 400** — Malformed request body, Claude retries with variations
5. **IntuneWinAppUtil.exe not found** — Build fails, Claude tries alternate paths

**Impact:**
- User sees vague error: "Deployment may be incomplete"
- No indication of what step failed or why
- Partial files left in `Source/AppName/` and `Output/` folders
- Must manually inspect logs to determine state
- Cannot resume — must start over from step 1

## Desired Behavior

1. **Log final Claude message** before throwing, so admin knows where it stopped
2. **Capture partial progress** — which steps completed successfully
3. **Checkpoint partial state** — save metadata so job can resume later (future)
4. **Cleanup partial artifacts** — optionally delete incomplete source folder
5. **Explicit error taxonomy** — categorize failure (download, build, upload, etc.)

## Technical Design

### Enhanced Error Context

```typescript
interface PartialJobState {
  appName: string
  sourceFolder: string | null
  scriptsGenerated: string[]  // ['Install-App.ps1', 'Detect-App.ps1', ...]
  installerDownloaded: boolean
  packageBuilt: boolean
  intunewinPath: string | null
  lastSuccessfulStep: string
  lastFailedStep: string | null
  finalClaudeMessage: string
}
```

### Track Progress During Loop

```typescript
async function runDeployJob(...) {
  const state: PartialJobState = {
    appName: '',
    sourceFolder: null,
    scriptsGenerated: [],
    installerDownloaded: false,
    packageBuilt: false,
    intunewinPath: null,
    lastSuccessfulStep: 'none',
    lastFailedStep: null,
    finalClaudeMessage: ''
  }
  
  let iterations = 0
  while (iterations++ < 20) {
    const response = await anthropic.messages.create({ ... })
    
    // Capture final Claude text before potential exit
    for (const block of response.content) {
      if (block.type === 'text') {
        state.finalClaudeMessage = block.text
      }
    }
    
    messages.push({ role: 'assistant', content: response.content })
    
    if (response.stop_reason === 'end_turn') {
      setPhase('done')
      sendEvent('job:complete', { jobId })
      return  // Success path
    }
    
    const toolResults: Anthropic.ToolResultBlockParam[] = []
    
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue
      
      const phase = PHASE_MAP[block.name] ?? 'analyzing'
      setPhase(phase)
      log(`Tool: ${block.name}`, 'INFO', 'system')
      
      try {
        const result = await executeToolCall(block.name, block.input, ...)
        
        // Track successful steps
        if (block.name === 'download_app' && result.success) {
          state.installerDownloaded = true
          state.lastSuccessfulStep = 'download_app'
        }
        if (block.name === 'generate_install_script' && result.success) {
          state.scriptsGenerated.push('Install-' + state.appName + '.ps1')
          state.lastSuccessfulStep = 'generate_install_script'
        }
        if (block.name === 'build_package' && result.success) {
          state.packageBuilt = true
          state.intunewinPath = result.intunewinPath
          state.lastSuccessfulStep = 'build_package'
        }
        
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) })
      } catch (err) {
        const errMsg = (err as Error).message
        state.lastFailedStep = block.name
        log(`Tool ${block.name} failed: ${errMsg}`, 'ERROR', 'system')
        toolResults.push({ 
          type: 'tool_result', 
          tool_use_id: block.id, 
          content: JSON.stringify({ success: false, error: errMsg }), 
          is_error: true 
        })
      }
    }
    
    messages.push({ role: 'user', content: toolResults })
  }
  
  // 20-iteration limit reached — enhanced error
  const errorMessage = buildIterationLimitError(state, messages)
  log(errorMessage, 'ERROR', 'system')
  throw new Error(errorMessage)
}

function buildIterationLimitError(state: PartialJobState, messages: Anthropic.MessageParam[]): string {
  const steps = [
    state.installerDownloaded ? '✓ Installer downloaded' : '✗ Installer download failed',
    state.scriptsGenerated.length > 0 ? `✓ Scripts generated (${state.scriptsGenerated.length})` : '✗ No scripts generated',
    state.packageBuilt ? '✓ Package built' : '✗ Package build failed',
  ].join('\n')
  
  return `Maximum Claude iterations reached (20). Partial progress:

${steps}

Last successful step: ${state.lastSuccessfulStep}
Last failed step: ${state.lastFailedStep ?? 'unknown'}

Claude's final message:
${state.finalClaudeMessage}

Full conversation contains ${messages.length} messages. Check logs for details.`
}
```

### Cleanup Option

```typescript
// After iteration limit error, optionally delete partial source folder
function cleanupPartialDeployment(state: PartialJobState) {
  if (!state.sourceFolder) return
  
  // Only delete if nothing was successfully built
  if (!state.packageBuilt && fs.existsSync(state.sourceFolder)) {
    log(`Cleaning up incomplete deployment at ${state.sourceFolder}`)
    fs.rmSync(state.sourceFolder, { recursive: true, force: true })
  }
}
```

### UI Presentation

**Deploy.tsx error display:**

```typescript
const onJobError = (_: any, data: { jobId: string; error: string; phase: string }) => {
  if (data.jobId !== jobId) return
  
  // Parse structured error
  if (data.error.includes('Maximum Claude iterations')) {
    const lines = data.error.split('\n')
    const progressSection = lines.slice(1, 5).join('\n')  // Extract progress lines
    
    setError({
      title: 'Deployment did not complete',
      summary: 'Claude reached the maximum iteration limit (20 tool calls).',
      details: progressSection,
      suggestion: 'Check the logs below for details. You may need to manually inspect the Source folder and retry.'
    })
  } else {
    setError({ title: 'Error', summary: data.error })
  }
  
  setPhase('error')
}
```

## Acceptance Criteria

- [ ] When 20-iteration limit reached, error message includes:
  - List of completed steps (✓ Downloaded, ✓ Scripts, ✗ Build)
  - Last successful step name
  - Last failed step name (if known)
  - Claude's final text message
- [ ] Error is logged to job log panel
- [ ] Partial source folder is NOT deleted (admin may want to inspect)
- [ ] TypeScript: 0 compile errors
- [ ] Test: artificially trigger iteration limit (reduce to 3 iterations)
- [ ] Peer review: PASS

## Testing Plan

### Test 1: Forced Iteration Limit
1. Edit `ai-agent.ts`: change `while (iterations++ < 20)` to `while (iterations++ < 3)`
2. Deploy an app that requires >3 iterations (complex app like "Visual Studio Code")
3. Verify: error message shows partial progress
4. Verify: logs show "Last successful step: download_app" or similar
5. Verify: source folder still exists (not deleted)

### Test 2: Normal Completion
1. Restore iteration limit to 20
2. Deploy a simple app (e.g. "7-Zip")
3. Verify: completes successfully in <10 iterations
4. Check logs: no iteration-limit warnings

### Test 3: Persistent Tool Failure
1. Temporarily break `download_app` tool (return 404 for all URLs)
2. Deploy an app
3. Verify: Claude retries multiple times
4. Verify: after 20 iterations, error shows "Last failed step: download_app"
5. Verify: Claude's reasoning visible in final message

## Future Enhancements (Out of Scope)

- **Resume from checkpoint** — save `PartialJobState` to DB, allow retry from last successful step
- **Dynamic iteration limit** — increase limit for complex apps, decrease for simple ones
- **User-configurable limit** — Settings → Advanced → "Max AI iterations"
- **Automatic cleanup toggle** — Settings checkbox: "Delete incomplete deployments"

## Dependencies

None — pure code changes

## Migration Notes

No breaking changes. Existing behavior unchanged; error messages improved.

## References

- Anthropic Messages API: https://docs.anthropic.com/en/api/messages
- Tool use iteration limits: https://docs.anthropic.com/en/docs/build-with-claude/tool-use
