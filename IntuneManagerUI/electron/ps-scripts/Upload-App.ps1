#Requires -Version 7.0
param(
    [Parameter(Mandatory)] [string]$AppId,
    [Parameter(Mandatory)] [string]$IntunewinPath,
    [string]$AccessToken = ''
)
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

function Write-Log([string]$Message, [string]$Level = 'INFO') {
    Write-Output "LOG:[$Level] $Message"
}

try {
    if (-not $AccessToken) { throw 'AccessToken is required' }
    if (-not (Test-Path $IntunewinPath)) { throw ".intunewin file not found: $IntunewinPath" }

    Add-Type -Assembly 'System.IO.Compression.FileSystem'

    $graphHeaders = @{
        Authorization  = "Bearer $AccessToken"
        'Content-Type' = 'application/json'
    }

    # ── 1. Parse Detection.xml from .intunewin ─────────────────────────────────
    Write-Log "Reading .intunewin metadata: $(Split-Path $IntunewinPath -Leaf)"

    $zip = [System.IO.Compression.ZipFile]::OpenRead($IntunewinPath)
    try {
        $detectEntry = $zip.GetEntry('IntunePackage/Detection.xml')
        if (-not $detectEntry) { throw 'Detection.xml not found in .intunewin' }

        $reader = New-Object System.IO.StreamReader($detectEntry.Open())
        $detectXml = [xml]$reader.ReadToEnd()
        $reader.Close()

        $appInfo = $detectXml.ApplicationInfo
        $encInfo = $appInfo.EncryptionInfo
        $encryptedFileName = $appInfo.FileName
        $unencryptedSize   = [int64]$appInfo.UnencryptedContentSize

        $innerEntry = $zip.GetEntry("IntunePackage/$encryptedFileName")
        if (-not $innerEntry) { throw "Encrypted file not found: IntunePackage/$encryptedFileName" }
        $encryptedSize = $innerEntry.Length
    } finally {
        $zip.Dispose()
    }

    Write-Log "App: $($appInfo.Name), encrypted file: $encryptedFileName, unencrypted size: $unencryptedSize bytes"

    # ── 2. Create content version ──────────────────────────────────────────────
    $baseUri = "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/$AppId/microsoft.graph.win32LobApp"
    $cv = Invoke-RestMethod -Method POST -Uri "$baseUri/contentVersions" -Headers $graphHeaders -Body '{}'
    $versionId = $cv.id
    Write-Log "Content version created: $versionId"

    # ── 3. Create content file entry ───────────────────────────────────────────
    $fileEntryJson = ConvertTo-Json @{
        '@odata.type' = '#microsoft.graph.mobileAppContentFile'
        name          = $encryptedFileName
        size          = $unencryptedSize
        sizeEncrypted = $encryptedSize
        isDependency  = $false
    } -Compress

    $cfUri = "$baseUri/contentVersions/$versionId/files"
    $cf = Invoke-RestMethod -Method POST -Uri $cfUri -Headers $graphHeaders -Body $fileEntryJson
    $fileId = $cf.id
    Write-Log "Content file entry created: $fileId"

    # ── 4. Poll for Azure Blob SAS URL ─────────────────────────────────────────
    $fileDetailsUri = "$cfUri/$fileId"
    $sasUrl = $null
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Seconds 2
        $fileStatus = Invoke-RestMethod -Method GET -Uri $fileDetailsUri -Headers $graphHeaders
        if ($fileStatus.uploadState -eq 'azureStorageUriRequestSuccess') {
            $sasUrl = $fileStatus.azureStorageUri
            break
        }
        if ($fileStatus.uploadState -match 'Fail') {
            throw "SAS URL request failed with state: $($fileStatus.uploadState)"
        }
    }
    if (-not $sasUrl) { throw 'Timed out waiting for Azure Storage SAS URL' }
    Write-Log 'Azure Storage SAS URL ready'

    # ── 5. Upload encrypted file to Azure Blob (multi-block) ──────────────────
    $chunkSize = 6 * 1024 * 1024  # 6 MB chunks
    $blockIds  = [System.Collections.Generic.List[string]]::new()

    $outerZip = [System.IO.Compression.ZipFile]::OpenRead($IntunewinPath)
    try {
        $innerEntry    = $outerZip.GetEntry("IntunePackage/$encryptedFileName")
        $contentStream = $innerEntry.Open()
        try {
            $buffer     = New-Object byte[] $chunkSize
            $blockIndex = 0

            while ($true) {
                $read = $contentStream.Read($buffer, 0, $chunkSize)
                if ($read -eq 0) { break }

                # Block IDs must all be the same byte-length when base64-decoded
                $blockId = [Convert]::ToBase64String(
                    [System.Text.Encoding]::ASCII.GetBytes($blockIndex.ToString('D8'))
                )
                $blockIds.Add($blockId)

                $chunk   = if ($read -eq $chunkSize) { $buffer } else { $buffer[0..($read - 1)] }
                $putUri  = "$sasUrl&comp=block&blockid=$([Uri]::EscapeDataString($blockId))"

                $null = Invoke-RestMethod -Method PUT -Uri $putUri `
                    -Body ([byte[]]$chunk) `
                    -ContentType 'application/octet-stream' `
                    -Headers @{ 'x-ms-blob-type' = 'BlockBlob' }

                $blockIndex++
                Write-Log "Uploaded block $blockIndex ($read bytes)"
            }
        } finally {
            $contentStream.Close()
        }
    } finally {
        $outerZip.Dispose()
    }

    # Commit the block list to Azure Blob
    $blockListXml = '<?xml version="1.0" encoding="utf-8"?><BlockList>' +
                    ($blockIds | ForEach-Object { "<Latest>$_</Latest>" } | Join-String) +
                    '</BlockList>'
    $null = Invoke-RestMethod -Method PUT -Uri "$sasUrl&comp=blocklist" `
        -Body $blockListXml -ContentType 'application/xml'
    Write-Log "Block list committed ($($blockIds.Count) blocks, $encryptedSize bytes)"

    # ── 6. Commit the file to Intune with encryption metadata ─────────────────
    # Intune needs a moment after the Azure block-list commit before it will
    # accept the Graph commit call. Retry up to 10 times (30s total) to handle
    # the "Your app is not ready yet" 400 race condition.
    $commitJson = ConvertTo-Json @{
        fileEncryptionInfo = @{
            encryptionKey        = $encInfo.EncryptionKey
            macKey               = $encInfo.MacKey
            initializationVector = $encInfo.InitializationVector
            mac                  = $encInfo.Mac
            profileIdentifier    = $encInfo.ProfileIdentifier
            fileDigest           = $encInfo.FileDigest
            fileDigestAlgorithm  = $encInfo.FileDigestAlgorithm
        }
    } -Compress -Depth 3

    # Check file state before committing so we know what Intune sees
    $preCommitStatus = Invoke-RestMethod -Method GET -Uri $fileDetailsUri -Headers $graphHeaders
    Write-Log "Pre-commit uploadState: $($preCommitStatus.uploadState)"

    $committed = $false
    for ($attempt = 1; $attempt -le 20; $attempt++) {
        try {
            Invoke-RestMethod -Method POST -Uri "$cfUri/$fileId/commit" `
                -Headers $graphHeaders -Body $commitJson | Out-Null
            $committed = $true
            break
        } catch {
            # Read the actual Graph API error body (PS only exposes it via ErrorDetails)
            $errBody = $_.ErrorDetails.Message
            $errMsg  = if ($errBody) { $errBody } else { $_.Exception.Message }
            if ($attempt -lt 20 -and ($errMsg -match 'not ready' -or $errMsg -match '400')) {
                Write-Log "Commit not ready (attempt $attempt/20) state=$($preCommitStatus.uploadState) — retrying in 5s..."
                Start-Sleep -Seconds 5
                $preCommitStatus = Invoke-RestMethod -Method GET -Uri $fileDetailsUri -Headers $graphHeaders
                Write-Log "  uploadState now: $($preCommitStatus.uploadState)"
            } else {
                throw [System.Exception]"Commit failed: $errMsg"
            }
        }
    }
    if (-not $committed) { throw 'Timed out waiting for Intune to accept file commit (20 attempts x 5s)' }
    Write-Log 'File commit initiated'

    # ── 7. Poll until Intune confirms commit ───────────────────────────────────
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Seconds 3
        $fileStatus = Invoke-RestMethod -Method GET -Uri $fileDetailsUri -Headers $graphHeaders
        if ($fileStatus.uploadState -eq 'commitFileSuccess') { break }
        if ($fileStatus.uploadState -match 'Fail') {
            throw "File commit failed with state: $($fileStatus.uploadState)"
        }
        Write-Log "Waiting for commit... state: $($fileStatus.uploadState)"
    }
    if ($fileStatus.uploadState -ne 'commitFileSuccess') {
        throw "Timed out waiting for file commit. Last state: $($fileStatus.uploadState)"
    }
    Write-Log 'File committed successfully'

    # ── 8. Associate committed content version with the app ───────────────────
    $patchJson = ConvertTo-Json @{ committedContentVersion = $versionId } -Compress
    Invoke-RestMethod -Method PATCH `
        -Uri "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/$AppId" `
        -Headers $graphHeaders -Body $patchJson | Out-Null

    Write-Log "App $AppId updated with content version $versionId"
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $true; versionId = $versionId } -Compress)"
} catch {
    Write-Log "Upload failed: $($_.Exception.Message)" 'ERROR'
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; error = $_.Exception.Message } -Compress)"
}
