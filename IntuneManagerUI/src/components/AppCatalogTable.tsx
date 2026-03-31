import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AppRow } from '../types/app'

interface Props {
  apps: AppRow[]
  loading?: boolean
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  'current':          { label: 'Current',    cls: 'badge-success' },
  'update-available': { label: 'Update',     cls: 'badge-warning' },
  'local-only':       { label: 'Local Only', cls: 'badge-info'    },
  'cloud-only':       { label: 'Cloud Only', cls: 'badge-neutral' },
  'unknown':          { label: 'Unknown',    cls: 'badge-neutral' }
}

export default function AppCatalogTable({ apps, loading }: Props) {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')

  const filtered = apps.filter(app => {
    const matchSearch = app.displayName.toLowerCase().includes(search.toLowerCase())
    const matchFilter = filter === 'all' || app.status === filter
    return matchSearch && matchFilter
  })

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-400)' }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>↻</div>
        Loading apps from Intune...
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <div style={styles.toolbar}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search apps..."
          style={{ width: 240 }}
        />
        <select value={filter} onChange={e => setFilter(e.target.value)} style={{ width: 160 }}>
          <option value="all">All Apps</option>
          <option value="current">Current</option>
          <option value="update-available">Update Available</option>
          <option value="cloud-only">Cloud Only</option>
          <option value="unknown">Unknown</option>
        </select>
        <span style={{ color: 'var(--text-400)', fontSize: 12, marginLeft: 'auto' }}>
          {filtered.length} of {apps.length} apps
        </span>
      </div>

      <div style={styles.tableWrapper}>
        <table style={styles.table}>
          <thead>
            <tr style={styles.headerRow}>
              <th style={styles.th}>Name</th>
              <th style={styles.th}>Intune Version</th>
              <th style={styles.th}>Latest Available</th>
              <th style={styles.th}>Status</th>
              <th style={styles.th}>Last Modified</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--text-400)' }}>
                  No apps found
                </td>
              </tr>
            )}
            {filtered.map(app => {
              const badge = STATUS_BADGE[app.status] ?? STATUS_BADGE.unknown
              const modified = app.lastModifiedDateTime
                ? new Date(app.lastModifiedDateTime).toLocaleDateString()
                : '—'

              const latestCell = app.versionChecking
                ? <span style={{ color: 'var(--text-500)', fontSize: 12 }}>checking...</span>
                : app.latestVersion
                  ? <span style={{
                      color: app.status === 'update-available' ? 'var(--warning)' : 'var(--text-200)',
                      fontWeight: app.status === 'update-available' ? 600 : 400
                    }}>{app.latestVersion}</span>
                  : <span style={{ color: 'var(--text-500)' }}>—</span>

              return (
                <tr key={app.id} style={styles.row}>
                  <td style={{ ...styles.td, fontWeight: 500 }}>{app.displayName}</td>
                  <td style={styles.td}>{app.displayVersion || '—'}</td>
                  <td style={styles.td}>{latestCell}</td>
                  <td style={styles.td}>
                    <span className={`badge ${badge.cls}`}>{badge.label}</span>
                  </td>
                  <td style={{ ...styles.td, color: 'var(--text-400)', fontSize: 12 }}>{modified}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>
                    {app.status === 'update-available' && (
                      <button
                        className="btn-primary"
                        style={{ fontSize: 11, padding: '4px 10px' }}
                        onClick={() => navigate(
                          `/deploy?update=${app.id}&name=${encodeURIComponent(app.displayName)}${app.wingetId ? `&wingetId=${encodeURIComponent(app.wingetId)}` : ''}`
                        )}
                      >
                        Update ↑
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%'
  },
  toolbar: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    marginBottom: 12
  },
  tableWrapper: {
    flex: 1,
    overflowY: 'auto',
    borderRadius: 'var(--radius)',
    border: '1px solid var(--border)'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse'
  },
  headerRow: {
    background: 'var(--bg-800)',
    borderBottom: '1px solid var(--border)'
  },
  th: {
    padding: '10px 14px',
    textAlign: 'left' as const,
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-400)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    whiteSpace: 'nowrap' as const
  },
  row: {
    borderBottom: '1px solid var(--border)',
    transition: 'background 0.1s'
  },
  td: {
    padding: '10px 14px',
    color: 'var(--text-200)',
    fontSize: 13
  }
}
