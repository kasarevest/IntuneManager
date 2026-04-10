#Requires -Version 7.0
param([string]$Query)

$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

function Write-Log([string]$Message, [string]$Level = 'INFO') {
    Write-Output "LOG:[$Level] $Message"
}

try {
    Write-Log "Searching winget for: $Query"

    # Use Winget.CommunityRepository bundled with WinTuner — no winget CLI required
    $wtModule = Get-Module -ListAvailable WinTuner | Sort-Object Version -Descending | Select-Object -First 1
    if (-not $wtModule) { throw 'WinTuner module not found' }
    Add-Type -Path (Join-Path $wtModule.ModuleBase 'Winget.CommunityRepository.dll')

    $repo    = [Winget.CommunityRepository.WingetRepository]::new([System.Net.Http.HttpClient]::new(), $null)
    $items   = $repo.SearchPackage($Query, [System.Threading.CancellationToken]::None).GetAwaiter().GetResult()

    $results = @($items | ForEach-Object {
        @{
            id        = $_.PackageId
            name      = $_.Name
            version   = $_.Version
            source    = 'winget'
            publisher = ''
        }
    })

    Write-Log "Found $($results.Count) result(s)"
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $true; results = $results } -Compress -Depth 5)"
} catch {
    Write-Log "Search failed: $($_.Exception.Message)" 'ERROR'
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; results = @(); error = $_.Exception.Message } -Compress)"
}
