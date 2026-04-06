import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'path'
import prisma from './db'
import { initializeAuth } from './routes/auth'
import authRouter from './routes/auth'
import settingsRouter from './routes/settings'
import psRouter from './routes/ps'
import aiRouter from './routes/ai'
import eventsRouter from './routes/events'

const PORT = process.env.PORT ?? 3001

// Validate required env vars
if (!process.env.APP_SECRET_KEY) {
  console.error('ERROR: APP_SECRET_KEY environment variable is required')
  process.exit(1)
}

const app = express()

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:4173',
  ...(process.env.APP_ORIGIN ? [process.env.APP_ORIGIN] : [])
]
app.use(cors({ origin: allowedOrigins }))
app.use(express.json({ limit: '10mb' }))

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.use(eventsRouter)
app.use(authRouter)
app.use(settingsRouter)
app.use(psRouter)
app.use(aiRouter)

// Serve React SPA in production
// server/dist/index.js → ../../builds/dist-web relative to compiled output
const DIST_WEB = path.join(__dirname, '..', '..', 'builds', 'dist-web')
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(DIST_WEB))
  // SPA fallback — all non-API routes serve index.html
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(DIST_WEB, 'index.html'))
  })
}

;(async () => {
  // Initialize auth (create default admin if needed)
  await initializeAuth(prisma)

  // Clean up expired sessions on startup
  try {
    await prisma.session.deleteMany({ where: { expires_at: { lt: new Date() } } })
  } catch { /* non-fatal */ }

  app.listen(PORT, () => console.log(`IntuneManager server running on port ${PORT}`))
})()
