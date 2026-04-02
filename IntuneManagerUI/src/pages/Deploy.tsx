import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTenant } from '../contexts/TenantContext'
import LogPanel from '../components/LogPanel'
import ProgressStepper from '../components/ProgressStepper'
import type { LogEntry, DeployJob } from '../types/app'
import type { IntunewinPackage } from '../types/ipc'
import {
  ipcAiPackageOnly,
  ipcAiUploadOnly,
  ipcAiCancel,
  ipcPsListIntunewinPackages,
  onJobLog,
  onJobPhaseChange,
  onJobComplete,
  onJobError,
  onJobPackageComplete
} from '../lib/ipc'

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Safely coerce a Record<string,unknown> field to a display string
function psStr(val: unknown, fallback = '—'): string {
  if (val == null) return fallback
  if (typeof val === 'string') return val || fallback
  return String(val)
}

// ─── Types ────────────────────────────────────────────────────────────────────

type JobMode = 'package' | 'deploy'

interface ActiveJob extends DeployJob {
  mode: JobMode
  intunewinPath?: string | null
}

interface UpdateQueueItem {
  id: string
  name: string
  wingetId: string
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Deploy() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { tenant } = useTenant()

  // Ready packages (from output folder)
  const [packages, setPackages] = useState<IntunewinPackage[]>([])
  const [packagesLoading, setPackagesLoading] = useState(true)
  const [packagesError, setPackagesError] = useState<string | null>(null)
  const [selectedPkg, setSelectedPkg] = useState<IntunewinPackage | null>(null)

  // Active job
  const [job, setJob] = useState<ActiveJob | null>(null)
  const unsubsRef = useRef<Array<() => void>>([])
  const packageResultRef = useRef<{ intunewinPath: string | null; packageSettings: Record<string, unknown> | null } | null>(null)
  const pageRef = useRef<HTMLDivElement>(null)

  // "Deploy to Intune?" confirmation modal
  const [deployPrompt, setDeployPrompt] = useState<{ appRequest: string; intunewinPath: string | null; packageSettings: Record<string, unknown> | null } | null>(null)
  const [deploying, setDeploying] = useState(false)

  // Update queue (for Update All from Dashboard)
  const [updateQueue, setUpdateQueue] = useState<UpdateQueueItem[]>([])
  const [updateQueueIndex, setUpdateQueueIndex] = useState(0)
  const updateQueueRef = useRef<UpdateQueueItem[]>([])
  const updateQueueIndexRef = useRef(0)

  // Cleanup subscriptions on unmount
  useEffect(() => {
    return () => { unsubsRef.current.forEach(fn => fn()) }
  }, [])

