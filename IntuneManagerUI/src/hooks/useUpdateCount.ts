import { useState, useEffect } from 'react'
import { ipcPsGetWtUpdates } from '../lib/api'

// Module-level cache so the API is only called once per session across all pages
let cachedCount: number | null = null
let pendingPromise: Promise<number> | null = null

function fetchUpdateCount(): Promise<number> {
  if (cachedCount !== null) return Promise.resolve(cachedCount)
  if (pendingPromise) return pendingPromise
  pendingPromise = ipcPsGetWtUpdates()
    .then(res => {
      const count = res.success ? (res.updates?.length ?? 0) : 0
      cachedCount = count
      pendingPromise = null
      return count
    })
    .catch(() => {
      pendingPromise = null
      return 0
    })
  return pendingPromise
}

// Call this after an update completes to invalidate the cache
export function invalidateUpdateCount() {
  cachedCount = null
  pendingPromise = null
}

export function useUpdateCount(): number {
  const [count, setCount] = useState(cachedCount ?? 0)

  useEffect(() => {
    fetchUpdateCount().then(setCount)
  }, [])

  return count
}
