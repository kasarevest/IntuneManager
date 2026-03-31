import { ipcMain, BrowserWindow, app } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import type { Database } from 'better-sqlite3'

// In dev: app.getAppPath() = IntuneManagerUI/  → ps-scripts at electron/ps-scripts
// In prod: app.getAppPath() = resources/app.asar → unpacked scripts at resources/app.asar.unpacked/electron/ps-scripts
// The .replace() handles the asar case so powershell.exe gets a real filesystem path
const PS_SCRIPTS_DIR = path.join(app.getAppPath(), 'electron', 'ps-scripts')
  .replace('app.asar', 'app.asar.unpacked')

// ─── Core PS runner ───────────────────────────────────────────────────────────

interface PsResult {
  exitCode: number
  result: Record<string, unknown> | null
  logLines: Array<{ level: string; message: string }>
  rawStdout: string[]
  rawStderr: string[]
}

function runPsScript(
  scriptName: string,
  args: string[],
  onLogLine?: (line: string, level: string) => void,
  signal?: AbortSignal,
  interactive?: boolean
): Promise<PsResult> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(PS_SCRIPTS_DIR, scriptName)
    // Do NOT pass -NonInteractive for scripts that open a browser (MSAL interactive login)
    const psArgs = interactive
      ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args]
      : ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args]

    const proc: ChildProcess = spawn('powershell.exe', psArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    })

    const stdoutLines: string[] = []
    const stderrLines: string[] = []
    const logLines: Array<{ level: string; message: string }> = []
    let resultJson: Record<string, unknown> | null = null
    let stdoutBuffer = ''

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf8')
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        stdoutLines.push(line)

        if (line.startsWith('RESULT:')) {
          try { resultJson = JSON.parse(line.slice(7)) } catch { /* ignore */ }
        } else if (line.startsWith('LOG:')) {
          const match = line.slice(4).match(/^\[(\w+)\]\s+(.*)/)
          const level = match?.[1] ?? 'INFO'
          const message = match?.[2] ?? line.slice(4)
          logLines.push({ level, message })
          onLogLine?.(message, level)
        }
      }
    })

    proc.stderr?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString('utf8').split(/\r?\n/).filter(Boolean)
      stderrLines.push(...lines)
      for (const line of lines) onLogLine?.(line, 'DEBUG')
    })

    proc.on('close', code => resolve({
      exitCode: code ?? -1,
      result: resultJson,
      logLines,
      rawStdout: stdoutLines,
      rawStderr: stderrLines
    }))

    proc.on('error', err => reject(new Error(`Failed to spawn powershell.exe: ${err.message}`)))

    signal?.addEventListener('abort', () => {
      try {
        proc.kill()
        spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { windowsHide: true })
      } catch { /* ignore */ }
    })
  })
}

// ─── IPC Registration ─────────────────────────────────────────────────────────

