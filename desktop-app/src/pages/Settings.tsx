import React from 'react'
import { useNavigate, useLocation, Outlet, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const TABS = [
  { path: '/settings/general', label: 'General' },
  { path: '/settings/tenant', label: 'Tenant Integration' },
  { path: '/settings/users', label: 'Users', superadminOnly: false }
]

export default function Settings() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  useAuth() // ensure auth context is available

  return (
    <div style={styles.page}>
      <div style={styles.sidebar}>
        <div style={styles.backRow}>
          <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => navigate('/dashboard')}>
            ← Dashboard
          </button>
        </div>
        <div style={styles.sideTitle}>Settings</div>
        {TABS.map(tab => (
          <Link
            key={tab.path}
            to={tab.path}
            style={{
              ...styles.navItem,
              background: pathname === tab.path || pathname.startsWith(tab.path + '/') ? 'var(--bg-700)' : 'transparent',
              color: pathname === tab.path ? 'var(--text-100)' : 'var(--text-400)'
            }}
          >
            {tab.label}
          </Link>
        ))}
      </div>
      <div style={styles.content}>
        <Outlet />
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    height: '100vh',
    display: 'flex',
    overflow: 'hidden'
  },
  sidebar: {
    width: 200,
    background: 'var(--bg-800)',
    borderRight: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    padding: '12px 8px',
    flexShrink: 0
  },
  backRow: {
    marginBottom: 12
  },
  sideTitle: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-500)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    padding: '4px 8px',
    marginBottom: 4
  },
  navItem: {
    display: 'block',
    padding: '8px 12px',
    borderRadius: 'var(--radius)',
    fontSize: 13,
    textDecoration: 'none',
    transition: 'background 0.1s, color 0.1s',
    marginBottom: 2
  },
  content: {
    flex: 1,
    overflow: 'auto',
    padding: 32
  }
}
