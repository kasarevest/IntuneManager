# Issue #006: Non-Semver Version Comparison Support

**Priority:** MAJOR (Feature Gap)  
**Status:** ✅ Completed  
**Created:** 2026-04-02  
**Completed:** 2026-04-10

## Problem Statement

`compareVersions` in `src/hooks/useAppCatalog.ts` silently returns `'unknown'` for non-semver version strings. Apps with date-based versions (e.g. `20241201.1`) or build-stamp versions (e.g. `1.0.0.12345-beta`) will never show an "Update Available" badge, even when they are genuinely outdated.

## Current Behavior

```typescript
function compareVersions(v1: string, v2: string): 'current' | 'outdated' | 'unknown' {
  try {
    const semver1 = new SemVer(v1)
    const semver2 = new SemVer(v2)
    if (semver1.compare(semver2) < 0) return 'outdated'
    return 'current'
  } catch {
    return 'unknown'  // Any parse error → unknown
  }
}
```

**Examples that fail:**
- Date-based: `20241201` vs `20250101` → `unknown` (should be `outdated`)
- Quad-part: `1.0.0.12345` vs `1.0.0.12400` → `unknown` (should be `outdated`)
- CalVer: `2024.12.1` vs `2025.1.1` → `unknown` (should be `outdated`)
- Chromium-style: `132.0.6834.83` vs `133.0.6846.0` → works (lucky — fits semver)

**Impact:**
- Microsoft Edge, Chromium, Slack, Discord, Teams — all use non-semver versions
- Users don't see update prompts even when apps are months out of date
- "Update All" misses these apps entirely

## Desired Behavior

1. **Detect version format** — date, quad-part, triple-part, semver
2. **Parse intelligently** — convert to comparable format
3. **Compare lexically** when semantic comparison not possible
4. **Fall back to `unknown`** only when truly unparseable (e.g. "v1.0-stable-final")

## Technical Design

### Enhanced Version Comparison

**Updated function in `useAppCatalog.ts`:**

```typescript
type VersionFormat = 'semver' | 'date' | 'quad' | 'triple' | 'lexical' | 'unknown'

interface ParsedVersion {
  format: VersionFormat
  parts: number[]
  raw: string
}

function parseVersion(v: string): ParsedVersion {
  // Strip common prefixes/suffixes
  const cleaned = v.trim().replace(/^v/, '').split(/[-_+]/)[0]
  
  // Try date format: YYYYMMDD or YYYY.MM.DD
  if (/^\d{8}$/.test(cleaned)) {
    const year = parseInt(cleaned.substring(0, 4))
    const month = parseInt(cleaned.substring(4, 6))
    const day = parseInt(cleaned.substring(6, 8))
    if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { format: 'date', parts: [year, month, day], raw: v }
    }
  }
  
  // Try numeric parts (1.2.3 or 1.2.3.4)
  const parts = cleaned.split('.').map(p => parseInt(p, 10))
  if (parts.every(p => !isNaN(p) && p >= 0)) {
    if (parts.length === 4) return { format: 'quad', parts, raw: v }
    if (parts.length === 3) return { format: 'triple', parts, raw: v }
    if (parts.length === 2) return { format: 'triple', parts: [...parts, 0], raw: v }
  }
  
  // Try semver (may have prerelease tags)
  try {
    const semver = new SemVer(v)
    return { 
      format: 'semver', 
      parts: [semver.major, semver.minor, semver.patch], 
      raw: v 
    }
  } catch { /* not semver */ }
  
  // Fallback: lexical comparison
  return { format: 'lexical', parts: [], raw: v }
}

function compareVersions(v1: string, v2: string): 'current' | 'outdated' | 'unknown' {
  if (!v1 || !v2) return 'unknown'
  
  const p1 = parseVersion(v1)
  const p2 = parseVersion(v2)
  
  // If formats don't match, fall back to lexical or unknown
  if (p1.format !== p2.format) {
    // Allow triple vs quad comparison (pad shorter)
    if ((p1.format === 'triple' || p1.format === 'quad') && 
        (p2.format === 'triple' || p2.format === 'quad')) {
      const maxLen = Math.max(p1.parts.length, p2.parts.length)
      const parts1 = [...p1.parts, ...Array(maxLen - p1.parts.length).fill(0)]
      const parts2 = [...p2.parts, ...Array(maxLen - p2.parts.length).fill(0)]
      return compareParts(parts1, parts2)
    }
    
    // Lexical fallback for mismatched formats
    if (p1.format === 'lexical' || p2.format === 'lexical') {
      return p1.raw.localeCompare(p2.raw) < 0 ? 'outdated' : 'current'
    }
    
    return 'unknown'
  }
  
  // Same format — compare parts
  if (p1.format === 'date' || p1.format === 'quad' || p1.format === 'triple' || p1.format === 'semver') {
    return compareParts(p1.parts, p2.parts)
  }
  
  // Lexical comparison
  if (p1.format === 'lexical') {
    const cmp = p1.raw.localeCompare(p2.raw)
    if (cmp < 0) return 'outdated'
    if (cmp > 0) return 'current'
    return 'current'  // Equal
  }
  
  return 'unknown'
}

function compareParts(parts1: number[], parts2: number[]): 'current' | 'outdated' | 'unknown' {
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const a = parts1[i] ?? 0
    const b = parts2[i] ?? 0
    if (a < b) return 'outdated'
    if (a > b) return 'current'
  }
  return 'current'  // Equal
}
```

