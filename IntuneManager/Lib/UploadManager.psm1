#Requires -Version 5.1
<#
.SYNOPSIS
    Uploads a .intunewin package to Microsoft Intune via Graph API + Azure Blob Storage.

    Full sequence:
    1. Extract EncryptionInfo from Detection.xml inside the .intunewin ZIP
    2. POST new content version
    3. POST file entry -> get SAS URI
    4. Upload .intunewin to Azure Blob in 5 MB chunks (no bearer token -- SAS URI is self-authorizing)
    5. PUT block list to finalize blob
    6. POST commit with fileEncryptionInfo
    7. Poll until commitFileSuccess
    8. PATCH app record to activate content version
#>

Set-StrictMode -Version Latest

$script:ChunkSizeMB = 5

function Invoke-IntuneUpload {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string]$AppId,
        [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string]$IntuneWinPath,
        # Optional progress callback: called with (ChunkIndex, TotalChunks)
        [scriptblock]$OnProgress,
        # SharedState hashtable -- checked for CancelRequested between chunks
        [hashtable]$SharedState
    )

    $resolvedPath = [System.IO.Path]::GetFullPath($IntuneWinPath)
    if (-not (Test-Path $resolvedPath -PathType Leaf)) {
        throw "IntuneWin file not found: $resolvedPath"
    }

    Write-AppLog "Starting upload: $([System.IO.Path]::GetFileName($resolvedPath))"

    # Step 1: Extract all metadata from Detection.xml inside the .intunewin ZIP
    # - FileEncryptionInfo : for the Graph commit body
    # - UnencryptedSize    : original installer size -> Graph 'size' field
    # - EncryptedSize      : inner encrypted blob size -> Graph 'sizeEncrypted' field
    # - EncryptedEntryPath : zip path of inner blob to stream for upload
    $meta          = Get-IntunewinMetadata -IntuneWinPath $resolvedPath
    $encInfo       = $meta.FileEncryptionInfo
    $unencSize     = $meta.UnencryptedSize
    $encSize       = $meta.EncryptedSize
    $encEntryPath  = $meta.EncryptedEntryPath

    Write-AppLog "Unencrypted size: $([math]::Round($unencSize/1MB,2)) MB | Encrypted blob: $([math]::Round($encSize/1MB,2)) MB"

    # Step 2: Create content version
    $versionId = New-ContentVersion -AppId $AppId

    # Step 3: Create file entry -> SAS URI
    # 'size' = unencrypted original size; 'sizeEncrypted' = encrypted blob size (inner ZIP entry)
    $fileBody = @{
        '@odata.type'  = '#microsoft.graph.mobileAppContentFile'
        name           = [System.IO.Path]::GetFileName($resolvedPath)
        size           = $unencSize
        sizeEncrypted  = $encSize
        isDependency   = $false
    }
    $fileEntry = New-ContentFile -AppId $AppId -VersionId $versionId -Body $fileBody
    $fileId    = $fileEntry.id

    # Graph API provisions azureStorageUri asynchronously after the POST.
    # Poll GET .../files/{id} until the SAS URI is populated (up to 60 seconds).
    $sasUri           = $fileEntry.azureStorageUri
    $sasWaitSeconds   = 60
    $sasElapsed       = 0
    $sasPollInterval  = 5
    while ([string]::IsNullOrWhiteSpace($sasUri) -and $sasElapsed -lt $sasWaitSeconds) {
        Write-AppLog "Waiting for SAS URI to be provisioned... ($sasElapsed s elapsed)"
        Start-Sleep -Seconds $sasPollInterval
        $sasElapsed += $sasPollInterval
        $pollEntry = Get-ContentFileState -AppId $AppId -VersionId $versionId -FileId $fileId
        $sasUri    = $pollEntry.azureStorageUri
    }

    if ([string]::IsNullOrWhiteSpace($sasUri)) {
        throw "SAS URI not provisioned by Graph API for file entry $fileId after ${sasWaitSeconds}s"
    }
    Write-AppLog "SAS URI ready after $sasElapsed s"

    # Step 4: Upload the inner encrypted blob in chunks (stream directly from the ZIP entry)
    # The .intunewin outer file is a ZIP; the actual content to upload is the inner
    # IntunePackage.intunewin entry, not the outer ZIP wrapper.
    $chunkSize   = $script:ChunkSizeMB * 1MB
    $totalChunks = [Math]::Ceiling($encSize / $chunkSize)
    $blockIds    = [System.Collections.Generic.List[string]]::new()

    Write-AppLog "Uploading $totalChunks chunk(s) to Azure Blob..."

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($resolvedPath)
    $encEntry = $zip.Entries | Where-Object { $_.FullName -eq $encEntryPath } | Select-Object -First 1
    if (-not $encEntry) { throw "Encrypted entry '$encEntryPath' not found in ZIP at retry time" }
    $stream = $encEntry.Open()
    try {
        for ($i = 0; $i -lt $totalChunks; $i++) {
            if ($SharedState -and $SharedState['CancelRequested']) {
                throw "Upload cancelled by user"
            }

            $blockId = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($i.ToString('D6')))
            $blockIds.Add($blockId)

            $buffer = New-Object byte[] $chunkSize
            try {
                $bytesRead = $stream.Read($buffer, 0, $chunkSize)
            } catch {
                throw "Failed to read chunk $($i+1) from encrypted blob stream: $($_.Exception.Message)"
            }
            if ($bytesRead -lt $chunkSize) {
                $buffer = $buffer[0..($bytesRead - 1)]
            }

            $blockUrl = "$sasUri&comp=block&blockid=$([Uri]::EscapeDataString($blockId))"
            $headers  = @{ 'x-ms-blob-type' = 'BlockBlob' }

            # Retry up to 3 times per chunk (handles transient Azure storage errors and SAS expiry)
            $chunkAttempt = 0
            $chunkSuccess = $false
            while ($chunkAttempt -lt 3 -and -not $chunkSuccess) {
                $chunkAttempt++
                try {
                    Invoke-RestMethod -Method PUT -Uri $blockUrl -Headers $headers `
                        -Body $buffer -ContentType 'application/octet-stream' -ErrorAction Stop | Out-Null
                    $chunkSuccess = $true
                } catch {
                    $sc = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
                    if ($sc -eq 403 -and $chunkAttempt -lt 3) {
                        Write-AppLog "SAS URI expired (403) on chunk $($i+1) -- requesting new URI" -Level WARN
                        $oldSasUri = $sasUri
                        $pollEntry = Get-ContentFileState -AppId $AppId -VersionId $versionId -FileId $fileId
                        $sasUri    = $pollEntry.azureStorageUri
                        if ($sasUri -eq $oldSasUri) {
                            throw "Azure Blob upload failed on chunk $($i+1): SAS URI refresh returned unchanged URI (still expired)"
                        }
                        $blockUrl  = "$sasUri&comp=block&blockid=$([Uri]::EscapeDataString($blockId))"
                        continue  # retry with new URI
                    } elseif ($chunkAttempt -ge 3) {
                        throw "Azure Blob upload failed on chunk $($i+1) after 3 attempts: $($_.Exception.Message)"
                    }
                    # Non-403 transient error -- loop will retry
                }
            }

            $pct = [math]::Round(($i + 1) / $totalChunks * 100, 0)
            Write-AppLog "Chunk $($i+1)/$totalChunks uploaded ($pct%)"

            if ($OnProgress) {
                try { & $OnProgress ($i + 1) $totalChunks } catch {}
            }
        }
    } finally {
        $stream.Close()
        $zip.Dispose()
    }

    # Step 5: Finalize blob with block list
    Write-AppLog "Finalizing Azure Blob..."
    $blockEntries = ($blockIds | ForEach-Object { "<Latest>$_</Latest>" }) -join ''
    $blockListXml = "<?xml version=`"1.0`" encoding=`"utf-8`"?><BlockList>$blockEntries</BlockList>"

    $blockListUrl = "$sasUri&comp=blocklist"
    try {
        Invoke-RestMethod -Method PUT -Uri $blockListUrl `
            -Body ([Text.Encoding]::UTF8.GetBytes($blockListXml)) `
            -ContentType 'application/xml' -ErrorAction Stop | Out-Null
    } catch {
        $detail = ''
        try {
            $stream = $_.Exception.Response.GetResponseStream()
            $reader = [System.IO.StreamReader]::new($stream)
            $detail = " | Response: $($reader.ReadToEnd())"
            $reader.Close()
        } catch {}
        throw "Block list PUT failed (HTTP $([int]$_.Exception.Response.StatusCode))$detail"
    }
    Write-AppLog "Block list committed"

    # Step 6: Commit the file with encryption info
    # Guard: assert required Graph fields are present before sending
    if ($encInfo['@odata.type'] -ne '#microsoft.graph.fileEncryptionInfo') {
        throw "FileEncryptionInfo is missing required '@odata.type' field -- metadata extraction may have failed"
    }
    if ([string]::IsNullOrWhiteSpace($encInfo['encryptionKey'])) {
        throw "FileEncryptionInfo.encryptionKey is missing -- Detection.xml may be corrupt"
    }
    Commit-ContentFile -AppId $AppId -VersionId $versionId -FileId $fileId `
        -FileEncryptionInfo $encInfo

    # Step 7: Poll until commitFileSuccess
    Write-AppLog "Waiting for Intune to confirm commit..."
    $maxWaitSeconds  = 120
    $pollInterval    = 5
    $elapsed         = 0
    $committed       = $false

    while ($elapsed -lt $maxWaitSeconds) {
        Start-Sleep -Seconds $pollInterval
        $elapsed += $pollInterval

        if ($SharedState -and $SharedState['CancelRequested']) {
            throw "Upload cancelled during commit polling"
        }

        $state = Get-ContentFileState -AppId $AppId -VersionId $versionId -FileId $fileId
        Write-AppLog "Commit state: $($state.uploadState) ($elapsed s elapsed)"

        if ($state.uploadState -eq 'commitFileSuccess') {
            $committed = $true
            break
        }
        if ($state.uploadState -match 'error|fail') {
            throw "Commit failed with state: $($state.uploadState)"
        }
    }

    if (-not $committed) {
        throw "Commit did not reach commitFileSuccess within ${maxWaitSeconds}s"
    }

    # Step 8: Activate content version
    Set-CommittedContent -AppId $AppId -VersionId $versionId
    Write-AppLog "Upload complete -- app content version activated in Intune"

    return [PSCustomObject]@{
        AppId     = $AppId
        VersionId = $versionId
        FileId    = $fileId
    }
}

function Get-IntunewinMetadata {
    <#
    .SYNOPSIS
        Extracts all upload metadata from Detection.xml inside the .intunewin ZIP.
        Returns a hashtable with:
          - FileEncryptionInfo  : object for the Graph commit body
          - UnencryptedSize     : original installer size (Graph 'size' field)
          - EncryptedSize       : inner encrypted blob size (Graph 'sizeEncrypted' field)
          - EncryptedEntryPath  : zip entry path of the inner encrypted blob
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string]$IntuneWinPath
    )

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = $null
    try {
        $zip = [System.IO.Compression.ZipFile]::OpenRead($IntuneWinPath)
        $detectionEntry = $zip.Entries | Where-Object { $_.Name -eq 'Detection.xml' } | Select-Object -First 1

        if (-not $detectionEntry) {
            throw "Detection.xml not found inside $IntuneWinPath"
        }

        $detStream = $detectionEntry.Open()
        $reader    = [System.IO.StreamReader]::new($detStream)
        try {
            $xmlText = $reader.ReadToEnd()
        } finally {
            $reader.Close()
            $detStream.Dispose()
        }

        [xml]$xml = $xmlText

        $ei      = $xml.SelectSingleNode('//EncryptionInfo')
        $appInfo = $xml.SelectSingleNode('//ApplicationInfo')

        if (-not $ei)      { throw "EncryptionInfo element not found in Detection.xml" }
        if (-not $appInfo) { throw "ApplicationInfo element not found in Detection.xml" }

        # Validate required encryption fields
        $required = @('EncryptionKey','MacKey','InitializationVector','Mac','FileDigest','FileDigestAlgorithm')
        foreach ($field in $required) {
            if ([string]::IsNullOrWhiteSpace($ei.$field)) {
                throw "EncryptionInfo.$field is missing or empty in Detection.xml"
            }
        }

        # UnencryptedContentSize = size of the original installer before encryption
        $unencryptedSize = [long]$appInfo.UnencryptedContentSize
        if ($unencryptedSize -le 0) { throw "ApplicationInfo.UnencryptedContentSize is missing or zero" }

        # The encrypted blob is the inner IntunePackage.intunewin entry inside the ZIP
        $encryptedEntry = $zip.Entries | Where-Object { $_.Name -eq 'IntunePackage.intunewin' } | Select-Object -First 1
        if (-not $encryptedEntry) { throw "IntunePackage.intunewin entry not found inside $IntuneWinPath" }
        $encryptedSize = $encryptedEntry.Length  # uncompressed size of the encrypted blob

        # ProfileIdentifier from Detection.xml (always ProfileVersion1 but read from source)
        $profileId = if ($ei.ProfileIdentifier) { $ei.ProfileIdentifier } else { 'ProfileVersion1' }

        return @{
            FileEncryptionInfo = @{
                '@odata.type'        = '#microsoft.graph.fileEncryptionInfo'
                profileIdentifier    = $profileId
                encryptionKey        = $ei.EncryptionKey
                macKey               = $ei.MacKey
                initializationVector = $ei.InitializationVector
                mac                  = $ei.Mac
                fileDigest           = $ei.FileDigest
                fileDigestAlgorithm  = $ei.FileDigestAlgorithm
            }
            UnencryptedSize    = $unencryptedSize
            EncryptedSize      = $encryptedSize
            EncryptedEntryPath = $encryptedEntry.FullName
        }
    } finally {
        if ($zip) { $zip.Dispose() }
    }
}

Export-ModuleMember -Function Invoke-IntuneUpload, Get-IntunewinMetadata
