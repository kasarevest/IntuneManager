#Requires -Version 5.1
<#
.SYNOPSIS
    Runspace + WPF Dispatcher bridge for IntuneManager.
    Background operations run in MTA runspaces; UI updates are marshalled
    to the STA UI thread via $SharedState.Dispatcher.Invoke().
#>

Set-StrictMode -Version Latest

#region Shared state (synchronized hashtable -- accessible from all runspaces)
$script:SharedState = [hashtable]::Synchronized(@{
    AccessToken        = $null
    TenantId           = $null
    ProjectRoot        = $null
    OutputFolder       = $null
    ToolPath           = $null
    AppDataDir         = $null
    Dispatcher         = $null
    CancelRequested    = $false
    IsOperationRunning = $false
})
#endregion

function Get-SharedState {
    [CmdletBinding()]
    param()
    return $script:SharedState
}

function Update-UIFromBackground {
    <#
    .SYNOPSIS
        Marshals a scriptblock to the WPF UI (STA) thread.
        Safe to call from any runspace/thread.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [scriptblock]$Action
    )
    if ($script:SharedState.Dispatcher) {
        $script:SharedState.Dispatcher.Invoke([System.Action]$Action)
    }
}

function Invoke-BackgroundOperation {
    <#
    .SYNOPSIS
        Runs $Work in an MTA runspace. Calls $OnComplete or $OnError on the UI thread when done.
        Gates on IsOperationRunning -- only one operation at a time.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [scriptblock]$Work,
        [scriptblock]$OnComplete = {},
        [scriptblock]$OnError    = {}
    )

    if ($script:SharedState.IsOperationRunning) {
        throw "An operation is already in progress. Please wait for it to finish."
    }

    $script:SharedState.IsOperationRunning = $true
    $script:SharedState.CancelRequested    = $false

    # Capture current module paths so the runspace can import them
    $libDir = $PSScriptRoot

    $runspace = [System.Management.Automation.Runspaces.RunspaceFactory]::CreateRunspace()
    $runspace.ApartmentState = [System.Threading.ApartmentState]::MTA
    $runspace.ThreadOptions  = [System.Management.Automation.Runspaces.PSThreadOptions]::ReuseThread
    $runspace.Open()
    $runspace.SessionStateProxy.SetVariable('SharedState', $script:SharedState)
    $runspace.SessionStateProxy.SetVariable('LibDir',      $libDir)
    $runspace.SessionStateProxy.SetVariable('OnComplete',  $OnComplete)
    $runspace.SessionStateProxy.SetVariable('OnError',     $OnError)

    $ps = [System.Management.Automation.PowerShell]::Create()
    $ps.Runspace = $runspace

    $ps.AddScript({
        # Import all Lib modules into this runspace
        Get-ChildItem (Join-Path $LibDir '*.psm1') | ForEach-Object {
            Import-Module $_.FullName -Force -ErrorAction SilentlyContinue
        }
        # Logger needs the Dispatcher ref
        if ($SharedState.Dispatcher) {
            # LogTextBox is set separately by MainWindow; Dispatcher needed for file logging at minimum
        }
    }) | Out-Null
    $ps.AddScript($Work) | Out-Null

    $capturedSharedState = $script:SharedState
    $capturedOnComplete  = $OnComplete
    $capturedOnError     = $OnError

    $handler = Register-ObjectEvent -InputObject $ps -EventName InvocationStateChanged -Action {
        $state = $Event.SourceEventArgs.InvocationStateInfo.State
        if ($state -in @('Completed', 'Failed', 'Stopped')) {
            $capturedSharedState.IsOperationRunning = $false

            if ($capturedSharedState.Dispatcher) {
                if ($state -eq 'Completed') {
                    $capturedSharedState.Dispatcher.Invoke([System.Action]{
                        try { & $capturedOnComplete } catch {}
                    })
                } else {
                    $reason = $Event.SourceEventArgs.InvocationStateInfo.Reason
                    $capturedSharedState.Dispatcher.Invoke([System.Action]{
                        try { & $capturedOnError $reason } catch {}
                    })
                }
            }

            # Cleanup
            try { $Event.Sender.Runspace.Dispose() } catch {}
            try { $Event.Sender.Dispose() }           catch {}
            Unregister-Event -SourceIdentifier $EventSubscriber.SourceIdentifier -ErrorAction SilentlyContinue
            Remove-Job -Id $EventSubscriber.Action.Id -ErrorAction SilentlyContinue
        }
    }

    $ps.BeginInvoke() | Out-Null
}

function Request-CancelOperation {
    [CmdletBinding()]
    param()
    if ($script:SharedState.IsOperationRunning) {
        $script:SharedState.CancelRequested = $true
        Write-AppLog "Cancel requested -- waiting for current operation to stop..." -Level WARN
    }
}

function Write-UILog {
    <#
    .SYNOPSIS
        Public log function callable from any thread/runspace.
        Delegates to Write-AppLog which handles Dispatcher marshalling internally.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string]$Message,
        [ValidateSet('INFO','WARN','ERROR','DEBUG')] [string]$Level = 'INFO'
    )
    Write-AppLog -Message $Message -Level $Level
}

Export-ModuleMember -Function Get-SharedState, Update-UIFromBackground,
                               Invoke-BackgroundOperation, Request-CancelOperation, Write-UILog
