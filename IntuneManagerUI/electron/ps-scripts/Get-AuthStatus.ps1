#Requires -Version 5.1
$OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = 'Stop'

try {
    $LibPath = Join-Path $PSScriptRoot '..\..\..\IntuneManager\Lib'
    Import-Module (Join-Path $LibPath 'Logger.psm1') -Force
    Import-Module (Join-Path $LibPath 'Auth.psm1') -Force

    $status = Get-AuthStatus

    $expiresIn = $null
    if ($status.TokenExpiry) {
        try {
            $diff = ([datetime]$status.TokenExpiry) - (Get-Date)
            $expiresIn = [int]$diff.TotalMinutes
        } catch {}
    }

    Write-Output "RESULT:$(ConvertTo-Json @{
        isConnected   = [bool]$status.IsConnected
        username      = $status.Username
        tenantId      = $status.TenantId
        expiresInMinutes = $expiresIn
    } -Compress)"
} catch {
    Write-Output "RESULT:$(ConvertTo-Json @{ isConnected = $false } -Compress)"
}
