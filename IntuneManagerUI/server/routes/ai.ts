import { Router } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import AnthropicBedrock from '@anthropic-ai/bedrock-sdk'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { requireAuth } from '../middleware/auth'
import { decrypt } from '../services/encryption'
import { runPsScript } from '../services/ps-bridge'
import { sseManager } from '../sse'
import prisma from '../db'
import { getAccessToken, GraphAuthError } from '../services/graph-auth'

const router = Router()

// ─── Claude client factory ────────────────────────────────────────────────────

interface ClientBundle {
  client: Anthropic | AnthropicBedrock
  model: string
}

async function createClient(): Promise<ClientBundle> {
  // Direct API key takes priority — allows container deployments to use
  // ANTHROPIC_API_KEY env var even when Bedrock settings exist in the DB.
  const apiKeyRow = await prisma.appSetting.findUnique({ where: { key: 'claude_api_key_encrypted' } })
  const apiKey = apiKeyRow ? decrypt(apiKeyRow.value) : process.env.ANTHROPIC_API_KEY ?? ''

  if (apiKey) {
    return { client: new Anthropic({ apiKey }), model: 'claude-sonnet-4-6' }
  }

  // Fall back to Bedrock only when no direct API key is available
  const getRow = async (key: string) => {
    const row = await prisma.appSetting.findUnique({ where: { key } })
    return row?.value ?? ''
  }
  const awsRegion = await getRow('aws_region')
  const bedrockModelId = await getRow('aws_bedrock_model_id')

  if (awsRegion && bedrockModelId) {
    return { client: new AnthropicBedrock({ awsRegion }), model: bedrockModelId }
  }

  return { client: new Anthropic({ apiKey: '' }), model: 'claude-sonnet-4-6' }
}

async function assertClientConfigured(): Promise<ClientBundle> {
  const getRow = async (key: string) => {
    const row = await prisma.appSetting.findUnique({ where: { key } })
    return row?.value ?? ''
  }

  // Check direct API key first
  const apiKeyRow = await prisma.appSetting.findUnique({ where: { key: 'claude_api_key_encrypted' } })
  const apiKey = apiKeyRow ? decrypt(apiKeyRow.value) : process.env.ANTHROPIC_API_KEY ?? ''

  if (apiKey) return createClient()

  // No API key — check Bedrock
  const awsRegion = await getRow('aws_region')
  const bedrockModelId = await getRow('aws_bedrock_model_id')

  if (awsRegion && !bedrockModelId) {
    throw new Error('Bedrock Model ID is required. Go to Settings → General and enter the Bedrock Model ID (e.g. anthropic.claude-3-5-sonnet-20241022-v2:0).')
  }

  if (awsRegion && bedrockModelId) {
    return createClient()
  }

  throw new Error('No Claude connection configured. Go to Settings → General and add an Anthropic API key, or configure AWS Bedrock.')
}

interface ActiveJob {
  id: string
  abortController: AbortController
  phase: string
}

const activeJobs = new Map<string, ActiveJob>()

const SYSTEM_PROMPT = `You are the IntuneManager AI deployment agent.
Your job is to deploy Windows applications to Microsoft Intune as Win32 apps.

DEPLOYMENT WORKFLOW (follow this exact order):
1. Call search_winget with the app name to find the exact winget ID and version
2. If winget has it, call get_latest_version to confirm the latest stable version
3. If winget does NOT have it, call search_chocolatey as fallback
4. Determine the installer download URL from the winget/chocolatey manifest
5. Call download_app to download the installer to Source/<AppName>/
6. Call generate_install_script to create Install-<AppName>.ps1
7. Call generate_uninstall_script to create Uninstall-<AppName>.ps1
8. Call generate_detect_script to create Detect-<AppName>.ps1
9. Call generate_package_settings to create PACKAGE_SETTINGS.md
10. Call build_package to create the .intunewin file
11. Call create_intune_app to register the app in Intune (skip if updating existing app)
12. Call upload_to_intune to upload the .intunewin to the app record

IMPORTANT RULES:
- Always use the LATEST STABLE version (not beta/preview/RC)
- For MSI installers: silent args are /qn /norestart
- For NSIS EXE: use /S
- For Inno Setup EXE: use /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
- Registry detection key: always use HKLM:\\SOFTWARE\\<AppNameNoSpaces>Installer
- Install behavior: always 'system' unless explicitly told otherwise
- Minimum OS: default to windows10_21H2 unless the app requires newer (Graph enum values: windows10_21H2, windows10_22H2, Windows11_21H2, Windows11_22H2, Windows11_23H2, Windows11_24H2)
- Always generate all 4 files (Install, Uninstall, Detect, PACKAGE_SETTINGS) before building
- Source folder naming: use PascalCase no spaces (e.g. AdobeAcrobat, MozillaFirefox)

For UPDATE operations (when existingAppId is provided):
- Skip step 11 (create_intune_app) — use the provided existingAppId
- Use the existingAppId directly for upload_to_intune`

