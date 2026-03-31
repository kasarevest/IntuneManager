#Requires -Version 5.1
<#
.SYNOPSIS
    Parses PACKAGE_SETTINGS.md files into structured PSCustomObjects.
    Never throws -- returns partial result with ParseWarnings[] for missing/unparseable fields.
    Also supports resolving the latest stable version via winget manifest (per /btw requirement).
#>

Set-StrictMode -Version Latest

# Minimum OS string -> Graph enum mapping
$script:MinOsMap = @{
    'Windows 10 1607'  = 'W10_1607'
    'Windows 10 1703'  = 'W10_1703'
    'Windows 10 1709'  = 'W10_1709'
    'Windows 10 1803'  = 'W10_1803'
    'Windows 10 1809'  = 'W10_1809'
    'Windows 10 1903'  = 'W10_1903'
    'Windows 10 1909'  = 'W10_1909'
    'Windows 10 2004'  = 'W10_2004'
    'Windows 10 20H2'  = 'W10_20H2'
    'Windows 10 21H1'  = 'W10_21H1'
    'Windows 10 21H2'  = 'W10_21H2'
    'Windows 10 22H2'  = 'W10_22H2'
    'Windows 11 21H2'  = 'W11_21H2'
    'Windows 11 22H2'  = 'W11_22H2'
    'Windows 11 23H2'  = 'W11_23H2'
    'Windows 11 24H2'  = 'W11_24H2'
}

function Parse-MarkdownTable {
    <#
    .SYNOPSIS
        Extracts key->value pairs from a Markdown table section.
        Returns a hashtable. Never throws.
    #>
    param([string[]]$Lines)
    $result = @{}
    foreach ($line in $Lines) {
        # Match table rows: | Key | Value |  (skip header/separator rows)
        if ($line -match '^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|') {
            $key = $Matches[1].Trim()
            $val = $Matches[2].Trim()
            # Skip header and separator rows
            if ($key -match '^[-:]+$' -or $val -match '^[-:]+$') { continue }
            if ($key -match '^Field$') { continue }
            # Strip markdown inline code backticks from value
            $val = $val -replace '^`(.+)`$', '$1'
            $result[$key] = $val
        }
    }
    return $result
}

function ConvertFrom-PackageSettings {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string]$Path
    )

    $warnings = [System.Collections.Generic.List[string]]::new()
    $result   = [ordered]@{
        SourceFolder      = Split-Path $Path -Parent
        SettingsPath      = $Path
        DisplayName       = $null
        Description       = $null
        Publisher         = $null
        AppVersion        = $null
        WingetId          = $null
        Category          = $null
        InformationUrl    = $null
        PrivacyUrl        = $null
        InstallCommand    = $null
        UninstallCommand  = $null
        InstallBehavior   = 'system'
        Architecture      = 'x64'
        MinimumOs         = 'W10_21H2'
        MinimumOsRaw      = $null
        DetectionScript   = $null
        DetectionMethod   = 'script'
        ReturnCodes       = @()
        InstallerUrl      = $null
        InstallerType     = $null
        InstallerSHA256   = $null
        ParseWarnings     = $null
    }

    if (-not (Test-Path $Path)) {
        $warnings.Add("File not found: $Path")
        $result.ParseWarnings = $warnings.ToArray()
        return [PSCustomObject]$result
    }

    try {
        $content = [System.IO.File]::ReadAllText($Path)
        $lines   = $content -split "`r?`n"

        # Parse all tables into one flat hashtable (section headers ignored; keys unique per file)
        $allKV = Parse-MarkdownTable -Lines $lines

        # App Information
        $result.DisplayName      = if ($allKV['Name']) { $allKV['Name'] } else { $allKV['Display Name'] }
        $result.Description      = $allKV['Description']
        $result.Publisher        = $allKV['Publisher']
        $result.AppVersion       = $allKV['App Version']
        $result.WingetId         = $allKV['Winget ID']
        $result.Category         = $allKV['Category']
        $result.InformationUrl   = $allKV['Information URL']
        $result.PrivacyUrl       = $allKV['Privacy URL']

        # Program settings
        $rawInstall = $allKV['Install command']
        $rawUninstall = $allKV['Uninstall command']
        # Strip backtick wrapping if present (portal safety check -- issue from Camtasia Lesson 001)
        if ($rawInstall)   { $result.InstallCommand   = $rawInstall.Trim().Trim('`') }
        if ($rawUninstall) { $result.UninstallCommand = $rawUninstall.Trim().Trim('`') }

        $ib = $allKV['Install behavior']
        if ($ib) { $result.InstallBehavior = $ib.ToLower() }

        # Requirements
        $arch = $allKV['OS Architecture']
        if ($arch) {
            $result.Architecture = if ($arch -match '32') { 'x86' } else { 'x64' }
        }

        $minOs = $allKV['Minimum OS']
        if ($minOs) {
            $result.MinimumOsRaw = $minOs
            $mapped = $script:MinOsMap[$minOs]
            if ($mapped) {
                $result.MinimumOs = $mapped
            } else {
                $warnings.Add("Unknown Minimum OS value '$minOs' -- defaulting to W10_21H2")
            }
        }

        # Detection
        $detectScript = $allKV['Script file']
        if ($detectScript) {
            $detectScript = $detectScript.Trim('`')
            $detectPath = Join-Path (Split-Path $Path -Parent) $detectScript
            if (Test-Path $detectPath) {
                $result.DetectionScript = $detectPath
            } else {
                $warnings.Add("Detection script not found at: $detectPath")
            }
        }

        # Return codes
        $returnCodes = [System.Collections.Generic.List[hashtable]]::new()
        foreach ($line in $lines) {
            if ($line -match '^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|') {
                $code = [int]$Matches[1]
                $meaning = $Matches[2].Trim()
                # Skip header rows
                if ($meaning -match '^[-:]+$' -or $meaning -match '^Meaning') { continue }
                $returnCodes.Add(@{ returnCode = $code; type = Get-ReturnCodeType $code $meaning })
            }
        }
        if ($returnCodes.Count -gt 0) { $result.ReturnCodes = $returnCodes.ToArray() }

        # Installer details
        $result.InstallerUrl    = if ($allKV['Installer URL']) { $allKV['Installer URL'] } else { $allKV['Download URL'] }
        $result.InstallerType   = $allKV['Installer Type']
        $result.InstallerSHA256 = $allKV['SHA256']

        # Validate mandatory fields
        if (-not $result.DisplayName)      { $warnings.Add("Missing required field: Name / Display Name") }
        if (-not $result.InstallCommand)   { $warnings.Add("Missing required field: Install command") }
        if (-not $result.UninstallCommand) { $warnings.Add("Missing required field: Uninstall command") }
        if (-not $result.DetectionScript)  { $warnings.Add("No detection script path resolved") }

    } catch {
        $warnings.Add("Parse exception: $($_.Exception.GetType().FullName) -- $($_.Exception.Message)")
    }

    $result.ParseWarnings = $warnings.ToArray()
    return [PSCustomObject]$result
}

