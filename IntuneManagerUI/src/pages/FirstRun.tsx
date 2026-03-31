import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ipcAuthGetGeneratedPassword, ipcAuthFirstRunComplete } from '../lib/ipc'

export default function FirstRun() {
  const navigate = useNavigate()
  const [password, setPassword] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const check = async () => {
      const res = await ipcAuthGetGeneratedPassword()
      if (res.success && res.generatedPassword) {
        setPassword(res.generatedPassword)
      } else {
        navigate('/login', { replace: true })
      }
      setLoading(false)
    }
    check()
  }, [navigate])

  const handleCopy = () => {
    if (password) {
      navigator.clipboard.writeText(password)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleContinue = async () => {
    await ipcAuthFirstRunComplete()
    navigate('/login', { replace: true })
  }

  if (loading) return null

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.header}>
          <span style={{ fontSize: 36 }}>🔐</span>
          <h1 style={styles.title}>Welcome to IntuneManager</h1>
          <p style={styles.subtitle}>
            A local administrator account has been created. Save this password — it will not be shown again.
          </p>
        </div>

        <div style={styles.section}>
          <label style={{ fontSize: 12, color: 'var(--text-400)', marginBottom: 6, display: 'block' }}>
            Admin Username
          </label>
          <div style={styles.valueBox}>admin</div>
        </div>

        <div style={styles.section}>
          <label style={{ fontSize: 12, color: 'var(--text-400)', marginBottom: 6, display: 'block' }}>
            Generated Password
          </label>
          <div style={{ ...styles.valueBox, ...styles.passwordBox }} className="font-mono">
            {password}
          </div>
          <button className="btn-secondary" onClick={handleCopy} style={{ marginTop: 8, width: '100%' }}>
            {copied ? '✓ Copied!' : 'Copy Password'}
          </button>
        </div>

        <div style={styles.warning}>
          <span style={{ color: 'var(--warning)', fontWeight: 600 }}>⚠ Important:</span>{' '}
          Store this password securely (e.g., your password manager). It cannot be recovered — only reset.
        </div>

        <div style={styles.checkRow}>
          <input
            type="checkbox"
            id="saved"
            checked={confirmed}
            onChange={e => setConfirmed(e.target.checked)}
            style={{ width: 'auto', cursor: 'pointer' }}
          />
          <label htmlFor="saved" style={{ fontSize: 13, color: 'var(--text-200)', cursor: 'pointer', margin: 0 }}>
            I have saved my password in a secure location
          </label>
        </div>

        <button
          className="btn-primary"
          onClick={handleContinue}
          disabled={!confirmed}
          style={{ width: '100%', padding: 10, marginTop: 4 }}
        >
          Continue to Login
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
    background: 'var(--bg-900)'
  },
  card: {
    background: 'var(--bg-800)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: '36px',
    width: 440,
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)'
  },
  header: {
    textAlign: 'center',
    marginBottom: 28
  },
  title: {
    fontSize: 20,
    fontWeight: 700,
    marginTop: 12,
    marginBottom: 8
  },
  subtitle: {
    color: 'var(--text-400)',
    fontSize: 13,
    lineHeight: 1.5
  },
  section: {
    marginBottom: 16
  },
  valueBox: {
    background: 'var(--bg-900)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '10px 14px',
    color: 'var(--text-100)',
    fontSize: 14
  },
  passwordBox: {
    fontSize: 18,
    letterSpacing: '0.08em',
    color: 'var(--success)',
    textAlign: 'center'
  },
  warning: {
    background: '#451a03',
    border: '1px solid #92400e',
    borderRadius: 6,
    padding: '10px 14px',
    fontSize: 12,
    color: 'var(--text-200)',
    marginBottom: 16,
    lineHeight: 1.5
  },
  checkRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16
  }
}
