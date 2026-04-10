import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ipcGetDeployments } from '../lib/api'

interface DeploymentRecord {
  id: number
  jobId: string
  appName: string
  wingetId: string | null
  intuneAppId: string | null
  deployedVersion: string | null
  operation: string
  status: string
  errorMessage: string | null
  startedAt: string
  completedAt: string | null
}

type StatusFilter = 'all' | 'success' | 'failed'

function durationStr(start: string, end: string | null): string {
  if (!end) return '—'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

export default function DeploymentHistory() {
  const navigate = useNavigate()
  const [deployments, setDeployments] = useState<DeploymentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [exportFormat, setExportFormat] = useState<'csv' | 'json'>('csv')
  const [exporting, setExporting] = useState(false)
  const pageSize = 50

  const load = useCallback(async (status: StatusFilter, p: number) => {
    setLoading(true)
    setError(null)
    try {
      const res = await ipcGetDeployments(status, p)
      if (res.success) {
        setDeployments(res.deployments as DeploymentRecord[])
        setTotal(res.total)
      } else {
        setError(res.error ?? 'Failed to load deployments')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(filter, page) }, [filter, page, load])

  const handleFilter = (f: StatusFilter) => {
    setFilter(f)
    setPage(1)
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const params = new URLSearchParams({ format: exportFormat })
      if (filter !== 'all') params.set('status', filter)
      const token = sessionStorage.getItem('intunemanager_session')
      const res = await fetch(`/api/deployments/export?${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      })
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `deployment-history.${exportFormat}`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      // silent — user will see nothing downloaded
    } finally {
      setExporting(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div style={styles.shell}>
      {/* Topbar */}
      <div style={styles.topbar}>
        <div style={styles.brand}>
          <span style={{ color: 'var(--accent)', fontSize: 18 }}>⚙</span>
          <span style={{ fontWeight: 700, fontSize: 16 }}>IntuneManager</span>
        </div>
        <nav style={styles.nav}>
          <button className="btn-ghost" style={{ fontSize: 13, padding: '5px 14px' }} onClick={() => navigate('/dashboard')}>Dashboard</button>
          <button className="btn-ghost" style={{ fontSize: 13, padding: '5px 14px' }} onClick={() => navigate('/installed-apps')}>Installed Apps</button>
          <button className="btn-ghost" style={{ fontSize: 13, padding: '5px 14px' }} onClick={() => navigate('/catalog')}>App Catalog</button>
          <button className="btn-ghost" style={{ fontSize: 13, padding: '5px 14px' }} onClick={() => navigate('/deploy')}>Deploy</button>
          <button className="btn-primary" style={{ fontSize: 13, padding: '5px 14px', background: 'var(--bg-700)', border: '1px solid var(--border)' }} disabled>History</button>
        </nav>
        <div style={{ flex: 1 }} />
      </div>

      <div style={styles.page}>
        <div style={styles.content}>
          <div style={styles.header}>
            <h1 style={styles.title}>Deployment History</h1>
            <p style={{ color: 'var(--text-400)', fontSize: 13 }}>
              Audit trail of all app deployments and updates.
            </p>
          </div>

          {/* Filter tabs + export */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {(['all', 'success', 'failed'] as StatusFilter[]).map(f => (
              <button
                key={f}
                className={filter === f ? 'btn-primary' : 'btn-secondary'}
                style={{ fontSize: 12, padding: '5px 14px', textTransform: 'capitalize' }}
                onClick={() => handleFilter(f)}
              >
                {f}
              </button>
            ))}
            <span style={{ fontSize: 12, color: 'var(--text-400)', marginLeft: 8 }}>
              {total} record{total !== 1 ? 's' : ''}
            </span>

            <div style={{ flex: 1 }} />

            {/* Export controls */}
            <select
              value={exportFormat}
              onChange={e => setExportFormat(e.target.value as 'csv' | 'json')}
              style={{ width: 'auto', fontSize: 12, padding: '4px 10px' }}
            >
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
            </select>
            <button
              className="btn-secondary"
              style={{ fontSize: 12, padding: '5px 14px', flexShrink: 0 }}
              onClick={handleExport}
              disabled={exporting || total === 0}
            >
              {exporting ? 'Exporting…' : 'Export'}
            </button>
          </div>

          {error && (
            <div className="card" style={{ border: '1px solid var(--error)', padding: '12px 16px' }}>
              <p style={{ color: 'var(--error)', fontSize: 13, margin: 0 }}>{error}</p>
            </div>
          )}

          {loading ? (
            <div style={{ color: 'var(--text-400)', fontSize: 13, padding: 24 }}>Loading...</div>
          ) : deployments.length === 0 ? (
            <div className="card" style={{ padding: 32, textAlign: 'center' }}>
              <p style={{ color: 'var(--text-400)', fontSize: 13 }}>No deployment records found.</p>
            </div>
          ) : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      {['Date', 'App Name', 'Version', 'Operation', 'Status', 'Duration', 'Error'].map(h => (
                        <th key={h} style={styles.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {deployments.map(d => (
                      <tr key={d.id} style={styles.tr}>
                        <td style={styles.td}>{new Date(d.startedAt).toLocaleString()}</td>
                        <td style={{ ...styles.td, fontWeight: 500 }}>{d.appName}</td>
                        <td style={styles.td}>{d.deployedVersion ?? '—'}</td>
                        <td style={styles.td}>
                          <span className={`badge badge-${d.operation === 'deploy' ? 'info' : 'neutral'}`}>
                            {d.operation}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <span className={`badge badge-${d.status === 'success' ? 'success' : d.status === 'failed' ? 'error' : 'warning'}`}>
                            {d.status}
                          </span>
                        </td>
                        <td style={styles.td}>{durationStr(d.startedAt, d.completedAt)}</td>
                        <td style={{ ...styles.td, color: 'var(--error)', fontSize: 12, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {d.errorMessage ?? ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button className="btn-secondary" style={{ fontSize: 12 }} disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
                  <span style={{ fontSize: 12, color: 'var(--text-400)' }}>Page {page} of {totalPages}</span>
                  <button className="btn-secondary" style={{ fontSize: 12 }} disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  shell: { height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  topbar: { display: 'flex', alignItems: 'center', gap: 16, padding: '10px 20px', background: 'var(--bg-800)', borderBottom: '1px solid var(--border)', flexShrink: 0 },
  brand: { display: 'flex', alignItems: 'center', gap: 8, marginRight: 8 },
  nav: { display: 'flex', gap: 4 },
  page: { flex: 1, overflow: 'auto', padding: 24 },
  content: { maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 },
  header: { marginBottom: 4 },
  title: { fontSize: 22, fontWeight: 700, marginBottom: 4 },
  table: { width: '100%', borderCollapse: 'collapse', background: 'var(--bg-800)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: '1px solid var(--border)' },
  th: { padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-400)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)', background: 'var(--surface-200)', whiteSpace: 'nowrap' },
  tr: { borderBottom: '1px solid var(--border)' },
  td: { padding: '10px 14px', fontSize: 13 }
}
