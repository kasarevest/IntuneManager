import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import prisma from '../db'

const router = Router()

// GET /api/deployments?status=all|success|failed&page=1
router.get('/api/deployments', requireAuth as import('express').RequestHandler, async (req, res) => {
  try {
    const status = req.query.status as string | undefined
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10))
    const pageSize = 50

    const where: Record<string, unknown> = {}
    if (status && status !== 'all') where.status = status

    const [total, rows] = await Promise.all([
      prisma.appDeployment.count({ where }),
      prisma.appDeployment.findMany({
        where,
        orderBy: { started_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ])

    const deployments = rows.map(d => ({
      id: d.id,
      jobId: d.job_id,
      appName: d.app_name,
      wingetId: d.winget_id,
      intuneAppId: d.intune_app_id,
      deployedVersion: d.deployed_version,
      operation: d.operation,
      status: d.status,
      errorMessage: d.error_message,
      startedAt: d.started_at,
      completedAt: d.completed_at
    }))

    res.json({ success: true, deployments, total, page, pageSize })
  } catch (err) {
    res.json({ success: false, error: (err as Error).message, deployments: [] })
  }
})

// GET /api/deployments/export?format=csv|json&status=all|success|failed
router.get('/api/deployments/export', requireAuth as import('express').RequestHandler, async (req, res) => {
  try {
    const format = (req.query.format as string | undefined) ?? 'csv'
    const status = req.query.status as string | undefined

    const where: Record<string, unknown> = {}
    if (status && status !== 'all') where.status = status

    const rows = await prisma.appDeployment.findMany({
      where,
      orderBy: { started_at: 'desc' }
    })

    const records = rows.map(d => ({
      id: d.id,
      jobId: d.job_id,
      appName: d.app_name,
      wingetId: d.winget_id ?? '',
      intuneAppId: d.intune_app_id ?? '',
      deployedVersion: d.deployed_version ?? '',
      operation: d.operation,
      status: d.status,
      errorMessage: d.error_message ?? '',
      startedAt: d.started_at ? new Date(d.started_at).toISOString() : '',
      completedAt: d.completed_at ? new Date(d.completed_at).toISOString() : ''
    }))

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Content-Disposition', 'attachment; filename="deployment-history.json"')
      res.send(JSON.stringify(records, null, 2))
      return
    }

    // CSV
    const headers = ['id', 'jobId', 'appName', 'wingetId', 'intuneAppId', 'deployedVersion', 'operation', 'status', 'errorMessage', 'startedAt', 'completedAt']
    const escape = (v: unknown) => {
      const s = String(v ?? '')
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
    }
    const csv = [
      headers.join(','),
      ...records.map(r => headers.map(h => escape(r[h as keyof typeof r])).join(','))
    ].join('\n')

    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', 'attachment; filename="deployment-history.csv"')
    res.send(csv)
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message })
  }
})

export default router
