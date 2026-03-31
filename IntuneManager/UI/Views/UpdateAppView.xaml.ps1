#Requires -Version 5.1
<#
.SYNOPSIS  Code-behind for UpdateAppView.xaml #>

$updateView    = $script:ContentHost.Content
$updateTitle   = $updateView.FindName('UpdateTitle')
$updateSub     = $updateView.FindName('UpdateSubtitle')
$oldVersion    = $updateView.FindName('OldVersion')
$newVersion    = $updateView.FindName('NewVersion')
$oldName       = $updateView.FindName('OldName')
$newName       = $updateView.FindName('NewName')
$chkRebuild    = $updateView.FindName('ChkRebuild')
$chkUpload     = $updateView.FindName('ChkUpload')
$chkMeta       = $updateView.FindName('ChkUpdateMeta')
$btnRunUpdate  = $updateView.FindName('BtnRunUpdate')
$btnCancelOp   = $updateView.FindName('BtnCancelOp')
$btnBack       = $updateView.FindName('BtnBack')
$progressPanel = $updateView.FindName('ProgressPanel')
$progressBar   = $updateView.FindName('UpdateProgress')
$progressLabel = $updateView.FindName('ProgressLabel')

$row = (Get-SharedState)['SelectedApp']

if ($row) {
    $updateTitle.Text = "Update: $($row.DisplayName)"
    $updateSub.Text   = "Local: $($row.LocalVersion)  ->  Intune: $($row.IntuneVersion)"
    $oldVersion.Text  = $row.IntuneVersion
    $newVersion.Text  = $row.LocalVersion
    $oldName.Text     = $row.DisplayName
    $newName.Text     = if ($row.LocalPackage) { $row.LocalPackage.DisplayName } else { $row.DisplayName }
}

$btnBack.Add_Click({ & $script:Nav_ShowDashboard })
$btnCancelOp.Add_Click({ Request-CancelOperation })

$btnRunUpdate.Add_Click({
    if (-not $row) { return }

    $doRebuild = $chkRebuild.IsChecked
    $doUpload  = $chkUpload.IsChecked
    $doMeta    = $chkMeta.IsChecked

    if (-not $doRebuild -and -not $doUpload -and -not $doMeta) {
        [System.Windows.MessageBox]::Show("Select at least one option.", "Nothing to do", 'OK', 'Information') | Out-Null
        return
    }

    $btnRunUpdate.IsEnabled = $false
    $btnBack.IsEnabled      = $false
    $btnCancelOp.Visibility = 'Visible'
    $progressPanel.Visibility = 'Visible'

    $shared      = Get-SharedState
    $projectRoot = $shared['ProjectRoot']
    $toolPath    = $shared['ToolPath']
    $outputDir   = $shared['OutputFolder']
    $pkg         = $row.LocalPackage
    $appId       = $row.AppId

    Invoke-BackgroundOperation -Work {
        $intuneWinPath = $null

        # Step 1: Rebuild
        if ($doRebuild -and $pkg) {
            Update-UIFromBackground -Action {
                $progressLabel.Text = "Building .intunewin package..."
                $progressBar.Value  = 10
            }
            $installCmdParts = $pkg.InstallCommand.Split(' ')
            $ps1Arg = $installCmdParts | Where-Object { $_ -match '\.ps1$' } | Select-Object -First 1
            $entryPoint = Join-Path $pkg.SourceFolder ([System.IO.Path]::GetFileName($ps1Arg))
            if (-not (Test-Path $entryPoint)) {
                $entryPoint = Get-ChildItem $pkg.SourceFolder -Filter 'Install-*.ps1' | Select-Object -First 1 -ExpandProperty FullName
            }
            $intuneWinPath = Invoke-PackageBuild `
                -SourceFolder $pkg.SourceFolder `
                -EntryPoint   $entryPoint `
                -OutputFolder $outputDir `
                -ToolPath     $toolPath `
                -SharedState  $SharedState `
                -OnLogLine    { param($line)
                    Update-UIFromBackground -Action { $progressLabel.Text = $line } }
        }

        # Step 2: Upload
        if ($doUpload -and $appId) {
            if (-not $intuneWinPath) {
                # Use existing .intunewin
                $baseName = [System.IO.Path]::GetFileNameWithoutExtension(
                    (Get-ChildItem $pkg.SourceFolder -Filter 'Install-*.ps1' | Select-Object -First 1).Name)
                $intuneWinPath = Join-Path $outputDir "$baseName.intunewin"
            }
            Update-UIFromBackground -Action {
                $progressLabel.Text = "Uploading to Azure Blob..."
                $progressBar.Value  = 50
            }
            Invoke-IntuneUpload -AppId $appId -IntuneWinPath $intuneWinPath `
                -SharedState $SharedState `
                -OnProgress  { param($chunk, $total)
                    $pct = [int](50 + $chunk / $total * 40)
                    Update-UIFromBackground -Action { $progressBar.Value = $pct } }
        }

        # Step 3: Update metadata
        if ($doMeta -and $appId -and $pkg) {
            Update-UIFromBackground -Action {
                $progressLabel.Text = "Updating app metadata..."
                $progressBar.Value  = 95
            }
            $body = @{
                '@odata.type'    = '#microsoft.graph.win32LobApp'
                displayVersion   = $pkg.AppVersion
                description      = $pkg.Description
                publisher        = $pkg.Publisher
                informationUrl   = $pkg.InformationUrl
                privacyUrl       = $pkg.PrivacyUrl
            }
            Update-Win32App -AppId $appId -Body $body | Out-Null
        }

        Update-UIFromBackground -Action {
            $progressBar.Value  = 100
            $progressLabel.Text = "Done!"
        }
    } -OnComplete {
        $btnRunUpdate.IsEnabled = $true
        $btnBack.IsEnabled      = $true
        $btnCancelOp.Visibility = 'Collapsed'
        Write-AppLog "Update complete for: $($row.DisplayName)"
        [System.Windows.MessageBox]::Show(
            "Update complete for $($row.DisplayName).",
            "Update Complete", 'OK', 'Information') | Out-Null
        # If an Update All queue is active, process the next app; otherwise return to Dashboard
        $queue = (Get-SharedState)['UpdateQueue']
        if ($queue -and $queue.Count -gt 0) {
            $nextRow = $queue.Dequeue()
            & $script:Nav_ShowUpdateView -AppRow $nextRow
        } else {
            (Get-SharedState)['UpdateQueue'] = $null
            & $script:Nav_ShowDashboard
        }
    } -OnError {
        param($err)
        $btnRunUpdate.IsEnabled = $true
        $btnBack.IsEnabled      = $true
        $btnCancelOp.Visibility = 'Collapsed'
        $msg = if ($err) { $err.Message } else { 'Update failed' }
        Write-AppLog "Update failed: $msg" -Level ERROR
        [System.Windows.MessageBox]::Show($msg, "Update Failed", 'OK', 'Error') | Out-Null
    }
})