  // Scroll to top when a job starts so the progress panel stays in view
  useEffect(() => {
    if (job && job.status === 'running') {
      pageRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [job?.status])

  // Load ready packages on mount
  useEffect(() => {
    loadPackages()
  }, [])

  // On mount: read URL params and auto-start job(s)
  useEffect(() => {
    const packageParam = searchParams.get('package')
    const singleName = searchParams.get('name')
    const singleWingetId = searchParams.get('wingetId')
    const updateAllRaw = searchParams.get('updateAll')

    if (packageParam) {
      // Came from App Catalog — start packaging job
      setSearchParams({}, { replace: true })
      startPackageJob(decodeURIComponent(packageParam))
    } else if (updateAllRaw) {
      try {
        const queue: UpdateQueueItem[] = JSON.parse(decodeURIComponent(updateAllRaw))
        if (queue.length > 0) {
          updateQueueRef.current = queue
          updateQueueIndexRef.current = 0
          setUpdateQueue(queue)
          setUpdateQueueIndex(0)
          setSearchParams({}, { replace: true })
          const first = queue[0]
          const req = first.wingetId
            ? `Update to latest version: ${first.name} (winget ID: ${first.wingetId}). Update existing Intune app ID: ${first.id}`
            : `Update to latest version: ${first.name}. Update existing Intune app ID: ${first.id}`
          startPackageJob(req)
        }
      } catch { /* invalid JSON, ignore */ }
    } else if (singleName) {
      const req = singleWingetId
        ? `Update to latest version: ${singleName} (winget ID: ${singleWingetId})`
        : `Update to latest version: ${singleName}`
      setSearchParams({}, { replace: true })
      startPackageJob(req)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadPackages = async () => {
    setPackagesLoading(true)
    setPackagesError(null)
    try {
      const res = await ipcPsListIntunewinPackages()
      if (res.success) {
        setPackages(res.packages ?? [])
      } else {
        setPackagesError(res.error ?? 'Failed to load packages')
      }
    } catch (err) {
      setPackagesError((err as Error).message ?? 'Failed to load packages')
    } finally {
      setPackagesLoading(false)
    }
  }

  // ─── Job runner ─────────────────────────────────────────────────────────────

  const clearSubs = () => {
    unsubsRef.current.forEach(fn => fn())
    unsubsRef.current = []
  }

  const startPackageJob = useCallback(async (appRequest: string) => {
    clearSubs()
    setDeployPrompt(null)
    packageResultRef.current = null

    const res = await ipcAiPackageOnly({ userRequest: appRequest })
    const jobId = res.jobId

    setJob({
      jobId,
      phase: 'analyzing',
      phaseLabel: 'Analyzing request...',
      logs: [],
      status: 'running',
      mode: 'package'
    })

    unsubsRef.current.push(
      onJobLog((data: LogEntry) => {
        if (data.jobId !== jobId) return
        setJob(prev => prev ? { ...prev, logs: [...prev.logs, data] } : prev)
      }),
      onJobPhaseChange((data: { jobId: string; phase: string; label: string }) => {
        if (data.jobId !== jobId) return
        setJob(prev => prev ? { ...prev, phase: data.phase, phaseLabel: data.label } : prev)
      }),
      onJobPackageComplete((data: { jobId: string; intunewinPath: string | null; packageSettings: Record<string, unknown> | null }) => {
        if (data.jobId !== jobId) return
        packageResultRef.current = { intunewinPath: data.intunewinPath, packageSettings: data.packageSettings }
        setJob(prev => prev ? { ...prev, intunewinPath: data.intunewinPath } : prev)
      }),
      onJobComplete((data: { jobId: string }) => {
        if (data.jobId !== jobId) return
        setJob(prev => prev ? { ...prev, status: 'complete' as const, phase: 'done', phaseLabel: 'Packaging complete!' } : prev)
        const pkg = packageResultRef.current
        if (pkg) {
          setDeployPrompt({ appRequest, intunewinPath: pkg.intunewinPath, packageSettings: pkg.packageSettings })
        }
        clearSubs()
        // Refresh ready packages list so newly built .intunewin appears
        loadPackages()
      }),
      onJobError((data: { jobId: string; error: string }) => {
        if (data.jobId !== jobId) return
        setJob(prev => prev ? { ...prev, status: 'error', error: data.error } : prev)
        clearSubs()
      })
    )
  }, [])

  const startUploadOnlyJob = useCallback(async (intunewinPath: string | null, packageSettings: Record<string, unknown> | null) => {
    if (!intunewinPath || !packageSettings) return
    clearSubs()
    setDeployPrompt(null)
    setDeploying(true)

    const res = await ipcAiUploadOnly({ intunewinPath, packageSettings })
    const jobId = res.jobId

    setJob(prev => prev
      ? { ...prev, jobId, phase: 'uploading', phaseLabel: 'Uploading to Intune...', status: 'running', mode: 'deploy' }
      : { jobId, phase: 'uploading', phaseLabel: 'Uploading to Intune...', logs: [], status: 'running', mode: 'deploy' }
    )
    setDeploying(false)

    unsubsRef.current.push(
      onJobLog((data: LogEntry) => {
        if (data.jobId !== jobId) return
        setJob(prev => prev ? { ...prev, logs: [...prev.logs, data] } : prev)
      }),
      onJobPhaseChange((data: { jobId: string; phase: string; label: string }) => {
        if (data.jobId !== jobId) return
        setJob(prev => prev ? { ...prev, phase: data.phase, phaseLabel: data.label } : prev)
      }),
      onJobComplete((data: { jobId: string }) => {
        if (data.jobId !== jobId) return
        clearSubs()

        // Advance update queue if in batch mode
        const queue = updateQueueRef.current
        const nextIndex = updateQueueIndexRef.current + 1
        if (queue.length > 0 && nextIndex < queue.length) {
          updateQueueIndexRef.current = nextIndex
          setUpdateQueueIndex(nextIndex)
          setJob(null)
          const next = queue[nextIndex]
          const req = next.wingetId
            ? `Update to latest version: ${next.name} (winget ID: ${next.wingetId}). Update existing Intune app ID: ${next.id}`
            : `Update to latest version: ${next.name}. Update existing Intune app ID: ${next.id}`
          startPackageJob(req)
        } else {
          const allDone = queue.length > 0
          setJob(prev => prev ? {
            ...prev, status: 'complete', phase: 'done',
            phaseLabel: allDone ? `All ${queue.length} updates deployed!` : 'Deployment complete!'
          } : prev)
          if (allDone) {
            updateQueueRef.current = []
            updateQueueIndexRef.current = 0
            setUpdateQueue([])
            setUpdateQueueIndex(0)
          }
        }
      }),
      onJobError((data: { jobId: string; error: string }) => {
        if (data.jobId !== jobId) return
        setJob(prev => prev ? { ...prev, status: 'error', error: data.error } : prev)
        clearSubs()
      })
    )
  }, [])

  const handleCancel = async () => {
    if (!job) return
    await ipcAiCancel(job.jobId)
    setJob(prev => prev ? { ...prev, status: 'cancelled' } : prev)
    clearSubs()
  }

  const handleReset = () => {
    clearSubs()
    setJob(null)
    setDeployPrompt(null)
  }

  const isRunning = job?.status === 'running'
  const isDone = job?.status === 'complete'
  const isError = job?.status === 'error'
  const showJobPanel = !!job

  // ─── Details modal for ready packages ────────────────────────────────────────

  const renderDetailsModal = () => {
    if (!selectedPkg) return null
    const ps = selectedPkg.packageSettings
    return (
      <div style={overlayStyles.backdrop} onClick={() => setSelectedPkg(null)}>
        <div style={overlayStyles.modal} onClick={e => e.stopPropagation()}>
          <div style={overlayStyles.header}>
            <div style={overlayStyles.logo}>
              <span style={overlayStyles.initials}>{getInitials(selectedPkg.appName)}</span>
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 18 }}>{ps ? psStr(ps.app_name, selectedPkg.appName) : selectedPkg.appName}</h2>
              <p style={{ margin: 0, color: 'var(--text-400)', fontSize: 13 }}>{ps ? psStr(ps.publisher) : '—'}</p>
            </div>
          </div>
          <table style={overlayStyles.table}>
            <tbody>
              {ps ? (
                <>
                  <tr><td style={overlayStyles.label}>Version</td><td>{psStr(ps.app_version)}</td></tr>
                  <tr><td style={overlayStyles.label}>Description</td><td>{psStr(ps.description)}</td></tr>
                  <tr><td style={overlayStyles.label}>Min OS</td><td>{psStr(ps.min_os)}</td></tr>
                  <tr><td style={overlayStyles.label}>Install</td><td style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>{psStr(ps.install_command)}</td></tr>
                  <tr><td style={overlayStyles.label}>Winget ID</td><td>{psStr(ps.winget_id)}</td></tr>
                </>
              ) : (
                <tr><td colSpan={2} style={{ color: 'var(--text-400)', fontSize: 13 }}>No PACKAGE_SETTINGS.md found for this package.</td></tr>
              )}
              <tr><td style={overlayStyles.label}>File</td><td style={{ fontSize: 12, wordBreak: 'break-all' }}>{selectedPkg.filename}</td></tr>
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
            <button
              className="btn-primary"
              disabled={isRunning || !selectedPkg.packageSettings}
              title={!selectedPkg.packageSettings ? 'No PACKAGE_SETTINGS.md found — cannot deploy' : undefined}
              onClick={() => {
                setSelectedPkg(null)
                startUploadOnlyJob(selectedPkg.intunewinPath, selectedPkg.packageSettings)
              }}
            >
              Deploy to Intune
            </button>
            <button className="btn-ghost" onClick={() => setSelectedPkg(null)}>Close</button>
          </div>
        </div>
      </div>
    )
  }

  // ─── Main render ─────────────────────────────────────────────────────────────

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
          <button className="btn-ghost" style={{ fontSize: 13, padding: '5px 14px' }} onClick={() => navigate('/catalog')}>
            App Catalog
          </button>
          <button
            className="btn-primary"
            style={{ fontSize: 13, padding: '5px 14px', background: 'var(--bg-700)', border: '1px solid var(--border)' }}
            disabled
          >
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

      <div ref={pageRef} style={styles.page}>
        <div style={styles.content}>

          {/* Header */}
          <div style={styles.header}>
            <h1 style={styles.title}>Deployment</h1>
            <p style={styles.subtitle}>
              Deploy packaged applications to Microsoft Intune. Only apps with a completed .intunewin package are shown below.
              To package a new app, go to the <button className="btn-link" onClick={() => navigate('/catalog')}>App Catalog</button>.
            </p>
          </div>

          {/* Job panel */}
          {showJobPanel && (
            <div className="card" style={styles.jobPanel}>
              <div style={styles.jobHeader}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>
                    {job.mode === 'package' ? 'Packaging' : 'Deploying'}
                  </span>
                  {updateQueue.length > 1 && updateQueue[updateQueueIndex] && (
                    <span style={{
                      fontSize: 11, background: 'var(--surface-200)', color: 'var(--text-400)',
                      borderRadius: 10, padding: '2px 8px'
                    }}>
                      {updateQueueIndex + 1} of {updateQueue.length}: {updateQueue[updateQueueIndex].name}
                    </span>
                  )}
                </div>
                {isRunning && (
                  <button className="btn-danger" style={{ fontSize: 12 }} onClick={handleCancel}>
                    Cancel
                  </button>
                )}
                {(isDone || isError) && (
                  <button className="btn-ghost" style={{ fontSize: 12 }} onClick={handleReset}>
                    Clear
                  </button>
                )}
              </div>

              <ProgressStepper currentPhase={job.phase} isError={isError} />

              <div style={{ marginBottom: 6 }}>
                <span style={{
                  fontSize: 13,
                  color: isDone ? 'var(--success)' : isError ? 'var(--error)' : 'var(--text-200)',
                  fontWeight: 500
                }}>
                  {isDone ? `✓ ${job.phaseLabel}` : isError ? `✕ ${job.error}` : job.phaseLabel}
                </span>
              </div>

              <LogPanel logs={job.logs} height={360} onClear={() => setJob(prev => prev ? { ...prev, logs: [] } : prev)} />

              {(isDone || isError) && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button className="btn-secondary" onClick={handleReset}>Clear</button>
                  <button className="btn-secondary" onClick={() => navigate('/dashboard')}>Dashboard</button>
                </div>
              )}
            </div>
          )}

          {/* "Deploy to Intune?" confirmation prompt */}
          {deployPrompt && !deploying && (
            <div className="card" style={{ ...styles.deployPrompt, border: '1px solid var(--primary)' }}>
              <p style={{ fontWeight: 600, marginBottom: 6 }}>Package created successfully</p>
              <p style={{ fontSize: 13, color: 'var(--text-400)', marginBottom: 16 }}>
                Do you want to deploy this application to Intune now?
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn-primary"
                  onClick={() => startUploadOnlyJob(deployPrompt.intunewinPath, deployPrompt.packageSettings)}
                >
                  Yes, Deploy to Intune
                </button>
                <button className="btn-ghost" onClick={() => setDeployPrompt(null)}>
                  No, keep package only
                </button>
              </div>
            </div>
          )}

          {deploying && (
            <div className="card" style={styles.deployPrompt}>
              <p style={{ color: 'var(--text-400)', fontSize: 13 }}>Starting deployment...</p>
            </div>
          )}

          {/* Ready to Deploy section */}
          <section>
            <div style={styles.sectionHeader}>
              <h2 style={styles.sectionTitle}>
                Ready to Deploy
                {!packagesLoading && packages.length > 0 && (
                  <span style={styles.countBadge}>{packages.length}</span>
                )}
                {packagesLoading && <span style={styles.loadingBadge}>Loading...</span>}
              </h2>
              <button
                className="btn-ghost"
                style={{ fontSize: 12 }}
                onClick={loadPackages}
                disabled={packagesLoading}
              >
                ↺ Refresh
              </button>
            </div>

            {packagesError && (
              <div className="card" style={{ border: '1px solid var(--error)', padding: '12px 16px', marginBottom: 8 }}>
                <p style={{ color: 'var(--error)', fontSize: 13, margin: 0 }}>
                  Could not load packages: {packagesError}
                </p>
              </div>
            )}

            {!packagesLoading && !packagesError && packages.length === 0 && (
              <div className="card" style={{ padding: 24, textAlign: 'center' }}>
                <p style={{ color: 'var(--text-400)', fontSize: 13, marginBottom: 12 }}>
                  No packaged apps found in the output folder.
                </p>
                <button className="btn-primary" style={{ fontSize: 13 }} onClick={() => navigate('/catalog')}>
                  Go to App Catalog
                </button>
              </div>
            )}

            {!packagesLoading && !packagesError && packages.length > 0 && (
              <div style={styles.grid}>
                {packages.map(pkg => (
                  <PackageCard
                    key={pkg.intunewinPath}
                    pkg={pkg}
                    onDeploy={() => startUploadOnlyJob(pkg.intunewinPath, pkg.packageSettings)}
                    onDetails={() => setSelectedPkg(pkg)}
                    disabled={isRunning}
                  />
                ))}
              </div>
            )}
          </section>

        </div>
      </div>

      {renderDetailsModal()}
    </div>
  )
}

// ─── PackageCard component ─────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1').trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('')
}

