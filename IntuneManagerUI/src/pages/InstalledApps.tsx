import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTenant } from '../contexts/TenantContext'
import { useAppCatalog } from '../hooks/useAppCatalog'
import type { AppRow } from '../types/app'
import type { WtUpdateItem } from '../types/ipc'
import { ipcPsGetWtUpdates, ipcPsWtUpdateApp, ipcSettingsGet } from '../lib/api'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1').trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('')
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  'current':          { label: 'Current',          color: 'var(--success)' },
  'update-available': { label: 'Update Available',  color: 'var(--warning)' },
  'cloud-only':       { label: 'Cloud Only',        color: 'var(--text-400)' },
  'local-only':       { label: 'Local Only',        color: 'var(--accent)' },
  'unknown':          { label: 'Unknown',           color: 'var(--text-500)' },
}

// ─── AppCard ──────────────────────────────────────────────────────────────────

interface AppCardProps {
  app: AppRow
  onUpdate?: () => void
  onDetails?: () => void
}

function AppCard({ app, onUpdate, onDetails }: AppCardProps) {
  const initials = getInitials(app.displayName)
  const status = STATUS_META[app.status] ?? STATUS_META.unknown
  const logoColor = app.status === 'update-available' ? 'var(--warning)' : 'var(--accent)'

  return (
    <div style={cardStyles.card}>
      <div style={{ ...cardStyles.logo, background: logoColor }}>
        <span style={cardStyles.initials}>{initials}</span>
      </div>

      <div style={cardStyles.body}>
        <div style={cardStyles.nameRow}>
          <span style={cardStyles.name}>{app.displayName}</span>
          <span style={{ ...cardStyles.statusDot, color: status.color }}>●</span>
        </div>

        <div style={cardStyles.meta}>
          {app.displayVersion ? (
            <span style={cardStyles.version}>v{app.displayVersion}</span>
          ) : (
            <span style={cardStyles.versionMissing}>No version</span>
          )}
          {app.latestVersion && app.status === 'update-available' && (
            <span style={cardStyles.latestTag}>→ v{app.latestVersion}</span>
          )}
          {app.versionChecking && (
            <span style={cardStyles.checking}>checking...</span>
          )}
        </div>

        <div style={cardStyles.statusLabel} >
          <span style={{ color: status.color, fontSize: 11 }}>{status.label}</span>
        </div>
      </div>

      <div style={cardStyles.actions}>
        {app.status === 'update-available' && onUpdate && (
          <button
            className="btn-primary"
            style={{ fontSize: 11, padding: '4px 10px' }}
            onClick={onUpdate}
          >
            Update ↑
          </button>
        )}
        <button
          className="btn-ghost"
          style={{ fontSize: 11, padding: '4px 8px' }}
          onClick={onDetails}
        >
          Details
        </button>
      </div>
    </div>
  )
}

// ─── Details modal ────────────────────────────────────────────────────────────

interface DetailsModalProps {
  app: AppRow
  onClose: () => void
  onUpdate?: () => void
}

