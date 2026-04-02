import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
  LineChart, Line, CartesianGrid,
} from 'recharts'
import { useAuth } from '../contexts/AuthContext'
import { useTenant } from '../contexts/TenantContext'
import {
  ipcPsGetIntuneApps, ipcPsGetDevices,
  ipcPsGetAppInstallStats, ipcPsGetUpdateStates,
  ipcPsGetUEAScores, ipcPsGetAutopilotEvents,
  onCacheAppsUpdated, onCacheDevicesUpdated, onCacheInstallStatsUpdated,
  onCacheUpdateStatesUpdated, onCacheUEAScoresUpdated, onCacheAutopilotEventsUpdated,
} from '../lib/ipc'
import type {
  DeviceItem, AppInstallStat, AutopilotEvent,
  IntuneAppsRes, GetDevicesRes, AppInstallStatsRes, UpdateStatesRes, UEAScoresRes, AutopilotEventsRes,
} from '../types/ipc'

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

interface SecuritySummary {
  rtpDisabled: number
  malwareDisabled: number
  signatureOverdue: number
  scanOverdue: number
  rebootPending: number
  attentionDevices: DeviceItem[]
}

// ─── OS version bucket helper ─────────────────────────────────────────────────

function parseOsBucket(osVersion: string): string {
  // osVersion format: "10.0.<build>.<revision>"
  const parts = osVersion.split('.')
  if (parts.length < 3) return osVersion || 'Unknown'
  const build = parseInt(parts[2], 10)
  if (isNaN(build)) return osVersion

  if (build >= 26100) return 'Win 11 24H2'
  if (build >= 22631) return 'Win 11 23H2'
  if (build >= 22621) return 'Win 11 22H2'
  if (build >= 22000) return 'Win 11 21H2'
  if (build >= 19045) return 'Win 10 22H2'
  if (build >= 19044) return 'Win 10 21H2'
  if (build >= 19043) return 'Win 10 21H1'
  if (build >= 19042) return 'Win 10 20H2'
  if (build >= 19041) return 'Win 10 2004'
  return `Win 10 (${parts[2]})`
}

// ─── Permission banner ────────────────────────────────────────────────────────

function PermissionBanner({ permission }: { permission: string }) {
  return (
    <div style={{ padding: '16px 12px', textAlign: 'center' }}>
      <div style={{ fontSize: 13, color: 'var(--text-400)', marginBottom: 4 }}>
        Permission required: <strong style={{ color: 'var(--text-200)' }}>{permission}</strong>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-500)' }}>
        Ask your tenant admin to grant admin consent for this permission in Azure AD.
      </div>
    </div>
  )
}

// ─── Mini donut / bar chart (pure CSS) ────────────────────────────────────────

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

// ─── UEA Score Ring (SVG arc) ─────────────────────────────────────────────────

