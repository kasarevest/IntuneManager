#Requires -Version 5.1
<#
.SYNOPSIS  Code-behind for LoginView.xaml #>

$loginView   = $script:ContentHost.Content
$btnBrowser  = $loginView.FindName('BtnBrowserLogin')
$btnDevice   = $loginView.FindName('BtnDeviceCode')
$loginStatus = $loginView.FindName('LoginStatus')
$statusPanel = $loginView.FindName('StatusPanel')

# Capture controls in script-scope variables so closures can reference them across WPF event dispatch
$script:LoginView_BtnBrowser  = $btnBrowser
$script:LoginView_BtnDevice   = $btnDevice
$script:LoginView_Status      = $loginStatus
$script:LoginView_StatusPanel = $statusPanel

$script:LoginView_SetStatus = {
    param([string]$Message, [string]$Color = '#9999BB')
    $script:LoginView_Status.Text       = $Message
    $script:LoginView_Status.Foreground = [System.Windows.Media.SolidColorBrush][System.Windows.Media.ColorConverter]::ConvertFromString($Color)
    $script:LoginView_StatusPanel.Visibility = 'Visible'
}

$script:LoginView_SaveConfig = {
    param([string]$TenantId, [string]$Username)
    $appDataDir = Join-Path $env:APPDATA 'IntuneManager'
    if (-not (Test-Path $appDataDir)) { New-Item -ItemType Directory -Path $appDataDir -Force | Out-Null }
    $cfgFile = Join-Path $appDataDir 'config.json'
    $cfg = @{ LastTenantId = $TenantId; LastUsername = $Username }
    if (Test-Path $cfgFile) {
        try { $existing = Get-Content $cfgFile -Raw | ConvertFrom-Json; $cfg = $existing } catch {}
    }
    $cfg | Add-Member -MemberType NoteProperty -Name 'LastTenantId' -Value $TenantId -Force
    $cfg | Add-Member -MemberType NoteProperty -Name 'LastUsername' -Value $Username -Force
    $cfg | ConvertTo-Json | Set-Content $cfgFile
}

$script:LoginView_OnSuccess = {
    param([string]$Username, [string]$TenantId)
    & $script:LoginView_SaveConfig $TenantId $Username
    $shared = Get-SharedState
    $shared['TenantId'] = $TenantId
    Write-AppLog "Signed in as: $Username | Tenant: $TenantId"
    & $script:LoginView_SetStatus "Signed in as $Username" '#3DDC84'
    & $script:Nav_ShowDashboard
    if ($script:OnSyncRequested) { & $script:OnSyncRequested }
}

$script:LoginView_OnError = {
    param([string]$ErrMsg)
    $script:LoginView_BtnBrowser.IsEnabled = $true
    $script:LoginView_BtnDevice.IsEnabled  = $true
    Write-AppLog "Login failed: $ErrMsg" -Level ERROR
    & $script:LoginView_SetStatus $ErrMsg '#F76E6E'
}

# Browser login -- must run on the STA UI thread (AcquireTokenInteractive requires STA)
$btnBrowser.Add_Click({
    $script:LoginView_BtnBrowser.IsEnabled = $false
    $script:LoginView_BtnDevice.IsEnabled  = $false
    & $script:LoginView_SetStatus "Opening Microsoft login..." '#4F8EF7'

    try {
        # Parent HWND is required by MSAL on .NET Framework -- without it the browser popup hangs silently
        $hwnd = (New-Object System.Windows.Interop.WindowInteropHelper($script:Window)).Handle
        $user = Connect-IntuneManager -ParentWindowHandle $hwnd
        $tenantId = Get-CurrentTenantId
        & $script:LoginView_OnSuccess $user $tenantId
    } catch {
        & $script:LoginView_OnError $_.Exception.Message
    }
})

# Device code flow -- runs in background runspace (user goes to URL in their own browser)
$btnDevice.Add_Click({
    $script:LoginView_BtnBrowser.IsEnabled = $false
    $script:LoginView_BtnDevice.IsEnabled  = $false
    & $script:LoginView_SetStatus "Starting device code flow -- check the log below..." '#4F8EF7'

    Invoke-BackgroundOperation -Work {
        $user = Connect-IntuneManager -DeviceCode
        $tenantId = Get-CurrentTenantId
        $capturedUser     = $user
        $capturedTenantId = $tenantId
        Update-UIFromBackground -Action {
            # store so OnComplete can read it
            $script:LoginView_DeviceCodeUser     = $capturedUser
            $script:LoginView_DeviceCodeTenantId = $capturedTenantId
        }
    } -OnComplete {
        & $script:LoginView_OnSuccess $script:LoginView_DeviceCodeUser $script:LoginView_DeviceCodeTenantId
    } -OnError {
        param($err)
        $msg = if ($err) { $err.Message } else { 'Authentication failed' }
        & $script:LoginView_OnError $msg
    }
})
