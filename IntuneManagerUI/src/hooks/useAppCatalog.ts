import { useState, useCallback } from 'react'
import type { AppRow } from '../types/app'
import { ipcPsGetIntuneApps, ipcPsGetPackageSettings, ipcPsGetLatestVersion } from '../lib/ipc'

function compareVersions(latest: string, intune: string): 'current' | 'update-available' | 'unknown' {
  try {
    const parse = (v: string) => v.trim().split('.').map(n => parseInt(n, 10) || 0)
    const lv = parse(latest)
    const iv = parse(intune)
    const len = Math.max(lv.length, iv.length)
    for (let i = 0; i < len; i++) {
      const l = lv[i] ?? 0
      const c = iv[i] ?? 0
      if (l > c) return 'update-available'
      if (l < c) return 'current'
    }
    return 'current'
  } catch {
    return 'unknown'
  }
}

export function useAppCatalog() {
  const [apps, setApps] = useState<AppRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSync, setLastSync] = useState<Date | null>(null)

  const sync = useCallback(async (sourceRootPath?: string) => {
    setLoading(true)
    setError(null)

    try {
      // Phase 1: fetch apps from Intune and render immediately
      const res = await ipcPsGetIntuneApps()
      if (!res.success) {
        setError(res.error ?? 'Failed to load apps')
        return
      }

      const intuneApps: AppRow[] = ((res.apps ?? []) as Array<Record<string, unknown>>).map(a => ({
        id: String(a.id ?? ''),
        displayName: String(a.displayName ?? ''),
        displayVersion: String(a.displayVersion ?? ''),
        publishingState: String(a.publishingState ?? ''),
        lastModifiedDateTime: String(a.lastModifiedDateTime ?? ''),
        status: 'cloud-only' as const,
        versionChecking: true
      }))

      setApps(intuneApps)
      setLastSync(new Date())
      setLoading(false)

      // Phase 2: for each app, get local package settings (wingetId) then fetch winget latest version
      // Process concurrently but update the row as each one resolves
      await Promise.all(intuneApps.map(async (app) => {
        try {
          // Step A: get wingetId from local PACKAGE_SETTINGS.md
          const settingsRes = await ipcPsGetPackageSettings(app.displayName, sourceRootPath)
          if (!settingsRes?.success || !settingsRes.wingetId) {
            // No local package info — stay as cloud-only, stop checking
            setApps(prev => prev.map(a => a.id === app.id
              ? { ...a, versionChecking: false }
              : a
            ))
            return
          }

          const wingetId = settingsRes.wingetId
          const localSourceFolder = settingsRes.sourceFolder

          // Step B: get latest version from winget
          const versionRes = await ipcPsGetLatestVersion(wingetId)
          const latestVersion = versionRes?.version ?? null

          if (!latestVersion) {
            // winget has no version info — show what we know, mark not checking
            setApps(prev => prev.map(a => a.id === app.id
              ? { ...a, wingetId, localSourceFolder, versionChecking: false }
              : a
            ))
            return
          }

          // Step C: compare winget latest vs Intune version
          const status = app.displayVersion
            ? compareVersions(latestVersion, app.displayVersion)
            : 'update-available'

          setApps(prev => prev.map(a => a.id === app.id
            ? { ...a, latestVersion, wingetId, localSourceFolder, status, versionChecking: false }
            : a
          ))
        } catch {
          // Non-fatal: leave the row as-is, just stop the spinner
          setApps(prev => prev.map(a => a.id === app.id
            ? { ...a, versionChecking: false }
            : a
          ))
        }
      }))

    } catch (err) {
      setError((err as Error).message)
      setLoading(false)
    }
  }, [])

  return { apps, loading, error, lastSync, sync }
}
