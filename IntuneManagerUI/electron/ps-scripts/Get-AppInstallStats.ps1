#Requires -Version 5.1
$OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = 'Stop'

try {
    $LibPath = Join-Path $PSScriptRoot '..\..\..\IntuneManager\Lib'
    Import-Module (Join-Path $LibPath 'Logger.psm1') -Force
    Import-Module (Join-Path $LibPath 'Auth.psm1') -Force
    Import-Module (Join-Path $LibPath 'GraphClient.psm1') -Force

    Write-AppLog 'Fetching Win32 app install statistics from Intune...'

    # Fetch all Win32 LOB apps
    $appsUri = "https://graph.microsoft.com/v1.0/deviceAppManagement/mobileApps" +
               "?`$filter=isOf('microsoft.graph.win32LobApp')&`$select=id,displayName&`$top=999"

    $allApps = [System.Collections.Generic.List[object]]::new()
    $nextUri = $appsUri
    while ($nextUri) {
        $response = Invoke-GraphRequest -Method GET -Uri $nextUri
        if ($response.value) { $allApps.AddRange([object[]]$response.value) }
        $nextUri = if ($response.PSObject.Properties['@odata.nextLink']) { $response.'@odata.nextLink' } else { $null }
    }

    Write-AppLog "Found $($allApps.Count) Win32 app(s). Fetching install summaries..."

    # Cap at 50 apps to avoid excessive Graph calls
    $cap = 50
    $truncated = $allApps.Count -gt $cap
    $appsToQuery = if ($truncated) { $allApps | Select-Object -First $cap } else { $allApps }

    $appStats = [System.Collections.Generic.List[object]]::new()

    foreach ($app in $appsToQuery) {
        $appId = [string]$app.id
        $displayName = if ($app.PSObject.Properties['displayName']) { [string]$app.displayName } else { $appId }

        try {
            $summaryUri = "https://graph.microsoft.com/v1.0/deviceAppManagement/mobileApps/$appId/microsoft.graph.win32LobApp/installSummary"
            $summary = Invoke-GraphRequest -Method GET -Uri $summaryUri

            $installed      = if ($summary.PSObject.Properties['installedDeviceCount'])      { [int]$summary.installedDeviceCount }      else { 0 }
            $failed         = if ($summary.PSObject.Properties['failedDeviceCount'])         { [int]$summary.failedDeviceCount }         else { 0 }
            $pending        = if ($summary.PSObject.Properties['pendingInstallDeviceCount']) { [int]$summary.pendingInstallDeviceCount } else { 0 }
            $notApplicable  = if ($summary.PSObject.Properties['notApplicableDeviceCount'])  { [int]$summary.notApplicableDeviceCount }  else { 0 }

            $denom = $installed + $failed + $pending
            $successPercent = if ($denom -gt 0) { [Math]::Round(($installed / $denom) * 100, 1) } else { 0.0 }

            $appStats.Add(@{
                id             = $appId
                displayName    = $displayName
                installed      = $installed
                failed         = $failed
                pending        = $pending
                notApplicable  = $notApplicable
                successPercent = $successPercent
            })
        } catch {
            # Skip apps whose installSummary is unavailable (e.g. not deployed)
            Write-AppLog "Skipping $displayName - $($_.Exception.Message)" 'WARN'
        }
    }

    Write-AppLog "Retrieved install stats for $($appStats.Count) app(s)"
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $true; apps = @($appStats); truncated = [bool]$truncated } -Compress -Depth 5)"
} catch {
    $msg = $_.Exception.Message
    # Detect 403 permission error
    $isPermissionError = $msg -match '403' -or $msg -match 'Forbidden' -or $msg -match 'Authorization_RequestDenied'
    if ($isPermissionError) {
        Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; apps = @(); permissionError = $true; error = $msg } -Compress)"
    } else {
        Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; apps = @(); error = $msg } -Compress)"
    }
}
