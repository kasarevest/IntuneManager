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

    Write-Log 'Fetching User Experience Analytics scores from Intune...'

    $headers = @{ Authorization = "Bearer $AccessToken" }

    $overviewUri = 'https://graph.microsoft.com/v1.0/deviceManagement/userExperienceAnalyticsOverview'
    $overview = Invoke-RestMethod -Method GET -Uri $overviewUri -Headers $headers

    $startupScore          = if ($null -ne $overview.startupScore)          { [double]$overview.startupScore }          else { -1 }
    $appReliabilityScore   = if ($null -ne $overview.appReliabilityScore)   { [double]$overview.appReliabilityScore }   else { -1 }
    $batteryHealthScore    = if ($null -ne $overview.batteryHealthScore)    { [double]$overview.batteryHealthScore }    else { -1 }
    $workFromAnywhereScore = if ($null -ne $overview.workFromAnywhereScore) { [double]$overview.workFromAnywhereScore } else { -1 }

    $overviewObj = @{
        startupScore          = $startupScore
        appReliabilityScore   = $appReliabilityScore
        batteryHealthScore    = $batteryHealthScore
        workFromAnywhereScore = $workFromAnywhereScore
    }

    Write-Log 'Fetching UEA app health performance data...'

    $appHealthUri = 'https://graph.microsoft.com/v1.0/deviceManagement/userExperienceAnalyticsAppHealthApplicationPerformance' +
                    '?$top=20&$orderby=crashCount desc'
    $appHealthRes = Invoke-RestMethod -Method GET -Uri $appHealthUri -Headers $headers

    $appHealthList = [System.Collections.Generic.List[object]]::new()
    if ($appHealthRes.value) {
        foreach ($item in $appHealthRes.value) {
            $appHealthList.Add(@{
                appName      = [string]($item.appName ?? '')
                appPublisher = [string]($item.appPublisher ?? '')
                crashCount   = [int]($item.appCrashCount ?? 0)
                hangCount    = [int]($item.appHangCount ?? 0)
                crashRate    = [double]($item.meanTimeToFailure ?? 0.0)
            })
        }
    }

    Write-Log "UEA scores retrieved. App health records: $($appHealthList.Count)"
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
