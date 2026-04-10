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

export default router
