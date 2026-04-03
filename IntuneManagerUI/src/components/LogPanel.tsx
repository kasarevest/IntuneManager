import React, { useEffect, useRef } from 'react'
import type { LogEntry } from '../types/app'

interface LogPanelProps {
  logs: LogEntry[]
  height?: number | string
  onClear?: () => void
}

const LEVEL_COLOR: Record<string, string> = {
  INFO: 'var(--text-200)',
  WARN: 'var(--warning)',
  ERROR: 'var(--error)',
  DEBUG: 'var(--text-500)'
}

const SOURCE_BADGE: Record<string, { label: string; color: string }> = {
  ai: { label: 'AI', color: '#6366f1' },
  ps: { label: 'PS', color: '#0891b2' },
  system: { label: 'SYS', color: 'var(--bg-600)' }
}

export default function LogPanel({ logs, height = 220, onClear }: LogPanelProps) {
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs.length])

  return (
    <div style={{ ...styles.container, height }}>
      <div style={styles.toolbar}>
        <span style={styles.title}>Log Output</span>
        {onClear && (
          <button className="btn-ghost" onClick={onClear} style={{ fontSize: 11 }}>
            Clear
          </button>
        )}
      </div>
      <div ref={bodyRef} style={styles.body} className="font-mono">
        {logs.length === 0 && (
          <span style={{ color: 'var(--text-500)', fontSize: 12 }}>No output yet...</span>
        )}
        {logs.map((entry, i) => {
          const badge = SOURCE_BADGE[entry.source] ?? SOURCE_BADGE.system
          const color = LEVEL_COLOR[entry.level] ?? 'var(--text-200)'
          const ts = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : ''
          return (
            <div key={i} style={styles.line}>
              <span style={{ color: 'var(--text-500)', minWidth: 56 }}>{ts}</span>
              <span style={{
                background: badge.color,
                color: '#fff',
                borderRadius: 3,
                padding: '0 4px',
                fontSize: 10,
                fontWeight: 700,
                minWidth: 28,
                textAlign: 'center'
              }}>{badge.label}</span>
              {entry.level !== 'INFO' && (
                <span style={{ color, fontWeight: 600, fontSize: 10 }}>[{entry.level}]</span>
              )}
              <span style={{ color, flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {entry.message}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg-900)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    overflow: 'hidden',
    fontSize: 12
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '4px 10px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg-800)'
  },
  title: {
    fontSize: 11,
    color: 'var(--text-400)',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
  },
  body: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 2
  },
  line: {
    display: 'flex',
    gap: 6,
    alignItems: 'flex-start',
    lineHeight: '1.5'
  }
}