const DEPLOY_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_winget',
    description: 'Search Windows Package Manager (winget) for an application. Use this first.',
    input_schema: {
      type: 'object' as const,
      properties: { query: { type: 'string', description: 'App name to search for' } },
      required: ['query']
    }
  },
  {
    name: 'search_chocolatey',
    description: 'Search Chocolatey package repository. Use as fallback if winget has no results.',
    input_schema: {
      type: 'object' as const,
      properties: { query: { type: 'string', description: 'App name or package ID to search for' } },
      required: ['query']
    }
  },
  {
    name: 'get_latest_version',
    description: 'Get the latest stable version for a winget package ID.',
    input_schema: {
      type: 'object' as const,
      properties: { winget_id: { type: 'string', description: 'Exact winget package ID' } },
      required: ['winget_id']
    }
  },
  {
    name: 'download_app',
    description: 'Download an application installer to local staging directory.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'Direct HTTPS download URL' },
        output_path: { type: 'string', description: 'Absolute path where installer will be saved' },
        expected_sha256: { type: 'string', description: 'Optional SHA256 hash for verification' }
      },
      required: ['url', 'output_path']
    }
  },
  {
    name: 'generate_install_script',
    description: 'Generate a PowerShell Install.ps1 script for an Intune Win32 app.',
    input_schema: {
      type: 'object' as const,
      properties: {
        app_name: { type: 'string' },
        app_version: { type: 'string' },
        installer_filename: { type: 'string' },
        installer_type: { type: 'string', enum: ['msi', 'exe', 'msix', 'appx'] },
        silent_args: { type: 'string', description: 'Silent install arguments' },
        sha256: { type: 'string', description: 'Optional SHA256 for installer integrity check' },
        source_folder: { type: 'string', description: 'Absolute path to app source folder' },
        registry_key_name: { type: 'string', description: 'Registry key name for detection (no spaces)' }
      },
      required: ['app_name', 'app_version', 'installer_filename', 'installer_type', 'silent_args', 'source_folder', 'registry_key_name']
    }
  },
  {
    name: 'generate_uninstall_script',
    description: 'Generate a PowerShell Uninstall.ps1 script for an Intune Win32 app.',
    input_schema: {
      type: 'object' as const,
      properties: {
        app_name: { type: 'string' },
        app_version: { type: 'string' },
        installer_type: { type: 'string', enum: ['msi', 'exe', 'msix', 'appx'] },
        product_guid: { type: 'string', description: 'MSI Product GUID if known' },
        source_folder: { type: 'string' },
        registry_key_name: { type: 'string' }
      },
      required: ['app_name', 'app_version', 'installer_type', 'source_folder', 'registry_key_name']
    }
  },
  {
    name: 'generate_detect_script',
    description: 'Generate a detection script for Intune.',
    input_schema: {
      type: 'object' as const,
      properties: {
        app_name: { type: 'string' },
        app_version: { type: 'string' },
        registry_key_name: { type: 'string' },
        exe_path: { type: 'string', description: 'Optional path to executable for secondary check' },
        source_folder: { type: 'string' }
      },
      required: ['app_name', 'app_version', 'registry_key_name', 'source_folder']
    }
  },
  {
    name: 'generate_package_settings',
    description: 'Generate PACKAGE_SETTINGS.md file for the app.',
    input_schema: {
      type: 'object' as const,
      properties: {
        app_name: { type: 'string' },
        description: { type: 'string' },
        publisher: { type: 'string' },
        app_version: { type: 'string' },
        winget_id: { type: 'string' },
        install_command: { type: 'string' },
        uninstall_command: { type: 'string' },
        installer_url: { type: 'string' },
        installer_type: { type: 'string' },
        sha256: { type: 'string' },
        min_os: { type: 'string' },
        detect_script_name: { type: 'string' },
        source_folder: { type: 'string' }
      },
      required: ['app_name', 'app_version', 'publisher', 'install_command', 'uninstall_command', 'source_folder', 'detect_script_name']
    }
  },
  {
    name: 'build_package',
    description: 'Call IntuneWinAppUtil.exe to create a .intunewin package file.',
    input_schema: {
      type: 'object' as const,
      properties: {
        source_folder: { type: 'string' },
        entry_point: { type: 'string', description: 'Absolute path to Install.ps1' },
        output_folder: { type: 'string' }
      },
      required: ['source_folder', 'entry_point', 'output_folder']
    }
  },
  {
    name: 'create_intune_app',
    description: 'Create a new Win32 app record in Microsoft Intune via Graph API.',
    input_schema: {
      type: 'object' as const,
      properties: {
        display_name: { type: 'string' },
        description: { type: 'string' },
        publisher: { type: 'string' },
        app_version: { type: 'string' },
        install_command_line: { type: 'string' },
        uninstall_command_line: { type: 'string' },
        install_behavior: { type: 'string', enum: ['system', 'user'] },
        minimum_os: { type: 'string', description: 'Graph API enum e.g. windows10_21H2, windows10_22H2, Windows11_21H2, Windows11_22H2, Windows11_23H2, Windows11_24H2' },
        detect_script_name: { type: 'string' },
        detect_script_content_base64: { type: 'string', description: 'Base64-encoded detection script content' }
      },
      required: ['display_name', 'publisher', 'app_version', 'install_command_line', 'uninstall_command_line', 'detect_script_name', 'detect_script_content_base64']
    }
  },
  {
    name: 'upload_to_intune',
    description: 'Upload a .intunewin file to an existing Intune app record.',
    input_schema: {
      type: 'object' as const,
      properties: {
        app_id: { type: 'string', description: 'Intune app GUID' },
        intunewin_path: { type: 'string', description: 'Absolute path to .intunewin file' }
      },
      required: ['app_id', 'intunewin_path']
    }
  }
]

const PHASE_MAP: Record<string, string> = {
  search_winget: 'searching',
  search_chocolatey: 'searching',
  get_latest_version: 'searching',
  download_app: 'downloading',
  generate_install_script: 'packaging',
  generate_uninstall_script: 'packaging',
  generate_detect_script: 'packaging',
  generate_package_settings: 'packaging',
  build_package: 'packaging',
  create_intune_app: 'uploading',
  upload_to_intune: 'uploading'
}

const PHASE_LABELS: Record<string, string> = {
  analyzing: 'Analyzing request...',
  searching: 'Searching for package...',
  downloading: 'Downloading installer...',
  packaging: 'Creating package...',
  uploading: 'Uploading to Intune...',
  done: 'Complete',
  error: 'Failed'
}

