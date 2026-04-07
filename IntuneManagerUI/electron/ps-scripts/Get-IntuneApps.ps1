#Requires -Version 5.1
param([string]$AccessToken = '')
$OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = 'Stop'

try {
    $LibPath = Join-Path $PSScriptRoot '..\..\..\IntuneManager\Lib'
    Import-Module (Join-Path $LibPath 'Logger.psm1') -Force
    Import-Module (Join-Path $LibPath 'Auth.psm1') -Force
    Import-Module (Join-Path $LibPath 'GraphClient.psm1') -Force
    if ($AccessToken) { Set-GraphAccessToken -Token $AccessToken }

    $apps = Get-IntuneWin32Apps

    $appList = $apps | ForEach-Object {
        @{
            id                   = $_.id
            displayName          = $_.displayName
            displayVersion       = $_.displayVersion
            publishingState      = $_.publishingState
            lastModifiedDateTime = $_.lastModifiedDateTime
        }
    }

    Write-Output "RESULT:$(ConvertTo-Json @{ success = $true; apps = @($appList) } -Compress -Depth 5)"
} catch {
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; error = $_.Exception.Message } -Compress)"
}
