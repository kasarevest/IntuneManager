#Requires -Version 7.0
param(
    [string]$BodyJson = '',       # Raw JSON body (PS7 handles JSON natively with no arg-mangling)
    [string]$BodyJsonPath = '',   # Legacy: path to JSON temp file (also accepted for compatibility)
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

    # Resolve JSON: prefer inline $BodyJson; fall back to reading from file path
    $json = if ($BodyJson) {
        $BodyJson
    } elseif ($BodyJsonPath -and (Test-Path $BodyJsonPath)) {
        [System.IO.File]::ReadAllText($BodyJsonPath, [System.Text.Encoding]::UTF8)
    } else {
        throw 'Either -BodyJson or a valid -BodyJsonPath is required'
    }

    $parsed = $json | ConvertFrom-Json
    Write-Log "Creating Intune Win32 app: $($parsed.displayName)"

    $headers = @{
        Authorization  = "Bearer $AccessToken"
        'Content-Type' = 'application/json'
    }

    # Pass the raw JSON string directly — avoids any round-trip issues with
    # @odata.type keys, single-element arrays, or special characters.
    $uri = 'https://graph.microsoft.com/beta/deviceAppManagement/mobileApps'
    $response = Invoke-RestMethod -Method POST -Uri $uri -Headers $headers -Body $json

    $appId = [string]$response.id
    Write-Log "App created: $appId"
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $true; appId = $appId } -Compress)"
} catch {
    $detail = $_.Exception.Message
    try {
        # Extract API error body if available
        $errResponse = $_.Exception.Response
        if ($errResponse) {
            $stream = $errResponse.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $detail = $reader.ReadToEnd()
            $reader.Close()
        }
    } catch { }
    Write-Log "Failed to create app: $detail" 'ERROR'
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; error = $detail } -Compress)"
}
