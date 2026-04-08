#Requires -Version 7.0
param([string]$AccessToken = '')
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

function Write-Log([string]$Message, [string]$Level = 'INFO') {
    Write-Output "LOG:[$Level] $Message"
}

try {
    if (-not $AccessToken) { throw 'AccessToken is required' }

    Write-Log 'Fetching Win32 app install statistics from Intune...'

    $headers = @{ Authorization = "Bearer $AccessToken" }
    $appsUri = "https://graph.microsoft.com/v1.0/deviceAppManagement/mobileApps" +
               "?`$filter=isOf('microsoft.graph.win32LobApp')&`$select=id,displayName&`$top=999"

    $allApps = [System.Collections.Generic.List[object]]::new()
    $nextUri = $appsUri
    while ($nextUri) {
        $response = Invoke-RestMethod -Method GET -Uri $nextUri -Headers $headers
        if ($response.value) { $allApps.AddRange([object[]]$response.value) }
        $nextUri = $response.'@odata.nextLink'
    }

    Write-Log "Found $($allApps.Count) Win32 app(s). Fetching install summaries..."

    $cap = 50
    $truncated = $allApps.Count -gt $cap
    $appsToQuery = if ($truncated) { $allApps | Select-Object -First $cap } else { $allApps }

    $appStats = [System.Collections.Generic.List[object]]::new()

    foreach ($app in $appsToQuery) {
        $appId = [string]$app.id
        $displayName = if ($app.displayName) { [string]$app.displayName } else { $appId }

        try {
            $summaryUri = "https://graph.microsoft.com/v1.0/deviceAppManagement/mobileApps/$appId/microsoft.graph.win32LobApp/installSummary"
            $summary = Invoke-RestMethod -Method GET -Uri $summaryUri -Headers $headers

            $installed     = [int]($summary.installedDeviceCount ?? 0)
            $failed        = [int]($summary.failedDeviceCount ?? 0)
            $pending       = [int]($summary.pendingInstallDeviceCount ?? 0)
            $notApplicable = [int]($summary.notApplicableDeviceCount ?? 0)

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
            Write-Log "Skipping $displayName - $($_.Exception.Message)" 'WARN'
        }
    }

    Write-Log "Retrieved install stats for $($appStats.Count) app(s)"
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $true; apps = @($appStats); truncated = [bool]$truncated } -Compress -Depth 5)"
} catch {
    $msg = $_.Exception.Message
    $isPermissionError = $msg -match '403' -or $msg -match 'Forbidden' -or $msg -match 'Authorization_RequestDenied'
    if ($isPermissionError) {
        Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; apps = @(); permissionError = $true; error = $msg } -Compress)"
    } else {
        Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; apps = @(); error = $msg } -Compress)"
    }
}
