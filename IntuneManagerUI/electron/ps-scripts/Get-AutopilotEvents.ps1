#Requires -Version 5.1
param([string]$AccessToken = '')
$OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = 'Stop'

try {
    $LibPath = Join-Path $PSScriptRoot '..\..\..\IntuneManager\Lib'
    Import-Module (Join-Path $LibPath 'Logger.psm1') -Force
    Import-Module (Join-Path $LibPath 'Auth.psm1') -Force
    Import-Module (Join-Path $LibPath 'GraphClient.psm1') -Force
    if ($AccessToken) { Set-GraphAccessToken -Token $AccessToken }

    Write-AppLog 'Fetching Autopilot enrollment events from Intune...'

    $uri = 'https://graph.microsoft.com/v1.0/deviceManagement/autopilotEvents' +
           '?$select=id,deviceRegisteredDateTime,enrollmentState,enrollmentFailureDetails&$top=999'

    $allEvents = [System.Collections.Generic.List[object]]::new()
    $nextUri = $uri
    while ($nextUri) {
        $response = Invoke-GraphRequest -Method GET -Uri $nextUri
        if ($response.value) { $allEvents.AddRange([object[]]$response.value) }
        $nextUri = if ($response.PSObject.Properties['@odata.nextLink']) { $response.'@odata.nextLink' } else { $null }
    }

    Write-AppLog "Retrieved $($allEvents.Count) Autopilot event(s)"

    # Filter to last 30 days
    $cutoff = (Get-Date).AddDays(-30)

    $eventList = [System.Collections.Generic.List[object]]::new()
    foreach ($ev in $allEvents) {
        $regDateStr = if ($ev.PSObject.Properties['deviceRegisteredDateTime']) { [string]$ev.deviceRegisteredDateTime } else { '' }

        # Only include events within the last 30 days
        if ($regDateStr -ne '') {
            try {
                $regDate = [datetime]::Parse($regDateStr)
                if ($regDate -lt $cutoff) { continue }
            } catch {
                # If date cannot be parsed, include the event anyway
            }
        }

        $failureDetails = $null
        if ($ev.PSObject.Properties['enrollmentFailureDetails'] -and $ev.enrollmentFailureDetails -ne $null) {
            $failureDetails = [string]$ev.enrollmentFailureDetails
        }

        $eventList.Add(@{
            id                       = if ($ev.PSObject.Properties['id'])              { [string]$ev.id }              else { '' }
            deviceRegisteredDateTime = $regDateStr
            enrollmentState          = if ($ev.PSObject.Properties['enrollmentState']) { [string]$ev.enrollmentState } else { '' }
            enrollmentFailureDetails = $failureDetails
        })
    }

    Write-AppLog "Returning $($eventList.Count) event(s) within the last 30 days"
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $true; events = @($eventList) } -Compress -Depth 5)"
} catch {
    $msg = $_.Exception.Message
    $isPermissionError = $msg -match '403' -or $msg -match 'Forbidden' -or $msg -match 'Authorization_RequestDenied'
    if ($isPermissionError) {
        Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; events = @(); permissionError = $true; error = $msg } -Compress)"
    } else {
        Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; events = @(); error = $msg } -Compress)"
    }
}
