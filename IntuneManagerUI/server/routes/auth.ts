import { Router } from 'express'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'
import { requireAuth, signToken, AuthenticatedRequest } from '../middleware/auth'
import prisma from '../db'

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

export async function initializeAuth(prismaClient: PrismaClient): Promise<void> {
  const existing = await prismaClient.user.findUnique({ where: { username: 'admin' } })
  if (!existing) {
    const password = generatePassword(16)
    const hash = bcrypt.hashSync(password, 12)
    await prismaClient.user.create({
      data: {
        username: 'admin',
        password_hash: hash,
        role: 'superadmin',
        must_change_password: 0
      }
    })
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
router.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body as { username: string; password: string }

    const user = await prisma.user.findFirst({
      where: { username }
    })

    if (!user) { res.json({ success: false, error: 'Invalid username or password' }); return }
    if (!bcrypt.compareSync(password, user.password_hash)) {
      res.json({ success: false, error: 'Invalid username or password' }); return
    }

    await prisma.user.update({ where: { id: user.id }, data: { last_login: new Date() } })

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
router.get('/api/auth/users', requireAuth as import('express').RequestHandler, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest
    if (authReq.user?.role !== 'superadmin') { res.status(403).json({ success: false, error: 'Insufficient permissions' }); return }

    const users = await prisma.user.findMany({
      select: { id: true, username: true, role: true, created_at: true, last_login: true },
      orderBy: { created_at: 'asc' }
    })
    res.json({ success: true, users })
  } catch (err) {
    res.json({ success: false, error: (err as Error).message })
  }
})

// POST /api/auth/users
router.post('/api/auth/users', requireAuth as import('express').RequestHandler, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest
    if (authReq.user?.role !== 'superadmin') { res.status(403).json({ success: false, error: 'Insufficient permissions' }); return }

    const { username, password, role } = req.body as { username: string; password: string; role: string }

    const hash = bcrypt.hashSync(password, 12)
    const newUser = await prisma.user.create({
      data: { username, password_hash: hash, role, must_change_password: 1 }
    })
    res.json({ success: true, userId: newUser.id })
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('Unique constraint') || msg.includes('UNIQUE')) {
      res.json({ success: false, error: 'Username already exists' }); return
    }
    res.json({ success: false, error: msg })
  }
})

// DELETE /api/auth/users/:id
router.delete('/api/auth/users/:id', requireAuth as import('express').RequestHandler, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest
    if (authReq.user?.role !== 'superadmin') { res.status(403).json({ success: false, error: 'Insufficient permissions' }); return }

    const userId = parseInt(String(req.params.id), 10)
    if (authReq.user?.id === userId) { res.json({ success: false, error: 'Cannot delete your own account' }); return }

    await prisma.user.delete({ where: { id: userId } })
    res.json({ success: true })
  } catch (err) {
    res.json({ success: false, error: (err as Error).message })
  }
})

// POST /api/auth/change-password
router.post('/api/auth/change-password', requireAuth as import('express').RequestHandler, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest
    if (!authReq.user) { res.json({ success: false, error: 'Invalid session' }); return }

    const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string }

    const user = await prisma.user.findUnique({ where: { id: authReq.user.id } })
    if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
      res.json({ success: false, error: 'Current password is incorrect' }); return
    }

    const newHash = bcrypt.hashSync(newPassword, 12)
    await prisma.user.update({ where: { id: authReq.user.id }, data: { password_hash: newHash, must_change_password: 0 } })
    res.json({ success: true })
  } catch (err) {
    res.json({ success: false, error: (err as Error).message })
  }
})

export default router
