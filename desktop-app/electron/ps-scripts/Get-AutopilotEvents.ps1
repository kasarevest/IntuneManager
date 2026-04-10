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

    Write-Log 'Fetching Autopilot enrollment events from Intune...'

    $headers = @{ Authorization = "Bearer $AccessToken" }
    $uri = 'https://graph.microsoft.com/v1.0/deviceManagement/autopilotEvents' +
           '?$select=id,deviceRegisteredDateTime,enrollmentState,enrollmentFailureDetails&$top=999'

    $allEvents = [System.Collections.Generic.List[object]]::new()
    $nextUri = $uri
    while ($nextUri) {
        $response = Invoke-RestMethod -Method GET -Uri $nextUri -Headers $headers
        if ($response.value) { $allEvents.AddRange([object[]]$response.value) }
        $nextUri = $response.'@odata.nextLink'
    }

    Write-Log "Retrieved $($allEvents.Count) Autopilot event(s)"

    $cutoff = (Get-Date).AddDays(-30)

    $eventList = [System.Collections.Generic.List[object]]::new()
    foreach ($ev in $allEvents) {
        $regDateStr = [string]($ev.deviceRegisteredDateTime ?? '')

        if ($regDateStr -ne '') {
            try {
                if ([datetime]::Parse($regDateStr) -lt $cutoff) { continue }
            } catch { }
        }

        $eventList.Add(@{
            id                       = [string]($ev.id ?? '')
            deviceRegisteredDateTime = $regDateStr
            enrollmentState          = [string]($ev.enrollmentState ?? '')
            enrollmentFailureDetails = if ($ev.enrollmentFailureDetails) { [string]$ev.enrollmentFailureDetails } else { $null }
        })
    }

    Write-Log "Returning $($eventList.Count) event(s) within the last 30 days"
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
