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

    Write-Log 'Fetching Windows Update states from Intune (beta)...'

    $headers = @{ Authorization = "Bearer $AccessToken" }
    $uri = 'https://graph.microsoft.com/beta/deviceManagement/windowsUpdateStates' +
           '?$select=deviceId,deviceDisplayName,osVersion,featureUpdateVersion,status&$top=999'

    $allStates = [System.Collections.Generic.List[object]]::new()
    $nextUri = $uri
    while ($nextUri) {
        $response = Invoke-RestMethod -Method GET -Uri $nextUri -Headers $headers
        if ($response.value) { $allStates.AddRange([object[]]$response.value) }
        $nextUri = $response.'@odata.nextLink'
    }

    Write-Log "Retrieved $($allStates.Count) Windows Update state record(s)"

    $notStarted = 0; $pending = 0; $inProgress = 0; $completed = 0; $failed = 0

    $stateList = $allStates | ForEach-Object {
        $s = $_
        $status = [string]($s.status ?? 'unknown')

        switch ($status) {
            'notStarted'  { $notStarted++ }
            'pending'     { $pending++ }
            'inProgress'  { $inProgress++ }
            'completed'   { $completed++ }
            'failed'      { $failed++ }
        }

        @{
            deviceId             = [string]($s.deviceId ?? '')
            deviceName           = [string]($s.deviceDisplayName ?? '')
            osVersion            = [string]($s.osVersion ?? '')
            featureUpdateVersion = [string]($s.featureUpdateVersion ?? '')
            status               = $status
        }
    }

    $summary = @{
        notStarted = $notStarted
        pending    = $pending
        inProgress = $inProgress
        completed  = $completed
        failed     = $failed
    }

    Write-Output "RESULT:$(ConvertTo-Json @{ success = $true; summary = $summary; states = @($stateList) } -Compress -Depth 5)"
} catch {
    $msg = $_.Exception.Message
    $isPermissionError = $msg -match '403' -or $msg -match 'Forbidden' -or $msg -match 'Authorization_RequestDenied'
    if ($isPermissionError) {
        Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; summary = @{}; states = @(); permissionError = $true; error = $msg } -Compress)"
    } else {
        Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; summary = @{}; states = @(); error = $msg } -Compress)"
    }
}
