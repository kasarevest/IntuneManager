import { Router } from 'express'
import { spawn } from 'child_process'
import fs from 'fs'
import { requireAuth } from '../middleware/auth'
import { runPsScript } from '../services/ps-bridge'
import { getCached, saveCache } from '../services/cache'
import { sseManager } from '../sse'
import prisma from '../db'
import { getAccessToken, GraphAuthError } from '../services/graph-auth'

const router = Router()

const sendToRenderer = (channel: string, data: unknown) => sseManager.broadcast(channel, data)

// GET /api/ps/tenant-config
router.get('/api/ps/tenant-config', requireAuth as import('express').RequestHandler, async (req, res) => {
  try {
    const row = await prisma.tenantConfig.findUnique({ where: { id: 1 } })
    if (!row || !row.access_token) { res.json({ isConnected: false }); return }
    const expiry = row.token_expiry ? new Date(row.token_expiry) : null
    const expiresInMinutes = expiry ? Math.round((expiry.getTime() - Date.now()) / 60000) : undefined
    res.json({ isConnected: true, username: row.username, tenantId: row.tenant_id, expiresInMinutes })
  } catch {
    res.json({ isConnected: false })
  }
})

// POST /api/ps/connect-tenant
// Phase 3: device-code path delegates to graph-auth.ts (MSAL node).
// Non-device-code path is handled by the browser redirect at GET /api/auth/ms-login.
router.post('/api/ps/connect-tenant', requireAuth as import('express').RequestHandler, async (req, res) => {
  const { useDeviceCode } = req.body as { useDeviceCode?: boolean }
  if (!useDeviceCode) {
    res.json({ success: false, error: 'Use the browser sign-in flow: navigate to /api/auth/ms-login' })
    return
  }
  // Device code flow is started from POST /api/auth/ms-device-code (ms-auth router).
  // This legacy endpoint returns a redirect hint for any callers still using it.
  res.json({ success: false, error: 'Use POST /api/auth/ms-device-code for the device code flow' })
})

// DELETE /api/ps/tenant
// Phase 3: server manages tokens — just clear the DB row. No PS process needed.
router.delete('/api/ps/tenant', requireAuth as import('express').RequestHandler, async (_req, res) => {
  try { await prisma.tenantConfig.deleteMany({ where: { id: 1 } }) } catch { /* non-fatal */ }
  res.json({ success: true })
})

// GET /api/ps/auth-status
// Phase 3: read from DB directly — no PS process needed.
router.get('/api/ps/auth-status', requireAuth as import('express').RequestHandler, async (_req, res) => {
  try {
    const row = await prisma.tenantConfig.findUnique({ where: { id: 1 } })
    if (!row?.username || !row?.access_token) { res.json({ isConnected: false }); return }
    const expiry = row.token_expiry ? new Date(row.token_expiry) : null
    const expiresInMinutes = expiry ? Math.round((expiry.getTime() - Date.now()) / 60000) : undefined
    res.json({ isConnected: true, username: row.username, tenantId: row.tenant_id, expiresInMinutes })
  } catch {
    res.json({ isConnected: false })
  }
})

// GET /api/ps/intune-apps
router.get('/api/ps/intune-apps', requireAuth as import('express').RequestHandler, async (req, res) => {
  let accessToken: string
  try { accessToken = await getAccessToken() } catch (e) {
    if (e instanceof GraphAuthError) { res.status(401).json({ success: false, error: e.message }); return }
    throw e
  }
  const cacheKey = 'cache_db_apps'
  const cached = await getCached(cacheKey)
  if (cached) {
    setImmediate(async () => {
      try {
        const r = await runPsScript('Get-IntuneApps.ps1', ['-AccessToken', accessToken])
        const fresh = r.result ?? { success: false, error: 'No result from PS script' }
        if ((fresh as Record<string, unknown>).success) await saveCache(cacheKey, fresh as Record<string, unknown>)
        sendToRenderer('ipc:cache:apps-updated', fresh)
      } catch (e) { sendToRenderer('ipc:cache:apps-updated', { success: false, error: String(e) }) }
    })
    res.json({ ...cached, fromCache: true }); return
  }
  const result = await runPsScript('Get-IntuneApps.ps1', ['-AccessToken', accessToken])
  const data = result.result ?? { success: false, error: 'No result from PS script' }
  if ((data as Record<string, unknown>).success) await saveCache(cacheKey, data as Record<string, unknown>)
  res.json(data)
})

