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
    $uri         = "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/$AppId/assignments"
    $assigned    = 0

    foreach ($a in $assignments) {
        $body = ConvertTo-Json @{
            '@odata.type' = '#microsoft.graph.mobileAppAssignment'
            intent        = $a.intent   # 'required' or 'available'
            target        = @{
                '@odata.type' = '#microsoft.graph.groupAssignmentTarget'
                groupId       = $a.groupId
            }
            settings      = $null
        } -Compress -Depth 5

        Invoke-RestMethod -Method POST -Uri $uri -Headers $graphHeaders -Body $body | Out-Null
        $assigned++
        Write-Log "Assigned to group $($a.groupId) as $($a.intent)"
    }

    Write-Log "Assignments complete: $assigned group(s)"
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $true; assigned = $assigned } -Compress)"
} catch {
    Write-Log "Assignment failed: $($_.Exception.Message)" 'ERROR'
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; assigned = 0; error = $_.Exception.Message } -Compress)"
}
