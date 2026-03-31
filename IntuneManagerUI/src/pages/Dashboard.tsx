import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useTenant } from '../contexts/TenantContext'
import { ipcPsGetIntuneApps, ipcPsGetDevices } from '../lib/ipc'
import type { DeviceItem } from '../types/ipc'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AppSummary {
  total: number
  current: number
  updateAvailable: number
  cloudOnly: number
  unknown: number
}

interface DeviceSummary {
  total: number
  compliant: number
  nonCompliant: number
  inGracePeriod: number
  needsAttention: number
  windowsUpdateNeeded: number
  driverUpdateNeeded: number
}

// ─── Mini donut / bar chart (pure CSS — no lib dependency) ────────────────────

interface MiniBarProps {
  segments: Array<{ value: number; color: string; label: string }>
  total: number
}

function MiniBar({ segments, total }: MiniBarProps) {
  if (total === 0) return <div style={chartStyles.barTrack} />
  return (
    <div style={chartStyles.barTrack}>
      {segments.map((seg, i) => {
        const pct = (seg.value / total) * 100
        if (pct === 0) return null
        return (
          <div
            key={i}
            style={{
              ...chartStyles.barSegment,
              width: `${pct}%`,
              background: seg.color,
              borderRadius: i === 0 ? '4px 0 0 4px' : i === segments.length - 1 ? '0 4px 4px 0' : 0,
            }}
            title={`${seg.label}: ${seg.value}`}
          />
        )
      })}
    </div>
  )
}

// ─── Stat card ────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string
  value: number | string
  sub?: string
  color?: string
  onClick?: () => void
  alert?: boolean
}

function StatCard({ label, value, sub, color, onClick, alert }: StatCardProps) {
  return (
    <div
      className="card"
      style={{
        ...cardStyles.statCard,
        cursor: onClick ? 'pointer' : undefined,
        border: alert ? '1px solid var(--warning)' : '1px solid var(--border)',
      }}
      onClick={onClick}
    >
      <div style={{ fontSize: 28, fontWeight: 700, color: color ?? 'var(--text-100)', lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-400)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 4 }}>
        {label}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: 'var(--text-500)', marginTop: 2 }}>{sub}</div>
      )}
      {alert && value !== 0 && (
        <div style={{ fontSize: 10, color: 'var(--warning)', marginTop: 4 }}>Needs attention</div>
      )}
    </div>
  )
}

// ─── Section card ─────────────────────────────────────────────────────────────

interface SectionCardProps {
  title: string
  action?: { label: string; onClick: () => void }
  children: React.ReactNode
}

