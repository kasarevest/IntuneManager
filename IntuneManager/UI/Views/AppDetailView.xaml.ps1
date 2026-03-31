#Requires -Version 5.1
<#
.SYNOPSIS  Code-behind for AppDetailView.xaml #>

$detailView  = $script:ContentHost.Content
$appTitle    = $detailView.FindName('AppTitle')
$appSubtitle = $detailView.FindName('AppSubtitle')
$localGrid   = $detailView.FindName('LocalGrid')
$intuneGrid  = $detailView.FindName('IntuneGrid')
$btnBack     = $detailView.FindName('BtnBack')
$btnRebuild  = $detailView.FindName('BtnRebuildUpdate')
$btnAssign   = $detailView.FindName('BtnViewAssignments')

$row = (Get-SharedState)['SelectedApp']

$script:AppDetail_AddDetailRow = {
    param($Grid, [string]$Label, [string]$Value)
    $rowDef = [System.Windows.Controls.RowDefinition]::new()
    $rowDef.Height = [System.Windows.GridLength]::Auto
    $Grid.RowDefinitions.Add($rowDef)
    $rowIndex = $Grid.RowDefinitions.Count - 1

    $lbl = [System.Windows.Controls.TextBlock]::new()
    $lbl.Text       = $Label
    $lbl.Foreground = [System.Windows.Media.SolidColorBrush][System.Windows.Media.ColorConverter]::ConvertFromString('#9999BB')
    $lbl.FontSize   = 11
    $lbl.Margin     = [System.Windows.Thickness]::new(0, 0, 0, 2)
    [System.Windows.Controls.Grid]::SetRow($lbl, $rowIndex)

    $val = [System.Windows.Controls.TextBlock]::new()
    $val.Text       = if ($Value) { $Value } else { '--' }
    $val.Foreground = [System.Windows.Media.SolidColorBrush][System.Windows.Media.ColorConverter]::ConvertFromString('#E2E2F0')
    $val.FontSize   = 13
    $val.TextWrapping = 'Wrap'
    $val.Margin     = [System.Windows.Thickness]::new(0, 0, 0, 10)
    [System.Windows.Controls.Grid]::SetRow($val, $rowIndex)

    # Two-column sub-grid approach: label top, value below
    # Using a StackPanel instead
    $sp = [System.Windows.Controls.StackPanel]::new()
    $sp.Margin = [System.Windows.Thickness]::new(0, 0, 0, 8)
    $sp.Children.Add($lbl) | Out-Null
    $sp.Children.Add($val) | Out-Null
    $Grid.Children.Add($sp) | Out-Null
    [System.Windows.Controls.Grid]::SetRow($sp, $rowIndex)
}

# Convert LocalGrid from Grid to StackPanel logic -- just use ItemsControl-like approach
# Replace Grid with StackPanel children approach

