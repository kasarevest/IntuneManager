/**
 * version.ts — version string comparison for App Catalog update detection.
 *
 * Handles:
 *   - Standard semver-ish  "1.2.3" / "1.2.3.4"
 *   - v-prefix             "v132.0.6834.83"
 *   - Pre-release suffix   "1.2.3-beta", "1.2.3+build"
 *   - 8-digit date format  "20241201" (YYYYMMDD) — used by some Microsoft apps
 *   - Quad-part            "132.0.6834.83" — Chromium-based (Edge, Chrome)
 *   - Mixed triple/quad    "3.2.1" vs "3.2.1.0" → treated as equal
 */

export type VersionResult = 'current' | 'update-available' | 'unknown'

/** Strip leading "v"/"V" and any pre-release/build metadata suffix. */
function normalise(v: string): string {
  return v.trim()
    .replace(/^v/i, '')      // "v1.2.3"     → "1.2.3"
    .replace(/[-+].*$/, '')  // "1.2.3-beta"  → "1.2.3"
}

/** An 8-digit all-numeric string is treated as YYYYMMDD. */
function isDateVersion(s: string): boolean {
  return /^\d{8}$/.test(s)
}

/**
 * Compare two version strings.
 *
 * @param latest  Version reported by winget / external source
 * @param intune  Version stored in the Intune app record
 */
export function compareVersions(latest: string, intune: string): VersionResult {
  try {
    const l = normalise(latest)
    const i = normalise(intune)

    // Both 8-digit date versions — compare as integers
    if (isDateVersion(l) && isDateVersion(i)) {
      const ln = parseInt(l, 10)
      const iv = parseInt(i, 10)
      if (ln > iv) return 'update-available'
      if (ln < iv) return 'current'
      return 'current'
    }

    // Mixed: one is date-based, the other is not — cannot reliably compare
    if (isDateVersion(l) !== isDateVersion(i)) {
      return 'unknown'
    }

    // Dot-separated numeric comparison — handles 2-, 3-, and 4-part versions
    const parse = (v: string): number[] => v.split('.').map(n => parseInt(n, 10) || 0)
    const lv = parse(l)
    const iv2 = parse(i)
    const len = Math.max(lv.length, iv2.length)

    for (let j = 0; j < len; j++) {
      const lp = lv[j] ?? 0
      const ip = iv2[j] ?? 0
      if (lp > ip) return 'update-available'
      if (lp < ip) return 'current'
    }

    return 'current'
  } catch {
    return 'unknown'
  }
}
