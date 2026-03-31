#Requires -Version 5.1
param(
    [Parameter(Mandatory)] [string]$DeviceId,
    [Parameter(Mandatory)] [string]$DeviceName
)
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

try {
    $LibPath = Join-Path $PSScriptRoot '..\..\..\IntuneManager\Lib'
    Import-Module (Join-Path $LibPath 'Logger.psm1') -Force
    Import-Module (Join-Path $LibPath 'Auth.psm1') -Force
    Import-Module (Join-Path $LibPath 'GraphClient.psm1') -Force

    Write-AppLog "Requesting diagnostics for device: $DeviceName ($DeviceId)"

    # Graph action: createDeviceLogCollectionRequest — triggers diagnostic log collection
    $uri = "https://graph.microsoft.com/beta/deviceManagement/managedDevices/$DeviceId/createDeviceLogCollectionRequest"
    $body = @{
        '@odata.type' = '#microsoft.graph.deviceLogCollectionRequest'
        templateType  = 'predefined'
    }
    $result = Invoke-GraphRequest -Method POST -Uri $uri -Body $body

    $requestId = if ($result.PSObject.Properties['id']) { $result.id } else { 'unknown' }
    Write-AppLog "Diagnostics collection request created: $requestId"
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $true; requestId = $requestId } -Compress)"
} catch {
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; error = $_.Exception.Message } -Compress)"
}