if ($row) {
    $appTitle.Text    = $row.DisplayName
    $appSubtitle.Text = "Status: $($row.StatusText)"

    # LOCAL panel -- replace placeholder Grid with StackPanel
    $localSP = [System.Windows.Controls.StackPanel]::new()
    $localSP.Margin = [System.Windows.Thickness]::new(0)

    $script:AppDetail_AddSPRow = {
        param($SP, [string]$Label, [string]$Value)
        $container = [System.Windows.Controls.StackPanel]::new()
        $container.Margin = [System.Windows.Thickness]::new(0,0,0,10)

        $lbl = [System.Windows.Controls.TextBlock]::new()
        $lbl.Text       = $Label.ToUpper()
        $lbl.Foreground = [System.Windows.Media.SolidColorBrush][System.Windows.Media.ColorConverter]::ConvertFromString('#9999BB')
        $lbl.FontSize   = 10
        $lbl.FontWeight = 'SemiBold'
        $lbl.Margin     = [System.Windows.Thickness]::new(0,0,0,2)

        $val = [System.Windows.Controls.TextBlock]::new()
        $val.Text        = if (-not [string]::IsNullOrWhiteSpace($Value)) { $Value } else { '--' }
        $val.Foreground  = [System.Windows.Media.SolidColorBrush][System.Windows.Media.ColorConverter]::ConvertFromString('#E2E2F0')
        $val.FontSize    = 13
        $val.TextWrapping = 'Wrap'

        $container.Children.Add($lbl) | Out-Null
        $container.Children.Add($val) | Out-Null
        $SP.Children.Add($container) | Out-Null
    }

    # Build local package panel
    $pkg = $row.LocalPackage
    if ($pkg) {
        & $script:AppDetail_AddSPRow $localSP 'Source Folder' (Split-Path $pkg.SourceFolder -Leaf)
        & $script:AppDetail_AddSPRow $localSP 'Version'       $pkg.AppVersion
        & $script:AppDetail_AddSPRow $localSP 'Publisher'     $pkg.Publisher
        & $script:AppDetail_AddSPRow $localSP 'Install Command' $pkg.InstallCommand
        & $script:AppDetail_AddSPRow $localSP 'Uninstall Command' $pkg.UninstallCommand
        & $script:AppDetail_AddSPRow $localSP 'Min OS'        $pkg.MinimumOsRaw
        & $script:AppDetail_AddSPRow $localSP 'Architecture'  $pkg.Architecture
        if ($pkg.ParseWarnings -and $pkg.ParseWarnings.Count -gt 0) {
            & $script:AppDetail_AddSPRow $localSP 'Warnings' ($pkg.ParseWarnings -join '; ')
        }
    } else {
        & $script:AppDetail_AddSPRow $localSP 'Status' 'No local package found'
    }

    # Replace placeholder Grid
    $localParent = $localGrid.Parent
    $localIndex  = $localParent.Children.IndexOf($localGrid)
    $localParent.Children.RemoveAt($localIndex)
    $localParent.Children.Insert($localIndex, $localSP)

    # Build Intune panel
    $intuneSP = [System.Windows.Controls.StackPanel]::new()
    $ia = $row.IntuneApp
    if ($ia) {
        & $script:AppDetail_AddSPRow $intuneSP 'App ID'        $ia.id
        & $script:AppDetail_AddSPRow $intuneSP 'Version'       $ia.displayVersion
        & $script:AppDetail_AddSPRow $intuneSP 'Publisher'     $ia.publisher
        & $script:AppDetail_AddSPRow $intuneSP 'State'         $ia.publishingState
        & $script:AppDetail_AddSPRow $intuneSP 'Last Modified' $row.LastModified

        $btnAssign.Visibility   = 'Visible'
        if ($row.Status -eq 'UpdateAvailable') {
            $btnRebuild.Visibility = 'Visible'
        }
    } else {
        & $script:AppDetail_AddSPRow $intuneSP 'Status' 'Not uploaded to Intune yet'
        $btnRebuild.Visibility = 'Visible'
        $btnRebuild.Content    = '↑ Build + Upload to Intune'
    }

    $intuneParent = $intuneGrid.Parent
    $intuneIndex  = $intuneParent.Children.IndexOf($intuneGrid)
    $intuneParent.Children.RemoveAt($intuneIndex)
    $intuneParent.Children.Insert($intuneIndex, $intuneSP)
}

#region Events
$btnBack.Add_Click({ & $script:Nav_ShowDashboard })

$btnRebuild.Add_Click({
    if ($row) { & $script:Nav_ShowUpdateView -AppRow $row }
})

$btnAssign.Add_Click({
    if (-not $row.AppId) { return }
    & $script:Nav_SetStatusText "Loading assignments..."
    Invoke-BackgroundOperation -Work {
        $assignments = Get-AppAssignments -AppId $SharedState['SelectedApp'].AppId
        $SharedState['Assignments'] = $assignments
    } -OnComplete {
        $assignments = (Get-SharedState)['Assignments']
        $msg = if ($assignments -and $assignments.Count -gt 0) {
            ($assignments | ForEach-Object { "$($_.target.'@odata.type'.Split('.')[-1]): $($_.intent)" }) -join "`n"
        } else { "No assignments found." }
        [System.Windows.MessageBox]::Show($msg, "Assignments for $($row.DisplayName)", 'OK', 'Information') | Out-Null
        & $script:Nav_SetStatusText "Ready"
    } -OnError {
        param($err)
        [System.Windows.MessageBox]::Show($err.Message, "Assignment Error", 'OK', 'Error') | Out-Null
        & $script:Nav_SetStatusText "Ready"
    }
})
#endregion
