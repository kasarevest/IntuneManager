#Requires -Version 7.0
<#
.SYNOPSIS
    Creates a .intunewin package using SvRooij.ContentPrep (bundled with WinTuner).

.DESCRIPTION
    Delegates to SvRooij.ContentPrep.Packager — the same library used by WinTuner —
    which guarantees the output format is accepted by Intune.

    Output ZIP layout (produced by SvRooij.ContentPrep):
      IntuneWinPackage/Contents/IntunePackage.intunewin  — AES-256-CBC encrypted inner ZIP
      IntuneWinPackage/Metadata/Detection.xml            — encryption keys + file digest

.PARAMETER SourceFolder
    Path to the folder containing the application files.

.PARAMETER EntryPoint
    Full path to the setup file (e.g. /mnt/source/MyApp/setup.exe).

.PARAMETER OutputFolder
    Folder where the .intunewin file will be written.

.OUTPUTS
    RESULT:{success,intunewinPath,sizeMB} on stdout (parsed by ps-bridge).
#>
param(
    [Parameter(Mandatory)] [string]$SourceFolder,
    [Parameter(Mandatory)] [string]$EntryPoint,
    [Parameter(Mandatory)] [string]$OutputFolder
)

$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

function Write-Log([string]$Message, [string]$Level = 'INFO') {
    Write-Output "LOG:[$Level] $Message"
}

try {
    # ── Validate inputs ───────────────────────────────────────────────────────
    if (-not (Test-Path $SourceFolder -PathType Container)) {
        throw "Source folder not found: $SourceFolder"
    }
    if (-not (Test-Path $EntryPoint)) {
        throw "Entry point not found: $EntryPoint"
    }
    if (-not (Test-Path $OutputFolder)) {
        New-Item -ItemType Directory -Path $OutputFolder -Force | Out-Null
    }

    $appName   = [System.IO.Path]::GetFileName($SourceFolder.TrimEnd('/\'))
    $setupFile = [System.IO.Path]::GetFileName($EntryPoint)

    Write-Log "Packaging: $appName"
    Write-Log "  Source:     $SourceFolder"
    Write-Log "  EntryPoint: $setupFile"
    Write-Log "  Output:     $OutputFolder"

    # ── Delete existing .intunewin for this app (overwrite) ──────────────────
    $existingFile = Join-Path $OutputFolder "${appName}.intunewin"
    if (Test-Path $existingFile) {
        Remove-Item $existingFile -Force
        Write-Log "Removed existing package: $existingFile"
    }

    # ── Load SvRooij.ContentPrep from the installed WinTuner module ───────────
    $wtModule = Get-Module -ListAvailable WinTuner |
        Sort-Object Version -Descending | Select-Object -First 1
    if (-not $wtModule) {
        throw 'WinTuner module not found. Run: Install-Module WinTuner -Scope AllUsers'
    }

    $contentPrepDll = Join-Path $wtModule.ModuleBase 'SvRooij.ContentPrep.dll'
    if (-not (Test-Path $contentPrepDll)) {
        throw "SvRooij.ContentPrep.dll not found in WinTuner module at: $($wtModule.ModuleBase)"
    }

    Add-Type -Path $contentPrepDll

    # ── Package using the official SvRooij.ContentPrep.Packager ──────────────
    Write-Log "Calling SvRooij.ContentPrep.Packager (WinTuner $($wtModule.Version))..."

    $details           = [SvRooij.ContentPrep.Models.ApplicationDetails]::new()
    $details.Name      = $appName
    $details.SetupFile = $setupFile

    $packager = [SvRooij.ContentPrep.Packager]::new()
    $packager.CreatePackage(
        $SourceFolder,
        $EntryPoint,
        $OutputFolder,
        $details,
        [System.Threading.CancellationToken]::None
    ).GetAwaiter().GetResult() | Out-Null

    # ── Locate the output file ────────────────────────────────────────────────
    $intunewinFile = Get-ChildItem -Path $OutputFolder -Filter '*.intunewin' -File |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1

    if (-not $intunewinFile) {
        throw '.intunewin file not produced in output folder'
    }

    $sizeMB = [Math]::Round($intunewinFile.Length / 1MB, 2)
    Write-Log "Package created: $($intunewinFile.FullName) ($sizeMB MB)"

    Write-Output "RESULT:$(ConvertTo-Json @{
        success       = $true
        intunewinPath = $intunewinFile.FullName
        sizeMB        = $sizeMB
    } -Compress)"

} catch {
    Write-Log "Packaging failed: $($_.Exception.Message)" 'ERROR'
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; error = $_.Exception.Message } -Compress)"
}
