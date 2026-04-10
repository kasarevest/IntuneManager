#Requires -Version 7.0
param(
    [Parameter(Mandatory)] [string]$PackageId,
    [Parameter(Mandatory)] [string]$GraphId,
    [Parameter(Mandatory)] [string]$PackageFolder,
    [string]$Version     = '',
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

    if (-not (Test-Path $PackageFolder)) {
        New-Item -Path $PackageFolder -ItemType Directory -Force | Out-Null
    }

    Import-Module WinTuner -Force
    Connect-WtWinTuner -Token $AccessToken

    Write-Log "Updating app $GraphId: $PackageId$(if ($Version) { " → v$Version" })"

    $wtArgs = @{
        PackageId     = $PackageId
        PackageFolder = $PackageFolder
    }
    if ($Version) { $wtArgs.Version = $Version }

    # WinTuner pipeline: create package then deploy over the existing app
    New-WtWingetPackage @wtArgs |
        Deploy-WtWin32App -GraphId $GraphId -KeepAssignments

    Write-Log "Update deployed successfully for $PackageId"
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $true; graphId = $GraphId } -Compress)"
} catch {
    Write-Log "Update failed: $($_.Exception.Message)" 'ERROR'
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; error = $_.Exception.Message } -Compress)"
}