async function executeToolCall(
  toolName: string,
  input: Record<string, unknown>,
  jobId: string,
  sendEvent: (channel: string, data: unknown) => void
): Promise<unknown> {
  const log = (msg: string, level = 'INFO', source: 'ai' | 'ps' | 'system' = 'system') => {
    sendEvent('job:log', { jobId, timestamp: new Date().toISOString(), level, message: msg, source })
  }

  switch (toolName) {
    case 'search_winget': {
      const result = await runPsScript('Search-Winget.ps1', ['-Query', String(input.query)],
        (msg, level) => log(msg, level, 'ps'))
      return result.result ?? { success: false, results: [] }
    }

    case 'search_chocolatey': {
      const result = await runPsScript('Search-Chocolatey.ps1', ['-Query', String(input.query)],
        (msg, level) => log(msg, level, 'ps'))
      return result.result ?? { success: false, results: [] }
    }

    case 'get_latest_version': {
      const result = await runPsScript('Get-LatestVersion.ps1', ['-WingetId', String(input.winget_id)],
        (msg, level) => log(msg, level, 'ps'))
      return result.result ?? { version: null }
    }

    case 'download_app': {
      const args = ['-Url', String(input.url), '-OutputPath', String(input.output_path)]
      if (input.expected_sha256) args.push('-ExpectedSHA256', String(input.expected_sha256))
      const result = await runPsScript('Download-File.ps1', args,
        (msg, level) => log(msg, level, 'ps'))
      return result.result ?? { success: false, error: 'Download failed' }
    }

    case 'generate_install_script': {
      const appName = String(input.app_name)
      const version = String(input.app_version)
      const installerFile = String(input.installer_filename)
      const installerType = String(input.installer_type)
      const silentArgs = String(input.silent_args)
      const registryKey = String(input.registry_key_name)
      const sourceFolder = String(input.source_folder)
      const sha256 = input.sha256 ? String(input.sha256) : ''

      const scriptContent = generateInstallScript(appName, version, installerFile, installerType, silentArgs, registryKey, sha256)
      const scriptPath = path.join(sourceFolder, `Install-${appName.replace(/\s+/g, '')}.ps1`)
      fs.mkdirSync(sourceFolder, { recursive: true })
      fs.writeFileSync(scriptPath, scriptContent, 'utf8')
      log(`Generated: ${scriptPath}`)
      return { success: true, scriptPath }
    }

    case 'generate_uninstall_script': {
      const appName = String(input.app_name)
      const version = String(input.app_version)
      const installerType = String(input.installer_type)
      const registryKey = String(input.registry_key_name)
      const sourceFolder = String(input.source_folder)
      const productGuid = input.product_guid ? String(input.product_guid) : ''

      const scriptContent = generateUninstallScript(appName, version, installerType, registryKey, productGuid)
      const scriptPath = path.join(sourceFolder, `Uninstall-${appName.replace(/\s+/g, '')}.ps1`)
      fs.writeFileSync(scriptPath, scriptContent, 'utf8')
      log(`Generated: ${scriptPath}`)
      return { success: true, scriptPath }
    }

    case 'generate_detect_script': {
      const appName = String(input.app_name)
      const version = String(input.app_version)
      const registryKey = String(input.registry_key_name)
      const sourceFolder = String(input.source_folder)
      const exePath = input.exe_path ? String(input.exe_path) : ''

      const scriptContent = generateDetectScript(appName, version, registryKey, exePath)
      const scriptName = `Detect-${appName.replace(/\s+/g, '')}.ps1`
      const scriptPath = path.join(sourceFolder, scriptName)
      fs.writeFileSync(scriptPath, scriptContent, 'utf8')
      log(`Generated: ${scriptPath}`)
      return { success: true, scriptPath, scriptName }
    }

    case 'generate_package_settings': {
      const content = generatePackageSettings(input)
      const settingsPath = path.join(String(input.source_folder), 'PACKAGE_SETTINGS.md')
      fs.writeFileSync(settingsPath, content, 'utf8')
      log(`Generated: ${settingsPath}`)
      return { success: true, settingsPath }
    }

    case 'build_package': {
      const toolRow = await prisma.appSetting.findUnique({ where: { key: 'intunewin_tool_path' } })
      const toolPath = toolRow?.value || ''
      const args = [
        '-SourceFolder', String(input.source_folder),
        '-EntryPoint', String(input.entry_point),
        '-OutputFolder', String(input.output_folder)
      ]
      if (toolPath) args.push('-ToolPath', toolPath)
      const result = await runPsScript('Build-Package.ps1', args, (msg, level) => log(msg, level, 'ps'))
      return result.result ?? { success: false, error: 'Build failed' }
    }

    case 'create_intune_app': {
      const rawMinOs = String(input.minimum_os ?? 'windows10_21H2')
      const MIN_OS_MAP: Record<string, string> = {
        'windows 10 21h2':  'windows10_21H2',
        'windows 10 22h2':  'windows10_22H2',
        'windows 10 20h2':  '2H20',
        'windows 10 2004':  '2004',
        'windows 10 1903':  '1903',
        'windows 10 1809':  '1809',
        'windows 10 1607':  '1607',
        'windows 11 21h2':  'Windows11_21H2',
        'windows 11 22h2':  'Windows11_22H2',
        'windows 11 23h2':  'Windows11_23H2',
        'windows 11 24h2':  'Windows11_24H2',
        'w10_21h2':  'windows10_21H2',
        'w10_22h2':  'windows10_22H2',
        'w11_21h2':  'Windows11_21H2',
        'w11_22h2':  'Windows11_22H2',
        'w11_23h2':  'Windows11_23H2',
        'w11_24h2':  'Windows11_24H2',
      }
      const minOs = MIN_OS_MAP[rawMinOs.toLowerCase()] ?? rawMinOs

      const setupFilePath = String(input.detect_script_name ?? '').replace(/.*[\\/]/, '')

      const bodyJson = JSON.stringify({
        '@odata.type': '#microsoft.graph.win32LobApp',
        displayName: input.display_name,
        description: input.description ?? '',
        publisher: input.publisher,
        displayVersion: input.app_version,
        fileName: setupFilePath,
        setupFilePath: setupFilePath,
        installCommandLine: input.install_command_line,
        uninstallCommandLine: input.uninstall_command_line,
        installExperience: {
          '@odata.type': '#microsoft.graph.win32LobAppInstallExperience',
          runAsAccount: input.install_behavior ?? 'system',
          deviceRestartBehavior: 'suppress'
        },
        minimumSupportedWindowsRelease: minOs,
        detectionRules: [{
          '@odata.type': '#microsoft.graph.win32LobAppPowerShellScriptDetection',
          enforceSignatureCheck: false,
          runAs32Bit: false,
          scriptContent: input.detect_script_content_base64
        }]
      })
      let accessToken: string
      try { accessToken = await getAccessToken() } catch (e) {
        throw new Error(`Cannot create Intune app: ${(e as Error).message}`)
      }
      const tmpJsonPath = path.join(os.tmpdir(), `intune-body-${Date.now()}.json`)
      fs.writeFileSync(tmpJsonPath, bodyJson, 'utf8')
      let result: Awaited<ReturnType<typeof runPsScript>>
      try {
        result = await runPsScript('New-Win32App.ps1', ['-BodyJsonPath', tmpJsonPath, '-AccessToken', accessToken],
          (msg, level) => log(msg, level, 'ps'))
      } finally {
        try { fs.unlinkSync(tmpJsonPath) } catch { /* ignore */ }
      }
      return result.result ?? { success: false, error: 'Create app failed' }
    }

    case 'upload_to_intune': {
      let accessToken: string
      try { accessToken = await getAccessToken() } catch (e) {
        throw new Error(`Cannot upload to Intune: ${(e as Error).message}`)
      }
      const result = await runPsScript('Upload-App.ps1',
        ['-AppId', String(input.app_id), '-IntunewinPath', String(input.intunewin_path), '-AccessToken', accessToken],
        (msg, level) => log(msg, level, 'ps'))
      return result.result ?? { success: false, error: 'Upload failed' }
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`)
  }
}

// ─── Script generators ────────────────────────────────────────────────────────

function generateInstallScript(appName: string, version: string, installerFile: string, installerType: string, silentArgs: string, registryKey: string, sha256: string): string {
  const safeAppName = appName.replace(/\s+/g, '')
  const msiInstall = installerType === 'msi'
    ? `    $args = @('/i', \`"\$InstallerPath\`", '/qn', '/norestart', '/l*v', \`"\$LogFile\`")\n    $proc = Start-Process msiexec.exe -ArgumentList $args -Wait -PassThru`
    : `    $proc = Start-Process -FilePath $InstallerPath -ArgumentList '${silentArgs}' -Wait -PassThru`

  return `#Requires -Version 5.1
<#
.SYNOPSIS  Install ${appName} v${version} for Intune Win32 deployment
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$AppName    = '${appName}'
$AppVersion = '${version}'
$RegKey     = 'HKLM:\\SOFTWARE\\${registryKey}'
$LogFile    = "$env:TEMP\\Install-${safeAppName}.log"

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $ts = Get-Date -Format 'HH:mm:ss'
    "[\$ts] [\$Level] \$Message" | Tee-Object -FilePath \$LogFile -Append | Write-Host
}

function Set-DetectionKey {
    param([string]$Version)
    try {
        if (-not (Test-Path \$RegKey)) { New-Item -Path \$RegKey -Force | Out-Null }
        Set-ItemProperty -Path \$RegKey -Name 'Version'      -Value \$Version -Type String -Force
        Set-ItemProperty -Path \$RegKey -Name 'InstallDate'  -Value (Get-Date -Format 'yyyyMMdd') -Type String -Force
        Set-ItemProperty -Path \$RegKey -Name 'InstalledBy'  -Value 'Intune' -Type String -Force
        return \$true
    } catch {
        Write-Log "Failed to write detection key: \$(\$_.Exception.Message)" 'WARN'
        return \$false
    }
}

try {
    Write-Log "Starting installation: \$AppName \$AppVersion"

    # Locate installer relative to script directory (safe — no traversal)
    \$ScriptDir    = \$PSScriptRoot
    \$InstallerPath = [IO.Path]::GetFullPath((Join-Path \$ScriptDir '${installerFile}'))
    if (-not \$InstallerPath.StartsWith(\$ScriptDir, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Installer path outside script directory: \$InstallerPath"
    }
    if (-not (Test-Path \$InstallerPath)) {
        throw "Installer not found: \$InstallerPath"
    }

${sha256 ? `    # SHA256 verification
    Write-Log "Verifying SHA256..."
    \$actual = (Get-FileHash -Path \$InstallerPath -Algorithm SHA256).Hash.ToLower()
    if (\$actual -ne '${sha256.toLowerCase()}') {
        throw "SHA256 mismatch. Expected: ${sha256.toLowerCase()}  Actual: \$actual"
    }
    Write-Log "SHA256 verified OK"
` : ''}
    # Check existing installation
    if (Test-Path \$RegKey) {
        \$installed = (Get-ItemProperty -Path \$RegKey -Name 'Version' -ErrorAction SilentlyContinue).Version
        if (\$installed) {
            try {
                \$cmp = ([System.Version]\$installed).CompareTo([System.Version]\$AppVersion)
                if (\$cmp -ge 0) {
                    Write-Log "Version \$installed already installed — skipping"
                    exit 0
                }
            } catch { Write-Log "Version comparison failed — proceeding with install" 'WARN' }
        }
    }

    Write-Log "Running installer..."
${msiInstall}

    Write-Log "Installer exit code: \$(\$proc.ExitCode)"

    if (\$proc.ExitCode -notin @(0, 3010, 1641)) {
        throw "Installer failed with exit code: \$(\$proc.ExitCode)"
    }

    Write-Log "Setting detection registry key..."
    Set-DetectionKey -Version \$AppVersion | Out-Null

    Write-Log "Installation complete: \$AppName \$AppVersion"

    if (\$proc.ExitCode -in @(3010, 1641)) {
        Write-Log "Reboot required"
        exit 3010
    }
    exit 0

} catch {
    Write-Log "FATAL: \$(\$_.Exception.GetType().FullName): \$(\$_.Exception.Message)" 'ERROR'
    exit 1
}
`
}

function generateUninstallScript(appName: string, version: string, installerType: string, registryKey: string, productGuid: string): string {
  const safeAppName = appName.replace(/\s+/g, '')
  const uninstallCmd = installerType === 'msi' && productGuid
    ? `    \$proc = Start-Process msiexec.exe -ArgumentList @('/x', '${productGuid}', '/qn', '/norestart') -Wait -PassThru`
    : `    \$uninstallStr = (Get-ItemProperty "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*" | Where-Object { \$_.DisplayName -like '*${appName}*' } | Select-Object -First 1).UninstallString
    if (-not \$uninstallStr) { Write-Log "Uninstall string not found — app may not be installed"; exit 0 }
    \$proc = Start-Process -FilePath 'cmd.exe' -ArgumentList "/c \`"\$uninstallStr\`" /S /silent /quiet" -Wait -PassThru`

  return `#Requires -Version 5.1
<#
.SYNOPSIS  Uninstall ${appName} v${version} for Intune Win32 deployment
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
\$RegKey  = 'HKLM:\\SOFTWARE\\${registryKey}'
\$LogFile = "\$env:TEMP\\Uninstall-${safeAppName}.log"

function Write-Log {
    param([string]\$Message, [string]\$Level = 'INFO')
    \$ts = Get-Date -Format 'HH:mm:ss'
    "[\$ts] [\$Level] \$Message" | Tee-Object -FilePath \$LogFile -Append | Write-Host
}

try {
    Write-Log "Starting uninstall: ${appName}"

${uninstallCmd}

    Write-Log "Uninstaller exit code: \$(\$proc.ExitCode)"

    if (\$proc.ExitCode -notin @(0, 3010, 1605)) {
        Write-Log "Warning: unexpected exit code \$(\$proc.ExitCode)" 'WARN'
    }

    # Remove detection registry key
    if (Test-Path \$RegKey) {
        Remove-Item -Path \$RegKey -Recurse -Force
        Write-Log "Detection registry key removed"
    }

    Write-Log "Uninstall complete"
    exit 0

} catch {
    Write-Log "FATAL: \$(\$_.Exception.GetType().FullName): \$(\$_.Exception.Message)" 'ERROR'
    exit 1
}
`
}

function generateDetectScript(appName: string, version: string, registryKey: string, exePath: string): string {
  return `#Requires -Version 5.1
<#
.SYNOPSIS  Detection script for ${appName} v${version}
#>

\$RegKey = 'HKLM:\\SOFTWARE\\${registryKey}'
\$MinVersion = '${version}'

try {
    if (-not (Test-Path \$RegKey)) { exit 1 }

    \$installed = (Get-ItemProperty -Path \$RegKey -Name 'Version' -ErrorAction SilentlyContinue).Version
    if (-not \$installed) { exit 1 }

    try {
        if ([System.Version]\$installed -lt [System.Version]\$MinVersion) { exit 1 }
    } catch {
        if (\$installed -ne \$MinVersion) { exit 1 }
    }
${exePath ? `
    # Secondary check: verify exe on disk
    if (-not (Test-Path '${exePath}')) { exit 1 }
` : ''}
    exit 0
} catch {
    exit 1
}
`
}

function generatePackageSettings(input: Record<string, unknown>): string {
  return `# ${input.app_name} — Package Settings

| Field | Value |
|-------|-------|
| Name | ${input.app_name} |
| Description | ${input.description ?? ''} |
| Publisher | ${input.publisher} |
| App Version | ${input.app_version} |
| Winget ID | ${input.winget_id ?? ''} |
| Category | Productivity |
| Information URL | ${input.information_url ?? ''} |
| Install Command | ${input.install_command} |
| Uninstall Command | ${input.uninstall_command} |
| Install Behavior | System |
| Architecture | x64 |
| Minimum OS | ${input.min_os ?? 'Windows 10 21H2'} |
| Detection Method | Script |
| Script File | ${input.detect_script_name} |
| Installer URL | ${input.installer_url ?? ''} |
| Installer Type | ${input.installer_type ?? ''} |
| SHA256 | ${input.sha256 ?? ''} |
`
}

// ─── Job runner functions ──────────────────────────────────────────────────────

async function runDeployJob(
  jobId: string,
  req: { userRequest: string; isUpdate?: boolean; existingAppId?: string },
  signal: AbortSignal,
  sendEvent: (channel: string, data: unknown) => void
): Promise<void> {
  const log = (msg: string, level = 'INFO', source: 'ai' | 'ps' | 'system' = 'ai') => {
    sendEvent('job:log', { jobId, timestamp: new Date().toISOString(), level, message: msg, source })
  }

  const setPhase = (phase: string) => {
    const label = PHASE_LABELS[phase] ?? phase
    sendEvent('job:phase-change', { jobId, phase, label })
  }

  const { client, model } = await assertClientConfigured()
  const isBedrockClient = client instanceof AnthropicBedrock

  const getSettingRow = async (key: string, fallback: string) => {
    const row = await prisma.appSetting.findUnique({ where: { key } })
    return row?.value || fallback
  }
  const sourceRoot = await getSettingRow('source_root_path', path.join(__dirname, '..', '..', '..', 'Source'))
  const outputFolder = await getSettingRow('output_folder_path', path.join(__dirname, '..', '..', '..', 'Output'))

  const pathContext = `\n\nPATH CONFIGURATION (use these exact paths):
- Source root: ${sourceRoot}  →  Create app subfolder here (e.g. ${sourceRoot}\\SevenZip)
- Output folder: ${outputFolder}  →  Pass this as output_folder to build_package`

  const messages: Anthropic.MessageParam[] = [{
    role: 'user',
    content: req.isUpdate && req.existingAppId
      ? `UPDATE the existing Intune app (ID: ${req.existingAppId}): ${req.userRequest}`
      : req.userRequest
  }]

  setPhase('analyzing')
  log(`Starting deployment: "${req.userRequest}"`)
  if (req.isUpdate && req.existingAppId) log(`Update mode — existing app ID: ${req.existingAppId}`)
  log(`AI connection: ${isBedrockClient ? `AWS Bedrock (${model})` : `Direct API (${model})`}`)
  log(`Source root: ${sourceRoot}`)
  log(`Output folder: ${outputFolder}`)

  let iterations = 0
  while (iterations++ < 20) {
    if (signal.aborted) throw new Error('Job cancelled')

    const response = await (client as Anthropic).messages.create({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT + pathContext,
      tools: DEPLOY_TOOLS,
      messages
    })

    messages.push({ role: 'assistant', content: response.content })

    for (const block of response.content) {
      if (block.type === 'text' && block.text.trim()) {
        log(`${block.text}`, 'INFO', 'ai')
      }
    }

    if (response.stop_reason === 'end_turn') {
      setPhase('done')
      sendEvent('job:complete', { jobId })
      break
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = []

    for (const block of response.content) {
      if (block.type !== 'tool_use') continue

      const phase = PHASE_MAP[block.name] ?? 'analyzing'
      setPhase(phase)
      log(`Tool: ${block.name}`, 'INFO', 'system')

      try {
        const result = await executeToolCall(block.name, block.input as Record<string, unknown>, jobId, sendEvent)
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) })
      } catch (err) {
        const errMsg = (err as Error).message
        log(`Tool ${block.name} failed: ${errMsg}`, 'ERROR', 'system')
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ success: false, error: errMsg }), is_error: true })
      }
    }

    messages.push({ role: 'user', content: toolResults })
  }

  if (iterations >= 20) {
    throw new Error('Maximum tool iterations reached (20). Deployment may be incomplete.')
  }
}

