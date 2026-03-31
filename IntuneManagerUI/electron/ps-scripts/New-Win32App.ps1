#Requires -Version 5.1
param(
    [string]$BodyJsonPath   # Path to a temp file containing the JSON body (avoids PS 5.1 arg-mangling)
)

$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = 'Stop'

function Write-Log([string]$Message, [string]$Level = 'INFO') {
    Write-Output "LOG:[$Level] $Message"
}

try {
    $LibPath = Join-Path $PSScriptRoot '..\..\..\IntuneManager\Lib'
    Import-Module (Join-Path $LibPath 'Logger.psm1') -Force
    Import-Module (Join-Path $LibPath 'Auth.psm1') -Force
    Import-Module (Join-Path $LibPath 'GraphClient.psm1') -Force

    # Read JSON from temp file (avoids PS 5.1 command-line argument mangling of { } : " chars)
    if (-not $BodyJsonPath -or -not (Test-Path $BodyJsonPath)) {
        throw "BodyJsonPath not provided or file not found: $BodyJsonPath"
    }
    $BodyJson = [System.IO.File]::ReadAllText($BodyJsonPath, [System.Text.Encoding]::UTF8)

    $parsed = $BodyJson | ConvertFrom-Json
    Write-Log "Creating Intune Win32 app: $($parsed.displayName)"

    # Post the JSON directly via HttpWebRequest to bypass ConvertTo-Hashtable / ConvertTo-Json
    # round-trip issues in PS 5.1 (single-element arrays become objects, @odata keys lost, etc.)
    $token = Get-ValidAccessToken
    $uri = 'https://graph.microsoft.com/beta/deviceAppManagement/mobileApps'
    $req = [System.Net.HttpWebRequest]::Create($uri)
    $req.Method = 'POST'
    $req.ContentType = 'application/json'
    $req.Accept = 'application/json'
    $req.Headers.Add('Authorization', "Bearer $token")
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($BodyJson)
    $req.ContentLength = $bytes.Length
    $stream = $req.GetRequestStream()
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Close()

    $resp = $req.GetResponse()
    $reader = [System.IO.StreamReader]::new($resp.GetResponseStream())
    $responseBody = $reader.ReadToEnd()
    $reader.Close()

    $appId = ($responseBody | ConvertFrom-Json).id
    Write-Log "App created: $appId"
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $true; appId = $appId } -Compress)"
} catch [System.Net.WebException] {
    $detail = $_.Exception.Message
    try {
        $er = $_.Exception.Response
        if ($er) {
            $reader2 = [System.IO.StreamReader]::new($er.GetResponseStream())
            $detail = $reader2.ReadToEnd()
            $reader2.Close()
        }
    } catch {}
    Write-Log "Failed to create app: $detail" 'ERROR'
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; error = $detail } -Compress)"
} catch {
    Write-Log "Failed to create app: $($_.Exception.Message)" 'ERROR'
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; error = $_.Exception.Message } -Compress)"
}
