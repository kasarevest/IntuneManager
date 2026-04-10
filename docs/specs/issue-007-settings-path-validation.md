# Issue #007: Settings Path Validation with Inline Feedback

**Priority:** Medium  
**Status:** ✅ Completed  
**Completed:** 2026-04-10  
**Created:** 2026-04-02

## Problem Statement

Settings → General → Paths (IntuneWinAppUtil, Source Root, Output Folder) require absolute paths but have no validation. If the admin enters a relative path or a path that doesn't exist, the error surfaces later during a build job. No inline feedback indicates whether the path is valid.

## Current Behavior

```typescript
// GeneralTab.tsx (simplified)
<input
  value={settings.intunewinToolPath}
  onChange={e => f('intunewinToolPath', e.target.value)}
  placeholder="C:\...\IntuneWinAppUtil.exe"
/>
```

**Problems:**
- User types `IntuneWinAppUtil.exe` (relative) → no immediate feedback
- User types `C:\DoesNotExist\tool.exe` → no warning
- User pastes UNC path `\\server\share\tool.exe` → may work but slow
- Error discovered only when deploying an app → "tool not found"

## Desired Behavior

1. **Real-time validation** — check path as user types (debounced 500ms)
2. **Inline visual feedback:**
   - ✅ Green checkmark: file/folder exists, absolute path
   - ⚠️ Yellow warning: file/folder doesn't exist but path valid
   - ❌ Red error: relative path or malformed
3. **Validation on blur** — check when user leaves field
4. **Block save** if any path is invalid (red error)
5. **Allow warnings** — user can save even if file doesn't exist yet

## Technical Design

### Path Validation Utility

**New file:** `src/utils/path-validator.ts`

```typescript
export interface PathValidation {
  isValid: boolean
  exists: boolean
  isAbsolute: boolean
  message: string
  severity: 'error' | 'warning' | 'success'
}

export function validatePath(
  pathStr: string,
  type: 'file' | 'directory'
): PathValidation {
  if (!pathStr.trim()) {
    return {
      isValid: false,
      exists: false,
      isAbsolute: false,
      message: 'Path is required',
      severity: 'error'
    }
  }
  
  // Check if absolute (Windows: starts with drive letter or UNC)
  const isAbsolute = /^[A-Za-z]:\\/.test(pathStr) || /^\\\\/.test(pathStr)
  
  if (!isAbsolute) {
    return {
      isValid: false,
      exists: false,
      isAbsolute: false,
      message: 'Must be an absolute path (e.g. C:\\...)',
      severity: 'error'
    }
  }
  
  // For actual existence check, we need IPC to main process
  // This is a client-side pre-check; server-side check happens on save
  return {
    isValid: true,
    exists: false,  // Unknown client-side
    isAbsolute: true,
    message: 'Path format is valid',
    severity: 'success'
  }
}
```

### IPC Handler for Existence Check

**In `electron/ipc/settings.ts`:**

```typescript
ipcMain.handle('ipc:validate-path', async (_event, req: {
  path: string
  type: 'file' | 'directory'
}) => {
  try {
    const stat = fs.statSync(req.path)
    
    if (req.type === 'file' && !stat.isFile()) {
      return { exists: false, message: 'Path exists but is not a file' }
    }
    if (req.type === 'directory' && !stat.isDirectory()) {
      return { exists: false, message: 'Path exists but is not a directory' }
    }
    
    return { exists: true, message: 'Path exists and is valid' }
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return { exists: false, message: 'Path does not exist' }
    }
    return { exists: false, message: `Error checking path: ${err.message}` }
  }
})
```

### React Hook for Validation

**New hook:** `src/hooks/usePathValidation.ts`

```typescript
import { useState, useEffect } from 'react'
import { ipcValidatePath } from '../lib/ipc'
import { validatePath, type PathValidation } from '../utils/path-validator'

export function usePathValidation(
  path: string,
  type: 'file' | 'directory',
  debounceMs: number = 500
): PathValidation & { checking: boolean } {
  const [validation, setValidation] = useState<PathValidation>({
    isValid: true,
    exists: false,
    isAbsolute: true,
    message: '',
    severity: 'success'
  })
  const [checking, setChecking] = useState(false)
  
  useEffect(() => {
    // Client-side check (instant)
    const clientCheck = validatePath(path, type)
    if (!clientCheck.isValid) {
      setValidation(clientCheck)
      return
    }
    
    // Server-side existence check (debounced)
    setChecking(true)
    const timer = setTimeout(async () => {
      const res = await ipcValidatePath({ path, type })
      setValidation({
        isValid: true,
        exists: res.exists,
        isAbsolute: true,
        message: res.message,
        severity: res.exists ? 'success' : 'warning'
      })
      setChecking(false)
    }, debounceMs)
    
    return () => clearTimeout(timer)
  }, [path, type, debounceMs])
  
  return { ...validation, checking }
}
```

