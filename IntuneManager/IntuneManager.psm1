#Requires -Version 5.1
<#
.SYNOPSIS
    Root module for IntuneManager. Dot-sources all Lib modules.
    Not typically imported directly -- Main.ps1 imports each Lib module explicitly
    for cleaner error handling. This file exists for tooling and script analysis.
#>

$libDir = Join-Path $PSScriptRoot 'Lib'
Get-ChildItem (Join-Path $libDir '*.psm1') | ForEach-Object {
    Import-Module $_.FullName -Force -Global
}
