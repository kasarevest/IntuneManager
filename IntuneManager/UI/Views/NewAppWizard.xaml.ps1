#Requires -Version 5.1
<#
.SYNOPSIS
    Code-behind for NewAppWizard.xaml
    3-step wizard: 1) Select source folder  2) Configure metadata  3) Build + Upload
    "Install latest stable version" requirement: PackageParser.GetLatestWingetVersion() is
    called if a WingetId is found in PACKAGE_SETTINGS.md.
#>

$wizard        = $script:ContentHost.Content
$wizContent    = $wizard.FindName('WizardContent')
$btnNext       = $wizard.FindName('BtnNext')
$btnPrev       = $wizard.FindName('BtnPrev')
$btnCancel     = $wizard.FindName('BtnCancelWizard')
$btnBackWizard = $wizard.FindName('BtnBackWizard')

$step1Ind   = $wizard.FindName('Step1Indicator')
$step2Ind   = $wizard.FindName('Step2Indicator')
$step3Ind   = $wizard.FindName('Step3Indicator')
$step1Lbl   = $wizard.FindName('Step1Label')
$step2Lbl   = $wizard.FindName('Step2Label')
$step3Lbl   = $wizard.FindName('Step3Label')

$script:WizardStep = 1
$script:WizardData = @{
    SourceFolder    = $null
    EntryPoint      = $null
    Package         = $null
    DisplayName     = $null
    Description     = $null
    Publisher       = $null
    AppVersion      = $null
    InstallCommand  = $null
    UninstallCommand= $null
    InstallBehavior = 'system'
    Architecture    = 'x64'
    MinimumOs       = 'W10_21H2'
    DetectionScript = $null
    WingetId        = $null
    UseLatestVersion= $true
}

#region Step 1 -- Select Source

