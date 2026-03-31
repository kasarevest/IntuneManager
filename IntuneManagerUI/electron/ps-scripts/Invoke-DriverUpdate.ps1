#Requires -Version 5.1
param(
    [Parameter(Mandatory)] [string]$DeviceId
)
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

try {
    $LibPath = Join-Path $PSScriptRoot '..\..\..\IntuneManager\Lib'
    Import-Module (Join-Path $LibPath 'Logger.psm1') -Force
    Import-Module (Join-Path $LibPath 'Auth.psm1') -Force
    Import-Module (Join-Path $LibPath 'GraphClient.psm1') -Force

    Write-AppLog "Triggering driver update sync for device: $DeviceId"

    # syncDevice forces the device to check in with Intune and pull pending
    # driver update policies. Graph does not have a separate driver-update-only
    # action endpoint; a full sync picks up all pending updates including drivers.
    $uri = "https://graph.microsoft.com/beta/deviceManagement/managedDevices/$DeviceId/syncDevice"
    Invoke-GraphRequest -Method POST -Uri $uri | Out-Null

    Write-AppLog 'Driver update sync triggered successfully'
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $true } -Compress)"
} catch {
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; error = $_.Exception.Message } -Compress)"
}