function ScoreRing({ score, label }: { score: number; label: string }) {
  const size = 80
  const r = 30
  const cx = size / 2
  const cy = size / 2
  const circumference = 2 * Math.PI * r
  const valid = score >= 0
  const pct = valid ? Math.min(100, Math.max(0, score)) / 100 : 0
  const dash = pct * circumference
  const color = !valid ? 'var(--text-500)' : score >= 70 ? 'var(--success)' : score >= 50 ? 'var(--warning)' : 'var(--error)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg width={size} height={size}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--surface-200)" strokeWidth={7} />
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={color}
          strokeWidth={7}
          strokeDasharray={`${dash} ${circumference - dash}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
        />
        <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle"
          style={{ fontSize: 14, fontWeight: 700, fill: valid ? 'var(--text-100)' : 'var(--text-500)' }}>
          {valid ? Math.round(score) : '--'}
        </text>
      </svg>
      <span style={{ fontSize: 11, color: 'var(--text-400)', textAlign: 'center', maxWidth: 80 }}>{label}</span>
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
  loading?: boolean
  children: React.ReactNode
}

function SectionCard({ title, action, loading, children }: SectionCardProps) {
  return (
    <div className="card" style={cardStyles.section}>
      <div style={cardStyles.sectionHeader}>
        <span style={cardStyles.sectionTitle}>{title}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {loading && <span style={{ fontSize: 11, color: 'var(--text-500)' }}>Loading...</span>}
          {action && (
            <button className="btn-ghost" style={{ fontSize: 12 }} onClick={action.onClick}>
              {action.label} →
            </button>
          )}
        </div>
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

const ENROLLMENT_TYPE_LABELS: Record<string, string> = {
  windowsAzureADJoin: 'Azure AD Join',
  windowsBulkAzureDomainJoin: 'Bulk Azure Join',
  windowsAutoEnrollment: 'Auto Enrollment',
  windowsCoManagement: 'Co-Management',
  windowsBulkUserlessDomainJoin: 'Userless Join',
  azureADJoinUsingDeviceAuth: 'Device Auth Join',
  hybridAzureADJoin: 'Hybrid Join',
  unknown: 'Unknown',
}

const ENROLLMENT_COLORS = [
  '#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16',
]

const UPDATE_STATUS_COLORS: Record<string, string> = {
  completed:  'var(--success)',
  inProgress: '#6366f1',
  pending:    'var(--warning)',
  notStarted: 'var(--surface-200)',
  failed:     'var(--error)',
}

export default function Dashboard() {
  const { logout } = useAuth()
  const { tenant, tenantChecked } = useTenant()
  const navigate = useNavigate()

  // Existing state
  const [appSummary, setAppSummary] = useState<AppSummary | null>(null)
  const [deviceSummary, setDeviceSummary] = useState<DeviceSummary | null>(null)
  const [loadingApps, setLoadingApps] = useState(false)
  const [loadingDevices, setLoadingDevices] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [errors, setErrors] = useState<string[]>([])

  // New v2 state
  const [osDistribution, setOsDistribution] = useState<Array<{ version: string; count: number }>>([])
  const [enrollmentTypes, setEnrollmentTypes] = useState<Array<{ name: string; value: number }>>([])
  const [securitySummary, setSecuritySummary] = useState<SecuritySummary | null>(null)
  const [appInstallStats, setAppInstallStats] = useState<AppInstallStat[]>([])
  const [appInstallTruncated, setAppInstallTruncated] = useState(false)
  const [appInstallPermErr, setAppInstallPermErr] = useState(false)
  const [updateSummary, setUpdateSummary] = useState<Record<string, number> | null>(null)
  const [updateVersions, setUpdateVersions] = useState<Array<{ version: string; completed: number; pending: number; failed: number; notStarted: number; inProgress: number }>>([])
  const [updatePermErr, setUpdatePermErr] = useState(false)
  const [ueaOverview, setUeaOverview] = useState<{ startupScore: number; appReliabilityScore: number; batteryHealthScore: number; workFromAnywhereScore: number } | null>(null)
  const [ueaAppHealth, setUeaAppHealth] = useState<Array<{ appName: string; appPublisher: string; crashCount: number; hangCount: number; crashRate: number }>>([])
  const [ueaPermErr, setUeaPermErr] = useState(false)
  const [enrollmentTrend, setEnrollmentTrend] = useState<Array<{ date: string; success: number; failed: number }>>([])
  const [autopilotPermErr, setAutopilotPermErr] = useState(false)
  const [loadingInstall, setLoadingInstall] = useState(false)
  const [loadingUpdate, setLoadingUpdate] = useState(false)
  const [loadingUEA, setLoadingUEA] = useState(false)
  const [loadingAutopilot, setLoadingAutopilot] = useState(false)
  const [backgroundRefreshing, setBackgroundRefreshing] = useState(false)
  const pendingCacheRefreshes = useRef(0)

  // ─── Result processors (shared by fetchSummary and cache update events) ───────

  const applyAppsResult = useCallback((data: IntuneAppsRes) => {
    if (!data.success) return
    const rawApps = (data.apps ?? []) as Array<Record<string, unknown>>
    const total = rawApps.length
    const published = rawApps.filter(a => String(a.publishingState ?? '') === 'published').length
    const pending = rawApps.filter(a =>
      String(a.publishingState ?? '') === 'pending' || String(a.publishingState ?? '') === 'processing'
    ).length
    setAppSummary({ total, current: published, updateAvailable: 0, cloudOnly: total - published - pending, unknown: pending })
  }, [])

  const applyDevicesResult = useCallback((data: GetDevicesRes) => {
    if (!data.success) return
    const devs = data.devices
    setDeviceSummary({
      total: devs.length,
      compliant: devs.filter(d => d.complianceState === 'compliant').length,
      nonCompliant: devs.filter(d => d.complianceState === 'noncompliant').length,
      inGracePeriod: devs.filter(d => d.complianceState === 'inGracePeriod').length,
      needsAttention: devs.filter(d => d.needsAttention).length,
      windowsUpdateNeeded: devs.filter(d => d.windowsUpdateStatus === 'needsUpdate').length,
      driverUpdateNeeded: devs.filter(d => d.driverUpdateStatus === 'needsUpdate').length,
    })
    const buckets = new Map<string, number>()
    for (const d of devs) {
      const bucket = parseOsBucket(d.osVersion)
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1)
    }
    setOsDistribution(
      Array.from(buckets.entries())
        .map(([version, count]) => ({ version, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8)
    )
    const etBuckets = new Map<string, number>()
    for (const d of devs) {
      const et = d.deviceEnrollmentType || 'unknown'
      const label = ENROLLMENT_TYPE_LABELS[et] ?? et
      etBuckets.set(label, (etBuckets.get(label) ?? 0) + 1)
    }
    setEnrollmentTypes(
      Array.from(etBuckets.entries())
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
    )
    const rtpOff = devs.filter(d => d.realTimeProtectionEnabled === false).length
    const malwareOff = devs.filter(d => d.malwareProtectionEnabled === false).length
    const sigOverdue = devs.filter(d => d.signatureUpdateOverdue).length
    const scanOverdue = devs.filter(d => d.quickScanOverdue).length
    const reboot = devs.filter(d => d.rebootRequired).length
    const attn = devs.filter(d =>
      d.realTimeProtectionEnabled === false || d.signatureUpdateOverdue || d.quickScanOverdue || d.rebootRequired
    ).slice(0, 10)
    setSecuritySummary({ rtpDisabled: rtpOff, malwareDisabled: malwareOff, signatureOverdue: sigOverdue, scanOverdue, rebootPending: reboot, attentionDevices: attn })
  }, [])

  const applyInstallResult = useCallback((data: AppInstallStatsRes) => {
    if (data.permissionError) {
      setAppInstallPermErr(true)
    } else if (data.success) {
      setAppInstallPermErr(false)
      const sorted = [...(data.apps ?? [])].sort((a, b) => b.failed - a.failed)
      setAppInstallStats(sorted)
      setAppInstallTruncated(data.truncated ?? false)
    }
  }, [])

  const applyUpdateResult = useCallback((data: UpdateStatesRes) => {
    if (data.permissionError) {
      setUpdatePermErr(true)
    } else if (data.success) {
      setUpdatePermErr(false)
      setUpdateSummary(data.summary as unknown as Record<string, number>)
      const versionMap = new Map<string, { completed: number; pending: number; failed: number; notStarted: number; inProgress: number }>()
      for (const s of data.states ?? []) {
        const ver = s.featureUpdateVersion || 'Unknown'
        if (!versionMap.has(ver)) versionMap.set(ver, { completed: 0, pending: 0, failed: 0, notStarted: 0, inProgress: 0 })
        const entry = versionMap.get(ver)!
        const st = s.status as keyof typeof entry
        if (st in entry) entry[st]++
      }
      setUpdateVersions(
        Array.from(versionMap.entries())
          .map(([version, counts]) => ({ version, ...counts }))
          .sort((a, b) => b.completed - a.completed)
          .slice(0, 8)
      )
    }
  }, [])

  const applyUEAResult = useCallback((data: UEAScoresRes) => {
    if (data.permissionError) {
      setUeaPermErr(true)
    } else if (data.success) {
      setUeaPermErr(false)
      setUeaOverview(data.overview)
      setUeaAppHealth(data.appHealth ?? [])
    }
  }, [])

  const applyAutopilotResult = useCallback((data: AutopilotEventsRes) => {
    if (data.permissionError) {
      setAutopilotPermErr(true)
    } else if (data.success) {
      setAutopilotPermErr(false)
      const events = data.events as AutopilotEvent[]
      const trend = new Map<string, { success: number; failed: number }>()
      const now = Date.now()
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now - i * 86400000)
        const key = d.toISOString().slice(0, 10)
        trend.set(key, { success: 0, failed: 0 })
      }
      for (const ev of events) {
        if (!ev.deviceRegisteredDateTime) continue
        const key = ev.deviceRegisteredDateTime.slice(0, 10)
        if (!trend.has(key)) continue
        const entry = trend.get(key)!
        if (ev.enrollmentState === 'enrolled') entry.success++
        else entry.failed++
      }
      setEnrollmentTrend(
        Array.from(trend.entries()).map(([date, v]) => ({ date: date.slice(5), ...v }))
      )
    }
  }, [])

  const fetchSummary = useCallback(async () => {
    const errs: string[] = []
    setLoadingApps(true)
    setLoadingDevices(true)
    setLoadingInstall(true)
    setLoadingUpdate(true)
    setLoadingUEA(true)
    setLoadingAutopilot(true)
    setErrors([])

    const [appsRes, devicesRes, installRes, updateRes, ueaRes, autopilotRes] = await Promise.allSettled([
      ipcPsGetIntuneApps(),
      ipcPsGetDevices(),
      ipcPsGetAppInstallStats(),
      ipcPsGetUpdateStates(),
      ipcPsGetUEAScores(),
      ipcPsGetAutopilotEvents(),
    ])

    setLoadingApps(false)
    setLoadingDevices(false)
    setLoadingInstall(false)
    setLoadingUpdate(false)
    setLoadingUEA(false)
    setLoadingAutopilot(false)

    // ── Apps ──────────────────────────────────────────────────────────────────
    if (appsRes.status === 'fulfilled' && appsRes.value.success) {
      applyAppsResult(appsRes.value)
    } else {
      if (appsRes.status === 'rejected') errs.push('Apps: ' + String(appsRes.reason))
      else if (appsRes.status === 'fulfilled') errs.push('Apps: ' + (appsRes.value.error ?? 'unknown error'))
    }

    // ── Devices ───────────────────────────────────────────────────────────────
    if (devicesRes.status === 'fulfilled' && devicesRes.value.success) {
      applyDevicesResult(devicesRes.value)
    } else {
      if (devicesRes.status === 'rejected') errs.push('Devices: ' + String(devicesRes.reason))
      else if (devicesRes.status === 'fulfilled') errs.push('Devices: ' + (devicesRes.value.error ?? 'unknown error'))
    }

    // ── App install / Update / UEA / Autopilot ────────────────────────────────
    if (installRes.status === 'fulfilled') applyInstallResult(installRes.value)
    if (updateRes.status === 'fulfilled') applyUpdateResult(updateRes.value)
    if (ueaRes.status === 'fulfilled') applyUEAResult(ueaRes.value)
    if (autopilotRes.status === 'fulfilled') applyAutopilotResult(autopilotRes.value)

    // ── Detect cache hits → background refreshes now in-flight ───────────────
    const cacheHits = [appsRes, devicesRes, installRes, updateRes, ueaRes, autopilotRes]
      .filter(r => r.status === 'fulfilled' && (r.value as unknown as Record<string, unknown>).fromCache === true).length
    if (cacheHits > 0) {
      pendingCacheRefreshes.current += cacheHits
      setBackgroundRefreshing(true)
    }

    setErrors(errs)
    setLastRefresh(new Date())
  }, [applyAppsResult, applyDevicesResult, applyInstallResult, applyUpdateResult, applyUEAResult, applyAutopilotResult])

  useEffect(() => {
    if (tenantChecked && tenant.isConnected) fetchSummary()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantChecked, tenant.isConnected])

  useEffect(() => {
    if (!tenant.isConnected) return
    const interval = setInterval(fetchSummary, 60_000)
    return () => clearInterval(interval)
  }, [tenant.isConnected, fetchSummary])

  // Subscribe to background cache refresh events
  useEffect(() => {
    const decrement = () => {
      pendingCacheRefreshes.current = Math.max(0, pendingCacheRefreshes.current - 1)
      if (pendingCacheRefreshes.current === 0) setBackgroundRefreshing(false)
    }
    const unsubs = [
      onCacheAppsUpdated(data => { if (data.success) applyAppsResult(data); decrement() }),
      onCacheDevicesUpdated(data => { if (data.success) applyDevicesResult(data); decrement() }),
      onCacheInstallStatsUpdated(data => { applyInstallResult(data); decrement() }),
      onCacheUpdateStatesUpdated(data => { applyUpdateResult(data); decrement() }),
      onCacheUEAScoresUpdated(data => { applyUEAResult(data); decrement() }),
      onCacheAutopilotEventsUpdated(data => { applyAutopilotResult(data); decrement() }),
    ]
    return () => unsubs.forEach(fn => fn())
  }, [applyAppsResult, applyDevicesResult, applyInstallResult, applyUpdateResult, applyUEAResult, applyAutopilotResult])

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  const loading = loadingApps || loadingDevices

  // ─── Alerts ────────────────────────────────────────────────────────────────

  const alerts: React.ReactNode[] = []
  if (deviceSummary && deviceSummary.nonCompliant > 0) {
    alerts.push(
      <AlertRow key="non-compliant" icon="⚠" text={`${deviceSummary.nonCompliant} non-compliant device${deviceSummary.nonCompliant > 1 ? 's' : ''}`} sub="These devices are out of compliance policy" color="var(--error)" onClick={() => navigate('/devices')} />
    )
  }
  if (deviceSummary && deviceSummary.inGracePeriod > 0) {
    alerts.push(
      <AlertRow key="grace" icon="⏱" text={`${deviceSummary.inGracePeriod} device${deviceSummary.inGracePeriod > 1 ? 's' : ''} in grace period`} sub="Compliance grace period will expire" color="var(--warning)" onClick={() => navigate('/devices')} />
    )
  }
  if (deviceSummary && deviceSummary.windowsUpdateNeeded > 0) {
    alerts.push(
      <AlertRow key="win-update" icon="🔄" text={`${deviceSummary.windowsUpdateNeeded} device${deviceSummary.windowsUpdateNeeded > 1 ? 's' : ''} need Windows updates`} sub="Trigger sync from the Devices page" onClick={() => navigate('/devices')} />
    )
  }
  if (securitySummary && securitySummary.rtpDisabled > 0) {
    alerts.push(
      <AlertRow key="rtp" icon="🛡" text={`${securitySummary.rtpDisabled} device${securitySummary.rtpDisabled > 1 ? 's' : ''} with real-time protection disabled`} color="var(--error)" onClick={() => navigate('/devices')} />
    )
  }
  if (tenantChecked && !tenant.isConnected) {
    alerts.push(
      <AlertRow key="no-tenant" icon="🔌" text="Tenant not connected" sub="Connect your Microsoft tenant to load live data" color="var(--error)" onClick={() => navigate('/settings/tenant')} />
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
          <button className="btn-primary" style={{ ...styles.navBtn, background: 'var(--bg-700)', border: '1px solid var(--border)' }} disabled>Dashboard</button>
          <button className="btn-ghost" style={styles.navBtn} onClick={() => navigate('/installed-apps')}>Installed Apps</button>
          <button className="btn-ghost" style={styles.navBtn} onClick={() => navigate('/catalog')}>App Catalog</button>
          <button className="btn-ghost" style={styles.navBtn} onClick={() => navigate('/deploy')}>Deploy</button>
          <button className="btn-ghost" style={styles.navBtn} onClick={() => navigate('/devices')}>Devices</button>
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
          {backgroundRefreshing && (
            <span style={{ fontSize: 11, color: 'var(--text-500)' }}>↻ Refreshing...</span>
          )}
          {!backgroundRefreshing && lastRefresh && (
            <span style={{ fontSize: 11, color: 'var(--text-500)' }}>Updated {lastRefresh.toLocaleTimeString()}</span>
          )}
          <button className="btn-secondary" style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => fetchSummary()} disabled={loading || !tenant.isConnected}>
            {loading ? '↻ Loading...' : '↺ Refresh'}
          </button>
          <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => navigate('/settings')}>Settings</button>
          <button className="btn-ghost" style={{ fontSize: 12 }} onClick={handleLogout}>Sign Out</button>
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

          {errors.length > 0 && (
            <div className="card" style={{ border: '1px solid var(--error)', padding: '10px 16px' }}>
              {errors.map((e, i) => <p key={i} style={{ color: 'var(--error)', fontSize: 13, margin: 0 }}>✕ {e}</p>)}
            </div>
          )}

          {/* ── Row 1: App Inventory + OS Distribution ── */}
          <div style={styles.twoCol}>

            <SectionCard title="App Inventory" loading={loadingApps} action={{ label: 'View All Apps', onClick: () => navigate('/installed-apps') }}>
              {loadingApps && !appSummary ? (
                <div style={styles.loadingRow}>Loading app data...</div>
              ) : appSummary ? (
                <>
                  <div style={styles.statRow}>
                    <StatCard label="Total Apps" value={appSummary.total} onClick={() => navigate('/installed-apps')} />
                    <StatCard label="Published" value={appSummary.current} color="var(--success)" onClick={() => navigate('/installed-apps')} />
                    <StatCard label="Pending" value={appSummary.unknown} color="var(--warning)" onClick={() => navigate('/installed-apps')} />
                  </div>
                  <MiniBar total={appSummary.total} segments={[
                    { value: appSummary.current, color: 'var(--success)', label: 'Published' },
                    { value: appSummary.unknown, color: 'var(--warning)', label: 'Pending' },
                    { value: appSummary.cloudOnly, color: 'var(--surface-200)', label: 'Other' },
                  ]} />
                  <div style={styles.barLegend}>
                    <LegendItem color="var(--success)" label="Published" />
                    <LegendItem color="var(--warning)" label="Pending / Processing" />
                    <LegendItem color="var(--surface-200)" label="Other" />
                  </div>
                </>
              ) : (
                <div style={styles.emptyState}>No app data — connect your tenant and refresh.</div>
              )}
            </SectionCard>

            <SectionCard title="OS Version Distribution" loading={loadingDevices}>
              {loadingDevices && osDistribution.length === 0 ? (
                <div style={styles.loadingRow}>Loading device data...</div>
              ) : osDistribution.length > 0 ? (
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart layout="vertical" data={osDistribution} margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                    <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--text-400)' }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="version" tick={{ fontSize: 11, fill: '#e2e8f0' }} axisLine={false} tickLine={false} width={90} />
                    <Tooltip
                      contentStyle={{ background: 'var(--bg-800)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
                      itemStyle={{ color: 'var(--text-200)' }}
                      cursor={{ fill: 'var(--surface-100)', opacity: 0.3 }}
                    />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={18}>
                      {osDistribution.map((_, i) => (
                        <Cell key={i} fill={i === 0 ? 'var(--accent)' : `hsl(${220 + i * 15}, 60%, ${55 - i * 3}%)`} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div style={styles.emptyState}>No device data — connect your tenant and refresh.</div>
              )}
            </SectionCard>

          </div>

          {/* ── Row 2: Device Health (full width) ── */}
          <SectionCard title="Device Health" loading={loadingDevices} action={{ label: 'View Devices', onClick: () => navigate('/devices') }}>
            {loadingDevices && !deviceSummary ? (
              <div style={styles.loadingRow}>Loading device data...</div>
            ) : deviceSummary ? (
              <>
                <div style={styles.statRow}>
                  <StatCard label="Total Devices" value={deviceSummary.total} onClick={() => navigate('/devices')} />
                  <StatCard label="Compliant" value={deviceSummary.compliant} color="var(--success)" onClick={() => navigate('/devices')} />
                  <StatCard label="Non-Compliant" value={deviceSummary.nonCompliant} color={deviceSummary.nonCompliant > 0 ? 'var(--error)' : 'var(--text-400)'} alert={deviceSummary.nonCompliant > 0} onClick={() => navigate('/devices')} />
                  <StatCard label="Needs Attention" value={deviceSummary.needsAttention} color={deviceSummary.needsAttention > 0 ? 'var(--warning)' : 'var(--text-400)'} alert={deviceSummary.needsAttention > 0} onClick={() => navigate('/devices')} />
                </div>
                <MiniBar total={deviceSummary.total} segments={[
                  { value: deviceSummary.compliant, color: 'var(--success)', label: 'Compliant' },
                  { value: deviceSummary.inGracePeriod, color: 'var(--warning)', label: 'Grace Period' },
                  { value: deviceSummary.nonCompliant, color: 'var(--error)', label: 'Non-Compliant' },
                  { value: Math.max(0, deviceSummary.total - deviceSummary.compliant - deviceSummary.inGracePeriod - deviceSummary.nonCompliant), color: 'var(--surface-200)', label: 'Unknown' },
                ]} />
                <div style={styles.barLegend}>
                  <LegendItem color="var(--success)" label="Compliant" />
                  <LegendItem color="var(--warning)" label="Grace Period" />
                  <LegendItem color="var(--error)" label="Non-Compliant" />
                  <LegendItem color="var(--surface-200)" label="Unknown" />
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                  <div style={styles.updateTile}>
                    <span style={{ fontSize: 20, fontWeight: 700, color: deviceSummary.windowsUpdateNeeded > 0 ? 'var(--warning)' : 'var(--success)' }}>{deviceSummary.windowsUpdateNeeded}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-400)' }}>Windows Updates Needed</span>
                  </div>
                  <div style={styles.updateTile}>
                    <span style={{ fontSize: 20, fontWeight: 700, color: deviceSummary.driverUpdateNeeded > 0 ? 'var(--warning)' : 'var(--success)' }}>{deviceSummary.driverUpdateNeeded}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-400)' }}>Driver Updates Needed</span>
                  </div>
                  <div style={styles.updateTile}>
                    <span style={{ fontSize: 20, fontWeight: 700, color: deviceSummary.inGracePeriod > 0 ? 'var(--warning)' : 'var(--success)' }}>{deviceSummary.inGracePeriod}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-400)' }}>In Grace Period</span>
                  </div>
                </div>
              </>
            ) : (
              <div style={styles.emptyState}>No device data — connect your tenant and refresh.</div>
            )}
          </SectionCard>

          {/* ── Row 3: Security Posture + Windows Update Compliance ── */}
          <div style={styles.twoCol}>

            <SectionCard title="Security Posture" loading={loadingDevices}>
              {loadingDevices && !securitySummary ? (
                <div style={styles.loadingRow}>Loading...</div>
              ) : securitySummary ? (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
                    <div style={styles.secTile}>
                      <span style={{ fontSize: 22, fontWeight: 700, color: securitySummary.rtpDisabled > 0 ? 'var(--error)' : 'var(--success)' }}>{securitySummary.rtpDisabled}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-400)', textTransform: 'uppercase', marginTop: 2 }}>RTP Disabled</span>
                    </div>
                    <div style={styles.secTile}>
                      <span style={{ fontSize: 22, fontWeight: 700, color: securitySummary.signatureOverdue > 0 ? 'var(--warning)' : 'var(--success)' }}>{securitySummary.signatureOverdue}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-400)', textTransform: 'uppercase', marginTop: 2 }}>Signature Overdue</span>
                    </div>
                    <div style={styles.secTile}>
                      <span style={{ fontSize: 22, fontWeight: 700, color: securitySummary.scanOverdue > 0 ? 'var(--warning)' : 'var(--success)' }}>{securitySummary.scanOverdue}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-400)', textTransform: 'uppercase', marginTop: 2 }}>Scan Overdue</span>
                    </div>
                    <div style={styles.secTile}>
                      <span style={{ fontSize: 22, fontWeight: 700, color: securitySummary.rebootPending > 0 ? 'var(--warning)' : 'var(--success)' }}>{securitySummary.rebootPending}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-400)', textTransform: 'uppercase', marginTop: 2 }}>Reboot Pending</span>
                    </div>
                  </div>
                  {securitySummary.attentionDevices.length > 0 && (
                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-400)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Devices needing security attention</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {securitySummary.attentionDevices.map(d => (
                          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                            <span style={{ flex: 1, color: 'var(--text-200)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.deviceName || d.id}</span>
                            <div style={{ display: 'flex', gap: 4 }}>
                              {!d.realTimeProtectionEnabled && <span style={styles.badge('error')}>RTP off</span>}
                              {d.signatureUpdateOverdue && <span style={styles.badge('warning')}>Sig overdue</span>}
                              {d.quickScanOverdue && <span style={styles.badge('warning')}>Scan due</span>}
                              {d.rebootRequired && <span style={styles.badge('info')}>Reboot</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div style={styles.emptyState}>No device data — connect your tenant and refresh.</div>
              )}
            </SectionCard>

            <SectionCard title="Windows Update Compliance" loading={loadingUpdate}>
              {loadingUpdate && !updateSummary ? (
                <div style={styles.loadingRow}>Loading...</div>
              ) : updatePermErr ? (
                <PermissionBanner permission="DeviceManagementManagedDevices.Read.All (beta)" />
              ) : updateVersions.length > 0 ? (
                <>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                    {updateSummary && Object.entries(updateSummary).map(([status, count]) => (
                      <div key={status} style={styles.updateTile}>
                        <span style={{ fontSize: 18, fontWeight: 700, color: UPDATE_STATUS_COLORS[status] ?? 'var(--text-400)' }}>{count}</span>
                        <span style={{ fontSize: 10, color: 'var(--text-500)', textTransform: 'capitalize' }}>{status}</span>
                      </div>
                    ))}
                  </div>
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={updateVersions} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                      <XAxis dataKey="version" tick={{ fontSize: 10, fill: 'var(--text-400)' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: 'var(--text-400)' }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{ background: 'var(--bg-800)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11 }}
                        cursor={{ fill: 'var(--surface-100)', opacity: 0.3 }}
                      />
                      <Bar dataKey="completed"  stackId="a" fill={UPDATE_STATUS_COLORS.completed}  maxBarSize={32} />
                      <Bar dataKey="inProgress" stackId="a" fill={UPDATE_STATUS_COLORS.inProgress} maxBarSize={32} />
                      <Bar dataKey="pending"    stackId="a" fill={UPDATE_STATUS_COLORS.pending}    maxBarSize={32} />
                      <Bar dataKey="notStarted" stackId="a" fill={UPDATE_STATUS_COLORS.notStarted} maxBarSize={32} />
                      <Bar dataKey="failed"     stackId="a" fill={UPDATE_STATUS_COLORS.failed}     maxBarSize={32} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  <div style={styles.barLegend}>
                    {Object.entries(UPDATE_STATUS_COLORS).map(([k, c]) => <LegendItem key={k} color={c} label={k.charAt(0).toUpperCase() + k.slice(1)} />)}
                  </div>
                </>
              ) : (
                <div style={styles.emptyState}>No update state data available.</div>
              )}
            </SectionCard>

          </div>

          {/* ── Row 4: App Install Health + UEA Scores ── */}
          <div style={styles.twoCol}>

            <SectionCard title="App Install Health" loading={loadingInstall}>
              {loadingInstall && appInstallStats.length === 0 ? (
                <div style={styles.loadingRow}>Loading...</div>
              ) : appInstallPermErr ? (
                <PermissionBanner permission="DeviceManagementApps.Read.All" />
              ) : appInstallStats.length > 0 ? (
                <>
                  {appInstallTruncated && (
                    <div style={{ fontSize: 11, color: 'var(--text-500)', marginBottom: 8 }}>Showing top 50 apps by deployment.</div>
                  )}
                  <div style={{ overflowY: 'auto', maxHeight: 240 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr>
                          {['App', 'Installed', 'Failed', 'Pending', 'Success%'].map(h => (
                            <th key={h} style={{ textAlign: h === 'App' ? 'left' : 'right', padding: '4px 6px', color: 'var(--text-400)', fontWeight: 600, borderBottom: '1px solid var(--border)', fontSize: 11 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {appInstallStats.map(app => {
                          const pct = app.successPercent
                          const pctColor = pct >= 90 ? 'var(--success)' : pct >= 70 ? 'var(--warning)' : 'var(--error)'
                          return (
                            <tr key={app.id} style={{ borderBottom: '1px solid var(--border)' }}>
                              <td style={{ padding: '5px 6px', color: 'var(--text-200)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={app.displayName}>{app.displayName}</td>
                              <td style={{ padding: '5px 6px', textAlign: 'right', color: 'var(--success)' }}>{app.installed}</td>
                              <td style={{ padding: '5px 6px', textAlign: 'right', color: app.failed > 0 ? 'var(--error)' : 'var(--text-400)' }}>{app.failed}</td>
                              <td style={{ padding: '5px 6px', textAlign: 'right', color: 'var(--text-400)' }}>{app.pending}</td>
                              <td style={{ padding: '5px 6px', textAlign: 'right', fontWeight: 600, color: pctColor }}>{pct.toFixed(0)}%</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div style={styles.emptyState}>No app install data available.</div>
              )}
            </SectionCard>

            <SectionCard title="User Experience Analytics" loading={loadingUEA}>
              {loadingUEA && !ueaOverview ? (
                <div style={styles.loadingRow}>Loading...</div>
              ) : ueaPermErr ? (
                <PermissionBanner permission="UserExperienceAnalytics.Read.All" />
              ) : ueaOverview ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: 16 }}>
                    <ScoreRing score={ueaOverview.startupScore} label="Startup" />
                    <ScoreRing score={ueaOverview.appReliabilityScore} label="App Reliability" />
                    <ScoreRing score={ueaOverview.batteryHealthScore} label="Battery" />
                    <ScoreRing score={ueaOverview.workFromAnywhereScore} label="Work Anywhere" />
                  </div>
                  {ueaAppHealth.length > 0 && (
                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-400)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Top app health issues</div>
                      <div style={{ overflowY: 'auto', maxHeight: 140 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                          <thead>
                            <tr>
                              {['App', 'Crashes', 'Hangs'].map(h => (
                                <th key={h} style={{ textAlign: h === 'App' ? 'left' : 'right', padding: '3px 6px', color: 'var(--text-400)', fontWeight: 600, fontSize: 10 }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {ueaAppHealth.map((a, i) => (
                              <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                                <td style={{ padding: '4px 6px', color: 'var(--text-200)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.appName}>{a.appName}</td>
                                <td style={{ padding: '4px 6px', textAlign: 'right', color: a.crashCount > 0 ? 'var(--error)' : 'var(--text-400)' }}>{a.crashCount}</td>
                                <td style={{ padding: '4px 6px', textAlign: 'right', color: a.hangCount > 0 ? 'var(--warning)' : 'var(--text-400)' }}>{a.hangCount}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div style={styles.emptyState}>No UEA data available.</div>
              )}
            </SectionCard>

          </div>

          {/* ── Row 5: Enrollment Trend + Alerts ── */}
          <div style={styles.twoCol}>

            <SectionCard title="Enrollment Trend (30 days)" loading={loadingAutopilot}>
              {loadingAutopilot && enrollmentTrend.length === 0 ? (
                <div style={styles.loadingRow}>Loading...</div>
              ) : autopilotPermErr ? (
                <PermissionBanner permission="DeviceManagementServiceConfig.ReadWrite.All" />
              ) : enrollmentTrend.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={enrollmentTrend} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-400)' }} axisLine={false} tickLine={false} interval={4} />
                      <YAxis tick={{ fontSize: 10, fill: 'var(--text-400)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{ background: 'var(--bg-800)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11 }}
                        cursor={{ stroke: 'var(--border)' }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-400)' }} />
                      <Line type="monotone" dataKey="success" stroke="var(--success)" strokeWidth={2} dot={false} name="Enrolled" />
                      <Line type="monotone" dataKey="failed" stroke="var(--error)" strokeWidth={2} dot={false} name="Failed" />
                    </LineChart>
                  </ResponsiveContainer>
                </>
              ) : (
                <div style={styles.emptyState}>No enrollment event data available.</div>
              )}
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

          {/* ── Row 6: Enrollment Distribution ── */}
          {enrollmentTypes.length > 0 && (
            <SectionCard title="Enrollment Type Distribution">
              <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                <ResponsiveContainer width={200} height={160}>
                  <PieChart>
                    <Pie data={enrollmentTypes} cx="50%" cy="50%" innerRadius={40} outerRadius={70} dataKey="value" paddingAngle={2}>
                      {enrollmentTypes.map((_, i) => (
                        <Cell key={i} fill={ENROLLMENT_COLORS[i % ENROLLMENT_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: 'var(--bg-800)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                  {enrollmentTypes.map((et, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                      <div style={{ width: 10, height: 10, borderRadius: 2, background: ENROLLMENT_COLORS[i % ENROLLMENT_COLORS.length], flexShrink: 0 }} />
                      <span style={{ flex: 1, color: 'var(--text-200)' }}>{et.name}</span>
                      <span style={{ color: 'var(--text-400)', fontVariantNumeric: 'tabular-nums' }}>{et.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </SectionCard>
          )}

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

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = {
  shell: { height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' } as React.CSSProperties,
  topbar: { display: 'flex', alignItems: 'center', gap: 16, padding: '10px 20px', background: 'var(--bg-800)', borderBottom: '1px solid var(--border)', flexShrink: 0 } as React.CSSProperties,
  brand: { display: 'flex', alignItems: 'center', gap: 8, marginRight: 8 } as React.CSSProperties,
  nav: { display: 'flex', gap: 4, marginRight: 8 } as React.CSSProperties,
  navBtn: { fontSize: 13, padding: '5px 14px' } as React.CSSProperties,
  tenantStatus: { display: 'flex', alignItems: 'center', gap: 6, flex: 1 } as React.CSSProperties,
  page: { flex: 1, overflow: 'auto', padding: 24 } as React.CSSProperties,
  content: { maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 } as React.CSSProperties,
  statRow: { display: 'flex', gap: 12, marginBottom: 14 } as React.CSSProperties,
  twoCol: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 } as React.CSSProperties,
  loadingRow: { padding: '20px 0', color: 'var(--text-400)', fontSize: 13, textAlign: 'center' } as React.CSSProperties,
  emptyState: { padding: '20px 0', color: 'var(--text-400)', fontSize: 13, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 } as React.CSSProperties,
  barLegend: { display: 'flex', gap: 14, marginTop: 8, flexWrap: 'wrap' } as React.CSSProperties,
  updateTile: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 8px', gap: 4, background: 'var(--bg-800)', borderRadius: 6, border: '1px solid var(--border)' } as React.CSSProperties,
  secTile: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 8px', background: 'var(--bg-800)', borderRadius: 6, border: '1px solid var(--border)' } as React.CSSProperties,
  badge: (variant: 'error' | 'warning' | 'info') => ({
    padding: '1px 6px',
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 600,
    background: variant === 'error' ? 'rgba(239,68,68,0.15)' : variant === 'warning' ? 'rgba(245,158,11,0.15)' : 'rgba(99,102,241,0.15)',
    color: variant === 'error' ? 'var(--error)' : variant === 'warning' ? 'var(--warning)' : '#818cf8',
  } as React.CSSProperties),
}

const cardStyles: Record<string, React.CSSProperties> = {
  statCard: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '14px 10px', textAlign: 'center', minWidth: 0 },
  section: { display: 'flex', flexDirection: 'column', gap: 0, padding: 20 },
  sectionHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  sectionTitle: { fontSize: 14, fontWeight: 600, color: 'var(--text-100)' },
  alertRow: { display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: '0 6px 6px 0', background: 'var(--bg-800)' },
}

const chartStyles: Record<string, React.CSSProperties> = {
  barTrack: { width: '100%', height: 8, borderRadius: 4, background: 'var(--surface-200)', display: 'flex', overflow: 'hidden' },
  barSegment: { height: '100%', transition: 'width 0.3s ease' },
}
