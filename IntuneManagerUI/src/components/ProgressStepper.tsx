import React from 'react'

const STEPS = [
  { id: 'analyzing', label: 'Analyzing' },
  { id: 'searching', label: 'Searching' },
  { id: 'downloading', label: 'Downloading' },
  { id: 'packaging', label: 'Packaging' },
  { id: 'uploading', label: 'Uploading' },
  { id: 'done', label: 'Done' }
]

interface Props {
  currentPhase: string
  isError?: boolean
}

export default function ProgressStepper({ currentPhase, isError }: Props) {
  const currentIdx = STEPS.findIndex(s => s.id === currentPhase)

  return (
    <div style={styles.container}>
      {STEPS.map((step, idx) => {
        const isDone = currentIdx > idx || currentPhase === 'done'
        const isActive = step.id === currentPhase && !isError
        const isErrorStep = isError && step.id === currentPhase

        return (
          <React.Fragment key={step.id}>
            <div style={styles.step}>
              <div style={{
                ...styles.circle,
                background: isErrorStep ? 'var(--error)' : isDone ? 'var(--success)' : isActive ? 'var(--accent)' : 'var(--bg-700)',
                borderColor: isErrorStep ? 'var(--error)' : isDone ? 'var(--success)' : isActive ? 'var(--accent)' : 'var(--border)',
                boxShadow: isActive ? '0 0 0 3px rgba(59,130,246,0.3)' : 'none'
              }}>
                {isDone && !isErrorStep ? '✓' : isErrorStep ? '✕' : idx + 1}
              </div>
              <span style={{
                ...styles.label,
                color: isDone || isActive ? 'var(--text-200)' : 'var(--text-500)',
                fontWeight: isActive ? 600 : 400
              }}>{step.label}</span>
            </div>
            {idx < STEPS.length - 1 && (
              <div style={{
                ...styles.connector,
                background: currentIdx > idx ? 'var(--success)' : 'var(--border)'
              }} />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: 0,
    padding: '12px 0'
  },
  step: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    minWidth: 64
  },
  circle: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    border: '2px solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 700,
    color: '#fff',
    transition: 'all 0.2s'
  },
  label: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
  },
  connector: {
    flex: 1,
    height: 2,
    marginBottom: 18,
    transition: 'background 0.2s'
  }
}
