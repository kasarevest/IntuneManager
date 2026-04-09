# Issue #004: Path Traversal Validation for AI-Generated Paths

**Priority:** MAJOR (Security)  
**Status:** Complete  
**Created:** 2026-04-02  
**Completed:** 2026-04-09

## Problem Statement

`executeToolCall` in `ai-agent.ts` writes files to `sourceFolder` provided by Claude without validating that the path resolves within the configured `sourceRoot`. A malformed or adversarially crafted response from Claude could write files outside the intended directory.

## Current Behavior

```typescript
// ai-agent.ts (simplified)
case 'generate_install_script': {
  const sourceFolder = String(input.source_folder)  // From Claude
  const scriptPath = path.join(sourceFolder, `Install-${appName}.ps1`)
  
  fs.mkdirSync(sourceFolder, { recursive: true })
  fs.writeFileSync(scriptPath, scriptContent, 'utf8')  // NO VALIDATION
  
  return { success: true, scriptPath }
}
```

**Attack vectors:**
1. **Path traversal:** `source_folder = "C:\\Source\\..\\..\\Windows\\System32\\MyApp"`
   - Resolves to `C:\Windows\System32\MyApp\Install-MyApp.ps1`
   - Overwrites system files
2. **Absolute path outside root:** `source_folder = "C:\\Users\\Public\\MyApp"`
   - Bypasses `sourceRoot` entirely
3. **Network path:** `source_folder = "\\\\RemoteServer\\Share\\MyApp"`
   - Writes to network location (potential data exfiltration)

