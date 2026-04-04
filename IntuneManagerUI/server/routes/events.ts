import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { sseManager } from '../sse'

const router = Router()

router.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.flushHeaders()

  const clientId = uuidv4()
  sseManager.addClient(clientId, res)

  // Keep-alive ping every 30s
  const ping = setInterval(() => res.write(': ping\n\n'), 30000)

  req.on('close', () => {
    clearInterval(ping)
    sseManager.removeClient(clientId)
  })
})

export default router
