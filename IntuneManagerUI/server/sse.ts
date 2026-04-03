import { Response } from 'express'

class SSEManager {
  private clients = new Map<string, Response>()

  addClient(clientId: string, res: Response): void {
    this.clients.set(clientId, res)
  }

  removeClient(clientId: string): void {
    this.clients.delete(clientId)
  }

  // Push to all connected clients (replaces win.webContents.send)
  broadcast(channel: string, data: unknown): void {
    const payload = JSON.stringify({ channel, data })
    for (const res of this.clients.values()) {
      res.write(`data: ${payload}\n\n`)
    }
  }
}

export const sseManager = new SSEManager()