$script:Wizard_BuildStep1 = {
    $sp = [System.Windows.Controls.StackPanel]::new()
    $sp.Margin = [System.Windows.Thickness]::new(20)
    $sp.MaxWidth = 600

    $script:Wizard_AddFormRow = {
        param($Parent, [string]$Label, $Control)
        $row = [System.Windows.Controls.StackPanel]::new()
        $row.Margin = [System.Windows.Thickness]::new(0,0,0,16)
        $lbl = [System.Windows.Controls.TextBlock]::new()
        $lbl.Text       = $Label.ToUpper()
        $lbl.Foreground = [System.Windows.Media.SolidColorBrush][System.Windows.Media.ColorConverter]::ConvertFromString('#9999BB')
        $lbl.FontSize   = 10
        $lbl.FontWeight = 'SemiBold'
        $lbl.Margin     = [System.Windows.Thickness]::new(0,0,0,4)
        $row.Children.Add($lbl) | Out-Null
        $row.Children.Add($Control) | Out-Null
        $Parent.Children.Add($row) | Out-Null
    }

    # Source folder picker
    $folderRow = [System.Windows.Controls.Grid]::new()
    $col1 = [System.Windows.Controls.ColumnDefinition]::new(); $col1.Width = [System.Windows.GridLength]::new(1, 'Star')
    $col2 = [System.Windows.Controls.ColumnDefinition]::new(); $col2.Width = [System.Windows.GridLength]::Auto
    $folderRow.ColumnDefinitions.Add($col1); $folderRow.ColumnDefinitions.Add($col2)

    $script:TxtSourceFolder = [System.Windows.Controls.TextBox]::new()
    $script:TxtSourceFolder.Height = 32
    $script:TxtSourceFolder.Text   = if ($script:WizardData.SourceFolder) { $script:WizardData.SourceFolder } else { '' }
    [System.Windows.Controls.Grid]::SetColumn($script:TxtSourceFolder, 0)
    $folderRow.Children.Add($script:TxtSourceFolder) | Out-Null

    $browseFolderBtn = [System.Windows.Controls.Button]::new()
    $browseFolderBtn.Content = 'Browse…'
    $browseFolderBtn.Margin  = [System.Windows.Thickness]::new(8,0,0,0)
    $browseFolderBtn.Height  = 32
    $browseFolderBtn.Padding = [System.Windows.Thickness]::new(12,0)
    [System.Windows.Controls.Grid]::SetColumn($browseFolderBtn, 1)
    $folderRow.Children.Add($browseFolderBtn) | Out-Null

    $browseFolderBtn.Add_Click({
        Add-Type -AssemblyName System.Windows.Forms
        $dlg = [System.Windows.Forms.FolderBrowserDialog]::new()
        $dlg.Description = 'Select the app source folder'
        $projRoot = (Get-SharedState)['ProjectRoot']
        if ($projRoot) { $dlg.SelectedPath = Join-Path $projRoot 'Source' }
        if ($dlg.ShowDialog() -eq 'OK') {
            $script:TxtSourceFolder.Text = $dlg.SelectedPath
            & $script:Wizard_LoadFolderContents $dlg.SelectedPath
        }
    })

    & $script:Wizard_AddFormRow $sp 'Source Folder' $folderRow

    # Latest version checkbox
    $latestChk = [System.Windows.Controls.CheckBox]::new()
    $latestChk.Content    = 'Install latest stable version (resolved via winget at upload time)'
    $latestChk.IsChecked  = $script:WizardData.UseLatestVersion
    $latestChk.Foreground = [System.Windows.Media.SolidColorBrush][System.Windows.Media.ColorConverter]::ConvertFromString('#E2E2F0')
    $latestChk.FontSize   = 13
    $latestChk.Add_Checked({   $script:WizardData.UseLatestVersion = $true  })
    $latestChk.Add_Unchecked({ $script:WizardData.UseLatestVersion = $false })
    $sp.Children.Add($latestChk) | Out-Null

    # File list panel
    $script:FileListPanel = [System.Windows.Controls.StackPanel]::new()
    $script:FileListPanel.Margin = [System.Windows.Thickness]::new(0,16,0,0)
    $sp.Children.Add($script:FileListPanel) | Out-Null

    # Auto-load if folder already set
    if ($script:WizardData.SourceFolder) { & $script:Wizard_LoadFolderContents $script:WizardData.SourceFolder }

    # Check for preloaded package
    $preload = (Get-SharedState)['WizardPreloadPackage']
    if ($preload -and $preload.SourceFolder) {
        $script:TxtSourceFolder.Text = $preload.SourceFolder
        & $script:Wizard_LoadFolderContents $preload.SourceFolder
    }

    $scroll = [System.Windows.Controls.ScrollViewer]::new()
    $scroll.VerticalScrollBarVisibility = 'Auto'
    $scroll.Content = $sp
    $wizContent.Content = $scroll
}

$script:Wizard_LoadFolderContents = {
    param([string]$FolderPath)
    $script:FileListPanel.Children.Clear()
    if (-not (Test-Path $FolderPath -PathType Container)) { return }

    $files = Get-ChildItem $FolderPath -File -ErrorAction SilentlyContinue
    if (-not $files) { return }

    $hdr = [System.Windows.Controls.TextBlock]::new()
    $hdr.Text       = 'Files detected:'
    $hdr.Foreground = [System.Windows.Media.SolidColorBrush][System.Windows.Media.ColorConverter]::ConvertFromString('#9999BB')
    $hdr.FontSize   = 11
    $hdr.FontWeight = 'SemiBold'
    $hdr.Margin     = [System.Windows.Thickness]::new(0,0,0,6)
    $script:FileListPanel.Children.Add($hdr) | Out-Null

    foreach ($f in $files) {
        $tb = [System.Windows.Controls.TextBlock]::new()
        $tb.Text       = "  $($f.Name)"
        $tb.Foreground = [System.Windows.Media.SolidColorBrush][System.Windows.Media.ColorConverter]::ConvertFromString('#E2E2F0')
        $tb.FontFamily = [System.Windows.Media.FontFamily]::new('Cascadia Mono, Consolas')
        $tb.FontSize   = 12
        $script:FileListPanel.Children.Add($tb) | Out-Null
    }

    # Auto-load PACKAGE_SETTINGS.md if present
    $settingsFile = Join-Path $FolderPath 'PACKAGE_SETTINGS.md'
    if (Test-Path $settingsFile) {
        $parsed = ConvertFrom-PackageSettings -Path $settingsFile
        $script:WizardData.Package         = $parsed
        $script:WizardData.DisplayName     = $parsed.DisplayName
        $script:WizardData.Description     = $parsed.Description
        $script:WizardData.Publisher       = $parsed.Publisher
        $script:WizardData.AppVersion      = $parsed.AppVersion
        $script:WizardData.InstallCommand  = $parsed.InstallCommand
        $script:WizardData.UninstallCommand= $parsed.UninstallCommand
        $script:WizardData.Architecture    = $parsed.Architecture
        $script:WizardData.MinimumOs       = $parsed.MinimumOs
        $script:WizardData.DetectionScript = $parsed.DetectionScript
        $script:WizardData.WingetId        = $parsed.WingetId

        $info = [System.Windows.Controls.TextBlock]::new()
        $info.Text       = "`n✓ PACKAGE_SETTINGS.md found -- metadata pre-populated"
        $info.Foreground = [System.Windows.Media.SolidColorBrush][System.Windows.Media.ColorConverter]::ConvertFromString('#3DDC84')
        $info.FontSize   = 12
        $script:FileListPanel.Children.Add($info) | Out-Null
    }

    # Find entry point .ps1
    $installScript = Get-ChildItem $FolderPath -Filter 'Install-*.ps1' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($installScript) {
        $script:WizardData.EntryPoint    = $installScript.FullName
        $script:WizardData.SourceFolder  = $FolderPath
    }
}

