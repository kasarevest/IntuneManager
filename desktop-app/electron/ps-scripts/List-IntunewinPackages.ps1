#Requires -Version 5.1
param(
    [string]$OutputFolder,
    [string]$SourceRootPath
)

$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

function Write-Log([string]$Message, [string]$Level = 'INFO') {
    Write-Output "LOG:[$Level] $Message"
}

# Strip markdown bold (**text**) and trim whitespace
function Strip-MdBold([string]$Text) {
    if (-not $Text) { return $Text }
    return ($Text -replace '\*\*', '').Trim()
}

# Parse a field from a markdown table row: | Field | Value |
# Handles both plain and **bold** field names
function Parse-MdField([string]$Text, [string]$Field) {
    $escaped = [regex]::Escape($Field)
    # Match: | Field | Value | or | **Field** | Value |
    if ($Text -match "(?m)^\|\s*\*{0,2}$escaped\*{0,2}\s*\|\s*(.+?)\s*\|") {
        return Strip-MdBold $Matches[1]
    }
    return $null
}

# Fuzzy-match an app name to a source subfolder name.
# Returns the matched folder path, or $null.
function Find-SourceFolder([string]$AppName, [string]$SourceRoot) {
    if (-not $SourceRoot -or -not (Test-Path $SourceRoot -PathType Container)) { return $null }

    $dirs = Get-ChildItem -Path $SourceRoot -Directory -ErrorAction SilentlyContinue
    if (-not $dirs) { return $null }

    # Normalize: lowercase, remove spaces/hyphens/underscores/dots/plus signs
    function Normalize([string]$s) {
        return ($s.ToLower() -replace '[\s\-_\.\+]', '')
    }

    $normApp = Normalize $AppName

    # 1. Exact case-insensitive match
    foreach ($d in $dirs) {
        if ($d.Name -ieq $AppName) { return $d.FullName }
    }

    # 2. Normalized exact match (strips spaces, hyphens, underscores, dots, +)
    foreach ($d in $dirs) {
        if ((Normalize $d.Name) -eq $normApp) { return $d.FullName }
    }

    # 3. Normalized prefix match (app name starts with folder name or vice versa)
    foreach ($d in $dirs) {
        $normDir = Normalize $d.Name
        if ($normApp.StartsWith($normDir) -or $normDir.StartsWith($normApp)) {
            return $d.FullName
        }
    }

    # 4. Normalized substring match (folder name contained in app name or vice versa)
    foreach ($d in $dirs) {
        $normDir = Normalize $d.Name
        if ($normApp.Contains($normDir) -or $normDir.Contains($normApp)) {
            return $d.FullName
        }
    }

    return $null
}

try {
    if (-not $OutputFolder -or -not (Test-Path $OutputFolder)) {
        Write-Output "RESULT:$(ConvertTo-Json @{ success = $true; packages = @() } -Compress)"
        exit 0
    }

    $intunewinFiles = Get-ChildItem -Path $OutputFolder -Filter '*.intunewin' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending

    $packages = [System.Collections.Generic.List[hashtable]]::new()

    foreach ($file in $intunewinFiles) {
        # Parse app name from filename:
        #   Install-MozillaFirefoxESR.intunewin -> MozillaFirefoxESR
        #   Install-Notepad++.intunewin         -> Notepad++
        #   Chrome.intunewin                    -> Chrome
        #   Firefox Setup 146.0.1.intunewin     -> Firefox Setup 146.0.1
        $baseName = $file.BaseName
        $appName = $baseName -replace '^Install-', ''

        $packageSettings = $null

        # Find the best-matching source folder
        $sourceFolder = Find-SourceFolder $appName $SourceRootPath

        if ($sourceFolder) {
            $settingsPath = Join-Path $sourceFolder 'PACKAGE_SETTINGS.md'
            if (Test-Path $settingsPath) {
                try {
                    $content = Get-Content $settingsPath -Raw

                    $parsed = @{
                        app_name           = Parse-MdField $content 'Name'
                        description        = Parse-MdField $content 'Description'
                        publisher          = Parse-MdField $content 'Publisher'
                        app_version        = Parse-MdField $content 'App Version'
                        install_command    = Parse-MdField $content 'Install Command'
                        uninstall_command  = Parse-MdField $content 'Uninstall Command'
                        detect_script_name = Parse-MdField $content 'Script File'
                        min_os             = Parse-MdField $content 'Minimum OS'
                        winget_id          = Parse-MdField $content 'Winget ID'
                        installer_url      = Parse-MdField $content 'Installer URL'
                        installer_type     = Parse-MdField $content 'Installer Type'
                        sha256             = Parse-MdField $content 'SHA256'
                        source_folder      = $sourceFolder
                    }
                    # Only treat as valid settings if at least one critical field was parsed
                    if ($parsed.app_name -or $parsed.install_command -or $parsed.app_version) {
                        $packageSettings = $parsed
                    } else {
                        Write-Log "PACKAGE_SETTINGS.md for ${appName} parsed but all critical fields are empty - treating as no settings" 'WARN'
                    }
                } catch {
                    Write-Log "Could not parse PACKAGE_SETTINGS.md for ${appName}: $($_.Exception.Message)" 'WARN'
                }
            } else {
                Write-Log "No PACKAGE_SETTINGS.md found in $sourceFolder" 'DEBUG'
            }
        } else {
            Write-Log "No matching source folder found for: $appName" 'DEBUG'
        }

        $pkg = @{
            filename        = $file.Name
            intunewinPath   = $file.FullName
            appName         = $appName
            lastModified    = $file.LastWriteTime.ToString('o')
            packageSettings = $packageSettings
        }
        $packages.Add($pkg)
    }

    $result = @{
        success  = $true
        packages = $packages.ToArray()
    }

    Write-Output "RESULT:$(ConvertTo-Json $result -Depth 10 -Compress)"
} catch {
    Write-Log "Failed to list packages: $($_.Exception.Message)" 'ERROR'
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; error = $_.Exception.Message; packages = @() } -Compress)"
}
