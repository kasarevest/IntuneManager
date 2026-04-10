import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ipcGetDeployments } from '../lib/api'

interface AuditRecord {
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

export default function AuditLog() {
  const navigate = useNavigate()
  const [records, setRecords] = useState<AuditRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [expanded, setExpanded] = useState<number | null>(null)
  const pageSize = 50

  const load = useCallback(async (status: StatusFilter, p: number) => {
    setLoading(true)
    setError(null)
    try {
      const res = await ipcGetDeployments(status, p)
      if (res.success) {
        setRecords(res.deployments as AuditRecord[])
        setTotal(res.total)
      } else {
        setError(res.error ?? 'Failed to load audit log')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(filter, page) }, [filter, page, load])

  const handleFilter = (f: StatusFilter) => { setFilter(f); setPage(1) }
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div style={styles.shell}>
      <div style={styles.topbar}>
        <div style={styles.brand}>
          <span style={{ color: 'var(--accent)', fontSize: 18 }}>⚙</span>
          <span style={{ fontWeight: 700, fontSize: 16 }}>IntuneManager</span>
        </div>
        <nav style={styles.nav}>
          <button className="btn-ghost" style={{ fontSize: 13, padding: '5px 14px' }} onClick={() => navigate('/dashboard')}>Dashboard</button>
          <button className="btn-ghost" style={{ fontSize: 13, padding: '5px 14px' }} onClick={() => navigate('/installed-apps')}>Installed Apps</button>
          <button className="btn-ghost" style={{ fontSize: 13, padding: '5px 14px' }} onClick={() => navigate('/history')}>History</button>
          <button className="btn-primary" style={{ fontSize: 13, padding: '5px 14px', background: 'var(--bg-700)', border: '1px solid var(--border)' }} disabled>Audit Log</button>
        </nav>
        <div style={{ flex: 1 }} />
      </div>

      <div style={styles.page}>
        <div style={styles.content}>
          <div>
            <h1 style={styles.title}>Audit Log</h1>
            <p style={{ color: 'var(--text-400)', fontSize: 13 }}>
              All deployment actions with full metadata. Click a row to expand details.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
            <span style={{ fontSize: 12, color: 'var(--text-400)', marginLeft: 8 }}>{total} record{total !== 1 ? 's' : ''}</span>
          </div>

          {error && (
            <div className="card" style={{ border: '1px solid var(--error)', padding: '12px 16px' }}>
              <p style={{ color: 'var(--error)', fontSize: 13, margin: 0 }}>{error}</p>
            </div>
          )}

          {loading ? (
            <div style={{ color: 'var(--text-400)', fontSize: 13, padding: 24 }}>Loading...</div>
          ) : records.length === 0 ? (
            <div className="card" style={{ padding: 32, textAlign: 'center' }}>
              <p style={{ color: 'var(--text-400)', fontSize: 13 }}>No audit records found.</p>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {records.map(r => (
                  <div key={r.id}>
                    <div
                      style={{
                        ...styles.row,
                        background: expanded === r.id ? 'var(--surface-200)' : 'var(--bg-800)',
                        cursor: 'pointer'
                      }}
                      onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                    >
                      <span style={{ fontSize: 11, color: 'var(--text-400)', minWidth: 140, flexShrink: 0 }}>
                        {new Date(r.startedAt).toLocaleString()}
                      </span>
                      <span style={{ fontWeight: 500, minWidth: 180, flexShrink: 0 }}>{r.appName}</span>
                      <span className={`badge badge-${r.operation === 'deploy' ? 'info' : 'neutral'}`}>{r.operation}</span>
                      <span className={`badge badge-${r.status === 'success' ? 'success' : r.status === 'failed' ? 'error' : 'warning'}`}>{r.status}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-400)' }}>{durationStr(r.startedAt, r.completedAt)}</span>
                      {r.deployedVersion && <span style={{ fontSize: 12, color: 'var(--text-400)' }}>v{r.deployedVersion}</span>}
                      <div style={{ flex: 1 }} />
                      <span style={{ fontSize: 11, color: 'var(--text-500)' }}>{expanded === r.id ? '▲' : '▼'}</span>
                    </div>

                    {expanded === r.id && (
                      <div style={styles.detail}>
                        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '6px 12px', fontSize: 12 }}>
                          <span style={{ color: 'var(--text-400)' }}>Job ID</span>
                          <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.jobId}</span>
                          {r.wingetId && <>
                            <span style={{ color: 'var(--text-400)' }}>Winget ID</span>
                            <span>{r.wingetId}</span>
                          </>}
                          {r.intuneAppId && <>
                            <span style={{ color: 'var(--text-400)' }}>Intune App ID</span>
                            <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.intuneAppId}</span>
                          </>}
                          <span style={{ color: 'var(--text-400)' }}>Started</span>
                          <span>{new Date(r.startedAt).toLocaleString()}</span>
                          {r.completedAt && <>
                            <span style={{ color: 'var(--text-400)' }}>Completed</span>
                            <span>{new Date(r.completedAt).toLocaleString()}</span>
                          </>}
                          {r.errorMessage && <>
                            <span style={{ color: 'var(--error)' }}>Error</span>
                            <span style={{ color: 'var(--error)' }}>{r.errorMessage}</span>
                          </>}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

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
  title: { fontSize: 22, fontWeight: 700, marginBottom: 4 },
  row: { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderRadius: 'var(--radius)', border: '1px solid var(--border)' },
  detail: { background: 'var(--surface-200)', border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 var(--radius) var(--radius)', padding: '12px 16px', marginBottom: 2 }
}
