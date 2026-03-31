import { useState, useEffect, useRef } from 'react'
import { ipcAiGetRecommendations } from '../lib/ipc'
import type { AppRecommendation } from '../types/ipc'

// Module-level cache so recommendations survive page remounts within the same session
let cachedRecommendations: AppRecommendation[] | null = null

interface RecommendationsState {
  recommendations: AppRecommendation[]
  loading: boolean
  error: string | null
  reload: () => void
}

export function useRecommendations(): RecommendationsState {
  const [recommendations, setRecommendations] = useState<AppRecommendation[]>(cachedRecommendations ?? [])
  const [loading, setLoading] = useState(cachedRecommendations === null)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const fetchRecommendations = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await ipcAiGetRecommendations()
      if (!mountedRef.current) return
      if (res.success && Array.isArray(res.recommendations)) {
        cachedRecommendations = res.recommendations
        setRecommendations(res.recommendations)
      } else {
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
    // Use cached results if available; otherwise fetch
    if (cachedRecommendations === null) {
      fetchRecommendations()
    }
    return () => { mountedRef.current = false }
  }, [])

  return {
    recommendations,
    loading,
    error,
    reload: fetchRecommendations
  }
}