export function registerPsBridgeHandlers(win: BrowserWindow, db: Database): void {
  const sendToRenderer = (channel: string, data: unknown) => win.webContents.send(channel, data)

  // Tenant connect — interactive=true removes -NonInteractive so browser can open
  ipcMain.handle('ipc:ps:connect-tenant', async (_event, req: { useDeviceCode?: boolean }) => {
    const args = req.useDeviceCode ? ['-DeviceCode'] : []
    const result = await runPsScript('Connect-Tenant.ps1', args, undefined, undefined, true)
    const res = result.result ?? { success: false, error: `No result from PS script. Stderr: ${result.rawStderr.join(' | ')}` }
    // Persist successful connection to DB so UI can restore state across navigations
    if (res.success) {
      try {
        db.prepare(`INSERT OR REPLACE INTO tenant_config
          (id, tenant_id, username, token_expiry, connected_at, updated_at)
          VALUES (1, ?, ?, ?, datetime('now'), datetime('now'))`)
          .run(res.tenantId ?? null, res.username ?? null, res.tokenExpiry ?? null)
      } catch { /* non-fatal */ }
    }
    return res
  })

  // Get persisted tenant config from DB (restores state after page navigation)
  ipcMain.handle('ipc:ps:get-tenant-config', () => {
    try {
      const row = db.prepare('SELECT * FROM tenant_config WHERE id = 1').get() as Record<string, unknown> | undefined
      if (!row || !row.username) return { isConnected: false }
      const expiry = row.token_expiry ? new Date(row.token_expiry as string) : null
      const expiresInMinutes = expiry ? Math.round((expiry.getTime() - Date.now()) / 60000) : undefined
      // A row with a username means the tenant has been configured. Treat it as connected —
      // MSAL's refresh token handles silent re-auth when PS scripts actually run.
      // Only block if the user explicitly disconnected (row deleted by Disconnect handler).
      return { isConnected: true, username: row.username, tenantId: row.tenant_id, expiresInMinutes }
    } catch {
      return { isConnected: false }
    }
  })

  // Auth status (PS-layer — only valid in same PS process, used for token refresh checks)
  ipcMain.handle('ipc:ps:get-auth-status', async () => {
    const result = await runPsScript('Get-AuthStatus.ps1', [])
    return result.result ?? { isConnected: false }
  })

  // Disconnect tenant
  ipcMain.handle('ipc:ps:disconnect-tenant', async () => {
    try { db.prepare('DELETE FROM tenant_config WHERE id = 1').run() } catch { /* non-fatal */ }
    const result = await runPsScript('Disconnect-Tenant.ps1', [])
    return result.result ?? { success: true }
  })

  // Get Intune apps
  ipcMain.handle('ipc:ps:get-intune-apps', async () => {
    const result = await runPsScript('Get-IntuneApps.ps1', [])
    return result.result ?? { success: false, error: 'No result from PS script' }
  })

  // Search winget
  ipcMain.handle('ipc:ps:search-winget', async (_event, req: { query: string }) => {
    const result = await runPsScript('Search-Winget.ps1', ['-Query', req.query])
    return result.result ?? { success: false, results: [] }
  })

  // Search chocolatey
  ipcMain.handle('ipc:ps:search-chocolatey', async (_event, req: { query: string }) => {
    const result = await runPsScript('Search-Chocolatey.ps1', ['-Query', req.query])
    return result.result ?? { success: false, results: [] }
  })

  // Get latest version
  ipcMain.handle('ipc:ps:get-latest-version', async (_event, req: { wingetId: string }) => {
    const result = await runPsScript('Get-LatestVersion.ps1', ['-WingetId', req.wingetId])
    return result.result ?? { version: null }
  })

  // Download file (with streaming progress)
  ipcMain.handle('ipc:ps:download-file', async (_event, req: {
    url: string; outputPath: string; expectedSHA256?: string; jobId?: string
  }) => {
    const args = ['-Url', req.url, '-OutputPath', req.outputPath]
    if (req.expectedSHA256) args.push('-ExpectedSHA256', req.expectedSHA256)

    const result = await runPsScript('Download-File.ps1', args, (msg, level) => {
      if (req.jobId) sendToRenderer('job:log', { jobId: req.jobId, level, message: msg, source: 'ps', timestamp: new Date().toISOString() })
    })
    return result.result ?? { success: false, error: 'Download failed' }
  })

  // Build package (with streaming logs)
  ipcMain.handle('ipc:ps:build-package', async (_event, req: {
    sourceFolder: string; entryPoint: string; outputFolder: string; toolPath?: string; jobId?: string
  }) => {
    const args = ['-SourceFolder', req.sourceFolder, '-EntryPoint', req.entryPoint, '-OutputFolder', req.outputFolder]
    if (req.toolPath) args.push('-ToolPath', req.toolPath)

    const result = await runPsScript('Build-Package.ps1', args, (msg, level) => {
      if (req.jobId) sendToRenderer('job:log', { jobId: req.jobId, level, message: msg, source: 'ps', timestamp: new Date().toISOString() })
    })
    return result.result ?? { success: false, error: 'Build failed' }
  })

  // Upload app (with streaming progress)
  ipcMain.handle('ipc:ps:upload-app', async (_event, req: {
    appId: string; intunewinPath: string; jobId?: string
  }) => {
    const args = ['-AppId', req.appId, '-IntunewinPath', req.intunewinPath]

    const result = await runPsScript('Upload-App.ps1', args, (msg, level) => {
      if (req.jobId) sendToRenderer('job:log', { jobId: req.jobId, level, message: msg, source: 'ps', timestamp: new Date().toISOString() })
    })
    return result.result ?? { success: false, error: 'Upload failed' }
  })

  // Create new Win32 app in Intune
  ipcMain.handle('ipc:ps:new-win32-app', async (_event, req: { body: Record<string, unknown>; jobId?: string }) => {
    const bodyJson = JSON.stringify(req.body)
    const result = await runPsScript('New-Win32App.ps1', ['-BodyJson', bodyJson], (msg, level) => {
      if (req.jobId) sendToRenderer('job:log', { jobId: req.jobId, level, message: msg, source: 'ps', timestamp: new Date().toISOString() })
    })
    return result.result ?? { success: false, error: 'Create app failed' }
  })

  // Update existing Win32 app
  ipcMain.handle('ipc:ps:update-win32-app', async (_event, req: { appId: string; body: Record<string, unknown>; jobId?: string }) => {
    const bodyJson = JSON.stringify(req.body)
    const result = await runPsScript('Update-Win32App.ps1', ['-AppId', req.appId, '-BodyJson', bodyJson], (msg, level) => {
      if (req.jobId) sendToRenderer('job:log', { jobId: req.jobId, level, message: msg, source: 'ps', timestamp: new Date().toISOString() })
    })
    return result.result ?? { success: false, error: 'Update app failed' }
  })

  // Get local package settings for an app
  ipcMain.handle('ipc:ps:get-package-settings', async (_event, req: { appName: string; sourceRootPath?: string }) => {
    const args = ['-AppName', req.appName]
    if (req.sourceRootPath) args.push('-SourceRootPath', req.sourceRootPath)
    const result = await runPsScript('Get-PackageSettings.ps1', args)
    return result.result ?? { success: false, error: 'No result' }
  })

  // List .intunewin packages in the output folder
  ipcMain.handle('ipc:ps:list-intunewin-packages', async () => {
    const getRow = (key: string) => {
      const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined
      return row?.value || ''
    }
    const outputFolder = getRow('output_folder_path')
    const sourceRootPath = getRow('source_root_path')
    const args = []
    if (outputFolder) args.push('-OutputFolder', outputFolder)
    if (sourceRootPath) args.push('-SourceRootPath', sourceRootPath)
    const result = await runPsScript('List-IntunewinPackages.ps1', args)
    if (result.result) return result.result
    if (result.exitCode !== 0) return { success: false, packages: [], error: result.rawStderr.join(' | ') || 'Script exited with code ' + result.exitCode }
    return { success: true, packages: [] }
  })

  // Get all managed devices from Intune
  ipcMain.handle('ipc:ps:get-devices', async () => {
    const result = await runPsScript('Get-IntuneDevices.ps1', [])
    return result.result ?? { success: false, devices: [], error: 'No result from PS script' }
  })

  // Trigger Windows Update sync on a device
  ipcMain.handle('ipc:ps:trigger-windows-update', async (_event, req: { deviceId: string }) => {
    const result = await runPsScript('Invoke-WindowsUpdate.ps1', ['-DeviceId', req.deviceId])
    return result.result ?? { success: false, error: 'No result from PS script' }
  })

  // Trigger driver update sync on a device
  ipcMain.handle('ipc:ps:trigger-driver-update', async (_event, req: { deviceId: string }) => {
    const result = await runPsScript('Invoke-DriverUpdate.ps1', ['-DeviceId', req.deviceId])
    return result.result ?? { success: false, error: 'No result from PS script' }
  })

  // Request diagnostics download for a device
  ipcMain.handle('ipc:ps:download-diagnostics', async (_event, req: { deviceId: string; deviceName: string }) => {
    const result = await runPsScript('Get-DeviceDiagnostics.ps1', ['-DeviceId', req.deviceId, '-DeviceName', req.deviceName])
    return result.result ?? { success: false, error: 'No result from PS script' }
  })

  // Write a script file to disk (used by AI agent to save generated PS scripts)
  ipcMain.handle('ipc:ps:write-script', async (_event, req: { outputPath: string; content: string }) => {
    const result = await runPsScript('Write-Script.ps1', ['-OutputPath', req.outputPath], undefined)
    // Pass content via a temp file approach — write content first, then move
    // Actually: Write-Script.ps1 reads content from stdin via -Content param
    void result
    // Simpler: write the file directly from Node
    const fs = await import('fs')
    try {
      fs.writeFileSync(req.outputPath, req.content, 'utf8')
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
}

export { runPsScript }
