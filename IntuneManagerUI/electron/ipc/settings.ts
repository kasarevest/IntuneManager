import { ipcMain, dialog, BrowserWindow } from 'electron'
import crypto from 'crypto'
import type { Database } from 'better-sqlite3'
import { execSync } from 'child_process'

// Derive an encryption key from the machine GUID (machine-specific, no admin needed to read)
function getMachineKey(): Buffer {
  try {
    const result = execSync(
      'powershell.exe -NoProfile -NonInteractive -Command "(Get-ItemProperty HKLM:\\SOFTWARE\\Microsoft\\Cryptography).MachineGuid"',
      { windowsHide: true }
    ).toString().trim()
    return crypto.createHash('sha256').update(result).digest()
  } catch {
    // Fallback to app-constant salt if registry read fails
    return crypto.createHash('sha256').update('IntuneManagerUI-fallback-key-2026').digest()
  }
}

const MACHINE_KEY = getMachineKey()
const IV_LENGTH = 16

function encrypt(plaintext: string): string {
  if (!plaintext) return ''
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv('aes-256-cbc', MACHINE_KEY, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return iv.toString('hex') + ':' + encrypted.toString('hex')
}

function decrypt(ciphertext: string): string {
  if (!ciphertext) return ''
  try {
    const [ivHex, encHex] = ciphertext.split(':')
    const iv = Buffer.from(ivHex, 'hex')
    const enc = Buffer.from(encHex, 'hex')
    const decipher = crypto.createDecipheriv('aes-256-cbc', MACHINE_KEY, iv)
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
  } catch {
    return ''
  }
}

export function registerSettingsHandlers(db: Database): void {
  ipcMain.handle('ipc:settings:get', () => {
    try {
      const rows = db.prepare('SELECT key, value FROM app_settings').all() as { key: string; value: string }[]
      const settings: Record<string, string> = {}
      for (const row of rows) settings[row.key] = row.value

      const hasApiKey = !!settings['claude_api_key_encrypted']
      return {
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
      }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('ipc:settings:get-api-key', () => {
    try {
      const row = db.prepare("SELECT value FROM app_settings WHERE key = 'claude_api_key_encrypted'").get() as { value: string } | undefined
      return { success: true, apiKey: row ? decrypt(row.value) : '' }
    } catch (err) {
      return { success: false, apiKey: '', error: (err as Error).message }
    }
  })

  ipcMain.handle('ipc:settings:save', (_event, req: {
    intunewinToolPath?: string
    sourceRootPath?: string
    outputFolderPath?: string
    claudeApiKey?: string
    defaultMinOs?: string
    logRetentionDays?: number
    awsRegion?: string
    awsBedrockModelId?: string
  }) => {
    try {
      const upsert = db.prepare('INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime(\'now\'))')

      if (req.intunewinToolPath !== undefined) upsert.run('intunewin_tool_path', req.intunewinToolPath)
      if (req.sourceRootPath !== undefined) upsert.run('source_root_path', req.sourceRootPath)
      if (req.outputFolderPath !== undefined) upsert.run('output_folder_path', req.outputFolderPath)
      if (req.claudeApiKey !== undefined && !req.claudeApiKey.includes('*')) {
        upsert.run('claude_api_key_encrypted', encrypt(req.claudeApiKey))
      }
      if (req.defaultMinOs !== undefined) upsert.run('default_min_os', req.defaultMinOs)
      if (req.logRetentionDays !== undefined) upsert.run('log_retention_days', String(req.logRetentionDays))
      if (req.awsRegion !== undefined) upsert.run('aws_region', req.awsRegion)
      if (req.awsBedrockModelId !== undefined) upsert.run('aws_bedrock_model_id', req.awsBedrockModelId)

      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // Open file picker (for .exe selection)
  ipcMain.handle('ipc:dialog:open-file', async (_event, req: { title?: string; filters?: Electron.FileFilter[] }) => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win ?? BrowserWindow.getAllWindows()[0], {
      title: req.title ?? 'Select File',
      properties: ['openFile'],
      filters: req.filters ?? [{ name: 'All Files', extensions: ['*'] }]
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // Open folder picker
  ipcMain.handle('ipc:dialog:open-folder', async (_event, req: { title?: string }) => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win ?? BrowserWindow.getAllWindows()[0], {
      title: req.title ?? 'Select Folder',
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })
}

export { decrypt as decryptSetting }
