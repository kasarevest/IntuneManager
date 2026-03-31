import { useState, useEffect, useRef } from 'react'
import { ipcAiGetRecommendations } from '../lib/ipc'
import type { AppRecommendation } from '../types/ipc'

// Module-level in-memory cache — survives page remounts within the same session.
// Seeded from the DB-cached response on first load; updated when background refresh completes.
let sessionCache: AppRecommendation[] | null = null

interface RecommendationsState {
  recommendations: AppRecommendation[]
  loading: boolean
  refreshing: boolean   // true while background refresh is in progress (cache shown)
  error: string | null
  reload: () => void
}

export function useRecommendations(): RecommendationsState {
  const [recommendations, setRecommendations] = useState<AppRecommendation[]>(sessionCache ?? [])
  const [loading, setLoading] = useState(sessionCache === null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const fetchRecommendations = async () => {
    // If we already have data (session or DB cache), don't show the full loading spinner
    const hasData = sessionCache !== null && sessionCache.length > 0
    if (!hasData) setLoading(true)
    setError(null)

    try {
      const res = await ipcAiGetRecommendations()
      if (!mountedRef.current) return

      if (res.success && Array.isArray(res.recommendations) && res.recommendations.length > 0) {
        sessionCache = res.recommendations as AppRecommendation[]
        setRecommendations(res.recommendations as AppRecommendation[])

        if (res.fromCache) {
          // Cache was returned instantly — background refresh is now in flight.
          // Listen for the refreshed results to arrive.
          setRefreshing(true)
        }
      } else if (!res.success) {
        setError(res.error ?? 'Failed to load recommendations')
      }
    } catch (err) {
      if (!mountedRef.current) return
      setError((err as Error).message)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    mountedRef.current = true

    // Subscribe to background refresh completions pushed from the main process
    const api = (window as unknown as { electronAPI: { on: (channel: string, cb: (data: unknown) => void) => () => void } }).electronAPI
    const unsubscribe = api.on(
      'ipc:ai:recommendations-updated',
      (data: unknown) => {
        if (!mountedRef.current) return
        const payload = data as { recommendations: AppRecommendation[] }
        if (Array.isArray(payload?.recommendations) && payload.recommendations.length > 0) {
          sessionCache = payload.recommendations
          setRecommendations(payload.recommendations)
        }
        setRefreshing(false)
      }
    )

    // Use session cache if available; otherwise fetch (which will hit DB cache or Claude)
    if (sessionCache === null) {
      fetchRecommendations()
    }

    return () => {
      mountedRef.current = false
      unsubscribe()
    }
  }, [])

  return {
    recommendations,
    loading,
    refreshing,
    error,
    reload: fetchRecommendations
  }
}
