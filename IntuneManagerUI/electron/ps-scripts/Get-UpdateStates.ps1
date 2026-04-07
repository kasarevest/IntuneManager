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

    Write-AppLog 'Fetching Windows Update states from Intune (beta)...'

    $uri = 'https://graph.microsoft.com/beta/deviceManagement/windowsUpdateStates' +
           '?$select=deviceId,deviceDisplayName,osVersion,featureUpdateVersion,status&$top=999'

    $allStates = [System.Collections.Generic.List[object]]::new()
    $nextUri = $uri
    while ($nextUri) {
        $response = Invoke-GraphRequest -Method GET -Uri $nextUri
        if ($response.value) { $allStates.AddRange([object[]]$response.value) }
        $nextUri = if ($response.PSObject.Properties['@odata.nextLink']) { $response.'@odata.nextLink' } else { $null }
    }

    Write-AppLog "Retrieved $($allStates.Count) Windows Update state record(s)"

    # Build summary counts by status
    $notStarted = 0
    $pending    = 0
    $inProgress = 0
    $completed  = 0
    $failed     = 0

    $stateList = $allStates | ForEach-Object {
        $s = $_
        $status = if ($s.PSObject.Properties['status']) { [string]$s.status } else { 'unknown' }

        switch ($status) {
            'notStarted'  { $notStarted++ }
            'pending'     { $pending++ }
            'inProgress'  { $inProgress++ }
            'completed'   { $completed++ }
            'failed'      { $failed++ }
        }

        @{
            deviceId             = if ($s.PSObject.Properties['deviceId'])             { [string]$s.deviceId }             else { '' }
            deviceName           = if ($s.PSObject.Properties['deviceDisplayName'])    { [string]$s.deviceDisplayName }    else { '' }
            osVersion            = if ($s.PSObject.Properties['osVersion'])            { [string]$s.osVersion }            else { '' }
            featureUpdateVersion = if ($s.PSObject.Properties['featureUpdateVersion']) { [string]$s.featureUpdateVersion } else { '' }
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