function SectionCard({ title, action, children }: SectionCardProps) {
  return (
    <div className="card" style={cardStyles.section}>
      <div style={cardStyles.sectionHeader}>
        <span style={cardStyles.sectionTitle}>{title}</span>
        {action && (
          <button className="btn-ghost" style={{ fontSize: 12 }} onClick={action.onClick}>
            {action.label} →
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

// ─── Alert row ────────────────────────────────────────────────────────────────

interface AlertRowProps {
  icon: string
  text: string
  sub?: string
  color?: string
  onClick?: () => void
}

function AlertRow({ icon, text, sub, color, onClick }: AlertRowProps) {
  return (
    <div
      style={{
        ...cardStyles.alertRow,
        cursor: onClick ? 'pointer' : undefined,
        borderLeft: `3px solid ${color ?? 'var(--warning)'}`,
      }}
      onClick={onClick}
    >
      <span style={{ fontSize: 16 }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, color: 'var(--text-200)', fontWeight: 500 }}>{text}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--text-400)', marginTop: 2 }}>{sub}</div>}
      </div>
      {onClick && <span style={{ color: 'var(--text-500)', fontSize: 12 }}>View →</span>}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const { logout } = useAuth()
  const { tenant, tenantChecked } = useTenant()
  const navigate = useNavigate()

  const [appSummary, setAppSummary] = useState<AppSummary | null>(null)
  const [deviceSummary, setDeviceSummary] = useState<DeviceSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [errors, setErrors] = useState<string[]>([])

  const fetchSummary = useCallback(async () => {
    setLoading(true)
    setErrors([])
    const errs: string[] = []

    // Fetch apps and devices in parallel
    const [appsRes, devicesRes] = await Promise.allSettled([
      ipcPsGetIntuneApps(),
      ipcPsGetDevices(),
    ])

    // Process apps
    if (appsRes.status === 'fulfilled' && appsRes.value.success) {
      const rawApps = (appsRes.value.apps ?? []) as Array<Record<string, unknown>>
      const total = rawApps.length
      const published = rawApps.filter(a => String(a.publishingState ?? '') === 'published').length
      const pending = rawApps.filter(a =>
        String(a.publishingState ?? '') === 'pending' || String(a.publishingState ?? '') === 'processing'
      ).length
      setAppSummary({
        total,
        current: published,
        updateAvailable: 0,
        cloudOnly: total - published - pending,
        unknown: pending,
      })
    } else {
      if (appsRes.status === 'rejected') errs.push('Apps: ' + String(appsRes.reason))
      else if (appsRes.status === 'fulfilled') errs.push('Apps: ' + (appsRes.value.error ?? 'unknown error'))
    }

    // Process devices
    if (devicesRes.status === 'fulfilled' && devicesRes.value.success) {
      const devs = devicesRes.value.devices as DeviceItem[]
      setDeviceSummary({
        total: devs.length,
        compliant: devs.filter(d => d.complianceState === 'compliant').length,
        nonCompliant: devs.filter(d => d.complianceState === 'noncompliant').length,
        inGracePeriod: devs.filter(d => d.complianceState === 'inGracePeriod').length,
        needsAttention: devs.filter(d => d.needsAttention).length,
        windowsUpdateNeeded: devs.filter(d => d.windowsUpdateStatus === 'needsUpdate').length,
        driverUpdateNeeded: devs.filter(d => d.driverUpdateStatus === 'needsUpdate').length,
      })
    } else {
      if (devicesRes.status === 'rejected') errs.push('Devices: ' + String(devicesRes.reason))
      else if (devicesRes.status === 'fulfilled') errs.push('Devices: ' + (devicesRes.value.error ?? 'unknown error'))
    }

    setErrors(errs)
    setLastRefresh(new Date())
    setLoading(false)
  }, [])

  // Initial fetch: once tenantChecked is true and tenant is connected, fetch immediately.
  // TenantContext polls the DB every 60 s so tenant.isConnected is always accurate —
  // no per-page reconnect logic needed here.
  useEffect(() => {
    if (tenantChecked && tenant.isConnected) {
      fetchSummary()
    }
  // Run only when tenantChecked first becomes true or connection status changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantChecked, tenant.isConnected])

  // Auto-refresh every 60 s while connected.
  useEffect(() => {
    if (!tenant.isConnected) return
    const interval = setInterval(fetchSummary, 60_000)
    return () => clearInterval(interval)
  }, [tenant.isConnected, fetchSummary])

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  // ─── Build alert list ──────────────────────────────────────────────────────

  const alerts: React.ReactNode[] = []

  if (deviceSummary && deviceSummary.nonCompliant > 0) {
    alerts.push(
      <AlertRow
        key="non-compliant"
        icon="⚠"
        text={`${deviceSummary.nonCompliant} non-compliant device${deviceSummary.nonCompliant > 1 ? 's' : ''}`}
        sub="These devices are out of compliance policy"
        color="var(--error)"
        onClick={() => navigate('/devices')}
      />
    )
  }
  if (deviceSummary && deviceSummary.inGracePeriod > 0) {
    alerts.push(
      <AlertRow
        key="grace"
        icon="⏱"
        text={`${deviceSummary.inGracePeriod} device${deviceSummary.inGracePeriod > 1 ? 's' : ''} in grace period`}
        sub="Compliance grace period will expire"
        color="var(--warning)"
        onClick={() => navigate('/devices')}
      />
    )
  }
  if (deviceSummary && deviceSummary.windowsUpdateNeeded > 0) {
    alerts.push(
      <AlertRow
        key="win-update"
        icon="🔄"
        text={`${deviceSummary.windowsUpdateNeeded} device${deviceSummary.windowsUpdateNeeded > 1 ? 's' : ''} need Windows updates`}
        sub="Trigger sync from the Devices page"
        onClick={() => navigate('/devices')}
      />
    )
  }
  if (tenantChecked && !tenant.isConnected) {
    alerts.push(
      <AlertRow
        key="no-tenant"
        icon="🔌"
        text="Tenant not connected"
        sub="Connect your Microsoft tenant to load live data"
        color="var(--error)"
        onClick={() => navigate('/settings/tenant')}
      />
    )
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
          <button
            className="btn-primary"
            style={{ ...styles.navBtn, background: 'var(--bg-700)', border: '1px solid var(--border)' }}
            disabled
          >
            Dashboard
          </button>
          <button className="btn-ghost" style={styles.navBtn} onClick={() => navigate('/installed-apps')}>
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

        <div style={styles.tenantStatus}>
          {tenant.isConnected ? (
            <>
              <span style={{ color: 'var(--success)', fontSize: 10 }}>●</span>
              <span style={{ fontSize: 12, color: 'var(--text-400)' }}>
                {tenant.username ?? 'Connected'}
                {tenant.expiresInMinutes != null && ` · ${tenant.expiresInMinutes}m left`}
              </span>
            </>
          ) : (
            <>
              <span style={{ color: 'var(--error)', fontSize: 10 }}>●</span>
              <span style={{ fontSize: 12, color: 'var(--text-400)' }}>Not connected</span>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {lastRefresh && (
            <span style={{ fontSize: 11, color: 'var(--text-500)' }}>
              Updated {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button
            className="btn-secondary"
            style={{ fontSize: 12, padding: '5px 10px' }}
            onClick={() => fetchSummary()}
            disabled={loading || !tenant.isConnected}
          >
            {loading ? '↻ Loading...' : '↺ Refresh'}
          </button>
          <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => navigate('/settings')}>
            Settings
          </button>
          <button className="btn-ghost" style={{ fontSize: 12 }} onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </div>

      {/* Main */}
      <div style={styles.page}>
        <div style={styles.content}>

          <div style={{ marginBottom: 4 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, marginBottom: 2 }}>Dashboard</h1>
            <p style={{ color: 'var(--text-400)', fontSize: 13, margin: 0 }}>
              Executive summary and health overview across your Intune environment.
            </p>
          </div>

          {/* Error strip */}
          {errors.length > 0 && (
            <div className="card" style={{ border: '1px solid var(--error)', padding: '10px 16px' }}>
              {errors.map((e, i) => (
                <p key={i} style={{ color: 'var(--error)', fontSize: 13, margin: 0 }}>✕ {e}</p>
              ))}
            </div>
          )}

          {/* ── Row 1: App overview ── */}
          <SectionCard
            title="App Inventory"
            action={{ label: 'View All Apps', onClick: () => navigate('/installed-apps') }}
          >
            {loading && !appSummary ? (
              <div style={styles.loadingRow}>Loading app data...</div>
            ) : appSummary ? (
              <>
                <div style={styles.statRow}>
                  <StatCard label="Total Apps" value={appSummary.total} onClick={() => navigate('/installed-apps')} />
                  <StatCard label="Published" value={appSummary.current} color="var(--success)" onClick={() => navigate('/installed-apps')} />
                  <StatCard label="Pending / Processing" value={appSummary.unknown} color="var(--warning)" onClick={() => navigate('/installed-apps')} />
                </div>
                <MiniBar
                  total={appSummary.total}
                  segments={[
                    { value: appSummary.current, color: 'var(--success)', label: 'Published' },
                    { value: appSummary.unknown, color: 'var(--warning)', label: 'Pending' },
                    { value: appSummary.cloudOnly, color: 'var(--surface-200)', label: 'Other' },
                  ]}
                />
                <div style={styles.barLegend}>
                  <LegendItem color="var(--success)" label="Published" />
                  <LegendItem color="var(--warning)" label="Pending / Processing" />
                  <LegendItem color="var(--surface-200)" label="Other" />
                </div>
              </>
            ) : (
              <div style={styles.emptyState}>
                No app data — connect your tenant and refresh.
              </div>
            )}
          </SectionCard>

          {/* ── Row 2: Device health ── */}
          <SectionCard
            title="Device Health"
            action={{ label: 'View Devices', onClick: () => navigate('/devices') }}
          >
            {loading && !deviceSummary ? (
              <div style={styles.loadingRow}>Loading device data...</div>
            ) : deviceSummary ? (
              <>
                <div style={styles.statRow}>
                  <StatCard label="Total Devices" value={deviceSummary.total} onClick={() => navigate('/devices')} />
                  <StatCard label="Compliant" value={deviceSummary.compliant} color="var(--success)" onClick={() => navigate('/devices')} />
                  <StatCard
                    label="Non-Compliant"
                    value={deviceSummary.nonCompliant}
                    color={deviceSummary.nonCompliant > 0 ? 'var(--error)' : 'var(--text-400)'}
                    alert={deviceSummary.nonCompliant > 0}
                    onClick={() => navigate('/devices')}
                  />
                  <StatCard
                    label="Needs Attention"
                    value={deviceSummary.needsAttention}
                    color={deviceSummary.needsAttention > 0 ? 'var(--warning)' : 'var(--text-400)'}
                    alert={deviceSummary.needsAttention > 0}
                    onClick={() => navigate('/devices')}
                  />
                </div>

                <MiniBar
                  total={deviceSummary.total}
                  segments={[
                    { value: deviceSummary.compliant, color: 'var(--success)', label: 'Compliant' },
                    { value: deviceSummary.inGracePeriod, color: 'var(--warning)', label: 'Grace Period' },
                    { value: deviceSummary.nonCompliant, color: 'var(--error)', label: 'Non-Compliant' },
                    { value: Math.max(0, deviceSummary.total - deviceSummary.compliant - deviceSummary.inGracePeriod - deviceSummary.nonCompliant), color: 'var(--surface-200)', label: 'Unknown' },
                  ]}
                />
                <div style={styles.barLegend}>
                  <LegendItem color="var(--success)" label="Compliant" />
                  <LegendItem color="var(--warning)" label="Grace Period" />
                  <LegendItem color="var(--error)" label="Non-Compliant" />
                  <LegendItem color="var(--surface-200)" label="Unknown" />
                </div>

                {/* Update status row */}
                <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                  <div style={styles.updateTile}>
                    <span style={{ fontSize: 20, fontWeight: 700, color: deviceSummary.windowsUpdateNeeded > 0 ? 'var(--warning)' : 'var(--success)' }}>
                      {deviceSummary.windowsUpdateNeeded}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-400)' }}>Windows Updates Needed</span>
                  </div>
                  <div style={styles.updateTile}>
                    <span style={{ fontSize: 20, fontWeight: 700, color: deviceSummary.driverUpdateNeeded > 0 ? 'var(--warning)' : 'var(--success)' }}>
                      {deviceSummary.driverUpdateNeeded}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-400)' }}>Driver Updates Needed</span>
                  </div>
                  <div style={styles.updateTile}>
                    <span style={{ fontSize: 20, fontWeight: 700, color: deviceSummary.inGracePeriod > 0 ? 'var(--warning)' : 'var(--success)' }}>
                      {deviceSummary.inGracePeriod}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-400)' }}>In Grace Period</span>
                  </div>
                </div>
              </>
            ) : (
              <div style={styles.emptyState}>
                No device data — connect your tenant and refresh.
              </div>
            )}
          </SectionCard>

          {/* ── Row 3: Deployment readiness + Alerts side by side ── */}
          <div style={styles.twoCol}>

            <SectionCard
              title="Deployment Readiness"
              action={{ label: 'Go to Deploy', onClick: () => navigate('/deploy') }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <QuickLink
                  icon="📦"
                  title="App Catalog"
                  description="Browse and package enterprise apps for Intune"
                  onClick={() => navigate('/catalog')}
                />
                <QuickLink
                  icon="⬆"
                  title="Deployment"
                  description="Upload packaged .intunewin files to Intune"
                  onClick={() => navigate('/deploy')}
                />
                <QuickLink
                  icon="💾"
                  title="Installed Apps Inventory"
                  description="Review all apps currently in your tenant"
                  onClick={() => navigate('/installed-apps')}
                />
              </div>
            </SectionCard>

            <SectionCard title="Alerts & Attention Required">
              {alerts.length === 0 ? (
                <div style={styles.emptyState}>
                  <span style={{ fontSize: 20 }}>✓</span>
                  <span>No active alerts — environment looks healthy.</span>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {alerts}
                </div>
              )}
            </SectionCard>

          </div>

        </div>
      </div>
    </div>
  )
}

// ─── Helper sub-components ────────────────────────────────────────────────────

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 11, color: 'var(--text-400)' }}>{label}</span>
    </div>
  )
}

interface QuickLinkProps {
  icon: string
  title: string
  description: string
  onClick: () => void
}

function QuickLink({ icon, title, description, onClick }: QuickLinkProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        borderRadius: 6,
        border: '1px solid var(--border)',
        cursor: 'pointer',
        background: 'var(--bg-800)',
        transition: 'background 0.1s',
      }}
      onClick={onClick}
    >
      <span style={{ fontSize: 20 }}>{icon}</span>
      <div>
        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-100)' }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--text-400)', marginTop: 1 }}>{description}</div>
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
  navBtn: {
    fontSize: 13,
    padding: '5px 14px',
  } as React.CSSProperties,
  tenantStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
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
  statRow: {
    display: 'flex',
    gap: 12,
    marginBottom: 14,
  },
  twoCol: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 20,
  },
  loadingRow: {
    padding: '20px 0',
    color: 'var(--text-400)',
    fontSize: 13,
    textAlign: 'center',
  },
  emptyState: {
    padding: '20px 0',
    color: 'var(--text-400)',
    fontSize: 13,
    textAlign: 'center',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  barLegend: {
    display: 'flex',
    gap: 14,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  updateTile: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '10px 8px',
    gap: 4,
    background: 'var(--bg-800)',
    borderRadius: 6,
    border: '1px solid var(--border)',
  },
}

const cardStyles: Record<string, React.CSSProperties> = {
  statCard: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '14px 10px',
    gap: 0,
    textAlign: 'center',
    minWidth: 0,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    padding: 20,
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-100)',
  },
  alertRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '10px 12px',
    borderRadius: '0 6px 6px 0',
    background: 'var(--bg-800)',
  },
}

const chartStyles: Record<string, React.CSSProperties> = {
  barTrack: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    background: 'var(--surface-200)',
    display: 'flex',
    overflow: 'hidden',
  },
  barSegment: {
    height: '100%',
    transition: 'width 0.3s ease',
  },
}
