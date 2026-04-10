#Requires -Version 7.0
param([string]$AccessToken = '')
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

function Write-Log([string]$Message, [string]$Level = 'INFO') {
    Write-Output "LOG:[$Level] $Message"
}

try {
    if (-not $AccessToken) { throw 'AccessToken is required' }

    Write-Log 'Fetching managed devices from Intune...'

    $headers = @{ Authorization = "Bearer $AccessToken" }
    $select = 'id,deviceName,userPrincipalName,operatingSystem,osVersion,' +
              'complianceState,managementState,enrolledDateTime,lastSyncDateTime,' +
              'deviceEnrollmentType,joinType,' +
              'windowsProtectionState,configurationManagerClientHealthState'

    $uri = 'https://graph.microsoft.com/beta/deviceManagement/managedDevices' +
           "?`$select=$select&`$top=999"

    $allDevices = [System.Collections.Generic.List[object]]::new()
    $nextUri = $uri
    while ($nextUri) {
        $response = Invoke-RestMethod -Method GET -Uri $nextUri -Headers $headers
        if ($response.value) { $allDevices.AddRange([object[]]$response.value) }
        $nextUri = $response.'@odata.nextLink'
    }

    Write-Log "Retrieved $($allDevices.Count) managed device(s)"

    $deviceList = $allDevices | ForEach-Object {
        $dev = $_

        $winUpdateStatus = 'unknown'
        $driverUpdateStatus = 'unknown'
        $fMalwareProtectionEnabled  = $false
        $fRealTimeProtectionEnabled = $false
        $fSignatureUpdateOverdue    = $false
        $fQuickScanOverdue          = $false
        $fRebootRequired            = $false

        try {
            if ($dev.windowsProtectionState) {
                $wps = $dev.windowsProtectionState
                $rtEnabled   = $wps.realTimeProtectionEnabled -eq $true
                $scanPending = $null -ne $wps.pendingFullScanCount -and [int]$wps.pendingFullScanCount -gt 0
                if ($rtEnabled -and -not $scanPending) {
                    $winUpdateStatus = 'updated'
                } elseif ($scanPending) {
                    $winUpdateStatus = 'needsUpdate'
                }
                $fMalwareProtectionEnabled  = [bool]$wps.malwareProtectionEnabled
                $fRealTimeProtectionEnabled = [bool]$wps.realTimeProtectionEnabled
                $fSignatureUpdateOverdue    = [bool]$wps.signatureUpdateOverdue
                $fQuickScanOverdue          = [bool]$wps.quickScanOverdue
                $fRebootRequired            = [bool]$wps.rebootRequired
            }
        } catch { $winUpdateStatus = 'unknown' }

        $compliance = $dev.complianceState ?? 'unknown'

        $hasDiagnostics = $false
        try {
            if ($dev.configurationManagerClientHealthState -and $dev.configurationManagerClientHealthState -ne '') {
                $hasDiagnostics = $true
            }
        } catch { $hasDiagnostics = $false }

        $needsAttention = (
            $compliance -eq 'noncompliant' -or
            $compliance -eq 'inGracePeriod' -or
            $winUpdateStatus -eq 'needsUpdate' -or
            $driverUpdateStatus -eq 'needsUpdate' -or
            $hasDiagnostics
        )

        @{
            id                        = [string]$dev.id
            deviceName                = [string]($dev.deviceName ?? '')
            userPrincipalName         = [string]($dev.userPrincipalName ?? '')
            operatingSystem           = [string]($dev.operatingSystem ?? '')
            osVersion                 = [string]($dev.osVersion ?? '')
            complianceState           = [string]$compliance
            managementState           = [string]($dev.managementState ?? '')
            enrolledDateTime          = [string]($dev.enrolledDateTime ?? '')
            lastSyncDateTime          = [string]($dev.lastSyncDateTime ?? '')
            windowsUpdateStatus       = [string]$winUpdateStatus
            driverUpdateStatus        = [string]$driverUpdateStatus
            hasDiagnostics            = [bool]$hasDiagnostics
            needsAttention            = [bool]$needsAttention
            deviceEnrollmentType      = [string]($dev.deviceEnrollmentType ?? '')
            joinType                  = [string]($dev.joinType ?? '')
            malwareProtectionEnabled  = [bool]$fMalwareProtectionEnabled
            realTimeProtectionEnabled = [bool]$fRealTimeProtectionEnabled
            signatureUpdateOverdue    = [bool]$fSignatureUpdateOverdue
            quickScanOverdue          = [bool]$fQuickScanOverdue
            rebootRequired            = [bool]$fRebootRequired
        }
    }

    Write-Output "RESULT:$(ConvertTo-Json @{ success = $true; devices = @($deviceList) } -Compress -Depth 5)"
} catch {
    Write-Output "RESULT:$(ConvertTo-Json @{ success = $false; devices = @(); error = $_.Exception.Message } -Compress)"
}