// GET /api/ps/devices
router.get('/api/ps/devices', requireAuth as import('express').RequestHandler, async (req, res) => {
  let accessToken: string
  try { accessToken = await getAccessToken() } catch (e) {
    if (e instanceof GraphAuthError) { res.status(401).json({ success: false, devices: [], error: e.message }); return }
    throw e
  }
  const cacheKey = 'cache_db_devices'
  const cached = await getCached(cacheKey)
  if (cached) {
    setImmediate(async () => {
      try {
        const r = await runPsScript('Get-IntuneDevices.ps1', ['-AccessToken', accessToken])
        const fresh = r.result ?? { success: false, devices: [], error: 'No result from PS script' }
        if ((fresh as Record<string, unknown>).success) await saveCache(cacheKey, fresh as Record<string, unknown>)
        sendToRenderer('ipc:cache:devices-updated', fresh)
      } catch (e) { sendToRenderer('ipc:cache:devices-updated', { success: false, devices: [], error: String(e) }) }
    })
    res.json({ ...cached, fromCache: true }); return
  }
  const result = await runPsScript('Get-IntuneDevices.ps1', ['-AccessToken', accessToken])
  const data = result.result ?? { success: false, devices: [], error: 'No result from PS script' }
  if ((data as Record<string, unknown>).success) await saveCache(cacheKey, data as Record<string, unknown>)
  res.json(data)
})

// POST /api/ps/search-winget
router.post('/api/ps/search-winget', requireAuth as import('express').RequestHandler, async (req, res) => {
  const { query } = req.body as { query: string }
  const result = await runPsScript('Search-Winget.ps1', ['-Query', query])
  res.json(result.result ?? { success: false, results: [] })
})

// POST /api/ps/search-chocolatey
router.post('/api/ps/search-chocolatey', requireAuth as import('express').RequestHandler, async (req, res) => {
  const { query } = req.body as { query: string }
  const result = await runPsScript('Search-Chocolatey.ps1', ['-Query', query])
  res.json(result.result ?? { success: false, results: [] })
})

// GET /api/ps/latest-version/:wingetId
router.get('/api/ps/latest-version/:wingetId', requireAuth as import('express').RequestHandler, async (req, res) => {
  const result = await runPsScript('Get-LatestVersion.ps1', ['-WingetId', String(req.params.wingetId)])
  res.json(result.result ?? { version: null })
})

// POST /api/ps/download-file
router.post('/api/ps/download-file', requireAuth as import('express').RequestHandler, async (req, res) => {
  const { url, outputPath, expectedSHA256, jobId } = req.body as {
    url: string; outputPath: string; expectedSHA256?: string; jobId?: string
  }
  const args = ['-Url', url, '-OutputPath', outputPath]
  if (expectedSHA256) args.push('-ExpectedSHA256', expectedSHA256)

  const result = await runPsScript('Download-File.ps1', args, (msg, level) => {
    if (jobId) sendToRenderer('job:log', { jobId, level, message: msg, source: 'ps', timestamp: new Date().toISOString() })
  })
  res.json(result.result ?? { success: false, error: 'Download failed' })
})

// POST /api/ps/build-package
router.post('/api/ps/build-package', requireAuth as import('express').RequestHandler, async (req, res) => {
  const { sourceFolder, entryPoint, outputFolder, toolPath, jobId } = req.body as {
    sourceFolder: string; entryPoint: string; outputFolder: string; toolPath?: string; jobId?: string
  }
  const args = ['-SourceFolder', sourceFolder, '-EntryPoint', entryPoint, '-OutputFolder', outputFolder]
  if (toolPath) args.push('-ToolPath', toolPath)

  const result = await runPsScript('Build-Package.ps1', args, (msg, level) => {
    if (jobId) sendToRenderer('job:log', { jobId, level, message: msg, source: 'ps', timestamp: new Date().toISOString() })
  })
  res.json(result.result ?? { success: false, error: 'Build failed' })
})