#endregion

#region Step 2 -- Configure Metadata

$script:Wizard_BuildStep2 = {
    $scroll = [System.Windows.Controls.ScrollViewer]::new()
    $scroll.VerticalScrollBarVisibility = 'Auto'
    $sp = [System.Windows.Controls.StackPanel]::new()
    $sp.Margin   = [System.Windows.Thickness]::new(20)
    $sp.MaxWidth = 700
    $scroll.Content = $sp

    $script:Wizard_AddField = {
        param([string]$Label, [string]$Key, [bool]$Required = $false)
        $row = [System.Windows.Controls.StackPanel]::new()
        $row.Margin = [System.Windows.Thickness]::new(0,0,0,14)

        $lbl = [System.Windows.Controls.TextBlock]::new()
        $lbl.Text       = $(if ($Required) { "$($Label.ToUpper()) *" } else { $Label.ToUpper() })
        $lbl.Foreground = [System.Windows.Media.SolidColorBrush][System.Windows.Media.ColorConverter]::ConvertFromString('#9999BB')
        $lbl.FontSize   = 10
        $lbl.FontWeight = 'SemiBold'
        $lbl.Margin     = [System.Windows.Thickness]::new(0,0,0,4)

        $txt = [System.Windows.Controls.TextBox]::new()
        $txt.Text   = if ($script:WizardData[$Key]) { $script:WizardData[$Key] } else { '' }
        $txt.Height = 32
        $txt.Name   = "Fld_$Key"

        $txt.Add_TextChanged({
            $script:WizardData[$this.Name.Replace('Fld_', '')] = $this.Text
        })

        $row.Children.Add($lbl) | Out-Null
        $row.Children.Add($txt) | Out-Null
        $sp.Children.Add($row) | Out-Null
    }

    & $script:Wizard_AddField 'Display Name'       'DisplayName'      $true
    & $script:Wizard_AddField 'Description'        'Description'
    & $script:Wizard_AddField 'Publisher'          'Publisher'
    & $script:Wizard_AddField 'App Version'        'AppVersion'
    & $script:Wizard_AddField 'Install Command'    'InstallCommand'   $true
    & $script:Wizard_AddField 'Uninstall Command'  'UninstallCommand' $true
    & $script:Wizard_AddField 'Winget ID (for latest version resolution)' 'WingetId'

    # Install behavior
    $behRow = [System.Windows.Controls.StackPanel]::new()
    $behRow.Margin = [System.Windows.Thickness]::new(0,0,0,14)
    $behLbl = [System.Windows.Controls.TextBlock]::new()
    $behLbl.Text = 'INSTALL BEHAVIOR'
    $behLbl.Foreground = [System.Windows.Media.SolidColorBrush][System.Windows.Media.ColorConverter]::ConvertFromString('#9999BB')
    $behLbl.FontSize = 10; $behLbl.FontWeight = 'SemiBold'; $behLbl.Margin = [System.Windows.Thickness]::new(0,0,0,4)
    $behCbo = [System.Windows.Controls.ComboBox]::new(); $behCbo.Height = 32
    @('system','user') | ForEach-Object { $behCbo.Items.Add($_) | Out-Null }
    $behCbo.SelectedItem = $script:WizardData.InstallBehavior
    $behCbo.Add_SelectionChanged({ $script:WizardData.InstallBehavior = $behCbo.SelectedItem })
    $behRow.Children.Add($behLbl) | Out-Null; $behRow.Children.Add($behCbo) | Out-Null
    $sp.Children.Add($behRow) | Out-Null

    # Latest version notice
    if ($script:WizardData.UseLatestVersion -and $script:WizardData.WingetId) {
        $notice = [System.Windows.Controls.TextBlock]::new()
        $notice.Text = "ℹ Latest stable version will be resolved from winget ($($script:WizardData.WingetId)) when you click Build + Upload."
        $notice.Foreground = [System.Windows.Media.SolidColorBrush][System.Windows.Media.ColorConverter]::ConvertFromString('#4F8EF7')
        $notice.FontSize = 12; $notice.TextWrapping = 'Wrap'
        $notice.Margin = [System.Windows.Thickness]::new(0,8,0,0)
        $sp.Children.Add($notice) | Out-Null
    }

    # Backtick warning (Lesson 001)
    $warnPanel = [System.Windows.Controls.Border]::new()
    $warnPanel.Background = [System.Windows.Media.SolidColorBrush][System.Windows.Media.ColorConverter]::ConvertFromString('#2A1A1A')
    $warnPanel.CornerRadius = [System.Windows.CornerRadius]::new(5)
    $warnPanel.Padding = [System.Windows.Thickness]::new(12,8)
    $warnPanel.Margin  = [System.Windows.Thickness]::new(0,12,0,0)
    $warnTxt = [System.Windows.Controls.TextBlock]::new()
    $warnTxt.Text = '⚠ Do NOT include backtick (`) characters in install/uninstall commands. They cause CreateProcess to fail.'
    $warnTxt.Foreground = [System.Windows.Media.SolidColorBrush][System.Windows.Media.ColorConverter]::ConvertFromString('#F7A144')
    $warnTxt.FontSize = 11; $warnTxt.TextWrapping = 'Wrap'
    $warnPanel.Child = $warnTxt
    $sp.Children.Add($warnPanel) | Out-Null

    $wizContent.Content = $scroll
}

