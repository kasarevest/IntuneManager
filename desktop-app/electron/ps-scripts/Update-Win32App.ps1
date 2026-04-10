#Requires -Version 7.0
param(
    [Parameter(Mandatory)] [string]$AppId,
    [string]$BodyJson = '',
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
    if (-not $BodyJson)    { throw 'BodyJson is required' }

    Write-Log "Updating Intune app: $AppId"

    $headers = @{
        Authorization  = "Bearer $AccessToken"
        'Content-Type' = 'application/json'
    }

    $uri = "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/$AppId"
    # Pass raw JSON to preserve @odata.type, array types, etc.
    Invoke-RestMethod -Method PATCH -Uri $uri -Headers $headers -Body $BodyJson | Out-Null

    Write-Log "App updated: $AppId"
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $true; appId = $AppId } -Compress)"
} catch {
    Write-Log "Failed to update app: $($_.Exception.Message)" 'ERROR'
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; error = $_.Exception.Message } -Compress)"
}