// POST /api/ps/upload-app
router.post('/api/ps/upload-app', requireAuth as import('express').RequestHandler, async (req, res) => {
  const { appId, intunewinPath, jobId } = req.body as {
    appId: string; intunewinPath: string; jobId?: string
  }
  let accessToken: string
  try { accessToken = await getAccessToken() } catch (e) {
    if (e instanceof GraphAuthError) { res.status(401).json({ success: false, error: e.message }); return }
    throw e
  }
  const args = ['-AppId', appId, '-IntunewinPath', intunewinPath, '-AccessToken', accessToken]

  const result = await runPsScript('Upload-App.ps1', args, (msg, level) => {
    if (jobId) sendToRenderer('job:log', { jobId, level, message: msg, source: 'ps', timestamp: new Date().toISOString() })
  })
  res.json(result.result ?? { success: false, error: 'Upload failed' })
})

// POST /api/ps/new-win32-app
router.post('/api/ps/new-win32-app', requireAuth as import('express').RequestHandler, async (req, res) => {
  const { body: appBody, jobId } = req.body as { body: Record<string, unknown>; jobId?: string }
  let accessToken: string
  try { accessToken = await getAccessToken() } catch (e) {
    if (e instanceof GraphAuthError) { res.status(401).json({ success: false, error: e.message }); return }
    throw e
  }
  const bodyJson = JSON.stringify(appBody)
  const result = await runPsScript('New-Win32App.ps1', ['-BodyJson', bodyJson, '-AccessToken', accessToken], (msg, level) => {
    if (jobId) sendToRenderer('job:log', { jobId, level, message: msg, source: 'ps', timestamp: new Date().toISOString() })
  })
  res.json(result.result ?? { success: false, error: 'Create app failed' })
})

// POST /api/ps/update-win32-app
router.post('/api/ps/update-win32-app', requireAuth as import('express').RequestHandler, async (req, res) => {
  const { appId, body: appBody, jobId } = req.body as { appId: string; body: Record<string, unknown>; jobId?: string }
  let accessToken: string
  try { accessToken = await getAccessToken() } catch (e) {
    if (e instanceof GraphAuthError) { res.status(401).json({ success: false, error: e.message }); return }
    throw e
  }
  const bodyJson = JSON.stringify(appBody)
  const result = await runPsScript('Update-Win32App.ps1', ['-AppId', appId, '-BodyJson', bodyJson, '-AccessToken', accessToken], (msg, level) => {
    if (jobId) sendToRenderer('job:log', { jobId, level, message: msg, source: 'ps', timestamp: new Date().toISOString() })
  })
  res.json(result.result ?? { success: false, error: 'Update app failed' })
})

// GET /api/ps/package-settings
router.get('/api/ps/package-settings', requireAuth as import('express').RequestHandler, async (req, res) => {
  const { appName, sourceRootPath } = req.query as { appName: string; sourceRootPath?: string }
  const args = ['-AppName', appName]
  if (sourceRootPath) args.push('-SourceRootPath', sourceRootPath)
  const result = await runPsScript('Get-PackageSettings.ps1', args)
  res.json(result.result ?? { success: false, error: 'No result' })
})

// GET /api/ps/list-packages
router.get('/api/ps/list-packages', requireAuth as import('express').RequestHandler, async (req, res) => {
  const getRow = async (key: string) => {
    const row = await prisma.appSetting.findUnique({ where: { key } })
    return row?.value || ''
  }
  const outputFolder = await getRow('output_folder_path')
  const sourceRootPath = await getRow('source_root_path')
  const args = []
  if (outputFolder) args.push('-OutputFolder', outputFolder)
  if (sourceRootPath) args.push('-SourceRootPath', sourceRootPath)
  const result = await runPsScript('List-IntunewinPackages.ps1', args)
  if (result.result) { res.json(result.result); return }
  if (result.exitCode !== 0) { res.json({ success: false, packages: [], error: result.rawStderr.join(' | ') || 'Script exited with code ' + result.exitCode }); return }
  res.json({ success: true, packages: [] })
})

