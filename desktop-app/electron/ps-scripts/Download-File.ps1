#Requires -Version 5.1
param(
    [string]$Url,
    [string]$OutputPath,
    [string]$ExpectedSHA256 = ''
)

$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = 'Stop'

function Write-Log([string]$Message, [string]$Level = 'INFO') {
    Write-Output "LOG:[$Level] $Message"
}

try {
    Write-Log "Downloading: $Url"
    Write-Log "Destination: $OutputPath"

    # Ensure output directory exists
    $dir = Split-Path $OutputPath -Parent
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }

    # Try BITS first (shows progress, resumes)
    $useBits = $false
    try {
        Import-Module BitsTransfer -ErrorAction Stop
        $useBits = $true
    } catch {}

    if ($useBits) {
        Write-Log "Using BITS transfer..."
        Start-BitsTransfer -Source $Url -Destination $OutputPath -TransferType Download
    } else {
        Write-Log "Using WebClient..."
        $wc = New-Object System.Net.WebClient
        $wc.DownloadFile($Url, $OutputPath)
    }

    if (-not (Test-Path $OutputPath)) {
        throw "Download completed but file not found: $OutputPath"
    }

    $fileInfo = Get-Item $OutputPath
    $sizeMB   = [Math]::Round($fileInfo.Length / 1MB, 2)
    Write-Log "Downloaded: $sizeMB MB"

    # SHA256 verification
    $actualHash = (Get-FileHash -Path $OutputPath -Algorithm SHA256).Hash.ToLower()
    Write-Log "SHA256: $actualHash"

    if ($ExpectedSHA256 -and $ExpectedSHA256.ToLower() -ne $actualHash) {
        Remove-Item $OutputPath -Force
        throw "SHA256 mismatch. Expected: $($ExpectedSHA256.ToLower())  Actual: $actualHash"
    }

    Write-Output "RESULT:$(ConvertTo-Json @{
        success  = $true
        path     = $OutputPath
        sizeMB   = $sizeMB
        sha256   = $actualHash
    } -Compress)"
} catch {
    Write-Log "Download failed: $($_.Exception.Message)" 'ERROR'
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; error = $_.Exception.Message } -Compress)"
}
