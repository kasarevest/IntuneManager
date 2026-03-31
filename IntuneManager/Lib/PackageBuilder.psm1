#Requires -Version 5.1
<#
.SYNOPSIS
    Orchestrates IntuneWinAppUtil.exe to build .intunewin packages.
    Streams stdout lines in real time via the shared Dispatcher.
    Returns the output .intunewin path on success; throws on failure.
#>

Set-StrictMode -Version Latest

function Invoke-PackageBuild {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string]$SourceFolder,
        [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string]$EntryPoint,
        [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string]$OutputFolder,
        [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string]$ToolPath,
        # Optional: called with each log line for real-time UI streaming
        [scriptblock]$OnLogLine,
        # SharedState hashtable passed from Dispatcher -- checked for CancelRequested
        [hashtable]$SharedState
    )

    #region Validation
    # Prevent path traversal
    $resolvedSource = [System.IO.Path]::GetFullPath($SourceFolder)
    $resolvedEntry  = [System.IO.Path]::GetFullPath($EntryPoint)
    $resolvedOutput = [System.IO.Path]::GetFullPath($OutputFolder)
    $resolvedTool   = [System.IO.Path]::GetFullPath($ToolPath)

    if (-not (Test-Path $resolvedSource -PathType Container)) {
        throw "Source folder not found: $resolvedSource"
    }
    if (-not (Test-Path $resolvedEntry -PathType Leaf)) {
        throw "Entry point script not found: $resolvedEntry"
    }
    if (-not $resolvedEntry.StartsWith($resolvedSource, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Entry point must be inside the source folder (path traversal check failed)"
    }
    if (-not (Test-Path $resolvedTool -PathType Leaf)) {
        throw "IntuneWinAppUtil.exe not found at: $resolvedTool"
    }
    if (-not (Test-Path $resolvedOutput -PathType Container)) {
        New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null
    }

    $entryFileName = [System.IO.Path]::GetFileName($resolvedEntry)
    #endregion

    Write-AppLog "Starting package build: $entryFileName from $resolvedSource"

    # Redirect stdout/stderr to temp files -- avoids -q buffering issue
    $stdoutFile = [System.IO.Path]::GetTempFileName()
    $stderrFile = [System.IO.Path]::GetTempFileName()

    $procArgs = "-c `"$resolvedSource`" -s `"$entryFileName`" -o `"$resolvedOutput`""
    # Intentionally NOT using -q so we get real-time stdout

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName               = $resolvedTool
    $psi.Arguments              = $procArgs
    $psi.UseShellExecute        = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    $psi.CreateNoWindow         = $true
    $psi.WorkingDirectory       = Split-Path $resolvedSource -Parent

    $proc = [System.Diagnostics.Process]::new()
    $proc.StartInfo = $psi

    # Collect stderr async
    $stderrLines = [System.Collections.Concurrent.ConcurrentBag[string]]::new()
    $proc.add_ErrorDataReceived({
        param($s, $e)
        if ($e.Data) { $stderrLines.Add($e.Data) }
    })

    $proc.Start() | Out-Null
    $proc.BeginErrorReadLine()

    # Stream stdout line by line
    $stdoutLines = [System.Collections.Generic.List[string]]::new()
    $foundDone   = $false
    $foundError  = $false

    while (-not $proc.StandardOutput.EndOfStream) {
        if ($SharedState -and $SharedState['CancelRequested']) {
            try { $proc.Kill() } catch {}
            throw "Package build cancelled by user"
        }

        $line = $proc.StandardOutput.ReadLine()
        if ($null -eq $line) { break }

        $stdoutLines.Add($line)
        Write-AppLog $line

        if ($OnLogLine) {
            try { & $OnLogLine $line } catch {}
        }

        if ($line -match 'Done!!!') { $foundDone  = $true }
        if ($line -match '\bERROR\b') { $foundError = $true }
    }

    $proc.WaitForExit(60000) | Out-Null
    $exitCode = $proc.ExitCode

    # Expected output file name: based on entry point (e.g. Install-Camtasia.intunewin)
    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($entryFileName)
    $outputFile = Join-Path $resolvedOutput "$baseName.intunewin"

    if ($exitCode -ne 0) {
        $stderrText = $stderrLines -join '; '
        throw "IntuneWinAppUtil.exe exited with code $exitCode. Stderr: $stderrText"
    }
    if ($foundError) {
        $errorLines = $stdoutLines | Where-Object { $_ -match '\bERROR\b' }
        throw "IntuneWinAppUtil.exe reported ERROR(s): $($errorLines -join '; ')"
    }
    if (-not $foundDone) {
        throw "IntuneWinAppUtil.exe did not output 'Done!!!' -- package may be incomplete"
    }
    if (-not (Test-Path $outputFile)) {
        # Fallback: look for any .intunewin created in the last 5 minutes
        $recent = Get-ChildItem $resolvedOutput -Filter '*.intunewin' -ErrorAction SilentlyContinue |
                  Where-Object { $_.LastWriteTime -gt (Get-Date).AddMinutes(-5) } |
                  Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($recent) {
            $outputFile = $recent.FullName
        } else {
            throw "Output .intunewin file not found at expected path: $outputFile"
        }
    }

    $sizeMB = [math]::Round((Get-Item $outputFile).Length / 1MB, 2)
    Write-AppLog "Package built successfully: $outputFile ($sizeMB MB)"
    return $outputFile
}

Export-ModuleMember -Function Invoke-PackageBuild
