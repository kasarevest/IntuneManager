#Requires -Version 5.1
<#
.SYNOPSIS
    Thread-safe logger for IntuneManager. Writes to the WPF LogTextBox (via Dispatcher)
    and to %APPDATA%\IntuneManager\session.log.
#>

Set-StrictMode -Version Latest

#region Private state
$script:LogTextBox  = $null   # Set by MainWindow after UI init
$script:Dispatcher  = $null   # Set by Main.ps1 after Window created
$script:LogFilePath = $null   # Set during Initialize-Logger
$script:LogLock     = [System.Object]::new()  # file write serialization
#endregion

#region Public API

function Initialize-Logger {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]$LogDirectory
    )
    if (-not (Test-Path $LogDirectory)) {
        New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
    }
    # Write-access test
    $testFile = Join-Path $LogDirectory 'write_test.tmp'
    try {
        [IO.File]::WriteAllText($testFile, 'test')
        Remove-Item $testFile -Force
    } catch {
        throw "Logger cannot write to log directory '$LogDirectory': $($_.Exception.Message)"
    }
    $script:LogFilePath = Join-Path $LogDirectory 'session.log'
    # Stamp session start
    $stamp = "===== Session started $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ====="
    [System.IO.File]::AppendAllText($script:LogFilePath, "$stamp`r`n")
}

function Set-LogTextBox {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] $TextBox,
        [Parameter(Mandatory)] $Dispatcher
    )
    $script:LogTextBox = $TextBox
    $script:Dispatcher = $Dispatcher
}

function Write-AppLog {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string]$Message,
        [ValidateSet('INFO','WARN','ERROR','DEBUG')] [string]$Level = 'INFO'
    )

    $timestamp = Get-Date -Format 'HH:mm:ss'
    $line      = "[$timestamp] [$Level] $Message"

    # Write to file (thread-safe via lock)
    if ($script:LogFilePath) {
        [System.Threading.Monitor]::Enter($script:LogLock)
        try {
            [System.IO.File]::AppendAllText($script:LogFilePath, "$line`r`n")
        } finally {
            [System.Threading.Monitor]::Exit($script:LogLock)
        }
    }

    # Write to UI TextBox
    if ($script:LogTextBox -and $script:Dispatcher) {
        $capturedLine = $line
        $capturedBox  = $script:LogTextBox
        $uiAction = [System.Action]{
            $capturedBox.AppendText("$capturedLine`n")
            $capturedBox.ScrollToEnd()
        }
        try {
            # If called from UI thread, invoke directly; otherwise use Dispatcher
            if ($script:Dispatcher.CheckAccess()) {
                & $uiAction
            } else {
                $script:Dispatcher.Invoke($uiAction)
            }
        } catch {
            # Swallow UI write errors -- don't let logger failures crash the app
        }
    } else {
        # Pre-UI or console mode -- write to host
        Write-Host $line
    }
}

function Clear-AppLog {
    [CmdletBinding()]
    param()
    if ($script:LogTextBox -and $script:Dispatcher) {
        $capturedBox = $script:LogTextBox
        $script:Dispatcher.Invoke([System.Action]{ $capturedBox.Clear() })
    }
}

function Copy-AppLog {
    [CmdletBinding()]
    param()
    if ($script:LogTextBox -and $script:Dispatcher) {
        $capturedBox = $script:LogTextBox
        $script:Dispatcher.Invoke([System.Action]{ $capturedBox.SelectAll(); $capturedBox.Copy() })
    }
}

function Save-AppLog {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string]$Path
    )
    if ($script:LogFilePath -and (Test-Path $script:LogFilePath)) {
        Copy-Item $script:LogFilePath -Destination $Path -Force
    }
}

function Get-LogFilePath {
    [CmdletBinding()]
    param()
    return $script:LogFilePath
}

#endregion

Export-ModuleMember -Function Initialize-Logger, Set-LogTextBox, Write-AppLog,
                               Clear-AppLog, Copy-AppLog, Save-AppLog, Get-LogFilePath
