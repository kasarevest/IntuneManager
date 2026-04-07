#Requires -Version 5.1
<#
.SYNOPSIS
    Microsoft Graph API client for IntuneManager.
    All calls use raw Invoke-RestMethod -- no Graph SDK required.
    Handles 429 rate limiting (Retry-After), @odata.nextLink pagination,
    and 403 permission errors with actionable messages.
#>

Set-StrictMode -Version Latest

$script:GraphBase       = 'https://graph.microsoft.com/beta'
$script:InjectedToken   = $null   # set by Set-GraphAccessToken when called from server

function Set-GraphAccessToken {
    <#
    .SYNOPSIS
        Injects a pre-fetched OAuth2 access token so Invoke-GraphRequest does not
        call Get-ValidAccessToken (MSAL.NET — Windows only).
        Called by PS scripts that receive -AccessToken from the Node.js server.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Token)
    $script:InjectedToken = $Token
}

#region Core request helper

function Invoke-GraphRequest {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [ValidateSet('GET','POST','PATCH','PUT','DELETE')] [string]$Method,
        [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string]$Uri,
        [hashtable]$Body,
        [string]$ContentType = 'application/json',
        [switch]$NoAuth  # for Azure Blob calls -- SAS URI is self-authorizing
    )

    $headers = @{ 'Accept' = 'application/json' }
    if (-not $NoAuth) {
        $token = if ($script:InjectedToken) { $script:InjectedToken } else { Get-ValidAccessToken }
        $headers['Authorization'] = "Bearer $token"
    }

    $bodyJson = $null
    if ($Body) {
        $bodyJson = $Body | ConvertTo-Json -Depth 20 -Compress
    }

    $maxRetries = 3
    $attempt    = 0
    while ($attempt -lt $maxRetries) {
        $attempt++
        try {
            $params = @{
                Method      = $Method
                Uri         = $Uri
                Headers     = $headers
                ContentType = $ContentType
                ErrorAction = 'Stop'
            }
            if ($bodyJson) { $params['Body'] = $bodyJson }

            $response = Invoke-RestMethod @params
            return $response
        } catch {
            $statusCode = $null
            if ($_.Exception.Response) {
                $statusCode = [int]$_.Exception.Response.StatusCode
            }

            if ($statusCode -eq 429) {
                $retryAfter = 30
                try {
                    $ra = $_.Exception.Response.Headers['Retry-After']
                    if ($ra) { $retryAfter = [int]$ra }
                } catch {}
                Write-AppLog "Graph 429 rate limit -- waiting ${retryAfter}s before retry $attempt/$maxRetries" -Level WARN
                Start-Sleep -Seconds $retryAfter
                continue
            }

            if ($statusCode -eq 403) {
                throw "Graph API 403 Forbidden on $Uri -- Required permissions not consented. Contact your Intune administrator to grant: DeviceManagementApps.ReadWrite.All, DeviceManagementConfiguration.Read.All"
            }

            if ($statusCode -eq 401) {
                throw "Graph API 401 Unauthorized -- token may have expired. Re-authenticate and try again."
            }

            # Capture Graph error response body for actionable error messages
            $responseDetail = ''
            try {
                $errStream = $_.Exception.Response.GetResponseStream()
                $errReader = [System.IO.StreamReader]::new($errStream)
                $responseDetail = " | $($errReader.ReadToEnd())"
                $errReader.Close()
            } catch {}

            $statusLabel = if ($null -ne $statusCode) { $statusCode } else { 'network error' }
            throw "Graph API $Method $Uri failed (HTTP $statusLabel): $($_.Exception.Message)$responseDetail"
        }
    }
    throw "Graph API $Method $Uri failed after $maxRetries retries"
}

function Invoke-GraphRequestPaged {
    <#
    .SYNOPSIS
        Calls Invoke-GraphRequest and follows @odata.nextLink until all pages are collected.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]$Uri
    )

    $allItems = [System.Collections.Generic.List[object]]::new()
    $nextUri  = $Uri

    while ($nextUri) {
        $response = Invoke-GraphRequest -Method GET -Uri $nextUri
        if ($response.value) {
            $allItems.AddRange([object[]]$response.value)
        }
        $nextUri = if ($response.PSObject.Properties['@odata.nextLink']) { $response.'@odata.nextLink' } else { $null }
    }

    return $allItems.ToArray()
}

#endregion

#region Win32 App functions

function Get-IntuneWin32Apps {
    [CmdletBinding()]
    param()

    Write-AppLog "Fetching Win32 apps from Intune..."
    # Note: displayVersion is a subtype property (win32LobApp), not on base mobileApp.
    # $select only works with base type properties; omit it and let Graph return all fields.
    $filter = "isof('microsoft.graph.win32LobApp')"
    $uri    = "$script:GraphBase/deviceAppManagement/mobileApps?`$filter=$filter"

    $apps = Invoke-GraphRequestPaged -Uri $uri
    Write-AppLog "Retrieved $($apps.Count) Win32 app(s) from Intune"
    return $apps
}

