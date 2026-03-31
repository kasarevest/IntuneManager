#Requires -Version 5.1
<#
.SYNOPSIS  Code-behind for DashboardView.xaml #>

$dashView      = $script:ContentHost.Content
$appGrid       = $dashView.FindName('AppGrid')
$txtSearch     = $dashView.FindName('TxtSearch')
$cboFilter     = $dashView.FindName('CboFilter')
$btnNewApp     = $dashView.FindName('BtnNewApp')
$btnUpdateAll  = $dashView.FindName('BtnUpdateAll')
$summaryLabel  = $dashView.FindName('SummaryLabel')

# ObservableCollection as the DataGrid's item source
$script:AppCollection = [System.Collections.ObjectModel.ObservableCollection[PSCustomObject]]::new()
$appGrid.ItemsSource  = $script:AppCollection

# Raw app data -- full list for filtering
$script:AllAppRows = @()

#region Status badge helpers
$script:Dashboard_GetStatusColor = {
    param([string]$Status)
    switch ($Status) {
        'Current'         { return '#2A7A4A' }
        'UpdateAvailable' { return '#7A5020' }
        'LocalOnly'       { return '#2A4A7A' }
        'CloudOnly'       { return '#4A2A7A' }
        default           { return '#3A3A5A' }
    }
}

$script:Dashboard_GetStatusText = {
    param([string]$Status)
    switch ($Status) {
        'Current'         { return '● Current' }
        'UpdateAvailable' { return '▲ Update' }
        'LocalOnly'       { return '★ Not in Intune' }
        'CloudOnly'       { return '☁ Cloud Only' }
        'IntuneNewer'     { return '↓ Intune Newer' }
        default           { return '? Unknown' }
    }
}
#endregion

#region Sync

$script:Dashboard_InvokeSync = {
    & $script:Nav_SetStatusText "Syncing..."
    & $script:Nav_SetOperationRunning $true
    Write-AppLog "Sync started"

    $projectRoot = (Get-SharedState)['ProjectRoot']
    $sourceRoot  = Join-Path $projectRoot 'Source'

    Invoke-BackgroundOperation -Work {
        # 1. Load local packages
        $localPackages = Get-AllPackageSettings -SourceRoot $sourceRoot

        # 2. Fetch Intune apps
        $intuneApps = Get-IntuneWin32Apps

        # Build lookup: displayName -> Intune app
        $intuneMap = @{}
        foreach ($app in $intuneApps) {
            $intuneMap[$app.displayName.ToLower()] = $app
        }

        # 3. Build rows -- local packages first
        $rows = [System.Collections.Generic.List[PSCustomObject]]::new()
        $localKeys = [System.Collections.Generic.HashSet[string]]::new()

        foreach ($pkg in $localPackages) {
            if (-not $pkg.DisplayName) { continue }
            $key = $pkg.DisplayName.ToLower()
            $localKeys.Add($key) | Out-Null
            $intuneApp = $intuneMap[$key]
            $intuneVer = if ($intuneApp) { $intuneApp.displayVersion } else { $null }
            $cmp = Compare-AppVersion -LocalVersion $pkg.AppVersion -IntuneVersion $intuneVer

            $rows.Add([PSCustomObject]@{
                DisplayName    = $pkg.DisplayName
                LocalVersion   = if ($pkg.AppVersion) { $pkg.AppVersion } else { '--' }
                IntuneVersion  = if ($intuneVer) { $intuneVer } else { '--' }
                Status         = $cmp.Status
                StatusText     = & $script:Dashboard_GetStatusText $cmp.Status
                StatusColor    = & $script:Dashboard_GetStatusColor $cmp.Status
                Publisher      = $pkg.Publisher
                LastModified   = if ($intuneApp) { [datetime]$intuneApp.lastModifiedDateTime | Get-Date -Format 'yyyy-MM-dd' } else { '--' }
                ActionLabel    = if ($cmp.Status -eq 'UpdateAvailable') { '▲ Update' } elseif ($cmp.Status -eq 'LocalOnly') { '↑ Upload' } else { '' }
                ActionVisibility = if ($cmp.Status -in @('UpdateAvailable','LocalOnly')) { 'Visible' } else { 'Collapsed' }
                AppId          = if ($intuneApp) { $intuneApp.id } else { $null }
                IntuneApp      = $intuneApp
                LocalPackage   = $pkg
                Comparison     = $cmp
            })
        }

        # 4. Add cloud-only apps (in Intune but no local package)
        foreach ($app in $intuneApps) {
            if ($localKeys.Contains($app.displayName.ToLower())) { continue }
            $rows.Add([PSCustomObject]@{
                DisplayName    = $app.displayName
                LocalVersion   = '--'
                IntuneVersion  = $app.displayVersion
                Status         = 'CloudOnly'
                StatusText     = & $script:Dashboard_GetStatusText 'CloudOnly'
                StatusColor    = & $script:Dashboard_GetStatusColor 'CloudOnly'
                Publisher      = $app.publisher
                LastModified   = [datetime]$app.lastModifiedDateTime | Get-Date -Format 'yyyy-MM-dd'
                ActionLabel    = ''
                ActionVisibility = 'Collapsed'
                AppId          = $app.id
                IntuneApp      = $app
                LocalPackage   = $null
                Comparison     = $null
            })
        }

        $SharedState['AllAppRows'] = $rows.ToArray()
        Update-UIFromBackground -Action {
            Write-AppLog "Sync complete -- $($rows.Count) app(s) loaded"
        }
    } -OnComplete {
        $script:AllAppRows = (Get-SharedState)['AllAppRows']
        & $script:Dashboard_ApplyFilter
        & $script:Nav_UpdateLastSync
        & $script:Nav_SetStatusText "Ready"
        & $script:Nav_SetOperationRunning $false
    } -OnError {
        param($err)
        $msg = if ($err) { $err.Message } else { 'Sync failed' }
        Write-AppLog "Sync error: $msg" -Level ERROR
        [System.Windows.MessageBox]::Show($msg, "Sync Failed", 'OK', 'Error') | Out-Null
        & $script:Nav_SetStatusText "Sync failed"
        & $script:Nav_SetOperationRunning $false
    }
}

