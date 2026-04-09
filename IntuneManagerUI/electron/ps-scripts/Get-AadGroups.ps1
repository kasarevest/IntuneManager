#Requires -Version 7.0
param(
    [string]$AccessToken = '',
    [string]$Search = ''
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

    # Build filter — combine securityEnabled with optional display name search
    $filter = "securityEnabled eq true&`$select=id,displayName,groupTypes,membershipRule&`$top=100"
    if ($Search) {
        $enc = [Uri]::EscapeDataString($Search)
        $filter = "securityEnabled eq true and startswith(displayName,'$enc')&`$select=id,displayName,groupTypes,membershipRule&`$top=100"
    }

    $uri  = "https://graph.microsoft.com/v1.0/groups?`$filter=$filter"
    Write-Log "Fetching AAD groups$(if ($Search) { " matching '$Search'" })"

    $resp = Invoke-RestMethod -Method GET -Uri $uri -Headers $graphHeaders
    $raw  = $resp.value

    $groups = @($raw | ForEach-Object {
        # Detect group type:
        #  Dynamic group with device membership rule → 'device'
        #  Otherwise → 'user' (default)
        $gtype = 'user'
        if ($_.groupTypes -contains 'DynamicMembership' -and $_.membershipRule -match 'device\.') {
            $gtype = 'device'
        } elseif ($_.displayName -imatch '\bdevice[s]?\b' -and $_.displayName -inotmatch '\buser[s]?\b') {
            $gtype = 'device'
        }

        @{
            id          = [string]$_.id
            displayName = [string]$_.displayName
            groupType   = $gtype
        }
    })

    Write-Log "Found $($groups.Count) group(s)"
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $true; groups = $groups } -Compress -Depth 4)"
} catch {
    Write-Log "Failed to fetch groups: $($_.Exception.Message)" 'ERROR'
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; groups = @(); error = $_.Exception.Message } -Compress)"
}
