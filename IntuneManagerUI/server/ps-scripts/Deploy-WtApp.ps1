#Requires -Version 7.0
param(
    [Parameter(Mandatory)] [string]$PackageFolder,
    [string]$AccessToken      = '',
    # Assignment target: AllUsers | AllDevices | None
    [string]$Assignment       = 'None',
    # For updating an existing app: provide its Graph app ID to update in place
    [string]$GraphId          = '',
    [switch]$KeepAssignments
)
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

function Write-Log([string]$Message, [string]$Level = 'INFO') {
    Write-Output "LOG:[$Level] $Message"
}

try {
    if (-not $AccessToken)    { throw 'AccessToken is required' }
    if (-not (Test-Path $PackageFolder)) { throw "Package folder not found: $PackageFolder" }

    Import-Module WinTuner -Force
    Connect-WtWinTuner -Token $AccessToken

    Write-Log "Deploying from: $PackageFolder"
    if ($GraphId) { Write-Log "Updating existing app GraphId: $GraphId" }

    $deployArgs = @{ PackageFolder = $PackageFolder }

    if ($GraphId)          { $deployArgs.GraphId          = $GraphId }
    if ($KeepAssignments)  { $deployArgs.KeepAssignments  = $true }

    # Map assignment strings to WinTuner's group references
    switch ($Assignment.ToUpper()) {
        'ALLUSERS'   { $deployArgs.Available = 'AllUsers' }
        'ALLDEVICES' { $deployArgs.Available = 'Intune_EntraJoined', 'Intune_HybridJoined' }
        # 'NONE' — no -Available arg: deploys with no assignment
    }

    $result = Deploy-WtWin32App @deployArgs

    $outId = if ($result -and $result.Id) { [string]$result.Id } elseif ($GraphId) { $GraphId } else { '' }
    Write-Log "Deployment complete. App ID: $outId"

    Write-Output "RESULT:$(ConvertTo-Json @{ success = $true; appId = $outId } -Compress)"
} catch {
    Write-Log "Deploy-WtWin32App failed: $($_.Exception.Message)" 'ERROR'
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; error = $_.Exception.Message } -Compress)"
}