#endregion

#region Step 3 -- Build + Upload

$script:Wizard_BuildStep3 = {
    $sp = [System.Windows.Controls.StackPanel]::new()
    $sp.Margin   = [System.Windows.Thickness]::new(20)
    $sp.MaxWidth = 600

    # Summary card
    $summaryBorder = [System.Windows.Controls.Border]::new()
    $summaryBorder.Background    = [System.Windows.Media.SolidColorBrush][System.Windows.Media.ColorConverter]::ConvertFromString('#2D2D44')
    $summaryBorder.CornerRadius  = [System.Windows.CornerRadius]::new(8)
    $summaryBorder.Padding       = [System.Windows.Thickness]::new(16)
    $summaryBorder.Margin        = [System.Windows.Thickness]::new(0,0,0,16)
    $summarySP = [System.Windows.Controls.StackPanel]::new()

    $script:Wizard_AddSummaryRow = {
        param([string]$Label, [string]$Value)
        $row = [System.Windows.Controls.StackPanel]::new()
        $row.Orientation = 'Horizontal'
        $row.Margin = [System.Windows.Thickness]::new(0,0,0,6)
        $lbl = [System.Windows.Controls.TextBlock]::new()
        $lbl.Text = "$($Label): "; $lbl.Foreground = [System.Windows.Media.SolidColorBrush][System.Windows.Media.ColorConverter]::ConvertFromString('#9999BB')
        $lbl.FontSize = 12; $lbl.Width = 130
        $val = [System.Windows.Controls.TextBlock]::new()
        $val.Text = if ($Value) { $Value } else { '--' }
        $val.Foreground = [System.Windows.Media.SolidColorBrush][System.Windows.Media.ColorConverter]::ConvertFromString('#E2E2F0')
        $val.FontSize = 12; $val.TextWrapping = 'Wrap'
        $row.Children.Add($lbl) | Out-Null; $row.Children.Add($val) | Out-Null
        $summarySP.Children.Add($row) | Out-Null
    }

    & $script:Wizard_AddSummaryRow 'App Name'    $script:WizardData.DisplayName
    & $script:Wizard_AddSummaryRow 'Version'     $script:WizardData.AppVersion
    & $script:Wizard_AddSummaryRow 'Publisher'   $script:WizardData.Publisher
    & $script:Wizard_AddSummaryRow 'Source'      (Split-Path $script:WizardData.SourceFolder -Leaf)
    & $script:Wizard_AddSummaryRow 'Winget ID'   $script:WizardData.WingetId
    & $script:Wizard_AddSummaryRow 'Latest ver.' $(if ($script:WizardData.UseLatestVersion) { 'Yes -- resolved at upload time' } else { 'No -- use version from settings' })

    $summaryBorder.Child = $summarySP
    $sp.Children.Add($summaryBorder) | Out-Null

    # Progress panel
    $script:WizProgressPanel = [System.Windows.Controls.StackPanel]::new()
    $script:WizProgressPanel.Margin = [System.Windows.Thickness]::new(0,0,0,0)

    $script:WizProgressBar = [System.Windows.Controls.ProgressBar]::new()
    $script:WizProgressBar.Height = 8; $script:WizProgressBar.Minimum = 0; $script:WizProgressBar.Maximum = 100
    $script:WizProgressBar.Foreground = [System.Windows.Media.SolidColorBrush][System.Windows.Media.ColorConverter]::ConvertFromString('#4F8EF7')
    $script:WizProgressBar.Background = [System.Windows.Media.SolidColorBrush][System.Windows.Media.ColorConverter]::ConvertFromString('#3A3A55')
    $script:WizProgressBar.BorderThickness = [System.Windows.Thickness]::new(0)
    $script:WizProgressBar.Margin = [System.Windows.Thickness]::new(0,0,0,6)

    $script:WizProgressLabel = [System.Windows.Controls.TextBlock]::new()
    $script:WizProgressLabel.Text = 'Ready to build and upload.'
    $script:WizProgressLabel.Foreground = [System.Windows.Media.SolidColorBrush][System.Windows.Media.ColorConverter]::ConvertFromString('#9999BB')
    $script:WizProgressLabel.FontSize = 12

    $script:WizProgressPanel.Children.Add($script:WizProgressBar)  | Out-Null
    $script:WizProgressPanel.Children.Add($script:WizProgressLabel) | Out-Null
    $sp.Children.Add($script:WizProgressPanel) | Out-Null

    $scroll = [System.Windows.Controls.ScrollViewer]::new()
    $scroll.VerticalScrollBarVisibility = 'Auto'; $scroll.Content = $sp
    $wizContent.Content = $scroll
}

