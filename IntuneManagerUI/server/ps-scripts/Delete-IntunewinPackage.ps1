#Requires -Version 7.0
param(
    [Parameter(Mandatory)] [string]$IntunewinPath
)
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

function Write-Log([string]$Message, [string]$Level = 'INFO') {
    Write-Output "LOG:[$Level] $Message"
}

try {
    if (-not $IntunewinPath.EndsWith('.intunewin')) {
        throw "Path must end in .intunewin: $IntunewinPath"
    }
    if (-not (Test-Path $IntunewinPath)) {
        throw "File not found: $IntunewinPath"
    }

    Remove-Item -Path $IntunewinPath -Force
    Write-Log "Deleted: $IntunewinPath"

    Write-Output "RESULT:$(ConvertTo-Json @{ success = $true; path = $IntunewinPath } -Compress)"
} catch {
    Write-Log "Delete failed: $($_.Exception.Message)" 'ERROR'
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; error = $_.Exception.Message } -Compress)"
}