// POST /api/ps/trigger-windows-update
router.post('/api/ps/trigger-windows-update', requireAuth as import('express').RequestHandler, async (req, res) => {
  const { deviceId } = req.body as { deviceId: string }
  let accessToken: string
  try { accessToken = await getAccessToken() } catch (e) {
    if (e instanceof GraphAuthError) { res.status(401).json({ success: false, error: e.message }); return }
    throw e
  }
  const result = await runPsScript('Invoke-WindowsUpdate.ps1', ['-DeviceId', deviceId, '-AccessToken', accessToken])
  res.json(result.result ?? { success: false, error: 'No result from PS script' })
})

// POST /api/ps/trigger-driver-update
router.post('/api/ps/trigger-driver-update', requireAuth as import('express').RequestHandler, async (req, res) => {
  const { deviceId } = req.body as { deviceId: string }
  let accessToken: string
  try { accessToken = await getAccessToken() } catch (e) {
    if (e instanceof GraphAuthError) { res.status(401).json({ success: false, error: e.message }); return }
    throw e
  }
  const result = await runPsScript('Invoke-DriverUpdate.ps1', ['-DeviceId', deviceId, '-AccessToken', accessToken])
  res.json(result.result ?? { success: false, error: 'No result from PS script' })
})

// POST /api/ps/download-diagnostics
router.post('/api/ps/download-diagnostics', requireAuth as import('express').RequestHandler, async (req, res) => {
  const { deviceId, deviceName } = req.body as { deviceId: string; deviceName: string }
  let accessToken: string
  try { accessToken = await getAccessToken() } catch (e) {
    if (e instanceof GraphAuthError) { res.status(401).json({ success: false, error: e.message }); return }
    throw e
  }
  const result = await runPsScript('Get-DeviceDiagnostics.ps1', ['-DeviceId', deviceId, '-DeviceName', deviceName, '-AccessToken', accessToken])
  res.json(result.result ?? { success: false, error: 'No result from PS script' })
})

// POST /api/ps/write-script
router.post('/api/ps/write-script', requireAuth as import('express').RequestHandler, async (req, res) => {
  const { outputPath, content } = req.body as { outputPath: string; content: string }
  try {
    fs.writeFileSync(outputPath, content, 'utf8')
    res.json({ success: true })
  } catch (err) {
    res.json({ success: false, error: (err as Error).message })
  }
})

// GET /api/ps/app-install-stats
router.get('/api/ps/app-install-stats', requireAuth as import('express').RequestHandler, async (req, res) => {
  let accessToken: string
  try { accessToken = await getAccessToken() } catch (e) {
    if (e instanceof GraphAuthError) { res.status(401).json({ success: false, apps: [], error: e.message }); return }
    throw e
  }
  const cacheKey = 'cache_db_install_stats'
  const cached = await getCached(cacheKey)
  if (cached) {
    setImmediate(async () => {
      try {
        const r = await runPsScript('Get-AppInstallStats.ps1', ['-AccessToken', accessToken])
        const fresh = r.result ?? { success: false, apps: [], error: 'No result from PS script' }
        if ((fresh as Record<string, unknown>).success) await saveCache(cacheKey, fresh as Record<string, unknown>)
        sendToRenderer('ipc:cache:install-stats-updated', fresh)
      } catch (e) { sendToRenderer('ipc:cache:install-stats-updated', { success: false, apps: [], error: String(e) }) }
    })
    res.json({ ...cached, fromCache: true }); return
  }
  const result = await runPsScript('Get-AppInstallStats.ps1', ['-AccessToken', accessToken])
  const data = result.result ?? { success: false, apps: [], error: 'No result from PS script' }
  if ((data as Record<string, unknown>).success) await saveCache(cacheKey, data as Record<string, unknown>)
  res.json(data)
})

