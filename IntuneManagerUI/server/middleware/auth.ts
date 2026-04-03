import jwt from 'jsonwebtoken'
import { Request, Response, NextFunction } from 'express'

export interface AuthenticatedRequest extends Request {
  user?: { id: number; username: string; role: string }
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) { res.status(401).json({ error: 'Unauthorized' }); return }
  try {
    const payload = jwt.verify(token, process.env.APP_SECRET_KEY!) as { id: number; username: string; role: string }
    req.user = payload
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}

export function signToken(payload: { id: number; username: string; role: string }): string {
  return jwt.sign(payload, process.env.APP_SECRET_KEY!, { expiresIn: '8h' })
}
