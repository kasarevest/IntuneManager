import React, { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTenant } from '../contexts/TenantContext'
import { useRecommendations } from '../hooks/useRecommendations'
import AppCard from '../components/AppCard'
import type { AppRecommendation } from '../types/ipc'
import { ipcPsSearchWinget } from '../lib/ipc'

// ─── Component ────────────────────────────────────────────────────────────────

export default function AppCatalog() {
  const navigate = useNavigate()
  const { tenant } = useTenant()
  const { recommendations, loading: recsLoading, refreshing: recsRefreshing, error: recsError } = useRecommendations()

  // Search
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<AppRecommendation[]>([])
  const [searching, setSearching] = useState(false)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cleanup debounce timeout on unmount
  useEffect(() => {
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current) }
  }, [])

  // ─── Search ─────────────────────────────────────────────────────────────────

  const handleSearchInput = (value: string) => {
    setSearchQuery(value)
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    if (!value.trim()) {
      setSearchResults([])
      return
    }
    searchDebounceRef.current = setTimeout(() => runSearch(value.trim()), 500)
  }

  const runSearch = async (query: string) => {
    setSearching(true)
    try {
      const res = await ipcPsSearchWinget(query)
      if (res.success && Array.isArray(res.results)) {
        const mapped: AppRecommendation[] = (res.results as Array<{ name?: string; id?: string; version?: string; source?: string }>).map((r, i) => ({
          id: r.id ?? `search-${i}`,
          name: r.name ?? r.id ?? 'Unknown',
          publisher: r.source ?? 'winget',
          description: r.version ? `Latest: ${r.version}` : 'Available on winget',
          wingetId: r.id ?? null,
          category: 'Search Result'
        }))
        setSearchResults(mapped)
      } else {
        setSearchResults([])
      }
    } catch {
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  // ─── Deploy action — navigates to Deployment page ───────────────────────────

  const handleCardDeploy = (app: AppRecommendation) => {
    const request = `Package and prepare for Intune: ${app.name}${app.wingetId ? ` (winget ID: ${app.wingetId})` : ''} by ${app.publisher}. Latest stable version.`
    navigate(`/deploy?package=${encodeURIComponent(request)}`)
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={styles.shell}>
      {/* Topbar */}
      <div style={styles.topbar}>
        <div style={styles.brand}>
          <span style={{ color: 'var(--accent)', fontSize: 18 }}>⚙</span>
          <span style={{ fontWeight: 700, fontSize: 16 }}>IntuneManager</span>
        </div>

        <nav style={styles.nav}>
          <button className="btn-ghost" style={{ fontSize: 13, padding: '5px 14px' }} onClick={() => navigate('/dashboard')}>
            Dashboard
          </button>
          <button className="btn-ghost" style={{ fontSize: 13, padding: '5px 14px' }} onClick={() => navigate('/installed-apps')}>
            Installed Apps
          </button>
          <button
            className="btn-primary"
            style={{ fontSize: 13, padding: '5px 14px', background: 'var(--bg-700)', border: '1px solid var(--border)' }}
            disabled
          >
            App Catalog
          </button>
          <button className="btn-ghost" style={{ fontSize: 13, padding: '5px 14px' }} onClick={() => navigate('/deploy')}>
            Deploy
          </button>
          <button className="btn-ghost" style={{ fontSize: 13, padding: '5px 14px' }} onClick={() => navigate('/devices')}>
            Devices
          </button>
        </nav>

        <div style={{ flex: 1 }} />

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {tenant.isConnected ? (
            <>
              <span style={{ color: 'var(--success)', fontSize: 10 }}>●</span>
              <span style={{ fontSize: 12, color: 'var(--text-400)' }}>{tenant.username ?? 'Connected'}</span>
            </>
          ) : (
            <>
              <span style={{ color: 'var(--error)', fontSize: 10 }}>●</span>
              <span style={{ fontSize: 12, color: 'var(--text-400)' }}>Not connected</span>
            </>
          )}
        </div>
      </div>

      <div style={styles.page}>
        <div style={styles.content}>

          {/* Header */}
          <div style={styles.header}>
            <h1 style={styles.title}>App Catalog</h1>
            <p style={styles.subtitle}>
              Discover and browse Windows applications. Click Deploy to package an app as an .intunewin file — you can then upload it to Intune from the Deployment page.
            </p>
          </div>

          {/* Search bar */}
          <div style={styles.searchRow}>
            <input
              value={searchQuery}
              onChange={e => handleSearchInput(e.target.value)}
              placeholder="Search for any app (e.g. Google Chrome, 7-Zip, Zoom...)"
              style={{ flex: 1 }}
            />
            {searchQuery && (
              <button
                className="btn-ghost"
                style={{ fontSize: 12 }}
                onClick={() => { setSearchQuery(''); setSearchResults([]) }}
              >
                Clear
              </button>
            )}
          </div>

          {/* Search results */}
          {searchQuery.trim() && (
            <section>
              <h2 style={styles.sectionTitle}>
                Search Results
                {searching && <span style={styles.loadingBadge}>Searching...</span>}
                {!searching && searchResults.length > 0 && (
                  <span style={styles.countBadge}>{searchResults.length}</span>
                )}
              </h2>
              {!searching && searchResults.length === 0 && (
                <p style={{ color: 'var(--text-400)', fontSize: 13 }}>
                  No results found for "{searchQuery}". Try a different search term.
                </p>
              )}
              {searching && (
                <div style={styles.grid}>
                  {[1, 2, 3, 4].map(i => <div key={i} style={styles.skeleton} />)}
                </div>
              )}
              {!searching && searchResults.length > 0 && (
                <div style={styles.grid}>
                  {searchResults.map(app => (
                    <AppCard key={app.id} app={app} onDeploy={handleCardDeploy} />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Recommendations */}
          {!searchQuery.trim() && (
            <section>
              <div style={styles.sectionHeader}>
                <h2 style={styles.sectionTitle}>
                  Recommended for Enterprise
                  {recsLoading && <span style={styles.loadingBadge}>Loading...</span>}
                  {!recsLoading && recommendations.length > 0 && (
                    <span style={styles.countBadge}>{recommendations.length} apps</span>
                  )}
                  {recsRefreshing && <span style={styles.refreshingBadge}>Refreshing...</span>}
                </h2>
              </div>

              {recsError && (
                <div className="card" style={{ border: '1px solid var(--error)', marginBottom: 8 }}>
                  <p style={{ color: 'var(--error)', fontSize: 13 }}>
                    Could not load recommendations: {recsError}
                  </p>
                </div>
              )}

              {recsLoading && (
                <div style={styles.grid}>
                  {Array.from({ length: 12 }, (_, i) => <div key={i} style={styles.skeleton} />)}
                </div>
              )}

              {!recsLoading && recommendations.length > 0 && (
                <div style={styles.grid}>
                  {recommendations.map(app => (
                    <AppCard key={app.id} app={app} onDeploy={handleCardDeploy} />
                  ))}
                </div>
              )}

              {!recsLoading && recommendations.length === 0 && !recsError && (
                <p style={{ color: 'var(--text-400)', fontSize: 13 }}>
                  No recommendations available. Use the search bar to find apps.
                </p>
              )}
            </section>
          )}

        </div>
      </div>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  shell: {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  topbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '10px 20px',
    background: 'var(--bg-800)',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginRight: 8,
  },
  nav: {
    display: 'flex',
    gap: 4,
    marginRight: 8,
  },
  page: {
    flex: 1,
    overflow: 'auto',
    padding: 24,
  },
  content: {
    maxWidth: 1100,
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  header: {
    marginBottom: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    marginBottom: 4,
  },
  subtitle: {
    color: 'var(--text-400)',
    fontSize: 13,
  },
  searchRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: 600,
    margin: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  loadingBadge: {
    fontSize: 11,
    color: 'var(--text-400)',
    fontWeight: 400,
  },
  refreshingBadge: {
    fontSize: 11,
    color: 'var(--accent)',
    fontWeight: 400,
  },
  countBadge: {
    fontSize: 11,
    background: 'var(--surface-200)',
    color: 'var(--text-400)',
    borderRadius: 10,
    padding: '1px 8px',
    fontWeight: 400,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
    gap: 12,
  },
  skeleton: {
    height: 120,
    borderRadius: 8,
    background: 'var(--surface-200)',
    animation: 'pulse 1.5s ease-in-out infinite',
  },
}
