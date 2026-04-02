import type {
  LoginReq, LoginRes,
  FirstRunCheckRes, GeneratedPasswordRes, ValidateSessionRes,
  CreateUserReq, ChangePasswordReq,
  SaveSettingsReq,
  ConnectTenantRes, AuthStatusRes,
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
import type { LogEntry } from '../types/app'

// Typed reference to the contextBridge-exposed API
const api = (window as unknown as { electronAPI: ElectronAPI }).electronAPI

interface ElectronAPI {
  invoke: (channel: string, data?: unknown) => Promise<unknown>
  on: (channel: string, callback: (data: unknown) => void) => () => void
  once: (channel: string, callback: (data: unknown) => void) => void
  off: (channel: string, listener: (data: unknown) => void) => void
}

// --- Auth ---
export const ipcAuthFirstRunCheck = (): Promise<FirstRunCheckRes> =>
  api.invoke('ipc:auth:first-run-check') as Promise<FirstRunCheckRes>

export const ipcAuthGetGeneratedPassword = (): Promise<GeneratedPasswordRes> =>
  api.invoke('ipc:auth:get-generated-password') as Promise<GeneratedPasswordRes>

export const ipcAuthFirstRunComplete = (): Promise<{ success: boolean }> =>
  api.invoke('ipc:auth:first-run-complete') as Promise<{ success: boolean }>

export const ipcAuthLogin = (req: LoginReq): Promise<LoginRes> =>
  api.invoke('ipc:auth:login', req) as Promise<LoginRes>

export const ipcAuthLogout = (sessionToken: string): Promise<void> =>
  api.invoke('ipc:auth:logout', { sessionToken }) as Promise<void>

export const ipcAuthValidateSession = (sessionToken: string): Promise<ValidateSessionRes> =>
  api.invoke('ipc:auth:validate-session', { sessionToken }) as Promise<ValidateSessionRes>

export const ipcAuthListUsers = (sessionToken: string): Promise<{ success: boolean; users?: unknown[]; error?: string }> =>
  api.invoke('ipc:auth:list-users', { sessionToken }) as Promise<{ success: boolean; users?: unknown[]; error?: string }>

export const ipcAuthCreateUser = (req: CreateUserReq): Promise<{ success: boolean; error?: string }> =>
  api.invoke('ipc:auth:create-user', req) as Promise<{ success: boolean; error?: string }>

export const ipcAuthDeleteUser = (sessionToken: string, userId: number): Promise<{ success: boolean; error?: string }> =>
  api.invoke('ipc:auth:delete-user', { sessionToken, userId }) as Promise<{ success: boolean; error?: string }>

export const ipcAuthChangePassword = (req: ChangePasswordReq): Promise<{ success: boolean; error?: string }> =>
  api.invoke('ipc:auth:change-password', req) as Promise<{ success: boolean; error?: string }>

// --- Dialog ---
export const ipcDialogOpenFile = (title: string, filters?: { name: string; extensions: string[] }[]): Promise<string | null> =>
  api.invoke('ipc:dialog:open-file', { title, filters }) as Promise<string | null>

export const ipcDialogOpenFolder = (title: string): Promise<string | null> =>
  api.invoke('ipc:dialog:open-folder', { title }) as Promise<string | null>

// --- Settings ---
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

export const ipcSettingsGet = (): Promise<SettingsGetRes> =>
  api.invoke('ipc:settings:get') as Promise<SettingsGetRes>

export const ipcSettingsSave = (req: SaveSettingsReq): Promise<{ success: boolean; error?: string }> =>
  api.invoke('ipc:settings:save', req) as Promise<{ success: boolean; error?: string }>

// --- PS Bridge / Tenant ---
export const ipcPsGetTenantConfig = (): Promise<AuthStatusRes> =>
  api.invoke('ipc:ps:get-tenant-config') as Promise<AuthStatusRes>

export const ipcPsConnectTenant = (useDeviceCode: boolean): Promise<ConnectTenantRes> =>
  api.invoke('ipc:ps:connect-tenant', { useDeviceCode }) as Promise<ConnectTenantRes>

export const ipcPsDisconnectTenant = (): Promise<{ success: boolean }> =>
  api.invoke('ipc:ps:disconnect-tenant') as Promise<{ success: boolean }>

export const ipcPsGetIntuneApps = (): Promise<{ success: boolean; apps?: unknown[]; error?: string }> =>
  api.invoke('ipc:ps:get-intune-apps') as Promise<{ success: boolean; apps?: unknown[]; error?: string }>

export const ipcPsGetPackageSettings = (appName: string, sourceRootPath?: string): Promise<{ success: boolean; version?: string; wingetId?: string; sourceFolder?: string; error?: string }> =>
  api.invoke('ipc:ps:get-package-settings', { appName, sourceRootPath }) as Promise<{ success: boolean; version?: string; wingetId?: string; sourceFolder?: string; error?: string }>

export const ipcPsGetLatestVersion = (wingetId: string): Promise<{ version: string | null; wingetId: string; error?: string }> =>
  api.invoke('ipc:ps:get-latest-version', { wingetId }) as Promise<{ version: string | null; wingetId: string; error?: string }>

export const ipcPsSearchWinget = (query: string): Promise<{ success: boolean; results: unknown[]; error?: string }> =>
  api.invoke('ipc:ps:search-winget', { query }) as Promise<{ success: boolean; results: unknown[]; error?: string }>

// --- AI Agent ---
export const ipcAiDeployApp = (req: DeployAppReq): Promise<DeployAppRes> =>
  api.invoke('ipc:ai:deploy-app', req) as Promise<DeployAppRes>

export const ipcAiPackageOnly = (req: PackageOnlyReq): Promise<PackageOnlyRes> =>
  api.invoke('ipc:ai:package-only', req) as Promise<PackageOnlyRes>

export const ipcAiUploadOnly = (req: UploadOnlyReq): Promise<UploadOnlyRes> =>
  api.invoke('ipc:ai:upload-only', req) as Promise<UploadOnlyRes>

export const ipcAiGetRecommendations = (): Promise<GetRecommendationsRes> =>
  api.invoke('ipc:ai:get-recommendations') as Promise<GetRecommendationsRes>

export const ipcAiCancel = (jobId: string): Promise<void> =>
  api.invoke('ipc:ai:cancel', { jobId }) as Promise<void>

export const ipcPsListIntunewinPackages = (): Promise<ListPackagesRes> =>
  api.invoke('ipc:ps:list-intunewin-packages') as Promise<ListPackagesRes>

export const ipcPsGetDevices = (): Promise<GetDevicesRes> =>
  api.invoke('ipc:ps:get-devices') as Promise<GetDevicesRes>

export const ipcPsTriggerWindowsUpdate = (deviceId: string): Promise<TriggerDeviceActionRes> =>
  api.invoke('ipc:ps:trigger-windows-update', { deviceId }) as Promise<TriggerDeviceActionRes>

export const ipcPsTriggerDriverUpdate = (deviceId: string): Promise<TriggerDeviceActionRes> =>
  api.invoke('ipc:ps:trigger-driver-update', { deviceId }) as Promise<TriggerDeviceActionRes>

export const ipcPsDownloadDiagnostics = (deviceId: string, deviceName: string): Promise<TriggerDeviceActionRes> =>
  api.invoke('ipc:ps:download-diagnostics', { deviceId, deviceName }) as Promise<TriggerDeviceActionRes>

// --- Dashboard v2 data sources ---
export const ipcPsGetAppInstallStats = (): Promise<AppInstallStatsRes> =>
  api.invoke('ipc:ps:get-app-install-stats') as Promise<AppInstallStatsRes>

export const ipcPsGetUpdateStates = (): Promise<UpdateStatesRes> =>
  api.invoke('ipc:ps:get-update-states') as Promise<UpdateStatesRes>

export const ipcPsGetUEAScores = (): Promise<UEAScoresRes> =>
  api.invoke('ipc:ps:get-uea-scores') as Promise<UEAScoresRes>

export const ipcPsGetAutopilotEvents = (): Promise<AutopilotEventsRes> =>
  api.invoke('ipc:ps:get-autopilot-events') as Promise<AutopilotEventsRes>

// --- AWS ---
export const ipcAwsSsoLogin = (profile?: string): Promise<AwsSsoLoginRes> =>
  api.invoke('ipc:aws:sso-login', { profile }) as Promise<AwsSsoLoginRes>

// --- Event subscriptions ---
export const onJobLog = (callback: (data: LogEntry) => void): (() => void) =>
  api.on('job:log', callback as (data: unknown) => void)

export const onJobPhaseChange = (callback: (data: { jobId: string; phase: string; label: string }) => void): (() => void) =>
  api.on('job:phase-change', callback as (data: unknown) => void)

export const onJobComplete = (callback: (data: { jobId: string }) => void): (() => void) =>
  api.on('job:complete', callback as (data: unknown) => void)

export const onJobError = (callback: (data: { jobId: string; error: string; phase: string }) => void): (() => void) =>
  api.on('job:error', callback as (data: unknown) => void)

export const onJobPackageComplete = (callback: (data: { jobId: string; intunewinPath: string | null; packageSettings: Record<string, unknown> | null }) => void): (() => void) =>
  api.on('job:package-complete', callback as (data: unknown) => void)
