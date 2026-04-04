import { Router } from 'express'
import { requireAuth, AuthenticatedRequest } from '../middleware/auth'
import { encrypt, decrypt } from '../services/encryption'
import prisma from '../db'

const router = Router()

// GET /api/settings
router.get('/api/settings', requireAuth as import('express').RequestHandler, async (req, res) => {
  try {
    const rows = await prisma.appSetting.findMany()
    const settings: Record<string, string> = {}
    for (const row of rows) settings[row.key] = row.value

    const hasApiKey = !!settings['claude_api_key_encrypted']
    res.json({
      success: true,
      intunewinToolPath: settings['intunewin_tool_path'] ?? '',
      sourceRootPath: settings['source_root_path'] ?? '',
      outputFolderPath: settings['output_folder_path'] ?? '',
      claudeApiKey: hasApiKey
        ? decrypt(settings['claude_api_key_encrypted']).replace(/.(?=.{4})/g, '*')
        : '',  // masked for display
      claudeApiKeyConfigured: hasApiKey,
      defaultMinOs: settings['default_min_os'] ?? 'W10_21H2',
      logRetentionDays: parseInt(settings['log_retention_days'] ?? '30'),
      awsRegion: settings['aws_region'] ?? '',
      awsBedrockModelId: settings['aws_bedrock_model_id'] ?? ''
    })
  } catch (err) {
    res.json({ success: false, error: (err as Error).message })
  }
})

// POST /api/settings
router.post('/api/settings', requireAuth as import('express').RequestHandler, async (req, res) => {
  try {
    const body = req.body as {
      intunewinToolPath?: string
      sourceRootPath?: string
      outputFolderPath?: string
      claudeApiKey?: string
      defaultMinOs?: string
      logRetentionDays?: number
      awsRegion?: string
      awsBedrockModelId?: string
    }

    const upsertSetting = (key: string, value: string) =>
      prisma.appSetting.upsert({
        where: { key },
        update: { value, updated_at: new Date() },
        create: { key, value }
      })

    const ops: Promise<unknown>[] = []
    if (body.intunewinToolPath !== undefined) ops.push(upsertSetting('intunewin_tool_path', body.intunewinToolPath))
    if (body.sourceRootPath !== undefined) ops.push(upsertSetting('source_root_path', body.sourceRootPath))
    if (body.outputFolderPath !== undefined) ops.push(upsertSetting('output_folder_path', body.outputFolderPath))
    if (body.claudeApiKey !== undefined && !body.claudeApiKey.includes('*')) {
      ops.push(upsertSetting('claude_api_key_encrypted', encrypt(body.claudeApiKey)))
    }
    if (body.defaultMinOs !== undefined) ops.push(upsertSetting('default_min_os', body.defaultMinOs))
    if (body.logRetentionDays !== undefined) ops.push(upsertSetting('log_retention_days', String(body.logRetentionDays)))
    if (body.awsRegion !== undefined) ops.push(upsertSetting('aws_region', body.awsRegion))
    if (body.awsBedrockModelId !== undefined) ops.push(upsertSetting('aws_bedrock_model_id', body.awsBedrockModelId))

    await Promise.all(ops)
    res.json({ success: true })
  } catch (err) {
    res.json({ success: false, error: (err as Error).message })
  }
})

// POST /api/settings/clear-cache
router.post('/api/settings/clear-cache', requireAuth as import('express').RequestHandler, async (req, res) => {
  try {
    await prisma.appSetting.deleteMany({
      where: {
        OR: [
          { key: 'recommendations_cache' },
          { key: { startsWith: 'cache_db_' } }
        ]
      }
    })
    res.json({ success: true })
  } catch (err) {
    res.json({ success: false, error: (err as Error).message })
  }
})

// GET /api/settings/api-key (returns decrypted key — only for internal use)
router.get('/api/settings/api-key', requireAuth as import('express').RequestHandler, async (req, res) => {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: 'claude_api_key_encrypted' } })
    res.json({ success: true, apiKey: row ? decrypt(row.value) : '' })
  } catch (err) {
    res.json({ success: false, apiKey: '', error: (err as Error).message })
  }
})

export default router
