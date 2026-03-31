#Requires -Version 5.1
<#
.SYNOPSIS
    MSAL.NET authentication for IntuneManager.
    Uses the Microsoft Graph PowerShell client ID (pre-consented in all M365/Intune tenants).
    No Azure app registration required. User signs in with their Microsoft admin account.
    TenantId is extracted from the token result -- caller does NOT supply it.
    Token cache persisted to %APPDATA%\IntuneManager\token.cache (DPAPI protected).
#>

Set-StrictMode -Version Latest

#region Private state
$script:PCA          = $null   # PublicClientApplication
$script:AccessToken  = $null
$script:TokenExpiry  = $null
$script:TenantId     = $null
$script:Username     = $null
$script:AppDataDir   = $null
$script:Scopes       = [string[]]@(
    'https://graph.microsoft.com/DeviceManagementApps.ReadWrite.All',
    'https://graph.microsoft.com/DeviceManagementConfiguration.Read.All'
)
# Microsoft Graph PowerShell -- pre-consented enterprise app in all M365 tenants.
# No Azure app registration required.
$script:ClientId     = '14d82eec-204b-4c2f-b7e8-296a70dab67e'
$script:Authority    = 'https://login.microsoftonline.com/common'
#endregion

#region Helpers

function Get-AppDataDir {
    if ($script:AppDataDir) { return $script:AppDataDir }
    $dir = Join-Path $env:APPDATA 'IntuneManager'
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $script:AppDataDir = $dir
    return $dir
}

function Get-TokenCachePath {
    return Join-Path (Get-AppDataDir) 'token.cache'
}

