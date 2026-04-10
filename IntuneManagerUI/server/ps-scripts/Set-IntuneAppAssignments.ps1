#Requires -Version 7.0
param(
    [Parameter(Mandatory)] [string]$AppId,
    [Parameter(Mandatory)] [string]$AssignmentsJson,
    [string]$AccessToken = ''
)
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

function Write-Log([string]$Message, [string]$Level = 'INFO') {
    Write-Output "LOG:[$Level] $Message"
}

try {
    if (-not $AccessToken) { throw 'AccessToken is required' }

    $graphHeaders = @{
        Authorization  = "Bearer $AccessToken"
        'Content-Type' = 'application/json'
    }

    $assignments = $AssignmentsJson | ConvertFrom-Json
    Write-Log "Assigning app $AppId to $($assignments.Count) group(s)"

    # Use the /assign action — single request for all groups instead of N sequential POSTs
    $uri = "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/$AppId/assign"

    $body = ConvertTo-Json @{
        mobileAppAssignments = @($assignments | ForEach-Object {
            @{
                '@odata.type' = '#microsoft.graph.mobileAppAssignment'
                intent        = $_.intent
                target        = @{
                    '@odata.type' = '#microsoft.graph.groupAssignmentTarget'
                    groupId       = $_.groupId
                }
                settings      = $null
            }
        })
    } -Compress -Depth 6

    Invoke-RestMethod -Method POST -Uri $uri -Headers $graphHeaders -Body $body -TimeoutSec 30 | Out-Null

    Write-Log "Assignments applied: $($assignments.Count) group(s)"
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $true; assigned = $assignments.Count } -Compress)"
} catch {
    Write-Log "Assignment failed: $($_.Exception.Message)" 'ERROR'
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; assigned = 0; error = $_.Exception.Message } -Compress)"
}
