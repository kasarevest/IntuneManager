#Requires -Version 5.1
<#
.SYNOPSIS
    Compares local package version to the version deployed in Intune.
    Handles both standard (1.2.3.4) and non-standard (26.0.4.15557, 146.0.1) version strings.
#>

Set-StrictMode -Version Latest

function Compare-AppVersion {
    [CmdletBinding()]
    param(
        [string]$LocalVersion,
        [string]$IntuneVersion
    )

    $localEmpty  = [string]::IsNullOrWhiteSpace($LocalVersion)
    $intuneEmpty = [string]::IsNullOrWhiteSpace($IntuneVersion)

    if ($localEmpty -and $intuneEmpty) {
        return [PSCustomObject]@{
            Status        = 'Unknown'
            LocalVersion  = $LocalVersion
            IntuneVersion = $IntuneVersion
            CanCompare    = $false
            Recommendation = 'Neither version is known'
        }
    }
    if ($localEmpty) {
        return [PSCustomObject]@{
            Status        = 'CloudOnly'
            LocalVersion  = ''
            IntuneVersion = $IntuneVersion
            CanCompare    = $false
            Recommendation = 'No local package found for this app'
        }
    }
    if ($intuneEmpty) {
        return [PSCustomObject]@{
            Status        = 'LocalOnly'
            LocalVersion  = $LocalVersion
            IntuneVersion = ''
            CanCompare    = $false
            Recommendation = 'App exists locally but has not been uploaded to Intune'
        }
    }

    # Attempt structured version comparison
    $lvParsed = $null
    $ivParsed = $null
    try { $lvParsed = [System.Version]::new($LocalVersion) } catch {}
    try { $ivParsed = [System.Version]::new($IntuneVersion) } catch {}

    # Fallback: normalize non-standard strings (e.g. "2025.3" -> "2025.3.0.0")
    if (-not $lvParsed) {
        $norm = ($LocalVersion -replace '[^0-9.]', '') -replace '\.{2,}', '.'
        try { $lvParsed = [System.Version]::new($norm) } catch {}
    }
    if (-not $ivParsed) {
        $norm = ($IntuneVersion -replace '[^0-9.]', '') -replace '\.{2,}', '.'
        try { $ivParsed = [System.Version]::new($norm) } catch {}
    }

    if (-not $lvParsed -or -not $ivParsed) {
        # Last resort: string equality
        $same = $LocalVersion.Trim() -eq $IntuneVersion.Trim()
        return [PSCustomObject]@{
            Status        = if ($same) { 'Current' } else { 'Unknown' }
            LocalVersion  = $LocalVersion
            IntuneVersion = $IntuneVersion
            CanCompare    = $false
            Recommendation = if ($same) { 'Versions match (string comparison)' } else { 'Cannot parse versions for comparison -- manual review required' }
        }
    }

    $cmp = $lvParsed.CompareTo($ivParsed)
    switch ($cmp) {
        { $_ -eq 0 } {
            return [PSCustomObject]@{
                Status        = 'Current'
                LocalVersion  = $LocalVersion
                IntuneVersion = $IntuneVersion
                CanCompare    = $true
                Recommendation = 'App is up to date'
            }
        }
        { $_ -gt 0 } {
            return [PSCustomObject]@{
                Status        = 'UpdateAvailable'
                LocalVersion  = $LocalVersion
                IntuneVersion = $IntuneVersion
                CanCompare    = $true
                Recommendation = "Local version ($($LocalVersion)) is newer than Intune ($($IntuneVersion)) - update recommended"
            }
        }
        default {
            return [PSCustomObject]@{
                Status        = 'IntuneNewer'
                LocalVersion  = $LocalVersion
                IntuneVersion = $IntuneVersion
                CanCompare    = $true
                Recommendation = "Intune version ($($IntuneVersion)) is newer than local ($($LocalVersion)) - update local package"
            }
        }
    }
}

Export-ModuleMember -Function Compare-AppVersion
