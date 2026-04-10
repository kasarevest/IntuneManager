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

    Write-Log 'Fetching Win32 apps from Intune...'

    $headers = @{ Authorization = "Bearer $AccessToken" }
    $uri = "https://graph.microsoft.com/v1.0/deviceAppManagement/mobileApps" +
           "?`$filter=isOf('microsoft.graph.win32LobApp')&`$select=id,displayName,displayVersion,publishingState,lastModifiedDateTime&`$top=999"

    $allApps = [System.Collections.Generic.List[object]]::new()
    $nextUri = $uri
    while ($nextUri) {
        $response = Invoke-RestMethod -Method GET -Uri $nextUri -Headers $headers
        if ($response.value) { $allApps.AddRange([object[]]$response.value) }
        $nextUri = $response.'@odata.nextLink'
    }

    Write-Log "Retrieved $($allApps.Count) Win32 app(s)"

    $appList = $allApps | ForEach-Object {
        @{
            id                   = [string]$_.id
            displayName          = [string]$_.displayName
            displayVersion       = if ($null -ne $_.displayVersion) { [string]$_.displayVersion } else { '' }
            publishingState      = if ($null -ne $_.publishingState) { [string]$_.publishingState } else { '' }
            lastModifiedDateTime = if ($null -ne $_.lastModifiedDateTime) { [string]$_.lastModifiedDateTime } else { '' }
        }
    }

    Write-Output "RESULT:$(ConvertTo-Json @{ success = $true; apps = @($appList) } -Compress -Depth 5)"
} catch {
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; error = $_.Exception.Message } -Compress)"
}
