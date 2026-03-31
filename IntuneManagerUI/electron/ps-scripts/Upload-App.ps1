#Requires -Version 5.1
param([string]$AppId, [string]$IntunewinPath)

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
    Import-Module (Join-Path $LibPath 'UploadManager.psm1') -Force

    if (-not (Test-Path $IntunewinPath)) {
        throw ".intunewin file not found: $IntunewinPath"
    }

    Write-Log "Uploading $IntunewinPath to app $AppId"

    $result = Invoke-IntuneUpload -AppId $AppId -IntunewinPath $IntunewinPath -OnProgress {
        param($msg)
        Write-Log $msg
    }

    Write-Log "Upload complete. Version ID: $($result.ContentVersionId)"
    Write-Output "RESULT:$(ConvertTo-Json @{
        success         = $true
        versionId       = $result.ContentVersionId
    } -Compress)"
} catch {
    Write-Log "Upload failed: $($_.Exception.Message)" 'ERROR'
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; error = $_.Exception.Message } -Compress)"
}