function Get-ReturnCodeType {
    param([int]$Code, [string]$Meaning)
    switch ($Code) {
        0    { return 'success' }
        3010 { return 'softReboot' }
        1641 { return 'hardReboot' }
        1618 { return 'retry' }
        default {
            if ($Meaning -match 'reboot|restart') { return 'softReboot' }
            if ($Meaning -match 'retry')           { return 'retry' }
            return 'failed'
        }
    }
}

function Get-AllPackageSettings {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string]$SourceRoot
    )

    $results = [System.Collections.Generic.List[PSCustomObject]]::new()
    $mdFiles = Get-ChildItem -Path $SourceRoot -Recurse -Filter 'PACKAGE_SETTINGS.md' -ErrorAction SilentlyContinue

    if (-not $mdFiles -or $mdFiles.Count -eq 0) {
        Write-AppLog "No PACKAGE_SETTINGS.md files found under: $SourceRoot" -Level WARN
        return @()
    }

    foreach ($f in $mdFiles) {
        $parsed = ConvertFrom-PackageSettings -Path $f.FullName
        if ($parsed.ParseWarnings.Count -gt 0) {
            Write-AppLog "Parse warnings for $($f.FullName): $($parsed.ParseWarnings -join '; ')" -Level WARN
        }
        $results.Add($parsed)
    }

    Write-AppLog "Parsed $($results.Count) PACKAGE_SETTINGS.md file(s)"
    return $results.ToArray()
}

function Get-LatestWingetVersion {
    <#
    .SYNOPSIS
        Resolves the latest stable version for an app using winget.
        Returns $null if winget is unavailable or the package is not found.
        Used by NewAppWizard when "Install latest stable version" is requested.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string]$WingetId
    )

    try {
        $wingetExe = Get-Command winget.exe -ErrorAction SilentlyContinue
        if (-not $wingetExe) {
            Write-AppLog "winget.exe not found -- cannot resolve latest version for $WingetId" -Level WARN
            return $null
        }

        $output = & winget.exe show $WingetId --accept-source-agreements 2>&1 | Out-String
        if ($output -match 'Version:\s+([^\r\n]+)') {
            $version = $Matches[1].Trim()
            Write-AppLog "winget latest version for ${WingetId}: $version"
            return $version
        }
        Write-AppLog "Could not parse winget version output for $WingetId" -Level WARN
        return $null
    } catch {
        Write-AppLog "winget version lookup failed for ${WingetId}: $($_.Exception.GetType().FullName) -- $($_.Exception.Message)" -Level WARN
        return $null
    }
}

Export-ModuleMember -Function ConvertFrom-PackageSettings, Get-AllPackageSettings, Get-LatestWingetVersion
