import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTenant } from '../contexts/TenantContext'
import {
  ipcPsGetDevices,
  ipcPsTriggerWindowsUpdate,
  ipcPsTriggerDriverUpdate,
  ipcPsDownloadDiagnostics
} from '../lib/ipc'
import type { DeviceItem } from '../types/ipc'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}

function ComplianceBadge({ state }: { state: string }) {
  const map: Record<string, { label: string; color: string }> = {
    compliant:       { label: 'Compliant',        color: 'var(--success)' },
    noncompliant:    { label: 'Non-Compliant',     color: 'var(--error)' },
    inGracePeriod:   { label: 'Grace Period',      color: 'var(--warning)' },
    unknown:         { label: 'Unknown',           color: 'var(--text-500)' },
    notApplicable:   { label: 'N/A',               color: 'var(--text-500)' },
    configManager:   { label: 'Config Manager',    color: 'var(--text-400)' },
  }
  const { label, color } = map[state] ?? { label: state, color: 'var(--text-500)' }
  return (
    <span style={{ ...badgeStyle, color, borderColor: color }}>
      {label}
    </span>
  )
}

function UpdateStatusBadge({ status, label }: { status: string; label: string }) {
  if (status === 'updated') {
    return <span style={{ ...badgeStyle, color: 'var(--success)', borderColor: 'var(--success)' }}>Updated</span>
  }
  if (status === 'needsUpdate') {
    return <span style={{ ...badgeStyle, color: 'var(--warning)', borderColor: 'var(--warning)' }}>{label}</span>
  }
  return <span style={{ ...badgeStyle, color: 'var(--text-500)', borderColor: 'var(--text-500)' }}>Unknown</span>
}

const badgeStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 10,
  border: '1px solid',
  fontSize: 11,
  fontWeight: 500,
  whiteSpace: 'nowrap',
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Devices() {
  const navigate = useNavigate()
  const { tenant } = useTenant()

  const [devices, setDevices] = useState<DeviceItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSync, setLastSync] = useState<Date | null>(null)

  // Per-device action state: maps deviceId -> action string | null
  const [actionInProgress, setActionInProgress] = useState<Record<string, string>>({})
  const [actionMessages, setActionMessages] = useState<Record<string, { text: string; ok: boolean }>>({})

  // Filter
  const [filterQuery, setFilterQuery] = useState('')
  const [filterAttention, setFilterAttention] = useState(false)

  const fetchDevices = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await ipcPsGetDevices()
      if (res.success) {
        setDevices(res.devices ?? [])
        setLastSync(new Date())
      } else {
        setError(res.error ?? 'Failed to load devices')
      }
    } catch (e) {
      setError((e as Error).message ?? 'Unexpected error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDevices()
  }, [fetchDevices])

  const setDeviceAction = (id: string, action: string | null) => {
    setActionInProgress(prev => {
      const next = { ...prev }
      if (action === null) delete next[id]
      else next[id] = action
      return next
    })
  }

  const setDeviceMessage = (id: string, text: string, ok: boolean) => {
    setActionMessages(prev => ({ ...prev, [id]: { text, ok } }))
    setTimeout(() => setActionMessages(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    }), 4000)
  }

  const handleWindowsUpdate = async (device: DeviceItem) => {
    setDeviceAction(device.id, 'windows-update')
    try {
      const res = await ipcPsTriggerWindowsUpdate(device.id)
      setDeviceMessage(device.id, res.success ? 'Update sync triggered' : (res.error ?? 'Failed'), res.success)
    } catch (e) {
      setDeviceMessage(device.id, (e as Error).message, false)
    } finally {
      setDeviceAction(device.id, null)
    }
  }

  const handleDriverUpdate = async (device: DeviceItem) => {
    setDeviceAction(device.id, 'driver-update')
    try {
      const res = await ipcPsTriggerDriverUpdate(device.id)
      setDeviceMessage(device.id, res.success ? 'Driver sync triggered' : (res.error ?? 'Failed'), res.success)
    } catch (e) {
      setDeviceMessage(device.id, (e as Error).message, false)
    } finally {
      setDeviceAction(device.id, null)
    }
  }

  const handleDiagnostics = async (device: DeviceItem) => {
    setDeviceAction(device.id, 'diagnostics')
    try {
      const res = await ipcPsDownloadDiagnostics(device.id, device.deviceName)
      setDeviceMessage(device.id, res.success ? 'Diagnostics collection requested' : (res.error ?? 'Failed'), res.success)
    } catch (e) {
      setDeviceMessage(device.id, (e as Error).message, false)
    } finally {
      setDeviceAction(device.id, null)
    }
  }

  // ── Derived data ─────────────────────────────────────────────────────────

  const attentionCount = devices.filter(d => d.needsAttention).length

  const filtered = devices.filter(d => {
    const q = filterQuery.toLowerCase()
    const matchesQuery = !q || d.deviceName.toLowerCase().includes(q) || d.userPrincipalName.toLowerCase().includes(q)
    const matchesAttention = !filterAttention || d.needsAttention
    return matchesQuery && matchesAttention
  })

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={styles.shell}>

      {/* Topbar */}
      <div style={styles.topbar}>
        <div style={styles.brand}>
          <span style={{ color: 'var(--accent)', fontSize: 18 }}>⚙</span>
          <span style={{ fontWeight: 700, fontSize: 16 }}>IntuneManager</span>
        </div>

        <nav style={styles.nav}>
          <button className="btn-ghost" style={styles.navBtn} onClick={() => navigate('/dashboard')}>Dashboard</button>
          <button className="btn-ghost" style={styles.navBtn} onClick={() => navigate('/installed-apps')}>Installed Apps</button>
          <button className="btn-ghost" style={styles.navBtn} onClick={() => navigate('/catalog')}>App Catalog</button>
          <button className="btn-ghost" style={styles.navBtn} onClick={() => navigate('/deploy')}>Deploy</button>
          <button
            className="btn-ghost"
            style={{ ...styles.navBtn, color: 'var(--text-100)', background: 'var(--bg-700)' }}
            disabled
          >
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

      {/* Main content */}
      <div style={styles.main}>

        {/* Page header */}
        <div style={styles.pageHeader}>
          <div>
            <h1 style={styles.title}>Devices</h1>
            <p style={styles.subtitle}>
              Managed devices from your Intune tenant. Review compliance, update status, and take action.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {lastSync && (
              <span style={{ fontSize: 11, color: 'var(--text-500)' }}>
                Synced {lastSync.toLocaleTimeString()}
              </span>
            )}
            <button
              className="btn-secondary"
              style={{ fontSize: 12, padding: '5px 10px' }}
              onClick={fetchDevices}
              disabled={loading}
            >
              {loading ? '↻ Loading...' : '↺ Refresh'}
            </button>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div style={styles.errorBanner}>
            <span>✕ {error}</span>
            <button className="btn-ghost" style={{ fontSize: 12 }} onClick={fetchDevices}>Retry</button>
          </div>
        )}

        {/* Stats row */}
        {!loading && devices.length > 0 && (
          <div style={styles.statsRow}>
            <div className="card" style={styles.statCard}>
              <div style={styles.statNum}>{devices.length}</div>
              <div style={styles.statLabel}>Total Devices</div>
            </div>
            <div className="card" style={styles.statCard}>
              <div style={{ ...styles.statNum, color: 'var(--success)' }}>
                {devices.filter(d => d.complianceState === 'compliant').length}
              </div>
              <div style={styles.statLabel}>Compliant</div>
            </div>
            <div className="card" style={styles.statCard}>
              <div style={{ ...styles.statNum, color: 'var(--error)' }}>
                {devices.filter(d => d.complianceState === 'noncompliant').length}
              </div>
              <div style={styles.statLabel}>Non-Compliant</div>
            </div>
            <div className="card" style={{ ...styles.statCard, cursor: 'pointer' }} onClick={() => setFilterAttention(f => !f)}>
              <div style={{ ...styles.statNum, color: attentionCount > 0 ? 'var(--warning)' : 'var(--text-400)' }}>
                {attentionCount}
              </div>
              <div style={styles.statLabel}>Need Attention</div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div style={styles.filtersRow}>
          <input
            value={filterQuery}
            onChange={e => setFilterQuery(e.target.value)}
            placeholder="Search by device name or user..."
            style={{ width: 280 }}
          />
          <button
            className={filterAttention ? 'btn-primary' : 'btn-ghost'}
            style={{ fontSize: 12, padding: '5px 12px' }}
            onClick={() => setFilterAttention(f => !f)}
          >
            {filterAttention ? '⚠ Attention Only' : 'Show Attention Only'}
          </button>
          {(filterQuery || filterAttention) && (
            <button
              className="btn-ghost"
              style={{ fontSize: 12 }}
              onClick={() => { setFilterQuery(''); setFilterAttention(false) }}
            >
              Clear Filters
            </button>
          )}
          {!loading && (
            <span style={{ fontSize: 12, color: 'var(--text-500)', marginLeft: 'auto' }}>
              {filtered.length} of {devices.length} device{devices.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Table */}
        <div style={styles.tableWrapper}>
          {loading && devices.length === 0 ? (
            <div style={styles.emptyState}>Loading devices from Intune...</div>
          ) : filtered.length === 0 ? (
            <div style={styles.emptyState}>
              {devices.length === 0 ? 'No managed devices found in this tenant.' : 'No devices match the current filters.'}
            </div>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}></th>
                  <th style={styles.th}>Device</th>
                  <th style={styles.th}>User</th>
                  <th style={styles.th}>OS Version</th>
                  <th style={styles.th}>Compliance</th>
                  <th style={styles.th}>Windows Update</th>
                  <th style={styles.th}>Driver Update</th>
                  <th style={styles.th}>Diagnostics</th>
                  <th style={styles.th}>Last Sync</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(device => {
                  const busy = actionInProgress[device.id]
                  const msg = actionMessages[device.id]
                  return (
                    <tr key={device.id} style={{
                      ...styles.tr,
                      background: device.needsAttention ? 'rgba(234,179,8,0.04)' : undefined,
                      borderLeft: device.needsAttention ? '3px solid var(--warning)' : '3px solid transparent',
                    }}>
                      {/* Attention indicator */}
                      <td style={{ ...styles.td, width: 24, paddingLeft: 8 }}>
                        {device.needsAttention && (
                          <span title="Needs attention" style={{ color: 'var(--warning)', fontSize: 14 }}>⚠</span>
                        )}
                      </td>

                      {/* Device name */}
                      <td style={styles.td}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{device.deviceName || '—'}</div>
                        {msg && (
                          <div style={{ fontSize: 11, marginTop: 2, color: msg.ok ? 'var(--success)' : 'var(--error)' }}>
                            {msg.text}
                          </div>
                        )}
                      </td>

                      {/* User */}
                      <td style={{ ...styles.td, color: 'var(--text-400)', fontSize: 12 }}>
                        {device.userPrincipalName || '—'}
                      </td>

                      {/* OS Version */}
                      <td style={{ ...styles.td, fontSize: 12, color: 'var(--text-300)' }}>
                        <div>{device.operatingSystem}</div>
                        <div style={{ color: 'var(--text-500)', fontSize: 11 }}>{device.osVersion}</div>
                      </td>

                      {/* Compliance */}
                      <td style={styles.td}>
                        <ComplianceBadge state={device.complianceState} />
                      </td>

                      {/* Windows Update */}
                      <td style={styles.td}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <UpdateStatusBadge status={device.windowsUpdateStatus} label="Needs Update" />
                          {device.windowsUpdateStatus === 'needsUpdate' && (
                            <button
                              className="btn-primary"
                              style={{ fontSize: 11, padding: '2px 8px' }}
                              disabled={!!busy}
                              onClick={() => handleWindowsUpdate(device)}
                            >
                              {busy === 'windows-update' ? 'Triggering...' : 'Sync Updates'}
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Driver Update */}
                      <td style={styles.td}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <UpdateStatusBadge status={device.driverUpdateStatus} label="Needs Update" />
                          {device.driverUpdateStatus === 'needsUpdate' && (
                            <button
                              className="btn-primary"
                              style={{ fontSize: 11, padding: '2px 8px' }}
                              disabled={!!busy}
                              onClick={() => handleDriverUpdate(device)}
                            >
                              {busy === 'driver-update' ? 'Triggering...' : 'Sync Drivers'}
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Diagnostics */}
                      <td style={styles.td}>
                        {device.hasDiagnostics ? (
                          <button
                            className="btn-secondary"
                            style={{ fontSize: 11, padding: '3px 10px' }}
                            disabled={!!busy}
                            onClick={() => handleDiagnostics(device)}
                          >
                            {busy === 'diagnostics' ? 'Requesting...' : 'Request Logs'}
                          </button>
                        ) : (
                          <span style={{ color: 'var(--text-500)', fontSize: 12 }}>—</span>
                        )}
                      </td>

                      {/* Last Sync */}
                      <td style={{ ...styles.td, fontSize: 12, color: 'var(--text-400)' }}>
                        {formatDate(device.lastSyncDateTime)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
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
  },
  navBtn: {
    fontSize: 13,
    padding: '5px 14px',
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    padding: 20,
    gap: 14,
    overflow: 'hidden',
  },
  pageHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexShrink: 0,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    margin: '0 0 4px',
  },
  subtitle: {
    color: 'var(--text-400)',
    fontSize: 13,
    margin: 0,
  },
  errorBanner: {
    background: '#7f1d1d',
    border: '1px solid #991b1b',
    borderRadius: 'var(--radius)',
    padding: '8px 16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: 13,
    flexShrink: 0,
  },
  statsRow: {
    display: 'flex',
    gap: 12,
    flexShrink: 0,
  },
  statCard: {
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
  filtersRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  tableWrapper: {
    flex: 1,
    overflow: 'auto',
    minHeight: 0,
  },
  emptyState: {
    padding: '48px 0',
    textAlign: 'center',
    color: 'var(--text-400)',
    fontSize: 14,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
  },
  th: {
    textAlign: 'left',
    padding: '8px 12px',
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-400)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg-800)',
    position: 'sticky' as const,
    top: 0,
    zIndex: 1,
  },
  td: {
    padding: '10px 12px',
    borderBottom: '1px solid var(--border)',
    verticalAlign: 'middle',
  },
  tr: {
    transition: 'background 0.1s',
  },
}
