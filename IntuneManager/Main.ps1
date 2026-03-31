#Requires -Version 5.1
<#
.SYNOPSIS
    IntuneManager -- Entry point.
    Run this file to launch the application:
        powershell.exe -STA -File "IntuneManager\Main.ps1"

    Or double-click if .ps1 files are associated with PowerShell.
    The script auto-relaunches itself with -STA if needed.
#>

# ─── 1. Ensure STA apartment (required for WPF) ───────────────────────────────
if ([System.Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') {
    $myPath = $MyInvocation.MyCommand.Path
    & powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File `"$myPath`"
    exit
}

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:AppRoot = $PSScriptRoot   # IntuneManager\

# ─── 2. Load WPF assemblies ───────────────────────────────────────────────────
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Windows.Forms   # for FolderBrowserDialog in wizard

# ─── 3. Load MSAL.NET ─────────────────────────────────────────────────────────
$msalPath = Join-Path $script:AppRoot 'Assets\Microsoft.Identity.Client.dll'
if (-not (Test-Path $msalPath)) {
    [System.Windows.MessageBox]::Show(
        "MSAL DLL not found: $msalPath`n`nRun setup or restore the Assets folder.",
        "Startup Error", 'OK', 'Error') | Out-Null
    exit 1
}
try {
    Add-Type -Path $msalPath
} catch {
    [System.Windows.MessageBox]::Show(
        "Failed to load MSAL DLL: $($_.Exception.Message)",
        "Startup Error", 'OK', 'Error') | Out-Null
    exit 1
}

# ─── 4. Import all Lib modules ────────────────────────────────────────────────
Get-ChildItem (Join-Path $script:AppRoot 'Lib\*.psm1') | ForEach-Object {
    Import-Module $_.FullName -Force -Global
}

# ─── 5. Initialize Logger ─────────────────────────────────────────────────────
$appDataDir = Join-Path $env:APPDATA 'IntuneManager'
if (-not (Test-Path $appDataDir)) {
    New-Item -ItemType Directory -Path $appDataDir -Force | Out-Null
}
Initialize-Logger -LogDirectory $appDataDir

Write-AppLog "IntuneManager starting | PowerShell $($PSVersionTable.PSVersion) | $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"

# ─── 6. Load global styles into Application resources ─────────────────────────
try {
    $stylesPath = Join-Path $script:AppRoot 'Assets\Styles.xaml'
    $stylesXaml = [System.IO.File]::ReadAllText($stylesPath)
    $reader     = [System.Xml.XmlReader]::Create([System.IO.StringReader]::new($stylesXaml))
    $styles     = [System.Windows.Markup.XamlReader]::Load($reader)

    if (-not [System.Windows.Application]::Current) {
        $app = [System.Windows.Application]::new()
    }
    [System.Windows.Application]::Current.Resources.MergedDictionaries.Add($styles)
    Write-AppLog "Styles loaded"
} catch {
    Write-AppLog "Warning: could not load Styles.xaml -- $($_.Exception.Message)" -Level WARN
}

# ─── 7. Load MainWindow ───────────────────────────────────────────────────────
$mainXamlPath = Join-Path $script:AppRoot 'UI\MainWindow.xaml'
$mainXaml     = [System.IO.File]::ReadAllText($mainXamlPath)
$reader       = [System.Xml.XmlReader]::Create([System.IO.StringReader]::new($mainXaml))
$script:Window = [System.Windows.Markup.XamlReader]::Load($reader)

# ─── 8. Wire MainWindow code-behind ───────────────────────────────────────────
. (Join-Path $script:AppRoot 'UI\MainWindow.xaml.ps1')

# ─── 9. Set SharedState ───────────────────────────────────────────────────────
$shared = Get-SharedState
$shared['Dispatcher']    = $script:Window.Dispatcher
$shared['ProjectRoot']   = Split-Path $script:AppRoot -Parent   # Intune MSI Prep\
$shared['ToolPath']      = Join-Path (Split-Path $script:AppRoot -Parent) 'IntuneWinAppUtil.exe'
$shared['OutputFolder']  = Join-Path (Split-Path $script:AppRoot -Parent) 'Output'
$shared['AppDataDir']    = $appDataDir

Write-AppLog "Project root: $($shared['ProjectRoot'])"
Write-AppLog "Tool path: $($shared['ToolPath'])"

# ─── 10. Check token cache -> route to LoginView or Dashboard ──────────────────
# Get-CachedToken uses 'common' authority -- no TenantId needed.
# If a cached session exists, it will restore TenantId from the token itself.
$cachedToken = Get-CachedToken
if ($cachedToken) {
    $restoredTenantId = Get-CurrentTenantId
    $shared['TenantId'] = $restoredTenantId
    Write-AppLog "Token cache valid -- showing Dashboard (tenant: $restoredTenantId)"
    & $script:Nav_ShowDashboard
} else {
    Write-AppLog "No cached session -- showing Login"
    & $script:Nav_ShowLoginView
}

# ─── 11. Enter WPF message pump ───────────────────────────────────────────────
Write-AppLog "Entering WPF message pump"
$script:Window.ShowDialog() | Out-Null
Write-AppLog "Window closed -- exiting"