// GET /api/ps/update-states
router.get('/api/ps/update-states', requireAuth as import('express').RequestHandler, async (req, res) => {
  let accessToken: string
  try { accessToken = await getAccessToken() } catch (e) {
    if (e instanceof GraphAuthError) { res.status(401).json({ success: false, summary: {}, states: [], error: e.message }); return }
    throw e
  }
  const cacheKey = 'cache_db_update_states'
  const cached = await getCached(cacheKey)
  if (cached) {
    setImmediate(async () => {
      try {
        const r = await runPsScript('Get-UpdateStates.ps1', ['-AccessToken', accessToken])
        const fresh = r.result ?? { success: false, summary: {}, states: [], error: 'No result from PS script' }
        if ((fresh as Record<string, unknown>).success) await saveCache(cacheKey, fresh as Record<string, unknown>)
        sendToRenderer('ipc:cache:update-states-updated', fresh)
      } catch (e) { sendToRenderer('ipc:cache:update-states-updated', { success: false, summary: {}, states: [], error: String(e) }) }
    })
    res.json({ ...cached, fromCache: true }); return
  }
  const result = await runPsScript('Get-UpdateStates.ps1', ['-AccessToken', accessToken])
  const data = result.result ?? { success: false, summary: {}, states: [], error: 'No result from PS script' }
  if ((data as Record<string, unknown>).success) await saveCache(cacheKey, data as Record<string, unknown>)
  res.json(data)
})

// GET /api/ps/uea-scores
router.get('/api/ps/uea-scores', requireAuth as import('express').RequestHandler, async (req, res) => {
  let accessToken: string
  try { accessToken = await getAccessToken() } catch (e) {
    if (e instanceof GraphAuthError) { res.status(401).json({ success: false, overview: null, appHealth: [], error: e.message }); return }
    throw e
  }
  const cacheKey = 'cache_db_uea_scores'
  const cached = await getCached(cacheKey)
  if (cached) {
    setImmediate(async () => {
      try {
        const r = await runPsScript('Get-UEAScores.ps1', ['-AccessToken', accessToken])
        const fresh = r.result ?? { success: false, overview: null, appHealth: [], error: 'No result from PS script' }
        if ((fresh as Record<string, unknown>).success) await saveCache(cacheKey, fresh as Record<string, unknown>)
        sendToRenderer('ipc:cache:uea-scores-updated', fresh)
      } catch (e) { sendToRenderer('ipc:cache:uea-scores-updated', { success: false, overview: null, appHealth: [], error: String(e) }) }
    })
    res.json({ ...cached, fromCache: true }); return
  }
  const result = await runPsScript('Get-UEAScores.ps1', ['-AccessToken', accessToken])
  const data = result.result ?? { success: false, overview: null, appHealth: [], error: 'No result from PS script' }
  if ((data as Record<string, unknown>).success) await saveCache(cacheKey, data as Record<string, unknown>)
  res.json(data)
})

// GET /api/ps/autopilot-events
router.get('/api/ps/autopilot-events', requireAuth as import('express').RequestHandler, async (req, res) => {
  let accessToken: string
  try { accessToken = await getAccessToken() } catch (e) {
    if (e instanceof GraphAuthError) { res.status(401).json({ success: false, events: [], error: e.message }); return }
    throw e
  }
  const cacheKey = 'cache_db_autopilot_events'
  const cached = await getCached(cacheKey)
  if (cached) {
    setImmediate(async () => {
      try {
        const r = await runPsScript('Get-AutopilotEvents.ps1', ['-AccessToken', accessToken])
        const fresh = r.result ?? { success: false, events: [], error: 'No result from PS script' }
        if ((fresh as Record<string, unknown>).success) await saveCache(cacheKey, fresh as Record<string, unknown>)
        sendToRenderer('ipc:cache:autopilot-events-updated', fresh)
      } catch (e) { sendToRenderer('ipc:cache:autopilot-events-updated', { success: false, events: [], error: String(e) }) }
    })
    res.json({ ...cached, fromCache: true }); return
  }
  const result = await runPsScript('Get-AutopilotEvents.ps1', ['-AccessToken', accessToken])
  const data = result.result ?? { success: false, events: [], error: 'No result from PS script' }
  if ((data as Record<string, unknown>).success) await saveCache(cacheKey, data as Record<string, unknown>)
  res.json(data)
})

// ── WinTuner routes ───────────────────────────────────────────────────────────

// GET /api/ps/wt-updates — list Win32 apps that have a newer WinGet version available
router.get('/api/ps/wt-updates', requireAuth as import('express').RequestHandler, async (req, res) => {
  let accessToken: string
  try { accessToken = await getAccessToken() } catch (e) {
    if (e instanceof GraphAuthError) { res.status(401).json({ success: false, updates: [], error: e.message }); return }
    throw e
  }
  const result = await runPsScript('Get-WtUpdates.ps1', ['-AccessToken', accessToken])
  res.json(result.result ?? { success: false, updates: [], error: 'No result from PS script' })
})

