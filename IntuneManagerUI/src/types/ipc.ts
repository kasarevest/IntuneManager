// Auth
export interface LoginReq { username: string; password: string }
export interface LoginRes { success: boolean; sessionToken?: string; user?: { id: number; username: string; role: 'superadmin' | 'admin' | 'viewer'; mustChangePassword: boolean }; error?: string }
export interface FirstRunCheckRes { isFirstRun: boolean }
export interface GeneratedPasswordRes { success: boolean; generatedPassword?: string }
export interface ValidateSessionRes { valid: boolean; user?: { id: number; username: string; role: 'superadmin' | 'admin' | 'viewer'; mustChangePassword: boolean } }
export interface CreateUserReq { sessionToken: string; username: string; password: string; role: string }
export interface ChangePasswordReq { sessionToken: string; currentPassword: string; newPassword: string }

// Settings
export interface SaveSettingsReq {
  intunewinToolPath?: string
  sourceRootPath?: string
  outputFolderPath?: string
  claudeApiKey?: string
  defaultMinOs?: string
  logRetentionDays?: number
  awsRegion?: string
  awsBedrockModelId?: string
}

export interface AwsSsoLoginRes {
  success: boolean
  error?: string
}

// PS Bridge
export interface ConnectTenantRes { success: boolean; username?: string; tenantId?: string; tokenExpiry?: string; error?: string }
export interface AuthStatusRes { isConnected: boolean; username?: string; tenantId?: string; expiresInMinutes?: number }
export interface IntuneAppsRes { success: boolean; apps?: unknown[]; error?: string; fromCache?: boolean }
export interface SearchRes { success: boolean; results: unknown[] }
export interface DownloadRes { success: boolean; path?: string; sizeMB?: number; sha256?: string; error?: string }
export interface BuildRes { success: boolean; intunewinPath?: string; error?: string }
export interface UploadRes { success: boolean; versionId?: string; error?: string }

// AI Agent
export interface DeployAppReq { userRequest: string; isUpdate?: boolean; existingAppId?: string; jobId?: string }
export interface DeployAppRes { jobId: string }

export interface PackageOnlyReq { userRequest: string; jobId?: string }
export interface PackageOnlyRes { jobId: string }

export interface UploadOnlyReq {
  intunewinPath: string
  packageSettings: Record<string, unknown>
  jobId?: string
}
export interface UploadOnlyRes { jobId: string }

export interface AppRecommendation {
  id: string
  name: string
  publisher: string
  description: string
  wingetId: string | null
  category: string
}

export interface GetRecommendationsRes {
  success: boolean
  recommendations: AppRecommendation[]
  error?: string
  fromCache?: boolean
}

export interface IntunewinPackage {
  filename: string
  intunewinPath: string
  appName: string
  lastModified: string
  packageSettings: Record<string, unknown> | null
}

export interface ListPackagesRes {
  success: boolean
  packages: IntunewinPackage[]
  error?: string
}

// Devices
export interface DeviceItem {
  id: string
  deviceName: string
  userPrincipalName: string
  operatingSystem: string
  osVersion: string
  complianceState: string
  managementState: string
  enrolledDateTime: string
  lastSyncDateTime: string
  windowsUpdateStatus: 'updated' | 'needsUpdate' | 'unknown'
  driverUpdateStatus: 'updated' | 'needsUpdate' | 'unknown'
  hasDiagnostics: boolean
  needsAttention: boolean
  // Dashboard v2 additions
  deviceEnrollmentType: string
  joinType: string
  malwareProtectionEnabled: boolean
  realTimeProtectionEnabled: boolean
  signatureUpdateOverdue: boolean
  quickScanOverdue: boolean
  rebootRequired: boolean
}

// App install health
export interface AppInstallStat {
  id: string
  displayName: string
  installed: number
  failed: number
  pending: number
  notApplicable: number
  successPercent: number
}
export interface AppInstallStatsRes {
  success: boolean
  apps: AppInstallStat[]
  truncated?: boolean
  permissionError?: boolean
  error?: string
  fromCache?: boolean
}

// Windows Update states
export interface UpdateStateSummary {
  notStarted: number
  pending: number
  inProgress: number
  completed: number
  failed: number
}
export interface UpdateStateDevice {
  deviceId: string
  deviceName: string
  osVersion: string
  featureUpdateVersion: string
  status: string
}
export interface UpdateStatesRes {
  success: boolean
  summary: UpdateStateSummary
  states: UpdateStateDevice[]
  permissionError?: boolean
  error?: string
  fromCache?: boolean
}

// UEA scores
export interface UEAOverview {
  startupScore: number
  appReliabilityScore: number
  batteryHealthScore: number
  workFromAnywhereScore: number
}
export interface UEAAppHealth {
  appName: string
  appPublisher: string
  crashCount: number
  hangCount: number
  crashRate: number
}
export interface UEAScoresRes {
  success: boolean
  overview: UEAOverview | null
  appHealth: UEAAppHealth[]
  permissionError?: boolean
  error?: string
  fromCache?: boolean
}

// Autopilot events
export interface AutopilotEvent {
  id: string
  deviceRegisteredDateTime: string
  enrollmentState: string
  enrollmentFailureDetails: string | null
}
export interface AutopilotEventsRes {
  success: boolean
  events: AutopilotEvent[]
  permissionError?: boolean
  error?: string
  fromCache?: boolean
}

export interface GetDevicesRes {
  success: boolean
  devices: DeviceItem[]
  error?: string
  fromCache?: boolean
}

export interface TriggerDeviceActionRes {
  success: boolean
  error?: string
}

// WinTuner updates
export interface WtUpdateItem {
  name: string
  packageId: string
  currentVersion: string
  latestVersion: string
  graphId: string
}
export interface WtUpdatesRes {
  success: boolean
  updates: WtUpdateItem[]
  error?: string
}
export interface WtPackageReq { packageId: string; packageFolder: string; version?: string; jobId?: string }
export interface WtPackageRes { success: boolean; packageFolder?: string; intunewinPath?: string | null; appJsonPath?: string | null; error?: string }
export interface WtDeployReq { packageFolder: string; assignment?: string; graphId?: string; keepAssignments?: boolean; jobId?: string }
export interface WtDeployRes { success: boolean; appId?: string; error?: string }
export interface WtUpdateAppReq { packageId: string; graphId: string; packageFolder: string; version?: string; jobId?: string }
export interface WtUpdateAppRes { success: boolean; graphId?: string; error?: string }

// AAD Group Assignment
export interface AadGroup {
  id: string
  displayName: string
  groupType: 'device' | 'user'
}
export interface GetAadGroupsRes { success: boolean; groups: AadGroup[]; error?: string }
export interface RecentGroup extends AadGroup { intent: 'required' | 'available'; useCount: number }
export interface GetRecentGroupsRes { success: boolean; groups: RecentGroup[] }
export interface GroupAssignment { groupId: string; groupName: string; groupType: 'device' | 'user'; intent: 'required' | 'available' }
export interface SetAssignmentsReq { appId: string; assignments: GroupAssignment[] }
export interface SetAssignmentsRes { success: boolean; assigned?: number; error?: string }
