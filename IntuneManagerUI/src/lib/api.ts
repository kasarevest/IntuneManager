/**
 * api.ts — Web API client (replaces ipc.ts for browser/Azure deployment)
 *
 * Every function that previously called window.electronAPI.invoke()
 * now calls fetch('/api/...'). The response shapes are identical so
 * all existing page/component code works without changes.
 *
 * Session token is read from sessionStorage on each call and sent as
 * an Authorization: Bearer header.
 */

import type {
  LoginReq, LoginRes,
  FirstRunCheckRes, GeneratedPasswordRes, ValidateSessionRes,
  CreateUserReq, ChangePasswordReq,
  SaveSettingsReq,
  ConnectTenantRes, AuthStatusRes,
  IntuneAppsRes,
  DeployAppReq, DeployAppRes,
  PackageOnlyReq, PackageOnlyRes,
  UploadOnlyReq, UploadOnlyRes,
  GetRecommendationsRes,
  ListPackagesRes,
  GetDevicesRes,
  TriggerDeviceActionRes,
  AwsSsoLoginRes,
  AppInstallStatsRes,
  UpdateStatesRes,
  UEAScoresRes,
  AutopilotEventsRes
} from '../types/ipc'

export interface SettingsGetRes {
  success: boolean
  intunewinToolPath?: string
  sourceRootPath?: string
  outputFolderPath?: string
  claudeApiKey?: string
  defaultMinOs?: string
  logRetentionDays?: number
  awsRegion?: string
  awsBedrockModelId?: string
  claudeApiKeyConfigured?: boolean
  error?: string
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function getAuthHeader(): Record<string, string> {
  const token = sessionStorage.getItem('intunemanager_session')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { ...getAuthHeader() } })
  return res.json() as Promise<T>
}

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  return res.json() as Promise<T>
}

async function del<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  return res.json() as Promise<T>
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const ipcAuthFirstRunCheck = (): Promise<FirstRunCheckRes> =>
  get('/api/auth/first-run-check')

export const ipcAuthGetGeneratedPassword = (): Promise<GeneratedPasswordRes> =>
  get('/api/auth/generated-password')

export const ipcAuthFirstRunComplete = (): Promise<{ success: boolean }> =>
  post('/api/auth/first-run-complete')

export const ipcAuthLogin = (req: LoginReq): Promise<LoginRes> =>
  post('/api/auth/login', req)

export const ipcAuthLogout = (_sessionToken: string): Promise<void> =>
  post('/api/auth/logout') as Promise<void>

export const ipcAuthValidateSession = (_sessionToken: string): Promise<ValidateSessionRes> =>
  get('/api/auth/validate-session')

export const ipcAuthListUsers = (_sessionToken: string): Promise<{ success: boolean; users?: unknown[]; error?: string }> =>
  get('/api/auth/users')

export const ipcAuthCreateUser = (req: CreateUserReq): Promise<{ success: boolean; error?: string }> =>
  post('/api/auth/users', req)

export const ipcAuthDeleteUser = (_sessionToken: string, userId: number): Promise<{ success: boolean; error?: string }> =>
  del(`/api/auth/users/${userId}`)

export const ipcAuthChangePassword = (req: ChangePasswordReq): Promise<{ success: boolean; error?: string }> =>
  post('/api/auth/change-password', req)

// ─── Dialog (no-op in web — Settings page uses plain text inputs) ─────────────

export const ipcDialogOpenFile = (_title: string, _filters?: unknown): Promise<string | null> =>
  Promise.resolve(null)

export const ipcDialogOpenFolder = (_title: string): Promise<string | null> =>
  Promise.resolve(null)

// ─── Settings ─────────────────────────────────────────────────────────────────

export const ipcSettingsGet = (): Promise<SettingsGetRes> =>
  get('/api/settings')

export const ipcSettingsSave = (req: SaveSettingsReq): Promise<{ success: boolean; error?: string }> =>
  post('/api/settings', req)

