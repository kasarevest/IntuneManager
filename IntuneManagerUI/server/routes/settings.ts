import { Router } from 'express'
import type { Database } from 'better-sqlite3'
import { requireAuth, AuthenticatedRequest } from '../middleware/auth'
import { encrypt, decrypt } from '../services/encryption'

const router = Router()

// GET /api/settings
router.get('/api/settings', requireAuth as import('express').RequestHandler, (req, res) => {
  try {
    const db = req.app.locals.db as Database
    const rows = db.prepare('SELECT key, value FROM app_settings').all() as { key: string; value: string }[]
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
router.post('/api/settings', requireAuth as import('express').RequestHandler, (req, res) => {
  try {
    const db = req.app.locals.db as Database
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

    const upsert = db.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))")

    if (body.intunewinToolPath !== undefined) upsert.run('intunewin_tool_path', body.intunewinToolPath)
    if (body.sourceRootPath !== undefined) upsert.run('source_root_path', body.sourceRootPath)
    if (body.outputFolderPath !== undefined) upsert.run('output_folder_path', body.outputFolderPath)
    if (body.claudeApiKey !== undefined && !body.claudeApiKey.includes('*')) {
      upsert.run('claude_api_key_encrypted', encrypt(body.claudeApiKey))
    }
    if (body.defaultMinOs !== undefined) upsert.run('default_min_os', body.defaultMinOs)
    if (body.logRetentionDays !== undefined) upsert.run('log_retention_days', String(body.logRetentionDays))
    if (body.awsRegion !== undefined) upsert.run('aws_region', body.awsRegion)
    if (body.awsBedrockModelId !== undefined) upsert.run('aws_bedrock_model_id', body.awsBedrockModelId)

    res.json({ success: true })
  } catch (err) {
    res.json({ success: false, error: (err as Error).message })
  }
})

// POST /api/settings/clear-cache
router.post('/api/settings/clear-cache', requireAuth as import('express').RequestHandler, (req, res) => {
  try {
    const db = req.app.locals.db as Database
    db.prepare("DELETE FROM app_settings WHERE key = 'recommendations_cache' OR key LIKE 'cache_db_%'").run()
    res.json({ success: true })
  } catch (err) {
    res.json({ success: false, error: (err as Error).message })
  }
})

// GET /api/settings/api-key (returns decrypted key — only for internal use)
router.get('/api/settings/api-key', requireAuth as import('express').RequestHandler, (req, res) => {
  try {
    const db = req.app.locals.db as Database
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'claude_api_key_encrypted'").get() as { value: string } | undefined
    res.json({ success: true, apiKey: row ? decrypt(row.value) : '' })
  } catch (err) {
    res.json({ success: false, apiKey: '', error: (err as Error).message })
  }
})

export default router