// ─── Upload-only job (steps 11-12: create app + upload, no re-packaging) ─────

async function runUploadOnlyJob(
  jobId: string,
  req: { intunewinPath: string; packageSettings: Record<string, unknown> },
  signal: AbortSignal,
  sendEvent: (channel: string, data: unknown) => void
): Promise<void> {
  const log = (msg: string, level = 'INFO', source: 'ai' | 'ps' | 'system' = 'system') => {
    sendEvent('job:log', { jobId, timestamp: new Date().toISOString(), level, message: msg, source })
  }
  const setPhase = (phase: string) => {
    const label = PHASE_LABELS[phase] ?? phase
    sendEvent('job:phase-change', { jobId, phase, label })
  }

  setPhase('uploading')
  log(`Deploying to Intune: ${req.intunewinPath}`)

  const ps = req.packageSettings

  if (signal.aborted) throw new Error('Job cancelled')

  // Read the detect script and base64-encode it
  const sourceFolder = String(ps.source_folder ?? '')
  const detectScriptName = String(ps.detect_script_name ?? '')
  const detectScriptPath = path.join(sourceFolder, detectScriptName)

  let detectScriptB64 = ''
  if (detectScriptPath && fs.existsSync(detectScriptPath)) {
    detectScriptB64 = fs.readFileSync(detectScriptPath, 'utf8').toString()
    detectScriptB64 = Buffer.from(detectScriptB64, 'utf8').toString('base64')
  } else {
    log(`Warning: detect script not found at ${detectScriptPath} — using empty detection`, 'WARN')
    detectScriptB64 = Buffer.from('exit 0', 'utf8').toString('base64')
  }

  // Step 11: Create the Intune app record
  log('Creating Intune app record...')
  const createResult = await executeToolCall('create_intune_app', {
    display_name: ps.app_name,
    description: ps.description ?? '',
    publisher: ps.publisher,
    app_version: ps.app_version,
    install_command_line: ps.install_command,
    uninstall_command_line: ps.uninstall_command,
    install_behavior: 'system',
    minimum_os: ps.min_os ?? 'W10_21H2',
    detect_script_name: detectScriptName,
    detect_script_content_base64: detectScriptB64
  }, jobId, sendEvent) as { success?: boolean; appId?: string; error?: string }

  if (!createResult.success) {
    throw new Error(`Failed to create Intune app: ${createResult.error ?? 'unknown error'}`)
  }

  const appId = createResult.appId
  if (!appId) throw new Error('Intune app created but no appId returned')

  log(`App created in Intune: ${appId}`)

  if (signal.aborted) throw new Error('Job cancelled')

  // Step 12: Upload the .intunewin file
  log(`Uploading package: ${req.intunewinPath}`)
  const uploadResult = await executeToolCall('upload_to_intune', {
    app_id: appId,
    intunewin_path: req.intunewinPath
  }, jobId, sendEvent) as { success?: boolean; error?: string }

  if (!uploadResult.success) {
    throw new Error(`Upload failed: ${uploadResult.error ?? 'unknown error'}`)
  }

  log('Deployment complete! App is now available in Intune.')
  setPhase('done')
  sendEvent('job:complete', { jobId })
}

