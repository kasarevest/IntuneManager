#Requires -Version 5.1
param([string]$AppId, [string]$BodyJson, [string]$AccessToken = '')

$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = 'Stop'

function Write-Log([string]$Message, [string]$Level = 'INFO') {
    Write-Output "LOG:[$Level] $Message"
}

try {
    $LibPath = Join-Path $PSScriptRoot '..\..\..\IntuneManager\Lib'
    Import-Module (Join-Path $LibPath 'Logger.psm1') -Force
    Import-Module (Join-Path $LibPath 'Auth.psm1') -Force
    Import-Module (Join-Path $LibPath 'GraphClient.psm1') -Force
    if ($AccessToken) { Set-GraphAccessToken -Token $AccessToken }

    $body = $BodyJson | ConvertFrom-Json

    Write-Log "Updating Intune app: $AppId"
    Update-Win32App -AppId $AppId -Body $body

    Write-Log "App updated: $AppId"
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $true; appId = $AppId } -Compress)"
} catch {
    Write-Log "Failed to update app: $($_.Exception.Message)" 'ERROR'
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; error = $_.Exception.Message } -Compress)"
}
