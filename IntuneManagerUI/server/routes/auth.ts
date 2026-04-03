import { Router } from 'express'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import type { Database } from 'better-sqlite3'
import { requireAuth, signToken, AuthenticatedRequest } from '../middleware/auth'

const router = Router()

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'

function generatePassword(length = 16): string {
  const bytes = crypto.randomBytes(length)
  return Array.from(bytes)
    .map((b: number) => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length])
    .join('')
}

// In-memory store for first-run generated password (never persisted)
let pendingFirstRunPassword: string | null = null
let isFirstRun = false

export function initializeAuth(db: Database): void {
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

// GET /api/auth/first-run-check
router.get('/api/auth/first-run-check', (_req, res) => {
  res.json({ isFirstRun })
})

// GET /api/auth/generated-password
router.get('/api/auth/generated-password', (_req, res) => {
  if (pendingFirstRunPassword) {
    res.json({ success: true, generatedPassword: pendingFirstRunPassword })
  } else {
    res.json({ success: false })
  }
})

// POST /api/auth/first-run-complete
router.post('/api/auth/first-run-complete', (_req, res) => {
  pendingFirstRunPassword = null
  isFirstRun = false
  res.json({ success: true })
})

// POST /api/auth/login
router.post('/api/auth/login', (req, res) => {
  try {
    const db = req.app.locals.db as Database
    const { username, password } = req.body as { username: string; password: string }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as {
      id: number; username: string; password_hash: string; role: string; must_change_password: number
    } | undefined

    if (!user) { res.json({ success: false, error: 'Invalid username or password' }); return }
    if (!bcrypt.compareSync(password, user.password_hash)) {
      res.json({ success: false, error: 'Invalid username or password' }); return
    }

    db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(new Date().toISOString(), user.id)

    const token = signToken({ id: user.id, username: user.username, role: user.role })

    res.json({
      success: true,
      sessionToken: token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        mustChangePassword: user.must_change_password === 1
      }
    })
  } catch (err) {
    res.json({ success: false, error: (err as Error).message })
  }
})

// POST /api/auth/logout
router.post('/api/auth/logout', (_req, res) => {
  // JWT is stateless — client discards token
  res.json({ success: true })
})

// GET /api/auth/validate-session
router.get('/api/auth/validate-session', requireAuth as import('express').RequestHandler, (req, res) => {
  const authReq = req as AuthenticatedRequest
  res.json({
    valid: true,
    user: authReq.user
  })
})

// GET /api/auth/users
router.get('/api/auth/users', requireAuth as import('express').RequestHandler, (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest
    if (authReq.user?.role !== 'superadmin') { res.status(403).json({ success: false, error: 'Insufficient permissions' }); return }

    const db = req.app.locals.db as Database
    const users = db.prepare(`
      SELECT id, username, role, created_at, last_login FROM users ORDER BY created_at
    `).all()
    res.json({ success: true, users })
  } catch (err) {
    res.json({ success: false, error: (err as Error).message })
  }
})

// POST /api/auth/users
router.post('/api/auth/users', requireAuth as import('express').RequestHandler, (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest
    if (authReq.user?.role !== 'superadmin') { res.status(403).json({ success: false, error: 'Insufficient permissions' }); return }

    const db = req.app.locals.db as Database
    const { username, password, role } = req.body as { username: string; password: string; role: string }

    const hash = bcrypt.hashSync(password, 12)
    const result = db.prepare(`
      INSERT INTO users (username, password_hash, role, must_change_password)
      VALUES (?, ?, ?, 1)
    `).run(username, hash, role)
    res.json({ success: true, userId: result.lastInsertRowid })
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('UNIQUE')) { res.json({ success: false, error: 'Username already exists' }); return }
    res.json({ success: false, error: msg })
  }
})

// DELETE /api/auth/users/:id
router.delete('/api/auth/users/:id', requireAuth as import('express').RequestHandler, (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest
    if (authReq.user?.role !== 'superadmin') { res.status(403).json({ success: false, error: 'Insufficient permissions' }); return }

    const userId = parseInt(String(req.params.id), 10)
    if (authReq.user?.id === userId) { res.json({ success: false, error: 'Cannot delete your own account' }); return }

    const db = req.app.locals.db as Database
    db.prepare('DELETE FROM users WHERE id = ?').run(userId)
    res.json({ success: true })
  } catch (err) {
    res.json({ success: false, error: (err as Error).message })
  }
})

// POST /api/auth/change-password
router.post('/api/auth/change-password', requireAuth as import('express').RequestHandler, (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest
    if (!authReq.user) { res.json({ success: false, error: 'Invalid session' }); return }

    const db = req.app.locals.db as Database
    const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string }

    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(authReq.user.id) as { password_hash: string }
    if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
      res.json({ success: false, error: 'Current password is incorrect' }); return
    }

    const newHash = bcrypt.hashSync(newPassword, 12)
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(newHash, authReq.user.id)
    res.json({ success: true })
  } catch (err) {
    res.json({ success: false, error: (err as Error).message })
  }
})

export default router
