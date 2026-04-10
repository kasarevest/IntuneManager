import React, { useState } from 'react'
import type { AppRecommendation } from '../types/ipc'

interface Props {
  app: AppRecommendation
  onDeploy: (app: AppRecommendation) => void
  disabled?: boolean
}

export default function AppCard({ app, onDeploy, disabled }: Props) {
  const [showDetails, setShowDetails] = useState(false)

  // Derive initials for the logo placeholder
  const initials = app.name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('')

  return (
    <>
      <div style={styles.card}>
        <div style={styles.logo}>
          <span style={styles.initials}>{initials}</span>
        </div>

        <div style={styles.body}>
          <div style={styles.nameRow}>
            <span style={styles.name}>{app.name}</span>
            {app.category && <span style={styles.category}>{app.category}</span>}
          </div>
          <p style={styles.publisher}>{app.publisher}</p>
          <p style={styles.description}>{app.description}</p>
        </div>

        <div style={styles.actions}>
          <button
            className="btn-primary"
            style={{ fontSize: 12, padding: '6px 14px' }}
            onClick={() => onDeploy(app)}
            disabled={disabled}
          >
            Deploy
          </button>
          <button
            className="btn-ghost"
            style={{ fontSize: 12, padding: '6px 10px' }}
            onClick={() => setShowDetails(true)}
          >
            Details
          </button>
        </div>
      </div>

      {showDetails && (
        <div style={overlayStyles.backdrop} onClick={() => setShowDetails(false)}>
          <div style={overlayStyles.modal} onClick={e => e.stopPropagation()}>
            <div style={overlayStyles.header}>
              <div style={styles.logo}>
                <span style={styles.initials}>{initials}</span>
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: 18 }}>{app.name}</h2>
                <p style={{ margin: 0, color: 'var(--text-400)', fontSize: 13 }}>{app.publisher}</p>
              </div>
            </div>

            <table style={overlayStyles.table}>
              <tbody>
                <tr>
                  <td style={overlayStyles.label}>Category</td>
                  <td>{app.category || '—'}</td>
                </tr>
                <tr>
                  <td style={overlayStyles.label}>Description</td>
                  <td>{app.description}</td>
                </tr>
                {app.wingetId && (
                  <tr>
                    <td style={overlayStyles.label}>Winget ID</td>
                    <td><code style={{ fontSize: 12 }}>{app.wingetId}</code></td>
                  </tr>
                )}
              </tbody>
            </table>

            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button
                className="btn-primary"
                onClick={() => { setShowDetails(false); onDeploy(app) }}
                disabled={disabled}
              >
                Deploy
              </button>
              <button className="btn-ghost" onClick={() => setShowDetails(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--surface-100)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    transition: 'border-color 0.15s',
  },
  logo: {
    width: 44,
    height: 44,
    borderRadius: 8,
    background: 'var(--primary)',
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
  category: {
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
    width: 420,
    maxWidth: '90vw',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    marginBottom: 20,
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
    width: 100,
  },
}
