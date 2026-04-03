import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { createDatabase } from './db'
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
const db = createDatabase()

// Make db available to routes
app.locals.db = db

// Initialize auth (create default admin if needed)
initializeAuth(db)

// Clean up expired sessions on startup
try { db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run() } catch { /* non-fatal */ }

app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:4173'] }))
app.use(express.json({ limit: '10mb' }))

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.use(eventsRouter)
app.use(authRouter)
app.use(settingsRouter)
app.use(psRouter)
app.use(aiRouter)

app.listen(PORT, () => console.log(`IntuneManager server running on port ${PORT}`))
