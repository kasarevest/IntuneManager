#Requires -Version 7.0
param(
    [Parameter(Mandatory)] [string]$DeviceId,
    [Parameter(Mandatory)] [string]$DeviceName,
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

    Write-Log "Requesting diagnostics for device: $DeviceName ($DeviceId)"

    $headers = @{
        Authorization  = "Bearer $AccessToken"
        'Content-Type' = 'application/json'
    }

    $uri = "https://graph.microsoft.com/beta/deviceManagement/managedDevices/$DeviceId/createDeviceLogCollectionRequest"
    $body = ConvertTo-Json @{
        '@odata.type' = '#microsoft.graph.deviceLogCollectionRequest'
        templateType  = 'predefined'
    } -Compress

    $result = Invoke-RestMethod -Method POST -Uri $uri -Headers $headers -Body $body

    $requestId = if ($result.id) { [string]$result.id } else { 'unknown' }
    Write-Log "Diagnostics collection request created: $requestId"
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $true; requestId = $requestId } -Compress)"
} catch {
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; error = $_.Exception.Message } -Compress)"
}