export const ipcSettingsClearAiCache = (): Promise<{ success: boolean; error?: string }> =>
  post('/api/settings/clear-cache')

// ─── PS Bridge / Tenant ───────────────────────────────────────────────────────

export const ipcPsGetTenantConfig = (): Promise<AuthStatusRes> =>
  get('/api/ps/tenant-config')

export const ipcPsConnectTenant = (useDeviceCode: boolean): Promise<ConnectTenantRes> =>
  post('/api/ps/connect-tenant', { useDeviceCode })

export const ipcPsDisconnectTenant = (): Promise<{ success: boolean }> =>
  del('/api/ps/tenant')

export const ipcPsGetIntuneApps = (): Promise<IntuneAppsRes> =>
  get('/api/ps/intune-apps')

export const ipcPsGetPackageSettings = (appName: string, sourceRootPath?: string): Promise<{ success: boolean; version?: string; wingetId?: string; sourceFolder?: string; error?: string }> =>
  get(`/api/ps/package-settings?appName=${encodeURIComponent(appName)}${sourceRootPath ? `&sourceRootPath=${encodeURIComponent(sourceRootPath)}` : ''}`)

export const ipcPsGetLatestVersion = (wingetId: string): Promise<{ version: string | null; wingetId: string; error?: string }> =>
  get(`/api/ps/latest-version/${encodeURIComponent(wingetId)}`)

export const ipcPsSearchWinget = (query: string): Promise<{ success: boolean; results: unknown[]; error?: string }> =>
  post('/api/ps/search-winget', { query })

// ─── AI Agent ─────────────────────────────────────────────────────────────────

export const ipcAiDeployApp = (req: DeployAppReq): Promise<DeployAppRes> =>
  post('/api/ai/deploy', req)

export const ipcAiPackageOnly = (req: PackageOnlyReq): Promise<PackageOnlyRes> =>
  post('/api/ai/package-only', req)

export const ipcAiUploadOnly = (req: UploadOnlyReq): Promise<UploadOnlyRes> =>
  post('/api/ai/upload-only', req)

export const ipcAiGetRecommendations = (): Promise<GetRecommendationsRes> =>
  get('/api/ai/recommendations')

export const ipcAiCancel = (jobId: string): Promise<void> =>
  del(`/api/ai/jobs/${jobId}`) as Promise<void>

export const ipcPsListIntunewinPackages = (): Promise<ListPackagesRes> =>
  get('/api/ps/list-packages')

export const ipcPsGetDevices = (): Promise<GetDevicesRes> =>
  get('/api/ps/devices')

export const ipcPsTriggerWindowsUpdate = (deviceId: string): Promise<TriggerDeviceActionRes> =>
  post('/api/ps/trigger-windows-update', { deviceId })

export const ipcPsTriggerDriverUpdate = (deviceId: string): Promise<TriggerDeviceActionRes> =>
  post('/api/ps/trigger-driver-update', { deviceId })

export const ipcPsDownloadDiagnostics = (deviceId: string, deviceName: string): Promise<TriggerDeviceActionRes> =>
  post('/api/ps/download-diagnostics', { deviceId, deviceName })

// ─── Dashboard data sources ───────────────────────────────────────────────────

export const ipcPsGetAppInstallStats = (): Promise<AppInstallStatsRes> =>
  get('/api/ps/app-install-stats')

export const ipcPsGetUpdateStates = (): Promise<UpdateStatesRes> =>
  get('/api/ps/update-states')

export const ipcPsGetUEAScores = (): Promise<UEAScoresRes> =>
  get('/api/ps/uea-scores')

export const ipcPsGetAutopilotEvents = (): Promise<AutopilotEventsRes> =>
  get('/api/ps/autopilot-events')

// ─── AWS ──────────────────────────────────────────────────────────────────────

export const ipcAwsSsoLogin = (profile?: string): Promise<AwsSsoLoginRes> =>
  post('/api/aws/sso-login', { profile })