#endregion

#region Step navigation

$script:Wizard_SetStepIndicator = {
    param([int]$ActiveStep)
    $inds  = @($step1Ind, $step2Ind, $step3Ind)
    $lbls  = @($step1Lbl, $step2Lbl, $step3Lbl)
    $activeColor   = [System.Windows.Media.SolidColorBrush][System.Windows.Media.ColorConverter]::ConvertFromString('#4F8EF7')
    $inactiveColor = [System.Windows.Media.SolidColorBrush][System.Windows.Media.ColorConverter]::ConvertFromString('#3A3A55')
    $doneColor     = [System.Windows.Media.SolidColorBrush][System.Windows.Media.ColorConverter]::ConvertFromString('#3DDC84')

    for ($i = 0; $i -lt 3; $i++) {
        if ($i + 1 -lt $ActiveStep) {
            $inds[$i].Background = $doneColor
            $lbls[$i].Foreground = $doneColor
        } elseif ($i + 1 -eq $ActiveStep) {
            $inds[$i].Background = $activeColor
            $lbls[$i].Foreground = $activeColor
        } else {
            $inds[$i].Background = $inactiveColor
            $lbls[$i].Foreground = [System.Windows.Media.SolidColorBrush][System.Windows.Media.ColorConverter]::ConvertFromString('#9999BB')
        }
    }
}