// ─── Package-only job (steps 1-10, no upload) ─────────────────────────────────

const PACKAGE_ONLY_TOOLS: Anthropic.Tool[] = DEPLOY_TOOLS.filter(
  t => t.name !== 'create_intune_app' && t.name !== 'upload_to_intune'
)

const PACKAGE_ONLY_SYSTEM_PROMPT = `You are the IntuneManager AI packaging agent.
Your job is to prepare a Windows application for Microsoft Intune deployment by creating the .intunewin package.
You must NOT upload or register anything in Intune — packaging only.

PACKAGING WORKFLOW (follow this exact order):
1. Call search_winget with the app name to find the exact winget ID and version
2. If winget has it, call get_latest_version to confirm the latest stable version
3. If winget does NOT have it, call search_chocolatey as fallback
4. Determine the installer download URL from the winget/chocolatey manifest
5. Call download_app to download the installer to Source/<AppName>/
6. Call generate_install_script to create Install-<AppName>.ps1
7. Call generate_uninstall_script to create Uninstall-<AppName>.ps1
8. Call generate_detect_script to create Detect-<AppName>.ps1
9. Call generate_package_settings to create PACKAGE_SETTINGS.md
10. Call build_package to create the .intunewin file — this is the final step

IMPORTANT RULES:
- Always use the LATEST STABLE version (not beta/preview/RC)
- For MSI installers: silent args are /qn /norestart
- For NSIS EXE: use /S
- For Inno Setup EXE: use /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
- Registry detection key: always use HKLM:\\SOFTWARE\\<AppNameNoSpaces>Installer
- Install behavior: always 'system'
- Minimum OS: default to windows10_21H2 (Graph enum values: windows10_21H2, windows10_22H2, Windows11_21H2, Windows11_22H2, Windows11_23H2, Windows11_24H2)
- Always generate all 4 files before building
- Source folder naming: use PascalCase no spaces (e.g. AdobeAcrobat, MozillaFirefox)
- After build_package succeeds, stop immediately with a summary. Do NOT call create_intune_app or upload_to_intune.`