interface PackageCardProps {
  pkg: IntunewinPackage
  onDeploy: () => void
  onDetails: () => void
  disabled?: boolean
}

function PackageCard({ pkg, onDeploy, onDetails, disabled }: PackageCardProps) {
  const ps = pkg.packageSettings
  const displayName = ps ? psStr(ps.app_name, pkg.appName) : pkg.appName
  const publisher = ps ? psStr(ps.publisher) : '—'
  const description = ps ? psStr(ps.description, 'No description available') : 'No description available'
  const version = ps ? (psStr(ps.app_version, '') || null) : null
  const initials = getInitials(displayName)

  return (
    <div style={cardStyles.card}>
      <div style={cardStyles.logo}>
        <span style={cardStyles.initials}>{initials}</span>
      </div>

      <div style={cardStyles.body}>
        <div style={cardStyles.nameRow}>
          <span style={cardStyles.name}>{displayName}</span>
          {version && <span style={cardStyles.version}>v{version}</span>}
        </div>
        <p style={cardStyles.publisher}>{publisher}</p>
        <p style={cardStyles.description}>{description}</p>
      </div>

      <div style={cardStyles.actions}>
        <button
          className="btn-primary"
          style={{ fontSize: 12, padding: '6px 14px' }}
          onClick={onDeploy}
          disabled={disabled || !ps}
          title={!ps ? 'No PACKAGE_SETTINGS.md found — cannot deploy' : undefined}
        >
          Deploy
        </button>
        <button
          className="btn-ghost"
          style={{ fontSize: 12, padding: '6px 10px' }}
          onClick={onDetails}
        >
          Details
        </button>
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
    margin: 0,
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
  jobPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  jobHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  deployPrompt: {
    padding: 20,
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
    background: 'var(--success)',
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
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 2,
  },
  name: {
    fontWeight: 600,
    fontSize: 14,
    color: 'var(--text-100)',
  },
  version: {
    fontSize: 11,
    background: 'var(--surface-200)',
    color: 'var(--text-400)',
    borderRadius: 4,
    padding: '1px 6px',
  },
  publisher: {
    fontSize: 12,
    color: 'var(--text-400)',
    margin: '0 0 4px',
  },
  description: {
    fontSize: 12,
    color: 'var(--text-300)',
    margin: 0,
    lineHeight: 1.4,
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
  },
  actions: {
    display: 'flex',
    gap: 6,
  },
}

const overlayStyles: Record<string, React.CSSProperties> = {
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
    width: 460,
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
    background: 'var(--success)',
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
    paddingBottom: 8,
    verticalAlign: 'top',
    whiteSpace: 'nowrap',
    width: 90,
  },
}
