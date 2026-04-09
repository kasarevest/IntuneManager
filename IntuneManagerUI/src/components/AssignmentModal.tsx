import React, { useState, useEffect } from 'react'
import type { AadGroup, RecentGroup, GroupAssignment } from '../types/ipc'
import { ipcPsGetAadGroups, ipcPsGetRecentGroups, ipcPsSetAppAssignments } from '../lib/api'

interface AssignmentModalProps {
  appId: string
  appName?: string
  onDone: (assigned: number) => void
  onSkip: () => void
}

export default function AssignmentModal({ appId, appName, onDone, onSkip }: AssignmentModalProps) {
  const [allGroups, setAllGroups] = useState<AadGroup[]>([])
  const [recentGroups, setRecentGroups] = useState<RecentGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Map<string, GroupAssignment>>(new Map())
  const [assigning, setAssigning] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [groupsRes, recentRes] = await Promise.all([
        ipcPsGetAadGroups(),
        ipcPsGetRecentGroups()
      ])
      if (groupsRes.success) setAllGroups(groupsRes.groups)
      else setError(groupsRes.error ?? 'Failed to load groups')
      if (recentRes.success) setRecentGroups(recentRes.groups)
    } catch (e) {
      const msg = (e as Error).message ?? ''
      if (msg.includes('503') || msg.includes('upstream') || msg.includes('timed out')) {
        setError('Service unavailable — the backend may still be starting. Click Retry in a moment.')
      } else if (msg.includes('401') || msg.includes('403') || msg.includes('Forbidden')) {
        setError('Permission denied. Reconnect your tenant to grant Group.Read access.')
      } else {
        setError(msg.slice(0, 120) || 'Failed to load groups')
      }
    } finally {
      setLoading(false)
    }
  }

  const defaultIntent = (g: AadGroup | RecentGroup): 'required' | 'available' =>
    g.groupType === 'device' ? 'required' : 'available'

  const toggleGroup = (g: AadGroup) => {
    setSelected(prev => {
      const next = new Map(prev)
      if (next.has(g.id)) {
        next.delete(g.id)
      } else {
        next.set(g.id, {
          groupId: g.id,
          groupName: g.displayName,
          groupType: g.groupType,
          intent: defaultIntent(g)
        })
      }
      return next
    })
  }

  const setIntent = (groupId: string, intent: 'required' | 'available') => {
    setSelected(prev => {
      const next = new Map(prev)
      const existing = next.get(groupId)
      if (existing) next.set(groupId, { ...existing, intent })
      return next
    })
  }

  const handleAssign = async () => {
    if (selected.size === 0) { onSkip(); return }
    setAssigning(true)
    setError(null)
    try {
      const assignments = Array.from(selected.values())
      const res = await ipcPsSetAppAssignments({ appId, assignments })
      if (res.success) {
        onDone(res.assigned ?? assignments.length)
      } else {
        setError(res.error ?? 'Assignment failed')
        setAssigning(false)
      }
    } catch (e) {
      setError((e as Error).message)
      setAssigning(false)
    }
  }

  const lc = search.toLowerCase()
  const recentIds = new Set(recentGroups.map(g => g.id))
  const filtered = lc
    ? allGroups.filter(g => g.displayName.toLowerCase().includes(lc)).slice(0, 20)
    : allGroups.filter(g => !recentIds.has(g.id)).slice(0, 15)

  return (
    <div style={s.backdrop} onClick={onSkip}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.header}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16 }}>Assign to Groups</h2>
            {appName && <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-400)' }}>{appName}</p>}
          </div>
          <button className="btn-ghost" style={{ fontSize: 12 }} onClick={onSkip}>Skip</button>
        </div>

        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ color: 'var(--error)', fontSize: 12, flex: 1 }}>{error}</span>
            <button className="btn-ghost" style={{ fontSize: 11 }} onClick={loadData}>Retry</button>
          </div>
        )}

        <input
          placeholder="Search groups..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', marginBottom: 12, boxSizing: 'border-box' }}
          autoFocus
        />

        {loading ? (
          <p style={{ color: 'var(--text-400)', fontSize: 13, margin: 0 }}>Loading groups...</p>
        ) : (
          <div style={s.list}>
            {recentGroups.length > 0 && !search && (
              <>
                <p style={s.sectionLabel}>Recently used</p>
                {recentGroups.map(g => (
                  <GroupRow key={g.id} group={g} selected={selected} onToggle={toggleGroup} onIntent={setIntent} />
                ))}
              </>
            )}

            {filtered.length > 0 && (
              <>
                {recentGroups.length > 0 && !search && (
                  <p style={s.sectionLabel}>All groups</p>
                )}
                {filtered.map(g => (
                  <GroupRow key={g.id} group={g} selected={selected} onToggle={toggleGroup} onIntent={setIntent} />
                ))}
              </>
            )}

            {!loading && allGroups.length === 0 && (
              <p style={{ color: 'var(--text-400)', fontSize: 13, margin: 0 }}>
                No groups found. Make sure you are connected to a tenant.
              </p>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button
            className="btn-primary"
            style={{ fontSize: 13 }}
            disabled={assigning || selected.size === 0}
            onClick={handleAssign}
          >
            {assigning ? 'Assigning...' : `Assign${selected.size > 0 ? ` (${selected.size})` : ''}`}
          </button>
          <button className="btn-ghost" style={{ fontSize: 13 }} onClick={onSkip}>
            Skip
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── GroupRow ─────────────────────────────────────────────────────────────────

interface GroupRowProps {
  group: AadGroup
  selected: Map<string, GroupAssignment>
  onToggle: (g: AadGroup) => void
  onIntent: (groupId: string, intent: 'required' | 'available') => void
}

function GroupRow({ group, selected, onToggle, onIntent }: GroupRowProps) {
  const isSelected = selected.has(group.id)
  const assignment = selected.get(group.id)

  return (
    <div
      style={{
        ...s.row,
        background: isSelected ? 'rgba(59,130,246,0.15)' : undefined,
        outline: isSelected ? '1px solid rgba(59,130,246,0.4)' : undefined,
      }}
      onClick={() => onToggle(group)}
    >
      <input
        type="checkbox"
        checked={isSelected}
        onChange={() => onToggle(group)}
        style={{ flexShrink: 0, cursor: 'pointer' }}
        onClick={e => e.stopPropagation()}
      />
      <span style={s.groupName}>{group.displayName}</span>
      <span style={{ ...s.badge, background: group.groupType === 'device' ? '#1e3a5f' : 'var(--bg-700)' }}>
        {group.groupType}
      </span>
      {isSelected && (
        <select
          value={assignment?.intent ?? 'available'}
          onChange={e => onIntent(group.id, e.target.value as 'required' | 'available')}
          style={{
            fontSize: 11,
            padding: '2px 4px',
            flexShrink: 0,
            background: 'var(--bg-800)',
            color: 'var(--text-100)',
            border: '1px solid var(--border)',
            borderRadius: 4,
          }}
          onClick={e => e.stopPropagation()}
        >
          <option value="required">Required</option>
          <option value="available">Available</option>
        </select>
      )}
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1100,
  },
  modal: {
    background: 'var(--surface-100)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: 24,
    width: 440,
    maxWidth: '90vw',
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minHeight: 0,
  },
  sectionLabel: {
    fontSize: 11,
    color: 'var(--text-400)',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    margin: '8px 0 4px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 8px',
    borderRadius: 6,
    cursor: 'pointer',
  },
  groupName: {
    flex: 1,
    fontSize: 13,
    color: 'var(--text-100)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  badge: {
    fontSize: 10,
    borderRadius: 4,
    padding: '1px 6px',
    color: 'var(--text-400)',
    flexShrink: 0,
  },
}
