#Requires -Version 5.1
$OutputEncoding = [System.Text.Encoding]::UTF8

try {
    $LibPath = Join-Path $PSScriptRoot '..\..\..\IntuneManager\Lib'
    Import-Module (Join-Path $LibPath 'Logger.psm1') -Force
    Import-Module (Join-Path $LibPath 'Auth.psm1') -Force
    Disconnect-IntuneManager
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $true } -Compress)"
} catch {
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $true } -Compress)"  # non-fatal
}