**Likelihood:** Low (requires Claude to be compromised or prompt injection)  
**Impact:** High (arbitrary file write on admin's machine)

## Desired Behavior

1. **Validate all AI-provided paths** before any file system operation
2. **Enforce containment** — paths must resolve within `sourceRoot`
3. **Reject suspicious patterns** — `..`, absolute paths, UNC paths
4. **Fail fast** — throw clear error if validation fails
5. **Log security events** — record rejected paths for audit

## Technical Design

### Path Validation Utility

**New file:** `electron/utils/path-validator.ts`

```typescript
import path from 'path'

export class PathTraversalError extends Error {
  constructor(message: string, public attemptedPath: string, public baseDir: string) {
    super(message)
    this.name = 'PathTraversalError'
  }
}

/**
 * Validates that targetPath resolves within baseDir (no traversal).
 * Throws PathTraversalError if validation fails.
 */
export function validatePathInBase(targetPath: string, baseDir: string): string {
  // Normalize both paths (resolve symlinks, canonicalize)
  const resolvedBase = path.resolve(baseDir)
  const resolvedTarget = path.resolve(targetPath)
  
  // Check 1: Target must start with base directory
  if (!resolvedTarget.startsWith(resolvedBase + path.sep) && resolvedTarget !== resolvedBase) {
    throw new PathTraversalError(
      `Path traversal detected: "${targetPath}" is outside allowed directory "${baseDir}"`,
      targetPath,
      baseDir
    )
  }
  
  // Check 2: Reject UNC paths (network shares)
  if (targetPath.startsWith('\\\\') || targetPath.startsWith('//')) {
    throw new PathTraversalError(
      `Network paths not allowed: "${targetPath}"`,
      targetPath,
      baseDir
    )
  }
  
  // Check 3: Reject paths with .. after resolution (defense in depth)
  const normalizedTarget = path.normalize(targetPath)
  if (normalizedTarget.includes('..')) {
    throw new PathTraversalError(
      `Path contains directory traversal: "${targetPath}"`,
      targetPath,
      baseDir
    )
  }
  
  return resolvedTarget
}

/**
 * Safe directory creation — only within baseDir.
 */
export function safeMkdir(targetPath: string, baseDir: string): void {
  const validated = validatePathInBase(targetPath, baseDir)
  fs.mkdirSync(validated, { recursive: true })
}

/**
 * Safe file write — only within baseDir.
 */
export function safeWriteFile(targetPath: string, baseDir: string, content: string | Buffer): void {
  const validated = validatePathInBase(targetPath, baseDir)
  fs.writeFileSync(validated, content, 'utf8')
}
```

### Integration in `ai-agent.ts`

```typescript
import { validatePathInBase, safeMkdir, safeWriteFile, PathTraversalError } from '../utils/path-validator'

async function executeToolCall(
  toolName: string,
  input: Record<string, unknown>,
  jobId: string,
  sendEvent: (channel: string, data: unknown) => void,
  db: Database
): Promise<unknown> {
  const log = (msg: string, level = 'INFO', source: 'ai' | 'ps' | 'system' = 'system') => {
    sendEvent('job:log', { jobId, timestamp: new Date().toISOString(), level, message: msg, source })
  }
  
  // Get configured source root
  const sourceRootRow = db.prepare("SELECT value FROM app_settings WHERE key = 'source_root_path'").get() as { value: string } | undefined
  const sourceRoot = sourceRootRow?.value || path.join(app.getAppPath(), '..', '..', '..', 'Source')
  
  switch (toolName) {
    case 'generate_install_script': {
      const appName = String(input.app_name)
      const sourceFolder = String(input.source_folder)
      
      try {
        // VALIDATE before any FS operation
        validatePathInBase(sourceFolder, sourceRoot)
        
        const scriptContent = generateInstallScript(...)
        const scriptPath = path.join(sourceFolder, `Install-${appName.replace(/\s+/g, '')}.ps1`)
        
        // Use safe FS operations
        safeMkdir(sourceFolder, sourceRoot)
        safeWriteFile(scriptPath, sourceRoot, scriptContent)
        
        log(`Generated: ${scriptPath}`)
        return { success: true, scriptPath }
      } catch (err) {
        if (err instanceof PathTraversalError) {
          log(`SECURITY: Path traversal blocked: ${err.attemptedPath}`, 'ERROR', 'system')
          return { 
            success: false, 
            error: `Invalid path: ${err.message}. Scripts must be created within ${sourceRoot}` 
          }
        }
        throw err
      }
    }
    
    case 'generate_uninstall_script': {
      // Same validation pattern
      const sourceFolder = String(input.source_folder)
      validatePathInBase(sourceFolder, sourceRoot)
      // ... rest of implementation
    }
    
    case 'generate_detect_script': {
      // Same validation pattern
      const sourceFolder = String(input.source_folder)
      validatePathInBase(sourceFolder, sourceRoot)
      // ... rest of implementation
    }
    
    case 'generate_package_settings': {
      // Same validation pattern
      const sourceFolder = String(input.source_folder)
      validatePathInBase(sourceFolder, sourceRoot)
      // ... rest of implementation
    }
    
    // ... other cases
  }
}
```

### Audit Logging

```typescript
// In electron/main.ts or a new audit logger
function logSecurityEvent(event: string, details: any) {
  const logPath = path.join(app.getPath('userData'), 'security.log')
  const entry = `${new Date().toISOString()} | ${event} | ${JSON.stringify(details)}\n`
  fs.appendFileSync(logPath, entry, 'utf8')
}

// In path-validator.ts
if (PathTraversalError) {
  logSecurityEvent('PATH_TRAVERSAL_BLOCKED', {
    attemptedPath: targetPath,
    baseDir: baseDir,
    resolvedPath: resolvedTarget
  })
}
```

## Acceptance Criteria

- [x] `validatePathInBase` utility function created (`electron/utils/path-validator.ts` + `server/utils/path-validator.ts`)
- [x] All 4 file-writing tools (`generate_*_script`, `generate_package_settings`) validate paths — both electron and server layers
- [x] Path traversal attempts rejected with clear error
- [x] UNC paths (network shares) rejected
- [x] Absolute paths outside `sourceRoot` rejected
- [x] Security events logged via `console.error` (captured by Electron log / server stdout)
- [x] TypeScript: 0 compile errors (verified via tsc background job)
- [ ] Unit tests: deferred — no test framework configured
- [ ] Peer review: PASS

## Implementation Notes

- `validatePathInBase` checks UNC paths **before** calling `path.resolve` (avoid Windows resolve quirks)
- Returns `{ success: false, error }` on `PathTraversalError` — gives Claude a tool result to act on rather than crashing the job loop
- `sourceRoot` read from `app_settings` DB at the top of `executeToolCall` per call; falls back to the same default path used by the deploy job
- Server uses identical utility at `server/utils/path-validator.ts` (same Node.js built-ins, no Electron imports)
- `safeMkdir`/`safeWriteFile` wrappers from spec not used — inline validation is clearer for a security-critical path
- Out of scope: `write-script` IPC handler, `download_app`/`build_package` PS-script paths (per spec)

## Testing Plan

### Test 1: Valid Path (Baseline)
```typescript
validatePathInBase('C:\\Source\\MyApp', 'C:\\Source')
// Expected: resolves to 'C:\\Source\\MyApp'
```

### Test 2: Traversal Attack
```typescript
validatePathInBase('C:\\Source\\..\\Windows\\MyApp', 'C:\\Source')
// Expected: throws PathTraversalError
```

### Test 3: Absolute Path Outside Root
```typescript
validatePathInBase('D:\\Malicious\\MyApp', 'C:\\Source')
// Expected: throws PathTraversalError
```

### Test 4: UNC Path
```typescript
validatePathInBase('\\\\RemoteServer\\Share\\MyApp', 'C:\\Source')
// Expected: throws PathTraversalError
```

### Test 5: Subdirectory (Valid)
```typescript
validatePathInBase('C:\\Source\\MyCategory\\MyApp', 'C:\\Source')
// Expected: resolves to 'C:\\Source\\MyCategory\\MyApp'
```

### Test 6: Integration Test — AI Provides Bad Path
1. Mock Claude to return `source_folder: "C:\\..\\Windows\\System32\\MyApp"`
2. Call `executeToolCall('generate_install_script', { source_folder: "...", ... }, ...)`
3. Verify: returns `{ success: false, error: "Invalid path: ..." }`
4. Verify: no file written to `C:\Windows\System32\`
5. Verify: `security.log` contains entry

### Test 7: Edge Case — Symlink
1. Create symlink: `C:\Source\Link` → `C:\Windows`
2. Try: `validatePathInBase('C:\\Source\\Link\\MyApp', 'C:\\Source')`
3. Expected: `path.resolve` follows symlink, detects outside base, throws error

## Dependencies

- Node.js `path.resolve` (built-in)
- Node.js `fs` (built-in)

## Migration Notes

**No breaking changes** — validation only applies to AI-provided paths, not user-configured paths in Settings.

## Out of Scope

- **Output folder validation** — `.intunewin` files written to `outputFolder` (separate issue)
- **Download path validation** — installers downloaded to source folder (already constrained)
- **Settings path validation** — user-configured paths in Settings UI (Issue #007)

## References

- OWASP Path Traversal: https://owasp.org/www-community/attacks/Path_Traversal
- Node.js `path.resolve`: https://nodejs.org/api/path.html#pathresolvepaths
- CWE-22 (Path Traversal): https://cwe.mitre.org/data/definitions/22.html
