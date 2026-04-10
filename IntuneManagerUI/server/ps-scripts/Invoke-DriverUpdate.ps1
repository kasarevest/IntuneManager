#Requires -Version 7.0
param(
    [Parameter(Mandatory)] [string]$DeviceId,
    [string]$AccessToken = ''
)
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

function Write-Log([string]$Message, [string]$Level = 'INFO') {
    Write-Output "LOG:[$Level] $Message"
}

try {
    if (-not $AccessToken) { throw 'AccessToken is required' }

    Write-Log "Triggering driver update sync for device: $DeviceId"

    $headers = @{ Authorization = "Bearer $AccessToken" }
    $uri = "https://graph.microsoft.com/beta/deviceManagement/managedDevices/$DeviceId/syncDevice"
    Invoke-RestMethod -Method POST -Uri $uri -Headers $headers | Out-Null

    Write-Log 'Driver update sync triggered successfully'
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $true } -Compress)"
} catch {
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; error = $_.Exception.Message } -Compress)"
}
