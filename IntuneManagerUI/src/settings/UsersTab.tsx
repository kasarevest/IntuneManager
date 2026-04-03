import React, { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import {
  ipcAuthListUsers,
  ipcAuthCreateUser,
  ipcAuthDeleteUser,
  ipcAuthChangePassword
} from '../lib/api'

interface UserRow {
  id: number
  username: string
  role: string
  created_at: string
  last_login: string | null
}

export default function UsersTab() {
  const { sessionToken, user: currentUser } = useAuth()
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // New user form
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState('admin')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  // Change own password
  const [currentPwd, setCurrentPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [changingPwd, setChangingPwd] = useState(false)
  const [pwdMsg, setPwdMsg] = useState('')

  const loadUsers = async () => {
    if (!sessionToken) return
    setLoading(true)
    const res = await ipcAuthListUsers(sessionToken)
    setLoading(false)
    if (res.success) setUsers(res.users as UserRow[])
    else setError(res.error ?? 'Failed to load users')
  }

  useEffect(() => { loadUsers() }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newUsername || !newPassword) { setCreateError('All fields required'); return }
    if (!sessionToken) return
    setCreating(true)
    setCreateError('')
    const res = await ipcAuthCreateUser({
      sessionToken, username: newUsername, password: newPassword, role: newRole
    })
    setCreating(false)
    if (res.success) {
      setNewUsername(''); setNewPassword(''); setNewRole('admin')
      loadUsers()
    } else {
      setCreateError(res.error ?? 'Failed to create user')
    }
  }

  const handleDeleteConfirm = async () => {
    if (!deleteTarget || !sessionToken) return
    setDeleting(true)
    setDeleteError('')
    const res = await ipcAuthDeleteUser(sessionToken, deleteTarget.id)
    setDeleting(false)
    if (res.success) {
      setDeleteTarget(null)
      loadUsers()
    } else {
      setDeleteError(res.error ?? 'Delete failed')
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentPwd || !newPwd || !sessionToken) return
    setChangingPwd(true)
    setPwdMsg('')
    const res = await ipcAuthChangePassword({
      sessionToken, currentPassword: currentPwd, newPassword: newPwd
    })
    setChangingPwd(false)
    if (res.success) {
      setPwdMsg('Password changed successfully')
      setCurrentPwd(''); setNewPwd('')
    } else {
      setPwdMsg(res.error ?? 'Failed to change password')
    }
  }

  const isSuperAdmin = currentUser?.role === 'superadmin'

  return (
    <div style={{ maxWidth: 600 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>Users</h2>
      <p style={{ color: 'var(--text-400)', fontSize: 13, marginBottom: 24 }}>
        Manage local accounts and passwords.
      </p>

      {/* User list */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Accounts</h3>
        {error && <p className="error-text" style={{ marginBottom: 8 }}>{error}</p>}
        {loading ? (
          <p style={{ color: 'var(--text-400)' }}>Loading...</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Username', 'Role', 'Last Login', ''].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontSize: 11, color: 'var(--text-400)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px', fontSize: 13 }}>
                    {u.username}
                    {u.id === currentUser?.id && <span style={{ color: 'var(--accent)', fontSize: 10, marginLeft: 6 }}>(you)</span>}
                  </td>
                  <td style={{ padding: '8px', fontSize: 12 }}>
                    <span className={`badge ${u.role === 'superadmin' ? 'badge-info' : 'badge-neutral'}`}>{u.role}</span>
                  </td>
                  <td style={{ padding: '8px', fontSize: 11, color: 'var(--text-400)' }}>
                    {u.last_login ? new Date(u.last_login).toLocaleString() : 'Never'}
                  </td>
                  <td style={{ padding: '8px', textAlign: 'right' }}>
                    {isSuperAdmin && u.id !== currentUser?.id && (
                      <button className="btn-danger" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => { setDeleteTarget(u); setDeleteError('') }}>
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Inline delete confirmation */}
      {deleteTarget && (
        <div className="card" style={{ marginBottom: 20, border: '1px solid var(--error)' }}>
          <p style={{ fontSize: 13, marginBottom: 12 }}>
            Delete user <strong>{deleteTarget.username}</strong>? This cannot be undone.
          </p>
          {deleteError && <p className="error-text" style={{ marginBottom: 8 }}>{deleteError}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-danger" style={{ fontSize: 12 }} onClick={handleDeleteConfirm} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Confirm Delete'}
            </button>
            <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => { setDeleteTarget(null); setDeleteError('') }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Create user — superadmin only */}
      {isSuperAdmin && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Create User</h3>
          <form onSubmit={handleCreate}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ flex: 2, minWidth: 140 }}>
                <label>Username</label>
                <input value={newUsername} onChange={e => setNewUsername(e.target.value)} />
              </div>
              <div style={{ flex: 2, minWidth: 140 }}>
                <label>Password</label>
                <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} autoComplete="new-password" />
              </div>
              <div style={{ flex: 1, minWidth: 100 }}>
                <label>Role</label>
                <select value={newRole} onChange={e => setNewRole(e.target.value)}>
                  <option value="admin">admin</option>
                  <option value="viewer">viewer</option>
                  <option value="superadmin">superadmin</option>
                </select>
              </div>
            </div>
            {createError && <p className="error-text" style={{ marginTop: 6 }}>{createError}</p>}
            <button type="submit" className="btn-primary" style={{ marginTop: 12 }} disabled={creating}>
              {creating ? 'Creating...' : 'Create User'}
            </button>
          </form>
        </div>
      )}

      {/* Change own password */}
      <div className="card">
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Change My Password</h3>
        <form onSubmit={handleChangePassword}>
          <div className="form-group">
            <label>Current Password</label>
            <input type="password" value={currentPwd} onChange={e => setCurrentPwd(e.target.value)} autoComplete="current-password" />
          </div>
          <div className="form-group">
            <label>New Password</label>
            <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} autoComplete="new-password" />
          </div>
          {pwdMsg && <p style={{ fontSize: 12, color: pwdMsg.includes('success') ? 'var(--success)' : 'var(--error)', marginBottom: 8 }}>{pwdMsg}</p>}
          <button type="submit" className="btn-primary" disabled={changingPwd || !currentPwd || !newPwd}>
            {changingPwd ? 'Changing...' : 'Change Password'}
          </button>
        </form>
      </div>
    </div>
  )
}
