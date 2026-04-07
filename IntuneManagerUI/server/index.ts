// Catch any crash and log it before exiting — essential for diagnosing
// container startup failures where stderr is not flushed before process dies.
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err.message)
  console.error(err.stack)
  process.exit(1)
})
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason)
  process.exit(1)
})

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
const DIST_WEB = path.join(__dirname, '..', '..', 'builds', 'dist-web')
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(DIST_WEB))
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(DIST_WEB, 'index.html'))
  })
}

// Start listening immediately so health checks pass even if DB is slow to wake.
// Azure SQL Serverless auto-pauses after 60 min idle — first connection can
// take up to 60 seconds. Initialise auth in the background after the server
// is already accepting requests.
app.listen(PORT, () => {
  console.log(`IntuneManager server running on port ${PORT}`)

  // DB initialisation is non-blocking — failures are logged but do not crash
  // the server. Routes that need the DB will return errors on first use if
  // the DB hasn't come up yet.
  initializeAuth(prisma)
    .then(() => {
      console.log('Auth initialised')
      return prisma.session.deleteMany({ where: { expires_at: { lt: new Date() } } })
    })
    .then(() => console.log('Expired sessions cleaned up'))
    .catch((err) => console.error('DB init error (non-fatal):', err.message))
})
