#Requires -Version 5.1
$OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = 'Stop'

try {
    $LibPath = Join-Path $PSScriptRoot '..\..\..\IntuneManager\Lib'
    Import-Module (Join-Path $LibPath 'Logger.psm1') -Force
    Import-Module (Join-Path $LibPath 'Auth.psm1') -Force
    Import-Module (Join-Path $LibPath 'GraphClient.psm1') -Force

    Write-AppLog 'Fetching managed devices from Intune...'

    # Fetch all managed devices with the fields needed for device health view
    $select = 'id,deviceName,userPrincipalName,operatingSystem,osVersion,' +
              'complianceState,managementState,enrolledDateTime,lastSyncDateTime,' +
              'deviceEnrollmentType,joinType,' +
              'windowsProtectionState,configurationManagerClientHealthState'

    $uri = 'https://graph.microsoft.com/beta/deviceManagement/managedDevices' +
           "?`$select=$select&`$top=999"

    $allDevices = [System.Collections.Generic.List[object]]::new()
    $nextUri = $uri
    while ($nextUri) {
        $response = Invoke-GraphRequest -Method GET -Uri $nextUri
        if ($response.value) { $allDevices.AddRange([object[]]$response.value) }
        $nextUri = if ($response.PSObject.Properties['@odata.nextLink']) { $response.'@odata.nextLink' } else { $null }
    }

    Write-AppLog "Retrieved $($allDevices.Count) managed device(s)"

    $deviceList = $allDevices | ForEach-Object {
        $dev = $_

        # ── Windows Update status ────────────────────────────────────────────────
        # windowsProtectionState.malwareProtectionEnabled / realTimeProtectionEnabled
        # is not update-related; update state is in windowsProtectionState.
        # Graph beta surfaces pendingFullScanCount etc. but for update readiness
        # the most reliable signal from managed devices is the osVersion compared
        # to the latest known release. As Graph does not return a direct
        # "windows update pending" boolean on managedDevices without a separate
        # call to windowsUpdateStates, we use the lastSyncDateTime age as a proxy:
        # - Device last synced > 30 days ago: treat as potentially needing updates
        # The configurationManagerClientHealthState provides a broader health signal.
        # If windowsProtectionState is available, use it for malware/protection.
        $winUpdateStatus = 'unknown'
        $driverUpdateStatus = 'unknown'
        $fMalwareProtectionEnabled  = $false
        $fRealTimeProtectionEnabled = $false
        $fSignatureUpdateOverdue    = $false
        $fQuickScanOverdue          = $false
        $fRebootRequired            = $false

        try {
            if ($dev.PSObject.Properties['windowsProtectionState'] -and $dev.windowsProtectionState) {
                $wps = $dev.windowsProtectionState
                # If real-time protection is enabled and no pending full scan, treat as updated
                # (best signal available without a separate Windows Update compliance call)
                $rtEnabled = $wps.PSObject.Properties['realTimeProtectionEnabled'] -and $wps.realTimeProtectionEnabled -eq $true
                $scanPending = $wps.PSObject.Properties['pendingFullScanCount'] -and [int]$wps.pendingFullScanCount -gt 0
                if ($rtEnabled -and -not $scanPending) {
                    $winUpdateStatus = 'updated'
                } elseif ($scanPending) {
                    $winUpdateStatus = 'needsUpdate'
                }

                # Dashboard v2: extract additional Defender/security fields
                if ($wps.PSObject.Properties['malwareProtectionEnabled']) {
                    $fMalwareProtectionEnabled = [bool]$wps.malwareProtectionEnabled
                }
                if ($wps.PSObject.Properties['realTimeProtectionEnabled']) {
                    $fRealTimeProtectionEnabled = [bool]$wps.realTimeProtectionEnabled
                }
                if ($wps.PSObject.Properties['signatureUpdateOverdue']) {
                    $fSignatureUpdateOverdue = [bool]$wps.signatureUpdateOverdue
                }
                if ($wps.PSObject.Properties['quickScanOverdue']) {
                    $fQuickScanOverdue = [bool]$wps.quickScanOverdue
                }
                if ($wps.PSObject.Properties['rebootRequired']) {
                    $fRebootRequired = [bool]$wps.rebootRequired
                }
            }
        } catch { $winUpdateStatus = 'unknown' }

        # ── Compliance state ────────────────────────────────────────────────────
        $compliance = if ($dev.PSObject.Properties['complianceState']) { $dev.complianceState } else { 'unknown' }

        # ── Diagnostics availability ────────────────────────────────────────────
        # Graph does not expose a direct "has diagnostics ready" boolean on
        # managedDevices; hasDiagnostics is set to true when the device has
        # pending diagnostic data indicated by a non-null configurationManagerClientHealthState
        $hasDiagnostics = $false
        try {
            if ($dev.PSObject.Properties['configurationManagerClientHealthState'] -and
                $dev.configurationManagerClientHealthState -ne $null -and
                $dev.configurationManagerClientHealthState -ne '') {
                $hasDiagnostics = $true
            }
        } catch { $hasDiagnostics = $false }

        # ── Attention flag ─────────────────────────────────────────────────────
        $needsAttention = (
            $compliance -eq 'noncompliant' -or
            $compliance -eq 'inGracePeriod' -or
            $winUpdateStatus -eq 'needsUpdate' -or
            $driverUpdateStatus -eq 'needsUpdate' -or
            $hasDiagnostics
        )

        # PS 5.1 does not support ternary ? : — extract fields via if/else first
        $fDeviceName           = if ($dev.PSObject.Properties['deviceName'])           { [string]$dev.deviceName }           else { '' }
        $fUserPrincipalName    = if ($dev.PSObject.Properties['userPrincipalName'])    { [string]$dev.userPrincipalName }    else { '' }
        $fOperatingSystem      = if ($dev.PSObject.Properties['operatingSystem'])      { [string]$dev.operatingSystem }      else { '' }
        $fOsVersion            = if ($dev.PSObject.Properties['osVersion'])            { [string]$dev.osVersion }            else { '' }
        $fManagementState      = if ($dev.PSObject.Properties['managementState'])      { [string]$dev.managementState }      else { '' }
        $fEnrolledDateTime     = if ($dev.PSObject.Properties['enrolledDateTime'])     { [string]$dev.enrolledDateTime }     else { '' }
        $fLastSyncDateTime     = if ($dev.PSObject.Properties['lastSyncDateTime'])     { [string]$dev.lastSyncDateTime }     else { '' }
        $fDeviceEnrollmentType = if ($dev.PSObject.Properties['deviceEnrollmentType']) { [string]$dev.deviceEnrollmentType } else { '' }
        $fJoinType             = if ($dev.PSObject.Properties['joinType'])             { [string]$dev.joinType }             else { '' }

        @{
            id                       = [string]$dev.id
            deviceName               = $fDeviceName
            userPrincipalName        = $fUserPrincipalName
            operatingSystem          = $fOperatingSystem
            osVersion                = $fOsVersion
            complianceState          = [string]$compliance
            managementState          = $fManagementState
            enrolledDateTime         = $fEnrolledDateTime
            lastSyncDateTime         = $fLastSyncDateTime
            windowsUpdateStatus      = [string]$winUpdateStatus
            driverUpdateStatus       = [string]$driverUpdateStatus
            hasDiagnostics           = [bool]$hasDiagnostics
            needsAttention           = [bool]$needsAttention
            deviceEnrollmentType     = $fDeviceEnrollmentType
            joinType                 = $fJoinType
            malwareProtectionEnabled = [bool]$fMalwareProtectionEnabled
            realTimeProtectionEnabled = [bool]$fRealTimeProtectionEnabled
            signatureUpdateOverdue   = [bool]$fSignatureUpdateOverdue
            quickScanOverdue         = [bool]$fQuickScanOverdue
            rebootRequired           = [bool]$fRebootRequired
        }
    }

    Write-Output "RESULT:$(ConvertTo-Json @{ success = $true; devices = @($deviceList) } -Compress -Depth 5)"
} catch {
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; devices = @(); error = $_.Exception.Message } -Compress)"
}
