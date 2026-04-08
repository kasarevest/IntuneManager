#Requires -Version 5.1
param(
    [string]$SourceFolder,
    [string]$EntryPoint,
    [string]$OutputFolder,
    [string]$ToolPath = ''
)

$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = 'Stop'

function Write-Log([string]$Message, [string]$Level = 'INFO') {
    Write-Output "LOG:[$Level] $Message"
}

try {
    # Resolve tool path — try configured path first, then common fallback locations
    $resolvedTool = $null

    $candidates = @()
    if ($ToolPath) {
        $candidates += [IO.Path]::GetFullPath($ToolPath)
    }
    # Relative to ps-scripts: 3 levels up lands at "Intune MSI Prep\" root
    $candidates += [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\IntuneWinAppUtil.exe'))
    # 2 levels up (IntuneManagerUI root)
    $candidates += [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\IntuneWinAppUtil.exe'))
    # Same folder as script
    $candidates += Join-Path $PSScriptRoot 'IntuneWinAppUtil.exe'
    # Desktop
    $candidates += Join-Path ([Environment]::GetFolderPath('Desktop')) 'IntuneWinAppUtil.exe'
    # User Downloads
    $candidates += Join-Path $env:USERPROFILE 'Downloads\IntuneWinAppUtil.exe'
    # Intune MSI Prep on Desktop
    $candidates += Join-Path ([Environment]::GetFolderPath('Desktop')) 'Intune MSI Prep\IntuneWinAppUtil.exe'

    foreach ($c in $candidates) {
        if (Test-Path $c) { $resolvedTool = $c; break }
    }

    # Last resort: search PATH
    if (-not $resolvedTool) {
        $inPath = Get-Command 'IntuneWinAppUtil.exe' -ErrorAction SilentlyContinue
        if ($inPath) { $resolvedTool = $inPath.Source }
    }

    if (-not $resolvedTool) {
        # PS7 fallback: use cross-platform Create-IntuneWin.ps1 when running on Linux/pwsh 7
        if ($PSVersionTable.PSVersion.Major -ge 7) {
            $createScript = Join-Path $PSScriptRoot 'Create-IntuneWin.ps1'
            if (Test-Path $createScript) {
                Write-Log "IntuneWinAppUtil.exe not found — using native PS7 packager"
                & $createScript -SourceFolder $SourceFolder -EntryPoint $EntryPoint -OutputFolder $OutputFolder
                return
            }
        }
        $tried = ($candidates | Select-Object -Unique) -join "`n  "
        throw "IntuneWinAppUtil.exe not found. Searched:`n  $tried`n`nPlease set the correct path in Settings → General → Paths."
    }

    $ToolPath = $resolvedTool
    Write-Log "Using tool: $ToolPath"

    if (-not (Test-Path $SourceFolder)) {
        throw "Source folder not found: $SourceFolder"
    }
    if (-not (Test-Path $EntryPoint)) {
        throw "Entry point not found: $EntryPoint"
    }
    if (-not (Test-Path $OutputFolder)) {
        New-Item -ItemType Directory -Path $OutputFolder -Force | Out-Null
    }

    Write-Log "Building package..."
    Write-Log "  Source:     $SourceFolder"
    Write-Log "  EntryPoint: $EntryPoint"
    Write-Log "  Output:     $OutputFolder"

    $tmpOut = [IO.Path]::GetTempFileName()
    $tmpErr = [IO.Path]::GetTempFileName()

    $proc = Start-Process -FilePath $ToolPath `
        -ArgumentList @('-c', "`"$SourceFolder`"", '-s', "`"$EntryPoint`"", '-o', "`"$OutputFolder`"", '-q') `
        -RedirectStandardOutput $tmpOut `
        -RedirectStandardError  $tmpErr `
        -PassThru -Wait -NoNewWindow

    # Stream output
    if (Test-Path $tmpOut) {
        Get-Content $tmpOut | ForEach-Object { if ($_) { Write-Log $_ } }
        Remove-Item $tmpOut -Force
    }
    if (Test-Path $tmpErr) {
        Get-Content $tmpErr | ForEach-Object { if ($_) { Write-Log $_ 'DEBUG' } }
        Remove-Item $tmpErr -Force
    }

    if ($proc.ExitCode -ne 0) {
        throw "IntuneWinAppUtil.exe exited with code $($proc.ExitCode)"
    }

    # Find the generated .intunewin file
    $entryBaseName = [IO.Path]::GetFileNameWithoutExtension($EntryPoint)
    $intunewin = Get-ChildItem -Path $OutputFolder -Filter "*.intunewin" |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1

    if (-not $intunewin) {
        throw "No .intunewin file found in output folder after build"
    }

    Write-Log "Package built: $($intunewin.FullName)"
    Write-Output "RESULT:$(ConvertTo-Json @{
        success       = $true
        intunewinPath = $intunewin.FullName
        sizeMB        = [Math]::Round($intunewin.Length / 1MB, 2)
    } -Compress)"
} catch {
    Write-Log "Build failed: $($_.Exception.Message)" 'ERROR'
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; error = $_.Exception.Message } -Compress)"
}
