export interface User {
  id: number
  username: string
  role: 'superadmin' | 'admin' | 'viewer'
  mustChangePassword: boolean
}

export interface AppRow {
  id: string
  displayName: string
  displayVersion: string
  publishingState: string
  lastModifiedDateTime: string
  latestVersion?: string        // latest version available from winget
  wingetId?: string             // winget package ID (from PACKAGE_SETTINGS.md)
  localSourceFolder?: string
  status: 'current' | 'update-available' | 'local-only' | 'cloud-only' | 'unknown'
  versionChecking?: boolean     // true while winget lookup is in progress
}

export interface LogEntry {
  jobId: string
  timestamp: string
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'
  message: string
  source: 'ai' | 'ps' | 'system'
}

export interface DeployJob {
  jobId: string
  phase: string
  phaseLabel: string
  logs: LogEntry[]
  status: 'running' | 'complete' | 'error' | 'cancelled'
  error?: string
}

export interface TenantInfo {
  isConnected: boolean
  username?: string
  tenantId?: string
  expiresInMinutes?: number
}

export interface AppSettings {
  intunewinToolPath: string
  sourceRootPath: string
  outputFolderPath: string
  claudeApiKey: string
  defaultMinOs: string
  logRetentionDays: number
}

export interface DeviceRow {
  id: string
  deviceName: string
  userPrincipalName: string
  operatingSystem: string
  osVersion: string
  complianceState: 'compliant' | 'noncompliant' | 'unknown' | 'notApplicable' | 'inGracePeriod' | 'configManager'
  managementState: string
  enrolledDateTime: string
  lastSyncDateTime: string
  // Windows Update fields
  windowsUpdateStatus: 'updated' | 'needsUpdate' | 'unknown'
  // Driver update fields
  driverUpdateStatus: 'updated' | 'needsUpdate' | 'unknown'
  // Diagnostics
  hasDiagnostics: boolean
  // Attention flag
  needsAttention: boolean
}