function Get-AppAssignments {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string]$AppId
    )

    $uri = "$script:GraphBase/deviceAppManagement/mobileApps/$AppId/assignments"
    $response = Invoke-GraphRequest -Method GET -Uri $uri
    return $response.value
}

function New-Win32App {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [hashtable]$Body
    )

    Write-AppLog "Creating new Win32 app: $($Body.displayName)"
    $uri = "$script:GraphBase/deviceAppManagement/mobileApps"
    $result = Invoke-GraphRequest -Method POST -Uri $uri -Body $Body
    Write-AppLog "App created with ID: $($result.id)"
    return $result
}

function Update-Win32App {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string]$AppId,
        [Parameter(Mandatory)] [hashtable]$Body
    )

    Write-AppLog "Updating app metadata: $AppId"
    $uri = "$script:GraphBase/deviceAppManagement/mobileApps/$AppId"
    $result = Invoke-GraphRequest -Method PATCH -Uri $uri -Body $Body
    return $result
}

function New-ContentVersion {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string]$AppId
    )

    $uri = "$script:GraphBase/deviceAppManagement/mobileApps/$AppId/microsoft.graph.win32LobApp/contentVersions"
    $result = Invoke-GraphRequest -Method POST -Uri $uri -Body @{}
    Write-AppLog "Content version created: $($result.id)"
    return $result.id
}

function New-ContentFile {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string]$AppId,
        [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string]$VersionId,
        [Parameter(Mandatory)] [hashtable]$Body
    )

    $uri = "$script:GraphBase/deviceAppManagement/mobileApps/$AppId/microsoft.graph.win32LobApp/contentVersions/$VersionId/files"
    $result = Invoke-GraphRequest -Method POST -Uri $uri -Body $Body
    Write-AppLog "Content file entry created: $($result.id) | SAS URI obtained"
    return $result
}

function Get-ContentFileState {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string]$AppId,
        [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string]$VersionId,
        [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string]$FileId
    )

    $uri = "$script:GraphBase/deviceAppManagement/mobileApps/$AppId/microsoft.graph.win32LobApp/contentVersions/$VersionId/files/$FileId"
    return Invoke-GraphRequest -Method GET -Uri $uri
}

function Commit-ContentFile {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string]$AppId,
        [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string]$VersionId,
        [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string]$FileId,
        [Parameter(Mandatory)] [hashtable]$FileEncryptionInfo
    )

    # Build JSON manually to preserve @odata.type key and avoid ConvertTo-Hashtable round-trip
    # (PS 5.1 ConvertTo-Json on nested hashtables with @odata.type keys produces malformed output)
    $uri   = "$script:GraphBase/deviceAppManagement/mobileApps/$AppId/microsoft.graph.win32LobApp/contentVersions/$VersionId/files/$FileId/commit"
    $token = if ($script:InjectedToken) { $script:InjectedToken } else { Get-ValidAccessToken }

    $bodyObj = @{ fileEncryptionInfo = $FileEncryptionInfo }
    $bodyJson = $bodyObj | ConvertTo-Json -Depth 10 -Compress

    $req = [System.Net.HttpWebRequest]::Create($uri)
    $req.Method = 'POST'
    $req.ContentType = 'application/json'
    $req.Accept = 'application/json'
    $req.Headers.Add('Authorization', "Bearer $token")
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($bodyJson)
    $req.ContentLength = $bytes.Length
    $reqStream = $req.GetRequestStream()
    $reqStream.Write($bytes, 0, $bytes.Length)
    $reqStream.Close()

    try {
        $resp = $req.GetResponse()
        $resp.Close()
    } catch [System.Net.WebException] {
        $detail = $_.Exception.Message
        if ($_.Exception.Response) {
            $errReader = $null
            try {
                $errReader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
                $detail = $errReader.ReadToEnd()
            } catch {} finally {
                if ($errReader) { $errReader.Dispose() }
            }
        }
        throw "Commit POST failed (HTTP $([int]$_.Exception.Response.StatusCode)): $detail"
    }

    Write-AppLog "Commit request sent for file: $FileId"
}

function Set-CommittedContent {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string]$AppId,
        [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string]$VersionId
    )

    Write-AppLog "Activating content version: $VersionId"
    $body = @{ committedContentVersion = $VersionId }
    $uri  = "$script:GraphBase/deviceAppManagement/mobileApps/$AppId"
    Invoke-GraphRequest -Method PATCH -Uri $uri -Body $body | Out-Null
    Write-AppLog "Content version committed successfully"
}

function Get-Win32AppById {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string]$AppId
    )
    $uri = "$script:GraphBase/deviceAppManagement/mobileApps/$AppId"
    return Invoke-GraphRequest -Method GET -Uri $uri
}

#endregion

Export-ModuleMember -Function Set-GraphAccessToken, Invoke-GraphRequest,
                               Get-IntuneWin32Apps, Get-AppAssignments,
                               New-Win32App, Update-Win32App, New-ContentVersion,
                               New-ContentFile, Get-ContentFileState, Commit-ContentFile,
                               Set-CommittedContent, Get-Win32AppById
