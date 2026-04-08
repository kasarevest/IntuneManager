#Requires -Version 7.0
<#
.SYNOPSIS
    Native PS7 / .NET 8.0 replacement for IntuneWinAppUtil.exe.

.DESCRIPTION
    Implements the .intunewin packaging format using only cross-platform
    .NET 8.0 APIs (System.IO.Compression, System.Security.Cryptography).
    No Windows-specific APIs, no external tools required.

    Format:
      Outer ZIP
        IntunePackage.intunewin  — AES-256-CBC encrypted inner ZIP (PKCS7)
        metadata/Detection.xml  — encryption keys + file digest

    Encryption:
      - Inner ZIP: ZipFile.CreateFromDirectory(SourceFolder)
      - SHA-256 of inner ZIP bytes                     → FileDigest
      - AES-256-CBC, random key + IV, PKCS7 padding    → encrypted blob
      - HMAC-SHA256 of encrypted blob, random MAC key  → Mac
      - Random 256-bit MAC key

.PARAMETER SourceFolder
    Path to the folder containing the application files.

.PARAMETER EntryPoint
    Path to the setup file (e.g. setup.exe). Used only for metadata.

.PARAMETER OutputFolder
    Folder where the .intunewin file will be written.

.OUTPUTS
    RESULT:{success,intunewinPath,sizeMB} on stdout (parsed by ps-bridge).
#>
param(
    [Parameter(Mandatory)] [string]$SourceFolder,
    [Parameter(Mandatory)] [string]$EntryPoint,
    [Parameter(Mandatory)] [string]$OutputFolder
)

$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

function Write-Log([string]$Message, [string]$Level = 'INFO') {
    Write-Output "LOG:[$Level] $Message"
}

# Load ZIP + crypto assemblies (already available in .NET 8 but explicit Add-Type is safe)
Add-Type -AssemblyName 'System.IO.Compression'
Add-Type -AssemblyName 'System.IO.Compression.FileSystem'
Add-Type -AssemblyName 'System.Security.Cryptography.Algorithms' -ErrorAction SilentlyContinue

$tempInnerZip = $null

