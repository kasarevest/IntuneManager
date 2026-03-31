#Requires -Version 5.1
param([string]$WingetId)

$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = 'Stop'

function Write-Log([string]$Message, [string]$Level = 'INFO') {
    Write-Output "LOG:[$Level] $Message"
}

try {
    Write-Log "Getting latest version for: $WingetId"

    $out = winget show --id $WingetId --exact --accept-source-agreements 2>&1
    $version = $null

    foreach ($line in $out) {
        if ($line -match '^Version:\s+(.+)$') {
            $version = $Matches[1].Trim()
            break
        }
    }

    if (-not $version) {
        # Fallback: search and grab first result
        $searchOut = winget search --id $WingetId --exact --accept-source-agreements 2>&1
        foreach ($line in $searchOut) {
            if ($line -match '\b(\d+\.\d+[\.\d]*)\b') {
                $version = $Matches[1]
                break
            }
        }
    }

    Write-Log "Latest version: $version"
    Write-Output "RESULT:$(ConvertTo-Json @{ version = $version; wingetId = $WingetId } -Compress)"
} catch {
    Write-Output "RESULT:$(ConvertTo-Json @{ version = $null; error = $_.Exception.Message } -Compress)"
}
