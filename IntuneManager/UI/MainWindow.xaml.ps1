#Requires -Version 5.1
<#
.SYNOPSIS
    Code-behind for MainWindow.xaml.
    All control references obtained via FindName(). No x:Class or C# compilation.
    Run by Main.ps1 after the window is loaded via XamlReader.
#>

#region Control references
$script:BtnSync      = $script:Window.FindName('BtnSync')
$script:BtnLogout    = $script:Window.FindName('BtnLogout')
$script:ContentHost  = $script:Window.FindName('ContentHost')
$script:LogTextBox   = $script:Window.FindName('LogTextBox')
$script:StatusLabel  = $script:Window.FindName('StatusLabel')
$script:ProgressBar  = $script:Window.FindName('ProgressBar')
$script:BtnCancel    = $script:Window.FindName('BtnCancel')
$script:BtnClearLog  = $script:Window.FindName('BtnClearLog')
$script:BtnCopyLog   = $script:Window.FindName('BtnCopyLog')
$script:BtnSaveLog   = $script:Window.FindName('BtnSaveLog')
$script:ConnDot      = $script:Window.FindName('ConnectionDot')
$script:ConnLabel    = $script:Window.FindName('ConnectionLabel')
$script:LastSync     = $script:Window.FindName('LastSyncLabel')
#endregion

#region Logger init -- wire TextBox now that it exists
Set-LogTextBox -TextBox $script:LogTextBox -Dispatcher $script:Window.Dispatcher
#endregion

#region Navigation helpers

$script:Nav_ShowLoginView = {
    $xamlPath = Join-Path $PSScriptRoot 'Views\LoginView.xaml'
    $xaml     = [System.IO.File]::ReadAllText($xamlPath)
    $reader   = [System.Xml.XmlReader]::Create([System.IO.StringReader]::new($xaml))
    $view     = [System.Windows.Markup.XamlReader]::Load($reader)
    $script:ContentHost.Content = $view
    . (Join-Path $PSScriptRoot 'Views\LoginView.xaml.ps1')
    $script:BtnSync.Visibility   = 'Collapsed'
    $script:BtnLogout.Visibility = 'Collapsed'
    & $script:Nav_UpdateConnectionStatus -Connected $false
}

$script:Nav_ShowDashboard = {
    $xamlPath = Join-Path $PSScriptRoot 'Views\DashboardView.xaml'
    $xaml     = [System.IO.File]::ReadAllText($xamlPath)
    $reader   = [System.Xml.XmlReader]::Create([System.IO.StringReader]::new($xaml))
    $view     = [System.Windows.Markup.XamlReader]::Load($reader)
    $script:ContentHost.Content = $view
    . (Join-Path $PSScriptRoot 'Views\DashboardView.xaml.ps1')
    $script:BtnSync.Visibility   = 'Visible'
    $script:BtnLogout.Visibility = 'Visible'
    & $script:Nav_UpdateConnectionStatus -Connected $true
}

$script:Nav_ShowAppDetail = {
    param([PSCustomObject]$AppRow)
    $xamlPath = Join-Path $PSScriptRoot 'Views\AppDetailView.xaml'
    $xaml     = [System.IO.File]::ReadAllText($xamlPath)
    $reader   = [System.Xml.XmlReader]::Create([System.IO.StringReader]::new($xaml))
    $view     = [System.Windows.Markup.XamlReader]::Load($reader)

    # Store AppRow in SharedState so AppDetail code-behind can read it
    (Get-SharedState)['SelectedApp'] = $AppRow

    $script:ContentHost.Content = $view
    . (Join-Path $PSScriptRoot 'Views\AppDetailView.xaml.ps1')
}

$script:Nav_ShowUpdateView = {
    param([PSCustomObject]$AppRow)
    $xamlPath = Join-Path $PSScriptRoot 'Views\UpdateAppView.xaml'
    $xaml     = [System.IO.File]::ReadAllText($xamlPath)
    $reader   = [System.Xml.XmlReader]::Create([System.IO.StringReader]::new($xaml))
    $view     = [System.Windows.Markup.XamlReader]::Load($reader)
    (Get-SharedState)['SelectedApp'] = $AppRow
    $script:ContentHost.Content = $view
    . (Join-Path $PSScriptRoot 'Views\UpdateAppView.xaml.ps1')
}

