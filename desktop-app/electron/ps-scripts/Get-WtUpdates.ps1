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

    Import-Module WinTuner -Force
    Connect-WtWinTuner -Token $AccessToken

    Write-Log 'Checking for Win32 app updates via WinTuner...'

    $updatedApps = $null
    $maxRetries  = 3
    for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
        try {
            $updatedApps = @(Get-WtWin32Apps -Update $true -Superseded $false)
            break
        } catch {
            if ($_.Exception.Message -like '*Collection was modified*' -and $attempt -lt $maxRetries) {
                Write-Log "Transient error, retrying ($attempt/$maxRetries)..." 'WARN'
                Start-Sleep -Seconds 2
            } else {
                throw
            }
        }
    }

    Write-Log "Found $($updatedApps.Count) app(s) with available updates"

    $updateList = $updatedApps | ForEach-Object {
        @{
            name           = [string]$_.Name
            packageId      = [string]$_.PackageId
            currentVersion = [string]$_.CurrentVersion
            latestVersion  = [string]$_.LatestVersion
            graphId        = [string]$_.GraphId
        }
    }

    Write-Output "RESULT:$(ConvertTo-Json @{ success = $true; updates = @($updateList) } -Compress -Depth 5)"
} catch {
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; updates = @(); error = $_.Exception.Message } -Compress)"
}