// POST /api/ps/wt-package — download a WinGet package via WinTuner (New-WtWingetPackage)
router.post('/api/ps/wt-package', requireAuth as import('express').RequestHandler, async (req, res) => {
  const { packageId, packageFolder, version, jobId } = req.body as {
    packageId: string; packageFolder: string; version?: string; jobId?: string
  }
  let accessToken: string
  try { accessToken = await getAccessToken() } catch (e) {
    if (e instanceof GraphAuthError) { res.status(401).json({ success: false, error: e.message }); return }
    throw e
  }
  const args = ['-PackageId', packageId, '-PackageFolder', packageFolder, '-AccessToken', accessToken]
  if (version) args.push('-Version', version)

  const result = await runPsScript('New-WtPackage.ps1', args, (msg, level) => {
    if (jobId) sendToRenderer('job:log', { jobId, level, message: msg, source: 'ps', timestamp: new Date().toISOString() })
  })
  res.json(result.result ?? { success: false, error: 'Package creation failed' })
})

// POST /api/ps/wt-deploy — deploy an app folder to Intune via WinTuner (Deploy-WtWin32App)
router.post('/api/ps/wt-deploy', requireAuth as import('express').RequestHandler, async (req, res) => {
  const { packageFolder, assignment, graphId, keepAssignments, jobId } = req.body as {
    packageFolder: string; assignment?: string; graphId?: string; keepAssignments?: boolean; jobId?: string
  }
  let accessToken: string
  try { accessToken = await getAccessToken() } catch (e) {
    if (e instanceof GraphAuthError) { res.status(401).json({ success: false, error: e.message }); return }
    throw e
  }
  const args = ['-PackageFolder', packageFolder, '-AccessToken', accessToken]
  if (assignment) args.push('-Assignment', assignment)
  if (graphId) args.push('-GraphId', graphId)
  if (keepAssignments) args.push('-KeepAssignments')

  const result = await runPsScript('Deploy-WtApp.ps1', args, (msg, level) => {
    if (jobId) sendToRenderer('job:log', { jobId, level, message: msg, source: 'ps', timestamp: new Date().toISOString() })
  })
  res.json(result.result ?? { success: false, error: 'Deployment failed' })
})

// POST /api/ps/wt-update-app — update an existing Intune app to its latest WinGet version
router.post('/api/ps/wt-update-app', requireAuth as import('express').RequestHandler, async (req, res) => {
  const { packageId, graphId, packageFolder, version, jobId } = req.body as {
    packageId: string; graphId: string; packageFolder: string; version?: string; jobId?: string
  }
  let accessToken: string
  try { accessToken = await getAccessToken() } catch (e) {
    if (e instanceof GraphAuthError) { res.status(401).json({ success: false, error: e.message }); return }
    throw e
  }
  const args = ['-PackageId', packageId, '-GraphId', graphId, '-PackageFolder', packageFolder, '-AccessToken', accessToken]
  if (version) args.push('-Version', version)

  const result = await runPsScript('Update-WtApp.ps1', args, (msg, level) => {
    if (jobId) sendToRenderer('job:log', { jobId, level, message: msg, source: 'ps', timestamp: new Date().toISOString() })
  })
  res.json(result.result ?? { success: false, error: 'Update failed' })
})

// POST /api/aws/sso-login
router.post('/api/aws/sso-login', requireAuth as import('express').RequestHandler, async (req, res) => {
  const { profile } = req.body as { profile?: string }
  const result = await new Promise<{ success: boolean; error?: string }>((resolve) => {
    const args = ['sso', 'login']
    if (profile) args.push('--profile', profile)

    const proc = spawn('aws', args, {
      shell: true,
      windowsHide: false  // show terminal so user can complete SSO browser flow
    })

    let stderr = ''
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true })
      } else {
        resolve({ success: false, error: stderr.trim() || `aws sso login exited with code ${code}` })
      }
    })

    proc.on('error', (err) => {
      resolve({ success: false, error: `AWS CLI not found or failed to start: ${err.message}` })
    })
  })
  res.json(result)
})

export default router
