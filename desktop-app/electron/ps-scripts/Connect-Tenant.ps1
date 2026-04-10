#Requires -Version 5.1
param([switch]$DeviceCode)

$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = 'Stop'

try {
    $LibPath = Join-Path $PSScriptRoot '..\..\..\IntuneManager\Lib'
    Import-Module (Join-Path $LibPath 'Logger.psm1') -Force
    Import-Module (Join-Path $LibPath 'Auth.psm1') -Force

    # Try silent refresh first (works if refresh token is still valid — no browser needed)
    $silentToken = $null
    if (-not $DeviceCode) {
        try { $silentToken = Get-CachedToken } catch {}
    }

    if (-not $silentToken) {
        # Silent failed or DeviceCode requested — do interactive login
        $connectParams = @{}
        if ($DeviceCode) { $connectParams['DeviceCode'] = $true }
        Connect-IntuneManager @connectParams | Out-Null
    }

    # Get full status (works whether we went through silent or interactive)
    $status = Get-AuthStatus
    Write-Output "RESULT:$(ConvertTo-Json @{
        success     = $true
        username    = $status.Username
        tenantId    = $status.TenantId
        tokenExpiry = if ($status.TokenExpiry) { $status.TokenExpiry.ToString('o') } else { $null }
    } -Compress)"
} catch {
    Write-Output "RESULT:$(ConvertTo-Json @{
        success = $false
        error   = $_.Exception.Message
    } -Compress)"
}