$script:Nav_ShowNewAppWizard = {
    $xamlPath = Join-Path $PSScriptRoot 'Views\NewAppWizard.xaml'
    $xaml     = [System.IO.File]::ReadAllText($xamlPath)
    $reader   = [System.Xml.XmlReader]::Create([System.IO.StringReader]::new($xaml))
    $view     = [System.Windows.Markup.XamlReader]::Load($reader)
    $script:ContentHost.Content = $view
    . (Join-Path $PSScriptRoot 'Views\NewAppWizard.xaml.ps1')
}

#endregion

#region Status bar helpers

$script:Nav_UpdateConnectionStatus = {
    param([bool]$Connected, [string]$TenantId = '')
    if ($Connected) {
        $script:ConnDot.Fill   = [System.Windows.Media.SolidColorBrush][System.Windows.Media.Color]::FromRgb(61, 220, 132)
        $script:ConnLabel.Text = if ($TenantId) { $TenantId } else { (Get-CurrentTenantId) }
    } else {
        $script:ConnDot.Fill   = [System.Windows.Media.SolidColorBrush][System.Windows.Media.Color]::FromRgb(90, 90, 122)
        $script:ConnLabel.Text = 'Not connected'
    }
}

$script:Nav_UpdateLastSync = {
    $script:LastSync.Text = "Last synced: $(Get-Date -Format 'HH:mm')"
}

$script:Nav_SetStatusText = {
    param([string]$Text)
    $script:StatusLabel.Text = $Text
}

$script:Nav_SetProgressValue = {
    param([int]$Value)
    if ($Value -le 0 -or $Value -ge 100) {
        $script:ProgressBar.Visibility = 'Collapsed'
    } else {
        $script:ProgressBar.Visibility = 'Visible'
        $script:ProgressBar.Value = $Value
    }
}

$script:Nav_SetOperationRunning = {
    param([bool]$Running)
    $script:BtnCancel.Visibility = if ($Running) { 'Visible' } else { 'Collapsed' }
    $script:BtnSync.IsEnabled    = -not $Running
}

#endregion

#region Log toolbar events
$script:BtnClearLog.Add_Click({ Clear-AppLog })
$script:BtnCopyLog.Add_Click({  Copy-AppLog  })
$script:BtnSaveLog.Add_Click({
    $dlg = [Microsoft.Win32.SaveFileDialog]::new()
    $dlg.Title      = 'Save Log'
    $dlg.Filter     = 'Text files (*.txt)|*.txt|All files (*.*)|*.*'
    $dlg.FileName   = "IntuneManager_$(Get-Date -Format 'yyyyMMdd_HHmmss').txt"
    if ($dlg.ShowDialog()) { Save-AppLog -Path $dlg.FileName }
})
#endregion

#region Title bar event wiring
$script:BtnSync.Add_Click({
    # Delegate to DashboardView which owns the Sync logic
    if ($script:OnSyncRequested) { & $script:OnSyncRequested }
})

$script:BtnLogout.Add_Click({
    Disconnect-IntuneManager
    # Clear config tenant
    $cfgPath = Join-Path (Get-SharedState)['AppDataDir'] 'config.json'
    if (Test-Path $cfgPath) {
        try {
            $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
            $cfg | Add-Member -MemberType NoteProperty -Name 'LastTenantId' -Value '' -Force
            $cfg | ConvertTo-Json | Set-Content $cfgPath
        } catch {}
    }
    & $script:Nav_ShowLoginView
    Write-AppLog "Logged out"
})

$script:BtnCancel.Add_Click({
    Request-CancelOperation
})
#endregion

#region Window closing
$script:Window.Add_Closing({
    # If an operation is running, prompt
    $state = Get-SharedState
    if ($state.IsOperationRunning) {
        $result = [System.Windows.MessageBox]::Show(
            "An operation is in progress. Are you sure you want to exit?",
            "Confirm Exit",
            [System.Windows.MessageBoxButton]::YesNo,
            [System.Windows.MessageBoxImage]::Warning)
        if ($result -ne [System.Windows.MessageBoxResult]::Yes) {
            $_.Cancel = $true
            return
        }
        Request-CancelOperation
    }
})
#endregion

Write-AppLog "IntuneManager initialized"
