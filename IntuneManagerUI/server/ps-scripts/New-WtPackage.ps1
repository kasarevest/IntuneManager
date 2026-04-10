#Requires -Version 7.0
param(
    [Parameter(Mandatory)] [string]$PackageId,
    [Parameter(Mandatory)] [string]$PackageFolder,
    [string]$Version              = '',
    [string]$AccessToken          = '',
    [string]$ExpectedModuleHash   = ''
)
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

function Write-Log([string]$Message, [string]$Level = 'INFO') {
    Write-Output "LOG:[$Level] $Message"
}

try {
    if (-not $AccessToken) { throw 'AccessToken is required' }

    # Ensure destination folder exists
    if (-not (Test-Path $PackageFolder)) {
        New-Item -Path $PackageFolder -ItemType Directory -Force | Out-Null
        Write-Log "Created package folder: $PackageFolder"
    }

    if ($ExpectedModuleHash) {
        $mod = Get-Module WinTuner -ListAvailable | Sort-Object Version -Descending | Select-Object -First 1
        if (-not $mod) { throw 'WinTuner module not found for hash verification' }
        $psd1 = Join-Path $mod.ModuleBase 'WinTuner.psd1'
        $actualHash = (Get-FileHash -Path $psd1 -Algorithm SHA256).Hash
        if ($actualHash -ne $ExpectedModuleHash.ToUpper()) {
            throw "WinTuner module hash mismatch! Expected: $ExpectedModuleHash, Got: $actualHash"
        }
        Write-Log "WinTuner module hash verified OK"
    }

    Import-Module WinTuner -Force
    Connect-WtWinTuner -Token $AccessToken

    Write-Log "Creating WinGet package: $PackageId$(if ($Version) { " v$Version" })"

    $wtArgs = @{
        PackageId     = $PackageId
        PackageFolder = $PackageFolder
    }
    if ($Version) { $wtArgs.Version = $Version }

    New-WtWingetPackage @wtArgs

    # Find the app.json WinTuner created (may be in a subfolder)
    $appJsonFile = Get-ChildItem -Path $PackageFolder -Filter 'app.json' -Recurse -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    $outFolder = if ($appJsonFile) { $appJsonFile.Directory.FullName } else { $PackageFolder }

    # Find .intunewin in the output folder
    $intunewinFile = Get-ChildItem -Path $outFolder -Filter '*.intunewin' -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    $intunewinPath = if ($intunewinFile) { $intunewinFile.FullName } else { $null }

    Write-Log "Package ready at: $outFolder"
    if ($intunewinPath) { Write-Log "IntuneWin: $intunewinPath" }

    Write-Output "RESULT:$(ConvertTo-Json @{
        success       = $true
        packageFolder = $outFolder
        intunewinPath = $intunewinPath
        appJsonPath   = if ($appJsonFile) { $appJsonFile.FullName } else { $null }
    } -Compress -Depth 3)"
} catch {
    Write-Log "New-WtWingetPackage failed: $($_.Exception.Message)" 'ERROR'
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; error = $_.Exception.Message } -Compress)"
}