$script:Wizard_GoToStep = {
    param([int]$Step)
    $script:WizardStep = $Step
    & $script:Wizard_SetStepIndicator $Step
    switch ($Step) {
        1 { & $script:Wizard_BuildStep1; $btnPrev.Visibility = 'Collapsed'; $btnNext.Content = 'Next ->' }
        2 { & $script:Wizard_BuildStep2; $btnPrev.Visibility = 'Visible';   $btnNext.Content = 'Next ->' }
        3 { & $script:Wizard_BuildStep3; $btnPrev.Visibility = 'Visible';   $btnNext.Content = '▲ Build + Upload' }
    }
}

$script:Wizard_ValidateStep = {
    param([int]$Step)
    switch ($Step) {
        1 {
            if ([string]::IsNullOrWhiteSpace($script:WizardData.SourceFolder)) {
                [System.Windows.MessageBox]::Show("Please select a source folder.", "Validation", 'OK', 'Warning') | Out-Null
                return $false
            }
            if (-not (Test-Path $script:WizardData.SourceFolder -PathType Container)) {
                [System.Windows.MessageBox]::Show("Source folder not found: $($script:WizardData.SourceFolder)", "Validation", 'OK', 'Warning') | Out-Null
                return $false
            }
            if (-not $script:WizardData.EntryPoint -or -not (Test-Path $script:WizardData.EntryPoint)) {
                [System.Windows.MessageBox]::Show("No Install-*.ps1 script found in the source folder.", "Validation", 'OK', 'Warning') | Out-Null
                return $false
            }
            return $true
        }
        2 {
            if ([string]::IsNullOrWhiteSpace($script:WizardData.DisplayName)) {
                [System.Windows.MessageBox]::Show("Display Name is required.", "Validation", 'OK', 'Warning') | Out-Null
                return $false
            }
            # Backtick check (Lesson 001 prevention) -- check anywhere in command, not just start/end
            if ($script:WizardData.InstallCommand -match '`') {
                [System.Windows.MessageBox]::Show("Install command contains backtick characters. Remove them before proceeding.", "Validation", 'OK', 'Warning') | Out-Null
                return $false
            }
            if ($script:WizardData.UninstallCommand -match '`') {
                [System.Windows.MessageBox]::Show("Uninstall command contains backtick characters. Remove them before proceeding.", "Validation", 'OK', 'Warning') | Out-Null
                return $false
            }
            return $true
        }
        default { return $true }
    }
}

#endregion

#region Build + Upload (Step 3 action)