async function runPackageOnlyJob(
  jobId: string,
  req: { userRequest: string },
  signal: AbortSignal,
  sendEvent: (channel: string, data: unknown) => void
): Promise<void> {
  const log = (msg: string, level = 'INFO', source: 'ai' | 'ps' | 'system' = 'ai') => {
    sendEvent('job:log', { jobId, timestamp: new Date().toISOString(), level, message: msg, source })
  }

  const setPhase = (phase: string) => {
    const label = PHASE_LABELS[phase] ?? phase
    sendEvent('job:phase-change', { jobId, phase, label })
  }

  const { client, model } = await assertClientConfigured()
  const isBedrockClient = client instanceof AnthropicBedrock

  const getSettingRow = async (key: string, fallback: string) => {
    const row = await prisma.appSetting.findUnique({ where: { key } })
    return row?.value || fallback
  }
  const sourceRoot = await getSettingRow('source_root_path', path.join(__dirname, '..', '..', '..', 'Source'))
  const outputFolder = await getSettingRow('output_folder_path', path.join(__dirname, '..', '..', '..', 'Output'))

  const pathContext = `\n\nPATH CONFIGURATION (use these exact paths):
- Source root: ${sourceRoot}  →  Create app subfolder here (e.g. ${sourceRoot}\\SevenZip)
- Output folder: ${outputFolder}  →  Pass this as output_folder to build_package`

  const messages: Anthropic.MessageParam[] = [{
    role: 'user',
    content: req.userRequest
  }]

  setPhase('analyzing')
  log(`Starting packaging: "${req.userRequest}"`)
  log(`AI connection: ${isBedrockClient ? `AWS Bedrock (${model})` : `Direct API (${model})`}`)
  log(`Source root: ${sourceRoot}`)
  log(`Output folder: ${outputFolder}`)

  // Track metadata captured during packaging so upload-only step can use it
  let builtIntunewinPath: string | null = null
  let capturedPackageSettings: Record<string, unknown> | null = null

  let iterations = 0
  while (iterations++ < 20) {
    if (signal.aborted) throw new Error('Job cancelled')

    const response = await (client as Anthropic).messages.create({
      model,
      max_tokens: 4096,
      system: PACKAGE_ONLY_SYSTEM_PROMPT + pathContext,
      tools: PACKAGE_ONLY_TOOLS,
      messages
    })

    messages.push({ role: 'assistant', content: response.content })

    for (const block of response.content) {
      if (block.type === 'text' && block.text.trim()) {
        log(`${block.text}`, 'INFO', 'ai')
      }
    }

    if (response.stop_reason === 'end_turn') {
      setPhase('done')
      sendEvent('job:package-complete', { jobId, intunewinPath: builtIntunewinPath, packageSettings: capturedPackageSettings })
      sendEvent('job:complete', { jobId })
      break
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = []

    for (const block of response.content) {
      if (block.type !== 'tool_use') continue

      const phase = PHASE_MAP[block.name] ?? 'analyzing'
      setPhase(phase)
      log(`Tool: ${block.name}`, 'INFO', 'system')

      try {
        const result = await executeToolCall(block.name, block.input as Record<string, unknown>, jobId, sendEvent)
        if (block.name === 'generate_package_settings') {
          capturedPackageSettings = block.input as Record<string, unknown>
        }
        if (block.name === 'build_package') {
          const r = result as { success?: boolean; intunewinPath?: string }
          if (r.success && r.intunewinPath) builtIntunewinPath = r.intunewinPath
        }
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) })
      } catch (err) {
        const errMsg = (err as Error).message
        log(`Tool ${block.name} failed: ${errMsg}`, 'ERROR', 'system')
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ success: false, error: errMsg }), is_error: true })
      }
    }

    messages.push({ role: 'user', content: toolResults })
  }

  if (iterations >= 20) {
    throw new Error('Maximum tool iterations reached (20). Packaging may be incomplete.')
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// POST /api/ai/deploy
router.post('/api/ai/deploy', requireAuth as import('express').RequestHandler, async (req, res) => {
  const body = req.body as {
    userRequest: string
    isUpdate?: boolean
    existingAppId?: string
    jobId?: string
  }

  const jobId = body.jobId ?? uuidv4()
  const abortController = new AbortController()
  activeJobs.set(jobId, { id: jobId, abortController, phase: 'analyzing' })

  const sendEvent = (channel: string, data: unknown) => sseManager.broadcast(channel, data)

  runDeployJob(jobId, body, abortController.signal, sendEvent).catch(err => {
    sendEvent('job:error', { jobId, error: (err as Error).message, phase: 'unknown' })
  }).finally(() => {
    activeJobs.delete(jobId)
  })

  res.json({ jobId })
})

// POST /api/ai/package-only
router.post('/api/ai/package-only', requireAuth as import('express').RequestHandler, async (req, res) => {
  const body = req.body as {
    userRequest: string
    jobId?: string
  }

  const jobId = body.jobId ?? uuidv4()
  const abortController = new AbortController()
  activeJobs.set(jobId, { id: jobId, abortController, phase: 'analyzing' })

  const sendEvent = (channel: string, data: unknown) => sseManager.broadcast(channel, data)

  runPackageOnlyJob(jobId, body, abortController.signal, sendEvent).catch(err => {
    sendEvent('job:error', { jobId, error: (err as Error).message, phase: 'unknown' })
  }).finally(() => {
    activeJobs.delete(jobId)
  })

  res.json({ jobId })
})

// POST /api/ai/upload-only
router.post('/api/ai/upload-only', requireAuth as import('express').RequestHandler, async (req, res) => {
  const body = req.body as {
    intunewinPath: string
    packageSettings: Record<string, unknown>
    jobId?: string
  }

  const jobId = body.jobId ?? uuidv4()
  const abortController = new AbortController()
  activeJobs.set(jobId, { id: jobId, abortController, phase: 'uploading' })

  const sendEvent = (channel: string, data: unknown) => sseManager.broadcast(channel, data)

  runUploadOnlyJob(jobId, body, abortController.signal, sendEvent).catch(err => {
    sendEvent('job:error', { jobId, error: (err as Error).message, phase: 'uploading' })
  }).finally(() => {
    activeJobs.delete(jobId)
  })

  res.json({ jobId })
})

// GET /api/ai/recommendations
router.get('/api/ai/recommendations', requireAuth as import('express').RequestHandler, async (req, res) => {
  let clientBundle: ClientBundle
  try { clientBundle = await assertClientConfigured() } catch (err) {
    res.json({ success: false, error: (err as Error).message, recommendations: [], fromCache: false }); return
  }
  const { client, model } = clientBundle

  const cacheRow = await prisma.appSetting.findUnique({ where: { key: 'recommendations_cache' } })
  let cachedRecommendations: unknown[] | null = null
  if (cacheRow?.value) {
    try { cachedRecommendations = JSON.parse(cacheRow.value) } catch { /* ignore corrupt cache */ }
  }

  const refreshInBackground = async () => {
    try {
      const response = await (client as Anthropic).messages.create({
        model,
        max_tokens: 4096,
        system: `You are an enterprise IT assistant. Return a JSON array of 50 commonly deployed enterprise Windows applications.
Each item must have: id (unique string), name (string), publisher (string), description (string, max 80 chars), wingetId (string or null), category (string).
Respond ONLY with a JSON array. No markdown, no explanation.`,
        messages: [{ role: 'user', content: 'List 50 essential enterprise Windows apps for Intune deployment.' }]
      })
      const text = response.content.find(b => b.type === 'text')?.text ?? '[]'
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      const fresh = jsonMatch ? JSON.parse(jsonMatch[0]) : []
      if (Array.isArray(fresh) && fresh.length > 0) {
        await prisma.appSetting.upsert({ where: { key: 'recommendations_cache' }, update: { value: JSON.stringify(fresh) }, create: { key: 'recommendations_cache', value: JSON.stringify(fresh) } })
        sseManager.broadcast('recommendations-updated', { recommendations: fresh })
      }
    } catch (refreshErr) {
      console.error('[AI] Background recommendation refresh failed:', (refreshErr as Error).message)
      sseManager.broadcast('recommendations-updated', { recommendations: null, error: (refreshErr as Error).message })
    }
  }

  if (cachedRecommendations && cachedRecommendations.length > 0) {
    refreshInBackground()
    res.json({ success: true, recommendations: cachedRecommendations, fromCache: true }); return
  }

  try {
    const response = await (client as Anthropic).messages.create({
      model,
      max_tokens: 4096,
      system: `You are an enterprise IT assistant. Return a JSON array of 50 commonly deployed enterprise Windows applications.
Each item must have: id (unique string), name (string), publisher (string), description (string, max 80 chars), wingetId (string or null), category (string).
Respond ONLY with a JSON array. No markdown, no explanation.`,
      messages: [{ role: 'user', content: 'List 50 essential enterprise Windows apps for Intune deployment.' }]
    })
    const text = response.content.find(b => b.type === 'text')?.text ?? '[]'
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    const recommendations = jsonMatch ? JSON.parse(jsonMatch[0]) : []
    if (Array.isArray(recommendations) && recommendations.length > 0) {
      await prisma.appSetting.upsert({ where: { key: 'recommendations_cache' }, update: { value: JSON.stringify(recommendations) }, create: { key: 'recommendations_cache', value: JSON.stringify(recommendations) } })
    }
    res.json({ success: true, recommendations, fromCache: false })
  } catch (err) {
    res.json({ success: false, error: (err as Error).message, recommendations: [], fromCache: false })
  }
})

// DELETE /api/ai/jobs/:jobId
router.delete('/api/ai/jobs/:jobId', requireAuth as import('express').RequestHandler, (req, res) => {
  const jobId = String(req.params.jobId)
  const job = activeJobs.get(jobId)
  if (job) {
    const sendEvent = (channel: string, data: unknown) => sseManager.broadcast(channel, data)
    job.abortController.abort()
    activeJobs.delete(jobId)
    sendEvent('job:error', { jobId, error: 'Cancelled by user', phase: job.phase })
    res.json({ success: true }); return
  }
  res.json({ success: false, error: 'Job not found' })
})

export default router
