#Requires -Version 5.1
param(
    [string]$AppName,
    [string]$SourceRootPath = ''
)

$OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = 'Stop'

try {
    # Determine source root
    if (-not $SourceRootPath) {
        $SourceRootPath = Join-Path $PSScriptRoot '..\..\..\..\Source'
    }
    $SourceRootPath = [IO.Path]::GetFullPath($SourceRootPath)

    if (-not (Test-Path $SourceRootPath)) {
        Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; error = 'Source root not found' } -Compress)"
        exit 0
    }

    # Try to find a matching PACKAGE_SETTINGS.md
    # Match by folder name containing app name (case-insensitive, spaces removed)
    $safeAppName = $AppName -replace '\s+', ''
    $settingsFile = $null

    Get-ChildItem -Path $SourceRootPath -Directory | ForEach-Object {
        $folderName = $_.Name
        if ($folderName -eq $safeAppName -or $folderName -like "*$safeAppName*" -or $safeAppName -like "*$folderName*") {
            $candidate = Join-Path $_.FullName 'PACKAGE_SETTINGS.md'
            if (Test-Path $candidate) {
                $settingsFile = $candidate
                $sourceFolder = $_.FullName
            }
        }
    }

    if (-not $settingsFile) {
        Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; error = 'No PACKAGE_SETTINGS.md found' } -Compress)"
        exit 0
    }

    # Parse fields from PACKAGE_SETTINGS.md
    $version  = $null
    $wingetId = $null
    Get-Content $settingsFile | ForEach-Object {
        if ($_ -match '^\|\s*App Version\s*\|\s*(.+?)\s*\|') {
            $version = $Matches[1].Trim()
        }
        if ($_ -match '^\|\s*Winget ID\s*\|\s*(.+?)\s*\|') {
            $wingetId = $Matches[1].Trim()
        }
    }

    Write-Output "RESULT:$(ConvertTo-Json @{
        success      = $true
        version      = $version
        wingetId     = $wingetId
        sourceFolder = $sourceFolder
        settingsFile = $settingsFile
    } -Compress)"
} catch {
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; error = $_.Exception.Message } -Compress)"
}