$script:Wizard_InvokeBuildAndUpload = {
    $btnNext.IsEnabled  = $false
    $btnPrev.IsEnabled  = $false
    $script:WizProgressBar.Value = 0
    $script:WizProgressLabel.Text = 'Starting...'

    $shared      = Get-SharedState
    $projectRoot = $shared['ProjectRoot']
    $toolPath    = $shared['ToolPath']
    $outputDir   = $shared['OutputFolder']
    $data        = $script:WizardData

    Invoke-BackgroundOperation -Work {
        # Resolve latest version if requested
        if ($data.UseLatestVersion -and $data.WingetId) {
            Update-UIFromBackground -Action { $script:WizProgressLabel.Text = "Resolving latest version via winget..." }
            $latestVer = Get-LatestWingetVersion -WingetId $data.WingetId
            if ($latestVer) {
                $data.AppVersion = $latestVer
                Update-UIFromBackground -Action { $script:WizProgressLabel.Text = "Latest version: $latestVer" }
            }
        }

        # Build .intunewin
        Update-UIFromBackground -Action {
            $script:WizProgressBar.Value = 10
            $script:WizProgressLabel.Text = "Building .intunewin package..."
        }
        $intuneWinPath = Invoke-PackageBuild `
            -SourceFolder $data.SourceFolder `
            -EntryPoint   $data.EntryPoint `
            -OutputFolder $outputDir `
            -ToolPath     $toolPath `
            -SharedState  $SharedState `
            -OnLogLine    { param($line) Update-UIFromBackground -Action { $script:WizProgressLabel.Text = $line } }

        Update-UIFromBackground -Action { $script:WizProgressBar.Value = 40 }

        # Build Graph app body
        $appBody = @{
            '@odata.type'         = '#microsoft.graph.win32LobApp'
            displayName           = $data.DisplayName
            description           = $data.Description
            publisher             = $data.Publisher
            displayVersion        = $data.AppVersion
            informationUrl        = $data.InformationUrl
            privacyUrl            = $data.PrivacyUrl
            installCommandLine    = $data.InstallCommand
            uninstallCommandLine  = $data.UninstallCommand
            installExperience     = @{ runAsAccount = $data.InstallBehavior }
            minimumSupportedWindowsRelease = $data.MinimumOs
            applicableArchitectures = $data.Architecture
            setupFilePath         = [System.IO.Path]::GetFileName($data.EntryPoint)
        }

        # Detection rule
        if ($data.DetectionScript) {
            $detectContent = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($data.DetectionScript))
            $appBody['detectionRules'] = @(@{
                '@odata.type'      = '#microsoft.graph.win32LobAppPowerShellScriptDetection'
                scriptContent      = $detectContent
                enforceSignatureCheck = $false
                runAs32Bit         = $false
            })
        }

        # Return codes
        if ($data.Package -and $data.Package.ReturnCodes) {
            $appBody['returnCodes'] = @($data.Package.ReturnCodes | ForEach-Object {
                @{ returnCode = $_.returnCode; type = $_.type }
            })
        }

        # Create app in Intune
        Update-UIFromBackground -Action { $script:WizProgressLabel.Text = "Creating app in Intune..." }
        $newApp = New-Win32App -Body $appBody
        $SharedState['NewAppId'] = $newApp.id

        Update-UIFromBackground -Action { $script:WizProgressBar.Value = 50 }

        # Upload content
        Update-UIFromBackground -Action { $script:WizProgressLabel.Text = "Uploading content..." }
        Invoke-IntuneUpload -AppId $newApp.id -IntuneWinPath $intuneWinPath `
            -SharedState $SharedState `
            -OnProgress  { param($chunk,$total)
                $pct = [int](50 + $chunk/$total * 45)
                Update-UIFromBackground -Action { $script:WizProgressBar.Value = $pct } }

        Update-UIFromBackground -Action {
            $script:WizProgressBar.Value  = 100
            $script:WizProgressLabel.Text = "Upload complete!"
        }
    } -OnComplete {
        $newAppId = (Get-SharedState)['NewAppId']
        Write-AppLog "New app created successfully: $($data.DisplayName) (ID: $newAppId)"
        [System.Windows.MessageBox]::Show(
            "App '$($data.DisplayName)' created successfully in Intune!`nApp ID: $newAppId",
            "Success", 'OK', 'Information') | Out-Null
        (Get-SharedState)['WizardPreloadPackage'] = $null
        & $script:Nav_ShowDashboard
    } -OnError {
        param($err)
        $btnNext.IsEnabled = $true
        $btnPrev.IsEnabled = $true
        $msg = if ($err) { $err.Message } else { 'Build/upload failed' }
        Write-AppLog "Wizard error: $msg" -Level ERROR
        [System.Windows.MessageBox]::Show($msg, "Error", 'OK', 'Error') | Out-Null
    }
}

#endregion

#region Button events

$btnNext.Add_Click({
    if ($script:WizardStep -lt 3) {
        if (-not (& $script:Wizard_ValidateStep $script:WizardStep)) { return }
        & $script:Wizard_GoToStep ($script:WizardStep + 1)
    } else {
        # Step 3: run build + upload
        & $script:Wizard_InvokeBuildAndUpload
    }
})

$btnPrev.Add_Click({
    if ($script:WizardStep -gt 1) { & $script:Wizard_GoToStep ($script:WizardStep - 1) }
})

$btnCancel.Add_Click({
    (Get-SharedState)['WizardPreloadPackage'] = $null
    & $script:Nav_ShowDashboard
})

$btnBackWizard.Add_Click({
    (Get-SharedState)['WizardPreloadPackage'] = $null
    & $script:Nav_ShowDashboard
})

#endregion

# Initialize
& $script:Wizard_GoToStep 1
