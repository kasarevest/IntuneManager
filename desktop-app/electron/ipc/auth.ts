import { ipcMain } from 'electron'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import type { Database } from 'better-sqlite3'

// In-memory store for first-run generated password (never persisted)
let pendingFirstRunPassword: string | null = null
let isFirstRun = false

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'

function generatePassword(length = 16): string {
  const bytes = crypto.randomBytes(length)
  return Array.from(bytes)
    .map((b: number) => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length])
    .join('')
}

export function initializeAuth(db: Database): void {
  // Check if admin user exists; if not, create with generated password
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get('admin')
  if (!existing) {
    const password = generatePassword(16)
    const hash = bcrypt.hashSync(password, 12)
    db.prepare(`
      INSERT INTO users (username, password_hash, role, must_change_password)
      VALUES (?, ?, 'superadmin', 0)
    `).run('admin', hash)
    pendingFirstRunPassword = password
    isFirstRun = true
  }
}

export function registerAuthHandlers(db: Database): void {
  // First-run check — only returns whether this is a first run; does NOT consume the password
  ipcMain.handle('ipc:auth:first-run-check', () => {
    return { isFirstRun }
  })

  // Get the generated password — safe to call multiple times until first-run-complete is called
  // (React StrictMode calls effects twice in dev; this must be idempotent)
  ipcMain.handle('ipc:auth:get-generated-password', () => {
    if (pendingFirstRunPassword) {
      return { success: true, generatedPassword: pendingFirstRunPassword }
    }
    return { success: false }
  })

  // Called by FirstRun page when user confirms they saved the password
  ipcMain.handle('ipc:auth:first-run-complete', () => {
    pendingFirstRunPassword = null
    isFirstRun = false
    return { success: true }
  })

  // Login
  ipcMain.handle('ipc:auth:login', (_event, req: { username: string; password: string }) => {
    try {
      const user = db.prepare('SELECT * FROM users WHERE username = ?').get(req.username) as {
        id: number; username: string; password_hash: string; role: string; must_change_password: number
      } | undefined

      if (!user) return { success: false, error: 'Invalid username or password' }
      if (!bcrypt.compareSync(req.password, user.password_hash)) {
        return { success: false, error: 'Invalid username or password' }
      }

      // Create session (8 hours)
      const token = uuidv4()
      const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()
      db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, user.id, expiresAt)
      db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(new Date().toISOString(), user.id)

      return {
        success: true,
        sessionToken: token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          mustChangePassword: user.must_change_password === 1
        }
      }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // Logout
  ipcMain.handle('ipc:auth:logout', (_event, req: { sessionToken: string }) => {
    try {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // Validate session
  ipcMain.handle('ipc:auth:validate-session', (_event, req: { sessionToken: string }) => {
    try {
      const session = db.prepare(`
        SELECT s.token, s.expires_at, u.id, u.username, u.role, u.must_change_password
        FROM sessions s JOIN users u ON s.user_id = u.id
        WHERE s.token = ?
      `).get(req.sessionToken) as {
        token: string; expires_at: string; id: number; username: string; role: string; must_change_password: number
      } | undefined

      if (!session) return { valid: false }
      if (new Date(session.expires_at) < new Date()) {
        db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken)
        return { valid: false }
      }

      return {
        valid: true,
        user: { id: session.id, username: session.username, role: session.role, mustChangePassword: session.must_change_password === 1 }
      }
    } catch {
      return { valid: false }
    }
  })

  // Create user (superadmin only)
  ipcMain.handle('ipc:auth:create-user', (_event, req: {
    sessionToken: string; username: string; password: string; role: string
  }) => {
    try {
      const session = validateSession(db, req.sessionToken)
      if (!session || session.role !== 'superadmin') return { success: false, error: 'Insufficient permissions' }

      const hash = bcrypt.hashSync(req.password, 12)
      const result = db.prepare(`
        INSERT INTO users (username, password_hash, role, must_change_password)
        VALUES (?, ?, ?, 1)
      `).run(req.username, hash, req.role)
      return { success: true, userId: result.lastInsertRowid }
    } catch (err) {
      const msg = (err as Error).message
      if (msg.includes('UNIQUE')) return { success: false, error: 'Username already exists' }
      return { success: false, error: msg }
    }
  })

  // List users (superadmin only)
  ipcMain.handle('ipc:auth:list-users', (_event, req: { sessionToken: string }) => {
    try {
      const session = validateSession(db, req.sessionToken)
      if (!session || session.role !== 'superadmin') return { success: false, error: 'Insufficient permissions' }

      const users = db.prepare(`
        SELECT id, username, role, created_at, last_login FROM users ORDER BY created_at
      `).all()
      return { success: true, users }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // Delete user (superadmin only, cannot delete self)
  ipcMain.handle('ipc:auth:delete-user', (_event, req: { sessionToken: string; userId: number }) => {
    try {
      const session = validateSession(db, req.sessionToken)
      if (!session || session.role !== 'superadmin') return { success: false, error: 'Insufficient permissions' }
      if (session.id === req.userId) return { success: false, error: 'Cannot delete your own account' }

      db.prepare('DELETE FROM users WHERE id = ?').run(req.userId)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // Change password
  ipcMain.handle('ipc:auth:change-password', (_event, req: {
    sessionToken: string; currentPassword: string; newPassword: string
  }) => {
    try {
      const session = validateSession(db, req.sessionToken)
      if (!session) return { success: false, error: 'Invalid session' }

      const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(session.id) as { password_hash: string }
      if (!bcrypt.compareSync(req.currentPassword, user.password_hash)) {
        return { success: false, error: 'Current password is incorrect' }
      }

      const newHash = bcrypt.hashSync(req.newPassword, 12)
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(newHash, session.id)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
}

function validateSession(db: Database, token: string): { id: number; username: string; role: string } | null {
  const session = db.prepare(`
    SELECT s.expires_at, u.id, u.username, u.role
    FROM sessions s JOIN users u ON s.user_id = u.id
    WHERE s.token = ?
  `).get(token) as { expires_at: string; id: number; username: string; role: string } | undefined

  if (!session || new Date(session.expires_at) < new Date()) return null
  return { id: session.id, username: session.username, role: session.role }
}