function DetailsModal({ app, onClose, onUpdate }: DetailsModalProps) {
  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div style={modalStyles.modal} onClick={e => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <div style={{ ...modalStyles.logo, background: app.status === 'update-available' ? 'var(--warning)' : 'var(--accent)' }}>
            <span style={modalStyles.initials}>{getInitials(app.displayName)}</span>
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 17 }}>{app.displayName}</h2>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-400)' }}>
              {(STATUS_META[app.status] ?? STATUS_META.unknown).label}
            </p>
          </div>
        </div>

        <table style={modalStyles.table}>
          <tbody>
            <tr>
              <td style={modalStyles.label}>Intune Version</td>
              <td>{app.displayVersion || '—'}</td>
            </tr>
            <tr>
              <td style={modalStyles.label}>Latest Available</td>
              <td>
                {app.versionChecking
                  ? <span style={{ color: 'var(--text-500)' }}>Checking...</span>
                  : app.latestVersion ?? '—'}
              </td>
            </tr>
            <tr>
              <td style={modalStyles.label}>Winget ID</td>
              <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{app.wingetId ?? '—'}</td>
            </tr>
            <tr>
              <td style={modalStyles.label}>Publishing State</td>
              <td>{app.publishingState || '—'}</td>
            </tr>
            <tr>
              <td style={modalStyles.label}>Last Modified</td>
              <td>
                {app.lastModifiedDateTime
                  ? new Date(app.lastModifiedDateTime).toLocaleDateString()
                  : '—'}
              </td>
            </tr>
          </tbody>
        </table>

        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          {app.status === 'update-available' && onUpdate && (
            <button className="btn-primary" onClick={() => { onClose(); onUpdate() }}>
              Update ↑
            </button>
          )}
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InstalledApps() {
  const navigate = useNavigate()
  const { tenant } = useTenant()
  const { apps, loading, error, lastSync, sync } = useAppCatalog()

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [selectedApp, setSelectedApp] = useState<AppRow | null>(null)
  const hasSynced = useRef(false)

  // WinTuner updates
  const [wtUpdates, setWtUpdates] = useState<WtUpdateItem[]>([])
  const [wtLoading, setWtLoading] = useState(false)
  const [wtError, setWtError] = useState<string | null>(null)
  const [wtUpdatingId, setWtUpdatingId] = useState<string | null>(null)
  const [outputFolder, setOutputFolder] = useState('')

  useEffect(() => {
    if (!hasSynced.current) {
      hasSynced.current = true
      sync()
    }
  }, [sync])

  useEffect(() => {
    loadWtUpdates()
    ipcSettingsGet().then(s => setOutputFolder(s.outputFolderPath ?? ''))
  }, [])

  const loadWtUpdates = async () => {
    setWtLoading(true)
    setWtError(null)
    try {
      const res = await ipcPsGetWtUpdates()
      if (res.success) {
        setWtUpdates(res.updates ?? [])
      } else {
        setWtError(res.error ?? 'Failed to check WinTuner updates')
      }
    } catch (e) {
      setWtError((e as Error).message)
    } finally {
      setWtLoading(false)
    }
  }

  const handleWtUpdate = async (item: WtUpdateItem) => {
    setWtUpdatingId(item.graphId)
    setWtError(null)
    const pkgFolder = `${outputFolder || '/tmp/wintuner-packages'}/wt-updates/${item.packageId.replace(/\./g, '-')}`
    try {
      const res = await ipcPsWtUpdateApp({ packageId: item.packageId, graphId: item.graphId, packageFolder: pkgFolder })
      if (res.success) {
        setWtUpdates(prev => prev.filter(u => u.graphId !== item.graphId))
      } else {
        setWtError(res.error ?? 'Update failed')
      }
    } catch (e) {
      setWtError((e as Error).message)
    } finally {
      setWtUpdatingId(null)
    }
  }

  const handleWtUpdateAll = async () => {
    if (wtUpdatingId) return
    for (const item of [...wtUpdates]) {
      await handleWtUpdate(item)
    }
  }

  const filtered = apps.filter(app => {
    const matchSearch = app.displayName.toLowerCase().includes(search.toLowerCase())
    const matchFilter = filter === 'all' || app.status === filter
    return matchSearch && matchFilter
  })

  const updatableApps = apps.filter(a => a.status === 'update-available')

  const handleUpdateApp = (app: AppRow) => {
    navigate(
      `/deploy?update=${app.id}&name=${encodeURIComponent(app.displayName)}${app.wingetId ? `&wingetId=${encodeURIComponent(app.wingetId)}` : ''}`
    )
  }

  const handleUpdateAll = () => {
    if (updatableApps.length === 0) return
    const queue = updatableApps.map(a => ({
      id: a.id,
      name: a.displayName,
      wingetId: a.wingetId ?? ''
    }))
    navigate(`/deploy?updateAll=${encodeURIComponent(JSON.stringify(queue))}`)
  }

  return (
    <div style={styles.shell}>
      {/* Topbar */}
      <div style={styles.topbar}>
        <div style={styles.brand}>
          <span style={{ color: 'var(--accent)', fontSize: 18 }}>⚙</span>
          <span style={{ fontWeight: 700, fontSize: 16 }}>IntuneManager</span>
        </div>

        <nav style={styles.nav}>
          <button className="btn-ghost" style={styles.navBtn} onClick={() => navigate('/dashboard')}>
            Dashboard
          </button>
          <button
            className="btn-primary"
            style={{ ...styles.navBtn, background: 'var(--bg-700)', border: '1px solid var(--border)' }}
            disabled
          >
            Installed Apps
          </button>
          <button className="btn-ghost" style={styles.navBtn} onClick={() => navigate('/catalog')}>
            App Catalog
          </button>
          <button className="btn-ghost" style={styles.navBtn} onClick={() => navigate('/deploy')}>
            Deploy
          </button>
          <button className="btn-ghost" style={styles.navBtn} onClick={() => navigate('/devices')}>
            Devices
          </button>
        </nav>

        <div style={{ flex: 1 }} />

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {lastSync && (
            <span style={{ fontSize: 11, color: 'var(--text-500)' }}>
              Synced {lastSync.toLocaleTimeString()}
            </span>
          )}
          <button
            className="btn-secondary"
            style={{ fontSize: 12, padding: '5px 10px' }}
            onClick={() => sync()}
            disabled={loading}
          >
            {loading ? '↻ Syncing...' : '↺ Sync'}
          </button>
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
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <h1 style={styles.title}>Installed Apps</h1>
              <p style={styles.subtitle}>
                Inventory of all Win32 applications currently deployed in your Intune tenant.
              </p>
            </div>
            {updatableApps.length > 0 && (
              <button
                className="btn-primary"
                style={{ fontSize: 13, flexShrink: 0, marginTop: 4 }}
                onClick={handleUpdateAll}
              >
                Update All ({updatableApps.length})
              </button>
            )}
          </div>

          {error && (
            <div className="card" style={{ border: '1px solid var(--error)', padding: '10px 16px' }}>
              <span style={{ color: 'var(--error)', fontSize: 13 }}>✕ {error}</span>
              <button className="btn-ghost" style={{ fontSize: 12, marginLeft: 12 }} onClick={() => sync()}>Retry</button>
            </div>
          )}

          {/* WinTuner updates panel */}
          {(wtLoading || wtUpdates.length > 0 || wtError) && (
            <div className="card" style={{ border: '1px solid rgba(234,179,8,0.4)', background: 'rgba(234,179,8,0.04)', padding: '12px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: wtUpdates.length > 0 ? 10 : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--warning)', fontSize: 15 }}>⟳</span>
                  <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--warning)' }}>
                    {wtLoading
                      ? 'Checking WinTuner updates...'
                      : wtError
                        ? 'WinTuner check failed'
                        : `WinTuner Updates Available (${wtUpdates.length})`}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {!wtLoading && (
                    <button className="btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }} onClick={loadWtUpdates}>
                      ↺ Refresh
                    </button>
                  )}
                  {wtUpdates.length > 1 && !wtUpdatingId && (
                    <button className="btn-primary" style={{ fontSize: 11, padding: '3px 10px' }} onClick={handleWtUpdateAll}>
                      Update All
                    </button>
                  )}
                </div>
              </div>
              {wtError && (
                <p style={{ fontSize: 12, color: 'var(--error)', margin: 0 }}>{wtError}</p>
              )}
              {wtUpdates.map(item => (
                <div key={item.graphId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--border)' }}>
                  <div>
                    <span style={{ fontWeight: 500, fontSize: 13 }}>{item.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-400)', marginLeft: 10 }}>
                      v{item.currentVersion} →{' '}
                      <span style={{ color: 'var(--warning)', fontWeight: 600 }}>v{item.latestVersion}</span>
                    </span>
                  </div>
                  <button
                    className="btn-primary"
                    style={{ fontSize: 11, padding: '4px 10px' }}
                    disabled={!!wtUpdatingId}
                    onClick={() => handleWtUpdate(item)}
                  >
                    {wtUpdatingId === item.graphId ? '↻ Updating...' : 'Update'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Stats strip */}
          {!loading && apps.length > 0 && (
            <div style={styles.statsRow}>
              <div className="card" style={styles.stat}>
                <span style={styles.statNum}>{apps.length}</span>
                <span style={styles.statLabel}>Total</span>
              </div>
              <div className="card" style={styles.stat}>
                <span style={{ ...styles.statNum, color: 'var(--success)' }}>
                  {apps.filter(a => a.status === 'current').length}
                </span>
                <span style={styles.statLabel}>Current</span>
              </div>
              <div className="card" style={styles.stat}>
                <span style={{ ...styles.statNum, color: 'var(--warning)' }}>
                  {updatableApps.length}
                </span>
                <span style={styles.statLabel}>Updates Available</span>
              </div>
              <div className="card" style={styles.stat}>
                <span style={{ ...styles.statNum, color: 'var(--text-400)' }}>
                  {apps.filter(a => a.status === 'cloud-only').length}
                </span>
                <span style={styles.statLabel}>Cloud Only</span>
              </div>
            </div>
          )}

          {/* Toolbar */}
          <div style={styles.toolbar}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search apps..."
              style={{ width: 260 }}
            />
            <select value={filter} onChange={e => setFilter(e.target.value)} style={{ width: 180 }}>
              <option value="all">All Apps</option>
              <option value="current">Current</option>
              <option value="update-available">Update Available</option>
              <option value="cloud-only">Cloud Only</option>
              <option value="unknown">Unknown</option>
            </select>
            {!loading && (
              <span style={{ fontSize: 12, color: 'var(--text-400)', marginLeft: 'auto' }}>
                {filtered.length} of {apps.length} apps
              </span>
            )}
          </div>

          {/* Loading state */}
          {loading && apps.length === 0 && (
            <div className="card" style={{ padding: 48, textAlign: 'center', color: 'var(--text-400)' }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>↻</div>
              Loading apps from Intune...
            </div>
          )}

          {/* Empty state */}
          {!loading && !error && apps.length === 0 && (
            <div className="card" style={{ padding: 48, textAlign: 'center' }}>
              <p style={{ color: 'var(--text-400)', fontSize: 13, marginBottom: 12 }}>
                No apps found. Sync to load your Intune app inventory.
              </p>
              <button className="btn-primary" onClick={() => sync()}>Sync Now</button>
            </div>
          )}

          {/* Cards grid */}
          {filtered.length > 0 && (
            <div style={styles.grid}>
              {filtered.map(app => (
                <AppCard
                  key={app.id}
                  app={app}
                  onUpdate={() => handleUpdateApp(app)}
                  onDetails={() => setSelectedApp(app)}
                />
              ))}
            </div>
          )}

          {!loading && apps.length > 0 && filtered.length === 0 && (
            <div className="card" style={{ padding: 24, textAlign: 'center' }}>
              <p style={{ color: 'var(--text-400)', fontSize: 13 }}>
                No apps match your search or filter.
              </p>
            </div>
          )}

        </div>
      </div>

      {selectedApp && (
        <DetailsModal
          app={selectedApp}
          onClose={() => setSelectedApp(null)}
          onUpdate={() => handleUpdateApp(selectedApp)}
        />
      )}
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
  navBtn: {
    fontSize: 13,
    padding: '5px 14px',
  } as React.CSSProperties,
  page: {
    flex: 1,
    overflow: 'auto',
    padding: 24,
  },
  content: {
    maxWidth: 1200,
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    marginBottom: 4,
    margin: 0,
  },
  subtitle: {
    color: 'var(--text-400)',
    fontSize: 13,
    margin: '4px 0 0',
  },
  statsRow: {
    display: 'flex',
    gap: 12,
  },
  stat: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '12px 10px',
    gap: 4,
  },
  statNum: {
    fontSize: 26,
    fontWeight: 700,
    lineHeight: 1,
  },
  statLabel: {
    fontSize: 11,
    color: 'var(--text-400)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  toolbar: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: 12,
  },
}

const cardStyles: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--surface-100)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  logo: {
    width: 44,
    height: 44,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  initials: {
    color: '#fff',
    fontWeight: 700,
    fontSize: 15,
    letterSpacing: 1,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    marginBottom: 4,
  },
  name: {
    fontWeight: 600,
    fontSize: 13,
    color: 'var(--text-100)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  statusDot: {
    fontSize: 8,
    flexShrink: 0,
  },
  meta: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    marginBottom: 4,
  },
  version: {
    fontSize: 12,
    color: 'var(--text-300)',
    background: 'var(--surface-200)',
    borderRadius: 4,
    padding: '1px 6px',
  },
  versionMissing: {
    fontSize: 12,
    color: 'var(--text-500)',
  },
  latestTag: {
    fontSize: 12,
    color: 'var(--warning)',
    fontWeight: 600,
  },
  checking: {
    fontSize: 11,
    color: 'var(--text-500)',
    fontStyle: 'italic',
  },
  statusLabel: {
    fontSize: 11,
  },
  actions: {
    display: 'flex',
    gap: 6,
  },
}

const modalStyles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: 'var(--surface-100)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: 24,
    width: 440,
    maxWidth: '90vw',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    marginBottom: 20,
  },
  logo: {
    width: 44,
    height: 44,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  initials: {
    color: '#fff',
    fontWeight: 700,
    fontSize: 15,
    letterSpacing: 1,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
  },
  label: {
    color: 'var(--text-400)',
    paddingRight: 16,
    paddingBottom: 10,
    verticalAlign: 'top',
    whiteSpace: 'nowrap',
    width: 120,
  },
}