function Save-TokenCache {
    param([byte[]]$Data)
    $encrypted = [System.Security.Cryptography.ProtectedData]::Protect(
        $Data, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    [System.IO.File]::WriteAllBytes((Get-TokenCachePath), $encrypted)
}

function Load-TokenCacheBytes {
    $path = Get-TokenCachePath
    if (-not (Test-Path $path)) { return $null }
    try {
        $encrypted = [System.IO.File]::ReadAllBytes($path)
        return [System.Security.Cryptography.ProtectedData]::Unprotect(
            $encrypted, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    } catch {
        Write-AppLog "Token cache unreadable (corrupt or wrong user profile) -- discarding: $($_.Exception.Message)" -Level WARN
        Remove-Item $path -Force -ErrorAction SilentlyContinue
        return $null
    }
}

function Initialize-PCA {
    # Ensure MSAL DLL is loaded
    $msalPath = Join-Path $PSScriptRoot '..\Assets\Microsoft.Identity.Client.dll'
    $msalPath = [IO.Path]::GetFullPath($msalPath)
    if (-not (Test-Path $msalPath)) {
        throw "MSAL DLL not found at: $msalPath"
    }
    $loaded = [System.AppDomain]::CurrentDomain.GetAssemblies() |
              Where-Object { $_.GetName().Name -eq 'Microsoft.Identity.Client' }
    if (-not $loaded) { Add-Type -Path $msalPath }

    # Compile a C# cache helper once per process — C# delegates work on non-PS threads
    if (-not ([System.Management.Automation.PSTypeName]'IntuneManager.MsalCacheHelper').Type) {
        Add-Type -ReferencedAssemblies $msalPath,'System.Security' -TypeDefinition @'
using System;
using System.IO;
using System.Security.Cryptography;
using System.Threading.Tasks;
using Microsoft.Identity.Client;

namespace IntuneManager {
    public class MsalCacheHelper {
        private readonly string _cachePath;
        public MsalCacheHelper(string cachePath) { _cachePath = cachePath; }

        public void BeforeAccess(TokenCacheNotificationArgs args) {
            if (!File.Exists(_cachePath)) return;
            try {
                byte[] encrypted = File.ReadAllBytes(_cachePath);
                byte[] data = ProtectedData.Unprotect(encrypted, null, DataProtectionScope.CurrentUser);
                args.TokenCache.DeserializeMsalV3(data);
            } catch { /* corrupt cache — ignore */ }
        }

        public void AfterAccess(TokenCacheNotificationArgs args) {
            if (!args.HasStateChanged) return;
            try {
                string dir = Path.GetDirectoryName(_cachePath);
                if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
                byte[] data = args.TokenCache.SerializeMsalV3();
                byte[] encrypted = ProtectedData.Protect(data, null, DataProtectionScope.CurrentUser);
                File.WriteAllBytes(_cachePath, encrypted);
            } catch { /* non-fatal */ }
        }

        // Returns a Func delegate for device code — PS can't cast method groups to Func<,> directly
        // Uses explicit delegate (not lambda) for .NET Framework 4.x C# compiler compatibility
        private static Task DeviceCodeCallbackImpl(DeviceCodeResult dcResult) {
            Console.WriteLine("[INFO] === Device Code Login ===");
            Console.WriteLine("[INFO] Go to: " + dcResult.VerificationUrl);
            Console.WriteLine("[INFO] Enter code: " + dcResult.UserCode);
            return Task.CompletedTask;
        }
        public static Func<DeviceCodeResult, Task> GetDeviceCodeCallback() {
            return new Func<DeviceCodeResult, Task>(DeviceCodeCallbackImpl);
        }

        // Return typed delegates so PS doesn't need to wrap them in scriptblocks
        // (PS scriptblocks fail on .NET thread pool threads — C# lambdas don't)
        // Uses explicit new TokenCacheCallback(...) for .NET Framework 4.x compatibility
        public TokenCacheCallback GetBeforeAccessDelegate() {
            return new TokenCacheCallback(BeforeAccess);
        }
        public TokenCacheCallback GetAfterAccessDelegate() {
            return new TokenCacheCallback(AfterAccess);
        }
    }
}
'@
    }

    $builder = [Microsoft.Identity.Client.PublicClientApplicationBuilder]::Create($script:ClientId)
    $builder = $builder.WithAuthority($script:Authority)
    $builder = $builder.WithRedirectUri('http://localhost')
    $pca = $builder.Build()

    # Wire up cache persistence using C# delegate methods — NOT PS scriptblocks
    # PS scriptblocks fail on .NET thread pool threads (no runspace); C# lambdas work anywhere
    $cacheHelper = [IntuneManager.MsalCacheHelper]::new((Get-TokenCachePath))
    $pca.UserTokenCache.SetBeforeAccess($cacheHelper.GetBeforeAccessDelegate())
    $pca.UserTokenCache.SetAfterAccess($cacheHelper.GetAfterAccessDelegate())

    $script:PCA = $pca
}

function Store-TokenResult {
    param($Result)
    $script:AccessToken = $Result.AccessToken
    $script:TokenExpiry = $Result.ExpiresOn.LocalDateTime
    $script:TenantId    = $Result.TenantId
    $script:Username    = $Result.Account.Username
}

#endregion

#region Public API

function Connect-IntuneManager {
    <#
    .SYNOPSIS
        Opens a Microsoft login prompt (system browser or device code).
        No tenant ID required -- the tenant is determined by which account the user signs in with.
        ParentWindowHandle: HWND of the parent WPF window. REQUIRED for interactive login on .NET Framework.
        Returns the signed-in username.
    #>
    [CmdletBinding()]
    param(
        [switch]$DeviceCode,
        [System.IntPtr]$ParentWindowHandle = [System.IntPtr]::Zero
    )

    Write-AppLog "Initializing MSAL (authority: $script:Authority, client: $script:ClientId)"
    Initialize-PCA

    if ($DeviceCode) {
        Write-AppLog "Starting device code flow..."
        # Use C# factory method -- PS can't cast method groups to Func<,> delegates directly
        $dcCallback = [IntuneManager.MsalCacheHelper]::GetDeviceCodeCallback()
        $result = $script:PCA.AcquireTokenWithDeviceCode($script:Scopes, $dcCallback).ExecuteAsync().GetAwaiter().GetResult()
    } else {
        Write-AppLog "Opening Microsoft login (system browser)..."
        # 10-minute timeout -- prevents indefinite UI freeze if user closes browser without completing login
        $cts = [System.Threading.CancellationTokenSource]::new([System.TimeSpan]::FromMinutes(10))
        try {
            $atiBuilder = $script:PCA.AcquireTokenInteractive($script:Scopes).WithUseEmbeddedWebView($false)
            # Parent HWND is required on .NET Framework -- without it AcquireTokenInteractive hangs silently
            if ($ParentWindowHandle -ne [System.IntPtr]::Zero) {
                $atiBuilder = $atiBuilder.WithParentActivityOrWindow($ParentWindowHandle)
            }
            $result = $atiBuilder.ExecuteAsync($cts.Token).GetAwaiter().GetResult()
        } catch [Microsoft.Identity.Client.MsalClientException] {
            # ErrorCode-based check is locale-stable and version-stable
            if ($_.Exception.ErrorCode -eq 'authentication_canceled') {
                throw "Login cancelled by user."
            }
            throw "Authentication failed: $($_.Exception.Message)"
        } catch [System.OperationCanceledException] {
            throw "Login timed out (10 minutes). Please try again."
        } catch {
            throw "Authentication failed ($($_.Exception.GetType().Name)): $($_.Exception.Message)"
        } finally {
            $cts.Dispose()
        }
    }

    Store-TokenResult $result
    Write-AppLog "Signed in as: $($script:Username) | Tenant: $($script:TenantId) | Expires: $($script:TokenExpiry.ToString('HH:mm:ss'))"
    return $script:Username
}

function Get-ValidAccessToken {
    <#
    .SYNOPSIS
        Returns a valid access token, refreshing silently if needed.
        Falls back to interactive login if silent refresh fails.
        Must be called on the STA UI thread if interactive fallback may occur.
    #>
    [CmdletBinding()]
    param()

    if (-not $script:PCA) { Initialize-PCA }

    $accounts = $script:PCA.GetAccountsAsync().GetAwaiter().GetResult()
    if ($accounts.Count -gt 0) {
        try {
            $result = $script:PCA.AcquireTokenSilent($script:Scopes, $accounts[0]).ExecuteAsync().GetAwaiter().GetResult()
            Store-TokenResult $result
            return $script:AccessToken
        } catch [Microsoft.Identity.Client.MsalUiRequiredException] {
            Write-AppLog "Silent refresh failed -- interactive login required" -Level WARN
        } catch {
            Write-AppLog "Silent token error: $($_.Exception.Message)" -Level WARN
        }
    }

    # Interactive fallback requires STA thread -- enforce before attempting
    if ([System.Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') {
        throw "Get-ValidAccessToken: silent refresh failed and interactive fallback requires STA thread. Call this function from the UI thread."
    }
    Write-AppLog "Re-authenticating interactively..."
    $cts = [System.Threading.CancellationTokenSource]::new([System.TimeSpan]::FromMinutes(5))
    try {
        $atiBuilder = $script:PCA.AcquireTokenInteractive($script:Scopes).WithUseEmbeddedWebView($false)
        $result = $atiBuilder.ExecuteAsync($cts.Token).GetAwaiter().GetResult()
    } finally {
        $cts.Dispose()
    }
    Store-TokenResult $result
    Save-TokenCache $script:PCA.UserTokenCache.SerializeMsalV3()
    return $script:AccessToken
}

function Disconnect-IntuneManager {
    [CmdletBinding()]
    param()
    if ($script:PCA) {
        $accounts = $script:PCA.GetAccountsAsync().GetAwaiter().GetResult()
        foreach ($acct in $accounts) {
            $script:PCA.RemoveAsync($acct).GetAwaiter().GetResult() | Out-Null
        }
    }
    $script:AccessToken = $null
    $script:TokenExpiry = $null
    $script:TenantId    = $null
    $script:Username    = $null
    $cachePath = Get-TokenCachePath
    if (Test-Path $cachePath) { Remove-Item $cachePath -Force }
    Write-AppLog "Disconnected and token cache cleared."
}

function Get-CachedToken {
    <#
    .SYNOPSIS
        Attempts a silent token acquisition from the on-disk cache.
        Returns the access token string if successful, otherwise $null.
        Called at startup to skip the login screen if already signed in.
        No TenantId parameter needed -- uses 'common' authority.
    #>
    [CmdletBinding()]
    param()

    $cachePath = Get-TokenCachePath
    if (-not (Test-Path $cachePath)) { return $null }

    try {
        Initialize-PCA
        $accounts = $script:PCA.GetAccountsAsync().GetAwaiter().GetResult()
        if ($accounts.Count -eq 0) { return $null }
        $result = $script:PCA.AcquireTokenSilent($script:Scopes, $accounts[0]).ExecuteAsync().GetAwaiter().GetResult()
        Store-TokenResult $result
        return $result.AccessToken
    } catch {
        Write-AppLog "Get-CachedToken failed: $($_.Exception.Message)" -Level WARN
        return $null
    }
}

function Get-AuthStatus {
    [CmdletBinding()]
    param()
    return [PSCustomObject]@{
        IsConnected  = ($null -ne $script:AccessToken)
        Username     = $script:Username
        TenantId     = $script:TenantId
        TokenExpiry  = $script:TokenExpiry
        ExpiresInMin = if ($script:TokenExpiry) {
            [math]::Round(($script:TokenExpiry - (Get-Date)).TotalMinutes, 0)
        } else { $null }
    }
}

function Get-CurrentAccessToken {
    [CmdletBinding()]
    param()
    return $script:AccessToken
}

function Get-CurrentTenantId {
    [CmdletBinding()]
    param()
    return $script:TenantId
}

#endregion

Export-ModuleMember -Function Connect-IntuneManager, Get-ValidAccessToken,
                               Disconnect-IntuneManager, Get-CachedToken,
                               Get-AuthStatus, Get-CurrentAccessToken, Get-CurrentTenantId
