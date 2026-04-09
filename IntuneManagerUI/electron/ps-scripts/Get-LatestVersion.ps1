#Requires -Version 7.0
param([string]$WingetId)

$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

function Write-Log([string]$Message, [string]$Level = 'INFO') {
    Write-Output "LOG:[$Level] $Message"
}

try {
    Write-Log "Getting latest version for: $WingetId"

    # Use Winget.CommunityRepository bundled with WinTuner — no winget CLI required
    $wtModule = Get-Module -ListAvailable WinTuner | Sort-Object Version -Descending | Select-Object -First 1
    if (-not $wtModule) { throw 'WinTuner module not found' }
    Add-Type -Path (Join-Path $wtModule.ModuleBase 'Winget.CommunityRepository.dll')

    $repo    = [Winget.CommunityRepository.WingetRepository]::new([System.Net.Http.HttpClient]::new(), $null)
    $version = $repo.GetLatestVersion($WingetId, [System.Threading.CancellationToken]::None).GetAwaiter().GetResult()

    Write-Log "Latest version: $version"
    Write-Output "RESULT:$(ConvertTo-Json @{ version = $version; wingetId = $WingetId } -Compress)"
} catch {
    Write-Log "Failed to get version: $($_.Exception.Message)" 'ERROR'
    Write-Output "RESULT:$(ConvertTo-Json @{ version = $null; wingetId = $WingetId; error = $_.Exception.Message } -Compress)"
}