#endregion

#region Filtering

$script:Dashboard_ApplyFilter = {
    $search  = $txtSearch.Text.ToLower()
    $filter  = ($cboFilter.SelectedItem | ForEach-Object { $_.Content })

    $filtered = $script:AllAppRows | Where-Object {
        $matchSearch = [string]::IsNullOrWhiteSpace($search) -or
                       $_.DisplayName.ToLower().Contains($search) -or
                       ($_.Publisher -and $_.Publisher.ToLower().Contains($search))
        $matchFilter = switch ($filter) {
            'Update Available'  { $_.Status -eq 'UpdateAvailable' }
            'Current'           { $_.Status -eq 'Current' }
            'Not in Intune'     { $_.Status -eq 'LocalOnly' }
            'Cloud Only'        { $_.Status -eq 'CloudOnly' }
            default             { $true }
        }
        $matchSearch -and $matchFilter
    }

    $script:Window.Dispatcher.Invoke([System.Action]{
        $script:AppCollection.Clear()
        foreach ($row in $filtered) { $script:AppCollection.Add($row) }
        $total   = $script:AllAppRows.Count
        $updates = ($script:AllAppRows | Where-Object { $_.Status -eq 'UpdateAvailable' }).Count
        $summaryLabel.Text = "$total apps loaded | $updates update(s) available"
    })
}

#endregion

#region Events

$txtSearch.Add_TextChanged({ & $script:Dashboard_ApplyFilter })
$cboFilter.Add_SelectionChanged({ & $script:Dashboard_ApplyFilter })

$appGrid.Add_SelectionChanged({
    $row = $appGrid.SelectedItem
    if ($row) { & $script:Nav_ShowAppDetail -AppRow $row }
})

# Row action button clicks
$appGrid.AddHandler(
    [System.Windows.Controls.Button]::ClickEvent,
    [System.Windows.RoutedEventHandler]{
        param($sender, $e)
        if ($e.OriginalSource -is [System.Windows.Controls.Button]) {
            $row = $e.OriginalSource.Tag
            if ($row) {
                if ($row.Status -eq 'UpdateAvailable') {
                    & $script:Nav_ShowUpdateView -AppRow $row
                } elseif ($row.Status -eq 'LocalOnly') {
                    & $script:Nav_ShowNewAppWizard
                    (Get-SharedState)['WizardPreloadPackage'] = $row.LocalPackage
                }
                $e.Handled = $true
            }
        }
    }
)

$btnNewApp.Add_Click({ & $script:Nav_ShowNewAppWizard })

$btnUpdateAll.Add_Click({
    $outdated = $script:AllAppRows | Where-Object { $_.Status -eq 'UpdateAvailable' }
    if ($outdated.Count -eq 0) {
        [System.Windows.MessageBox]::Show("All apps are up to date.", "No Updates", 'OK', 'Information') | Out-Null
        return
    }
    $confirm = [System.Windows.MessageBox]::Show(
        "Update $($outdated.Count) app(s): $($outdated.DisplayName -join ', ')?",
        "Update All",
        [System.Windows.MessageBoxButton]::YesNo,
        [System.Windows.MessageBoxImage]::Question)
    if ($confirm -ne 'Yes') { return }
    # Store the queue in SharedState; UpdateAppView chains to the next one on completion
    $queue = [System.Collections.Generic.Queue[PSCustomObject]]::new()
    foreach ($row in $outdated) { $queue.Enqueue($row) }
    (Get-SharedState)['UpdateQueue'] = $queue
    $first = $queue.Dequeue()
    & $script:Nav_ShowUpdateView -AppRow $first
})

# Wire the title bar Sync button to this view's Invoke-Sync
$script:OnSyncRequested = { & $script:Dashboard_InvokeSync }

#endregion

# Kick off initial sync
& $script:Dashboard_InvokeSync