### Updated GeneralTab Component

```typescript
function PathInputWithValidation({
  label,
  value,
  onChange,
  type,
  placeholder
}: {
  label: string
  value: string
  onChange: (val: string) => void
  type: 'file' | 'directory'
  placeholder: string
}) {
  const { isValid, exists, message, severity, checking } = usePathValidation(value, type)
  
  const icon = checking ? '⏳' : 
    severity === 'success' ? '✅' : 
    severity === 'warning' ? '⚠️' : '❌'
  
  const borderColor = severity === 'success' ? 'var(--success)' : 
    severity === 'warning' ? 'var(--warning)' : 
    severity === 'error' ? 'var(--error)' : 'var(--border)'
  
  return (
    <div className="form-group">
      <label>{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ 
            borderColor,
            paddingRight: 32
          }}
        />
        <span style={{
          position: 'absolute',
          right: 8,
          top: '50%',
          transform: 'translateY(-50%)',
          fontSize: 16
        }}>
          {icon}
        </span>
      </div>
      {message && (
        <p style={{
          fontSize: 12,
          marginTop: 4,
          color: severity === 'error' ? 'var(--error)' : 
                 severity === 'warning' ? 'var(--warning)' : 
                 'var(--text-400)'
        }}>
          {message}
        </p>
      )}
    </div>
  )
}

export default function GeneralTab() {
  // ... existing state ...
  const [pathValidations, setPathValidations] = useState({
    tool: { isValid: true, severity: 'success' as const },
    source: { isValid: true, severity: 'success' as const },
    output: { isValid: true, severity: 'success' as const }
  })
  
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Block save if any path has error
    if (pathValidations.tool.severity === 'error' ||
        pathValidations.source.severity === 'error' ||
        pathValidations.output.severity === 'error') {
      setError('Fix invalid paths before saving.')
      return
    }
    
    // Allow warnings (file doesn't exist but path format valid)
    // ... rest of save logic
  }
  
  return (
    <form onSubmit={handleSave}>
      <div className="card">
        <h3>Paths</h3>
        
        <PathInputWithValidation
          label="IntuneWinAppUtil.exe Path"
          value={settings.intunewinToolPath}
          onChange={val => f('intunewinToolPath', val)}
          type="file"
          placeholder="C:\...\IntuneWinAppUtil.exe"
        />
        
        <PathInputWithValidation
          label="Source Root Folder"
          value={settings.sourceRootPath}
          onChange={val => f('sourceRootPath', val)}
          type="directory"
          placeholder="C:\...\Source"
        />
        
        <PathInputWithValidation
          label="Output Folder"
          value={settings.outputFolderPath}
          onChange={val => f('outputFolderPath', val)}
          type="directory"
          placeholder="C:\...\Output"
        />
      </div>
      
      <button type="submit" disabled={saving || /* any path invalid */}>
        {saving ? 'Saving...' : 'Save'}
      </button>
    </form>
  )
}
```

## Acceptance Criteria

- [ ] Path input fields show real-time validation feedback
- [ ] Green checkmark: file/folder exists
- [ ] Yellow warning: path valid but doesn't exist
- [ ] Red error: relative path or malformed
- [ ] Validation debounced 500ms (no IPC spam on every keystroke)
- [ ] Save button disabled if any red errors
- [ ] Save allowed with warnings (user can create folder later)
- [ ] TypeScript: 0 compile errors
- [ ] Peer review: PASS

## Testing Plan

### Test 1: Valid Existing Path
1. Enter: `C:\Windows\System32\notepad.exe` (IntuneWinAppUtil field)
2. Wait 500ms
3. Expected: Green checkmark, "Path exists and is valid"

### Test 2: Valid Non-Existent Path
1. Enter: `C:\DoesNotExist\tool.exe`
2. Wait 500ms
3. Expected: Yellow warning, "Path does not exist"
4. Verify: Save button enabled (warning allowed)

### Test 3: Invalid Relative Path
1. Enter: `tool.exe`
2. Expected: Immediate red error, "Must be an absolute path"
3. Verify: Save button disabled

### Test 4: Directory vs File Mismatch
1. Enter: `C:\Windows` (IntuneWinAppUtil field — expects file)
2. Wait 500ms
3. Expected: Yellow/red warning, "Path exists but is not a file"

### Test 5: Debounce
1. Rapidly type: `C:\W...i...n...d...o...w...s`
2. Expected: No IPC calls until 500ms after last keystroke

## Dependencies

- IPC handler: `ipc:validate-path`
- Node.js `fs.statSync` (main process only)

## Out of Scope

- **Auto-correction** — suggest `C:\` when user types `c:\`
- **Browse from validation error** — click ❌ to open file picker
- **Relative path resolution** — convert `.\tool.exe` → `C:\...\tool.exe`

## References

- Windows path validation: https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file
