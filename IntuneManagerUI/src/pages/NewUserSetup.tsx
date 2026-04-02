import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useTenant } from '../contexts/TenantContext'
import { ipcAuthChangePassword } from '../lib/ipc'

export default function NewUserSetup() {
  const { user, sessionToken, refreshSession } = useAuth()
  const { tenant, connect } = useTenant()
  const navigate = useNavigate()

  // Step 1 — change password
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwError, setPwError] = useState('')
  const [pwLoading, setPwLoading] = useState(false)
  const [pwDone, setPwDone] = useState(false)

  // Step 2 — connect tenant (local state: always starts disconnected regardless of global tenant state)
  const [tenantConnected, setTenantConnected] = useState(false)
  const [tenantLoading, setTenantLoading] = useState(false)
  const [tenantError, setTenantError] = useState('')

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newPassword) { setPwError('New password is required'); return }
    if (newPassword !== confirmPassword) { setPwError('Passwords do not match'); return }
    if (newPassword.length < 8) { setPwError('Password must be at least 8 characters'); return }
    if (!sessionToken) { setPwError('Session expired — please log in again'); return }

    setPwError('')
    setPwLoading(true)
    const res = await ipcAuthChangePassword({ sessionToken, currentPassword, newPassword })
    setPwLoading(false)

    if (res.success) {
      await refreshSession()
      setPwDone(true)
    } else {
      setPwError(res.error ?? 'Failed to change password')
    }
  }

  const handleConnect = async (useDeviceCode: boolean) => {
    setTenantError('')
    setTenantLoading(true)
    const res = await connect(useDeviceCode)
    setTenantLoading(false)
    if (res.success) {
      setTenantConnected(true)
    } else {
      setTenantError(res.error ?? 'Connection failed')
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        {/* Header */}
        <div style={styles.header}>
          <span style={styles.logoIcon}>⚙</span>
          <div>
            <div style={styles.logoText}>Welcome, {user?.username}</div>
            <div style={styles.subtitle}>Complete your account setup before continuing</div>
          </div>
        </div>

        {/* Step 1 — Change Password */}
        <div style={styles.section}>
          <div style={styles.sectionHeader}>
            <span style={{ ...styles.stepBadge, background: pwDone ? 'var(--success)' : 'var(--accent)' }}>
              {pwDone ? '✓' : '1'}
            </span>
            <span style={styles.sectionTitle}>Change your password</span>
            {pwDone && <span style={styles.doneLabel}>Done</span>}
          </div>

          {!pwDone ? (
            <form onSubmit={handleChangePassword} style={{ marginTop: 16 }}>
              <div className="form-group">
                <label>Current password</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="Enter your current password"
                />
              </div>
              <div className="form-group">
                <label>New password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                />
              </div>
              <div className="form-group">
                <label>Confirm new password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="Re-enter new password"
                />
              </div>
              {pwError && <p className="error-text" style={{ marginBottom: 12 }}>{pwError}</p>}
              <button type="submit" className="btn-primary" style={{ width: '100%', padding: '10px' }} disabled={pwLoading}>
                {pwLoading ? 'Saving...' : 'Set New Password'}
              </button>
            </form>
          ) : (
            <p style={styles.doneText}>Your password has been updated.</p>
          )}
        </div>

        {/* Step 2 — Connect Tenant */}
        <div style={{ ...styles.section, opacity: pwDone ? 1 : 0.5, pointerEvents: pwDone ? 'auto' : 'none' }}>
          <div style={styles.sectionHeader}>
            <span style={{ ...styles.stepBadge, background: tenantConnected ? 'var(--success)' : 'var(--accent)' }}>
              {tenantConnected ? '✓' : '2'}
            </span>
            <span style={styles.sectionTitle}>Connect your Intune tenant</span>
            {tenantConnected && <span style={styles.doneLabel}>Connected</span>}
          </div>

          <p style={styles.stepDesc}>
            Sign in with your Microsoft account to connect IntuneManager to your Intune tenant.
          </p>

          {tenantConnected ? (
            <div style={styles.connectedInfo}>
              <span style={{ color: 'var(--success)' }}>●</span> Connected as <strong>{tenant.username}</strong>
              {tenant.tenantId && <span style={{ color: 'var(--text-400)', marginLeft: 8 }}>({tenant.tenantId})</span>}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button
                className="btn-primary"
                style={{ flex: 1, padding: '9px 16px' }}
                onClick={() => handleConnect(false)}
                disabled={tenantLoading}
              >
                {tenantLoading ? 'Connecting...' : 'Sign in with Microsoft'}
              </button>
              <button
                className="btn-secondary"
                style={{ flex: 1, padding: '9px 16px' }}
                onClick={() => handleConnect(true)}
                disabled={tenantLoading}
              >
                Use Device Code
              </button>
            </div>
          )}

          {tenantError && <p className="error-text" style={{ marginTop: 10 }}>{tenantError}</p>}
        </div>

        {/* Continue button */}
        <button
          className="btn-primary"
          style={{ width: '100%', padding: '11px', marginTop: 8, opacity: pwDone && tenantConnected ? 1 : 0.4 }}
          disabled={!pwDone || !tenantConnected}
          onClick={() => navigate('/dashboard', { replace: true })}
        >
          Continue to Dashboard
        </button>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    height: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg-900)',
    padding: '24px 16px'
  },
  card: {
    background: 'var(--bg-800)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: '36px 36px 32px',
    width: 440,
    maxWidth: '100%',
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    marginBottom: 28
  },
  logoIcon: {
    fontSize: 32,
    color: 'var(--accent)'
  },
  logoText: {
    fontSize: 18,
    fontWeight: 700,
    color: 'var(--text-100)'
  },
  subtitle: {
    fontSize: 12,
    color: 'var(--text-400)',
    marginTop: 2
  },
  section: {
    borderTop: '1px solid var(--border)',
    paddingTop: 20,
    marginBottom: 20,
    transition: 'opacity 0.2s'
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 10
  },
  stepBadge: {
    width: 24,
    height: 24,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 700,
    color: '#fff',
    flexShrink: 0
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-100)',
    flex: 1
  },
  doneLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--success)',
    background: 'rgba(34,197,94,0.12)',
    borderRadius: 4,
    padding: '2px 8px'
  },
  doneText: {
    fontSize: 13,
    color: 'var(--text-300)',
    marginTop: 12
  },
  stepDesc: {
    fontSize: 12,
    color: 'var(--text-400)',
    marginTop: 10,
    lineHeight: 1.5
  },
  connectedInfo: {
    marginTop: 12,
    fontSize: 13,
    color: 'var(--text-200)',
    display: 'flex',
    alignItems: 'center',
    gap: 6
  }
}
