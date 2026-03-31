#Requires -Version 5.1
param([string]$Query)

$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = 'Stop'

function Write-Log([string]$Message, [string]$Level = 'INFO') {
    Write-Output "LOG:[$Level] $Message"
}

try {
    Write-Log "Searching winget for: $Query"

    # Try JSON output first (winget 1.5+)
    $jsonOut = winget search --query $Query --output json --accept-source-agreements 2>$null
    $results = @()

    if ($jsonOut) {
        try {
            $parsed = $jsonOut | ConvertFrom-Json
            $results = $parsed.Sources | ForEach-Object { $_.Packages } | ForEach-Object {
                @{
                    id        = $_.PackageIdentifier
                    name      = $_.Name
                    version   = $_.Version
                    source    = 'winget'
                    publisher = ''
                }
            }
        } catch { $jsonOut = $null }
    }

    # Fallback: text parse
    if (-not $results -or $results.Count -eq 0) {
        $textOut = winget search --query $Query --accept-source-agreements 2>&1
        $lines = $textOut | Where-Object { $_ -match '\S' }
        # Skip header line (starts with 'Name') and separator line (all dashes/spaces)
        $dataLines = $lines | Where-Object { $_ -notmatch '^[-\s]+$' -and $_ -notmatch '^\s*Name\s' }
        foreach ($line in $dataLines) {
            $parts = $line -split '\s{2,}'
            if ($parts.Count -ge 2 -and $parts[1].Trim() -match '\.') {
                # Only include lines where the second column looks like a package ID (contains a dot)
                $results += @{
                    id      = $parts[1].Trim()
                    name    = $parts[0].Trim()
                    version = if ($parts.Count -ge 3) { $parts[2].Trim() } else { '' }
                    source  = 'winget'
                    publisher = ''
                }
            }
        }
    }

    Write-Log "Found $($results.Count) winget result(s)"
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $true; results = @($results) } -Compress -Depth 5)"
} catch {
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; results = @(); error = $_.Exception.Message } -Compress)"
}
