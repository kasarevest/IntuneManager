#Requires -Version 5.1
param([string]$Query)

$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Log([string]$Message, [string]$Level = 'INFO') {
    Write-Output "LOG:[$Level] $Message"
}

try {
    Write-Log "Searching Chocolatey for: $Query"

    # Use choco API search endpoint (no choco install required)
    $uri = "https://community.chocolatey.org/api/v2/Search()?`$filter=IsLatestVersion&`$skip=0&`$top=10&searchTerm='$Query'&targetFramework=''&includePrerelease=false"
    $response = Invoke-RestMethod -Uri $uri -Method Get -TimeoutSec 15 -UseBasicParsing

    $results = @()
    foreach ($entry in $response.d.results) {
        $results += @{
            id        = $entry.Id
            name      = $entry.Title
            version   = $entry.Version
            source    = 'chocolatey'
            publisher = $entry.Authors
        }
    }

    Write-Log "Found $($results.Count) Chocolatey result(s)"
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $true; results = @($results) } -Compress -Depth 5)"
} catch {
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; results = @(); error = $_.Exception.Message } -Compress)"
}
