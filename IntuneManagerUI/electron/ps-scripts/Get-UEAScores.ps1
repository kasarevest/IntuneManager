#Requires -Version 5.1
$OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = 'Stop'

try {
    $LibPath = Join-Path $PSScriptRoot '..\..\..\IntuneManager\Lib'
    Import-Module (Join-Path $LibPath 'Logger.psm1') -Force
    Import-Module (Join-Path $LibPath 'Auth.psm1') -Force
    Import-Module (Join-Path $LibPath 'GraphClient.psm1') -Force

    Write-AppLog 'Fetching User Experience Analytics scores from Intune...'

    # --- Overview scores ---
    $overviewUri = 'https://graph.microsoft.com/v1.0/deviceManagement/userExperienceAnalyticsOverview'
    $overview = Invoke-GraphRequest -Method GET -Uri $overviewUri

    # Extract score fields - field names vary by tenant/API version; guard all accesses
    $startupScore          = if ($overview.PSObject.Properties['startupScore'])          { [double]$overview.startupScore }          else { -1 }
    $appReliabilityScore   = if ($overview.PSObject.Properties['appReliabilityScore'])   { [double]$overview.appReliabilityScore }   else { -1 }
    $batteryHealthScore    = if ($overview.PSObject.Properties['batteryHealthScore'])    { [double]$overview.batteryHealthScore }    else { -1 }
    $workFromAnywhereScore = if ($overview.PSObject.Properties['workFromAnywhereScore']) { [double]$overview.workFromAnywhereScore } else { -1 }

    $overviewObj = @{
        startupScore          = $startupScore
        appReliabilityScore   = $appReliabilityScore
        batteryHealthScore    = $batteryHealthScore
        workFromAnywhereScore = $workFromAnywhereScore
    }

    Write-AppLog 'Fetching UEA app health performance data...'

    # --- App health ---
    $appHealthUri = 'https://graph.microsoft.com/v1.0/deviceManagement/userExperienceAnalyticsAppHealthApplicationPerformance' +
                    '?$top=20&$orderby=crashCount desc'
    $appHealthRes = Invoke-GraphRequest -Method GET -Uri $appHealthUri

    $appHealthList = [System.Collections.Generic.List[object]]::new()
    if ($appHealthRes.PSObject.Properties['value'] -and $appHealthRes.value) {
        foreach ($item in $appHealthRes.value) {
            $appName      = if ($item.PSObject.Properties['appName'])           { [string]$item.appName }      else { '' }
            $appPublisher = if ($item.PSObject.Properties['appPublisher'])      { [string]$item.appPublisher } else { '' }
            $crashCount   = if ($item.PSObject.Properties['appCrashCount'])     { [int]$item.appCrashCount }   else { 0 }
            $hangCount    = if ($item.PSObject.Properties['appHangCount'])      { [int]$item.appHangCount }    else { 0 }
            $crashRate    = if ($item.PSObject.Properties['meanTimeToFailure']) { [double]$item.meanTimeToFailure } else { 0.0 }

            $appHealthList.Add(@{
                appName      = $appName
                appPublisher = $appPublisher
                crashCount   = $crashCount
                hangCount    = $hangCount
                crashRate    = $crashRate
            })
        }
    }

    Write-AppLog "UEA scores retrieved. App health records: $($appHealthList.Count)"
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $true; overview = $overviewObj; appHealth = @($appHealthList) } -Compress -Depth 5)"
} catch {
    $msg = $_.Exception.Message
    $isPermissionError = $msg -match '403' -or $msg -match 'Forbidden' -or $msg -match 'Authorization_RequestDenied'
    if ($isPermissionError) {
        Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; overview = $null; appHealth = @(); permissionError = $true; error = $msg } -Compress)"
    } else {
        Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; overview = $null; appHealth = @(); error = $msg } -Compress)"
    }
}