### Unit Tests

**New file:** `src/utils/version-compare.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { compareVersions } from './version-compare'

describe('compareVersions', () => {
  it('handles standard semver', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBe('outdated')
    expect(compareVersions('1.1.0', '1.0.9')).toBe('current')
    expect(compareVersions('2.0.0', '2.0.0')).toBe('current')
  })
  
  it('handles date-based versions', () => {
    expect(compareVersions('20241201', '20250101')).toBe('outdated')
    expect(compareVersions('20250201', '20250101')).toBe('current')
  })
  
  it('handles quad-part versions', () => {
    expect(compareVersions('1.0.0.12345', '1.0.0.12400')).toBe('outdated')
    expect(compareVersions('132.0.6834.83', '133.0.6846.0')).toBe('outdated')
  })
  
  it('handles triple vs quad comparison', () => {
    expect(compareVersions('1.0.0', '1.0.0.1')).toBe('outdated')
    expect(compareVersions('1.0.1', '1.0.0.9999')).toBe('current')
  })
  
  it('handles prefixes', () => {
    expect(compareVersions('v1.0.0', 'v1.0.1')).toBe('outdated')
  })
  
  it('handles prerelease tags', () => {
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBe('outdated')
  })
  
  it('returns unknown for unparseable versions', () => {
    expect(compareVersions('stable', 'latest')).toBe('unknown')
    expect(compareVersions('v1-final', 'v2-final')).toBe('unknown')
  })
})
```

## Acceptance Criteria

- [ ] `compareVersions` detects date, quad, triple, semver formats
- [ ] Date-based versions compared correctly (e.g. `20241201` vs `20250101`)
- [ ] Quad-part versions compared correctly (e.g. `132.0.6834.83`)
- [ ] Triple vs quad comparison works (pad with zeros)
- [ ] Lexical fallback for truly unparseable versions
- [ ] Unit tests: 15+ test cases covering all formats
- [ ] Apps like Edge, Chromium, Teams now show "Update Available" when outdated
- [ ] TypeScript: 0 compile errors
- [ ] Peer review: PASS

## Testing Plan

### Test 1: Date-Based App (Microsoft Edge)
1. Intune version: `20241115.1`
2. Winget latest: `20250201.1`
3. Expected: "Update Available" badge shown

### Test 2: Quad-Part App (Chromium)
1. Intune version: `132.0.6834.83`
2. Winget latest: `133.0.6846.0`
3. Expected: "Update Available" badge shown

### Test 3: Semver App (7-Zip)
1. Intune version: `24.07`
2. Winget latest: `24.08`
3. Expected: "Update Available" badge shown (regression test)

### Test 4: Unparseable Version
1. Intune version: `stable-2024`
2. Winget latest: `latest-2025`
3. Expected: "Unknown" badge (no comparison possible)

## Edge Cases

**CalVer formats:**
- `2024.12.1` → triple-part (works)
- `24.12.1` → triple-part (works, but year ambiguous)
- `2024w52` → lexical fallback

**Mixed formats:**
- `1.0.0` (Intune) vs `2024.01.01` (winget) → unknown (incompatible)

## Dependencies

None — pure TypeScript logic

## Migration Notes

No breaking changes. Existing semver apps unchanged. Non-semver apps get upgrade from `unknown` → `outdated`/`current`.

## Out of Scope

- **User-provided comparison rules** — e.g. "treat build numbers as patch"
- **Prerelease ordering** — beta < rc < stable (already handled by semver library)
- **Version aliases** — e.g. "latest" → actual version lookup

## References

- Semantic Versioning: https://semver.org/
- Calendar Versioning (CalVer): https://calver.org/
- Chromium Version Numbers: https://www.chromium.org/developers/version-numbers/