try {
    # ── Validate inputs ───────────────────────────────────────────────────────
    if (-not (Test-Path $SourceFolder -PathType Container)) {
        throw "Source folder not found: $SourceFolder"
    }
    if (-not (Test-Path $EntryPoint)) {
        throw "Entry point not found: $EntryPoint"
    }
    if (-not (Test-Path $OutputFolder)) {
        New-Item -ItemType Directory -Path $OutputFolder -Force | Out-Null
    }

    $appName    = [System.IO.Path]::GetFileName($SourceFolder.TrimEnd('/\'))
    $setupFile  = [System.IO.Path]::GetFileName($EntryPoint)
    $outputName = "${appName}.intunewin"
    $outputPath = [System.IO.Path]::Combine($OutputFolder, $outputName)

    Write-Log "Packaging: $appName"
    Write-Log "  Source:     $SourceFolder"
    Write-Log "  EntryPoint: $setupFile"
    Write-Log "  Output:     $outputPath"

    # ── Step 1: Create inner ZIP of source folder ─────────────────────────────
    Write-Log "Step 1/5: Creating inner ZIP..."
    $tempInnerZip = [System.IO.Path]::GetTempFileName() + '.zip'
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $SourceFolder,
        $tempInnerZip,
        [System.IO.Compression.CompressionLevel]::Optimal,
        $false   # includeBaseDirectory = false (ZIP contents, not the folder)
    )
    $innerBytes = [System.IO.File]::ReadAllBytes($tempInnerZip)
    $unencryptedSize = $innerBytes.Length
    Write-Log "  Inner ZIP size: $([Math]::Round($unencryptedSize / 1KB, 1)) KB"

    # ── Step 2: SHA-256 of inner ZIP bytes → FileDigest ───────────────────────
    Write-Log "Step 2/5: Computing SHA-256 digest..."
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    $digestBytes = $sha256.ComputeHash($innerBytes)
    $sha256.Dispose()
    $fileDigestB64 = [System.Convert]::ToBase64String($digestBytes)

    # ── Step 3: AES-256-CBC encrypt the inner ZIP ─────────────────────────────
    Write-Log "Step 3/5: Encrypting with AES-256-CBC..."
    $aes = [System.Security.Cryptography.Aes]::Create()
    $aes.KeySize = 256
    $aes.BlockSize = 128
    $aes.Mode = [System.Security.Cryptography.CipherMode]::CBC
    $aes.Padding = [System.Security.Cryptography.PaddingMode]::PKCS7
    $aes.GenerateKey()
    $aes.GenerateIV()

    $encKeyB64 = [System.Convert]::ToBase64String($aes.Key)
    $ivB64     = [System.Convert]::ToBase64String($aes.IV)

    $encryptor = $aes.CreateEncryptor()
    $encMs     = [System.IO.MemoryStream]::new()
    $cryptoStream = [System.Security.Cryptography.CryptoStream]::new(
        $encMs,
        $encryptor,
        [System.Security.Cryptography.CryptoStreamMode]::Write
    )
    $cryptoStream.Write($innerBytes, 0, $innerBytes.Length)
    $cryptoStream.FlushFinalBlock()
    $encryptedBytes = $encMs.ToArray()
    $cryptoStream.Dispose()
    $encMs.Dispose()
    $aes.Dispose()
    Write-Log "  Encrypted size: $([Math]::Round($encryptedBytes.Length / 1KB, 1)) KB"

    # ── Step 4: HMAC-SHA256 of encrypted bytes ────────────────────────────────
    Write-Log "Step 4/5: Computing HMAC-SHA256..."
    $macKeyBytes = [byte[]]::new(32)
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($macKeyBytes)
    $hmac     = [System.Security.Cryptography.HMACSHA256]::new($macKeyBytes)
    $macBytes = $hmac.ComputeHash($encryptedBytes)
    $hmac.Dispose()
    $macKeyB64 = [System.Convert]::ToBase64String($macKeyBytes)
    $macB64    = [System.Convert]::ToBase64String($macBytes)

    # ── Step 5: Build outer ZIP with encrypted blob + Detection.xml ───────────
    Write-Log "Step 5/5: Building outer ZIP..."

    $detectionXml = @"
<?xml version="1.0" encoding="utf-8"?>
<ApplicationInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ToolVersion="1.0.0.0">
  <EncryptionInfo>
    <EncryptionKey>$encKeyB64</EncryptionKey>
    <MacKey>$macKeyB64</MacKey>
    <InitializationVector>$ivB64</InitializationVector>
    <Mac>$macB64</Mac>
    <ProfileIdentifier>ProfileVersion1</ProfileIdentifier>
    <FileDigest>$fileDigestB64</FileDigest>
    <FileDigestAlgorithm>SHA256</FileDigestAlgorithm>
  </EncryptionInfo>
  <Name>$appName</Name>
  <UnencryptedContentSize>$unencryptedSize</UnencryptedContentSize>
  <FileName>$outputName</FileName>
  <SetupFile>$setupFile</SetupFile>
</ApplicationInfo>
"@

    $xmlBytes = [System.Text.Encoding]::UTF8.GetBytes($detectionXml)

    # Write outer ZIP directly to the output file
    if (Test-Path $outputPath) { Remove-Item $outputPath -Force }

    $outerMs  = [System.IO.MemoryStream]::new()
    $archive  = [System.IO.Compression.ZipArchive]::new(
        $outerMs,
        [System.IO.Compression.ZipArchiveMode]::Create,
        $true   # leaveOpen = true so we can ToArray() after dispose
    )

    # Entry 1: encrypted blob (no compression — it's already encrypted binary)
    $blobEntry   = $archive.CreateEntry('IntunePackage.intunewin', [System.IO.Compression.CompressionLevel]::NoCompression)
    $blobStream  = $blobEntry.Open()
    $blobStream.Write($encryptedBytes, 0, $encryptedBytes.Length)
    $blobStream.Dispose()

    # Entry 2: Detection.xml inside metadata/ subfolder
    $xmlEntry    = $archive.CreateEntry('metadata/Detection.xml', [System.IO.Compression.CompressionLevel]::Optimal)
    $xmlStream   = $xmlEntry.Open()
    $xmlStream.Write($xmlBytes, 0, $xmlBytes.Length)
    $xmlStream.Dispose()

    $archive.Dispose()

    [System.IO.File]::WriteAllBytes($outputPath, $outerMs.ToArray())
    $outerMs.Dispose()

    $sizeMB = [Math]::Round((Get-Item $outputPath).Length / 1MB, 2)
    Write-Log "Package created: $outputPath ($sizeMB MB)"

    Write-Output "RESULT:$(ConvertTo-Json @{
        success       = $true
        intunewinPath = $outputPath
        sizeMB        = $sizeMB
    } -Compress)"

} catch {
    Write-Log "Packaging failed: $($_.Exception.Message)" 'ERROR'
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; error = $_.Exception.Message } -Compress)"
} finally {
    if ($tempInnerZip -and (Test-Path $tempInnerZip)) {
        Remove-Item $tempInnerZip -Force -ErrorAction SilentlyContinue
    }
}
