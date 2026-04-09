#Requires -Version 5.1
<#
.SYNOPSIS
    Phase 5 - one-time setup: creates Azure File Shares for source and output
    files, registers them with the Container Apps environment, and mounts them
    into the Container App at /mnt/source and /mnt/output.

.DESCRIPTION
    Creates (idempotent — safe to re-run):
      - Storage account in rg-intunemanager-prod (reuses existing if found)
      - Azure File Share: source-files  → mounted at /mnt/source
      - Azure File Share: output-files  → mounted at /mnt/output

    Then:
      - Registers each share with the Container Apps environment storage
      - Patches the Container App to add volumes + volume mounts
      - Prints the path values to configure in the app (source_root_path /
        output_folder_path settings)

    Prerequisites:
      - az CLI installed and logged in  (az login)
      - Contributor or Owner on rg-intunemanager-prod
      - Storage Account Contributor on the subscription/resource group

.EXAMPLE
    .\scripts\setup-storage-mounts.ps1
#>
[CmdletBinding()]
param(
    [string]$StorageAccountName = '',   # leave blank to auto-detect / create
    [int]$ShareQuotaGiB = 100
)

$ErrorActionPreference = 'Stop'

$CA_NAME      = 'ca-intunemanager-prod'
$RG_NAME      = 'rg-intunemanager-prod'
$LOCATION     = 'eastus'
$DEFAULT_ST   = 'stintunemgrprod'       # used only if no storage account found
$SOURCE_SHARE = 'source-files'
$OUTPUT_SHARE = 'output-files'
$SOURCE_ENV   = 'source-storage'        # Container Apps environment storage name
$OUTPUT_ENV   = 'output-storage'
$MOUNT_SOURCE = '/mnt/source'
$MOUNT_OUTPUT = '/mnt/output'
$API_VER      = '2024-03-01'

function Log([string]$msg) { Write-Host "[setup-storage] $msg" }
function LogOk([string]$msg) { Write-Host "[setup-storage] OK — $msg" -ForegroundColor Green }
function LogWarn([string]$msg) { Write-Host "[setup-storage] WARN — $msg" -ForegroundColor Yellow }

# ── 1. Resolve / create storage account ──────────────────────────────────────
Log "Checking for existing storage accounts in '$RG_NAME'..."

if ($StorageAccountName) {
    $ST_NAME = $StorageAccountName
    Log "Using supplied storage account name: $ST_NAME"
} else {
    $accounts = az storage account list --resource-group $RG_NAME --output json | ConvertFrom-Json
    if ($accounts -and $accounts.Count -gt 0) {
        $ST_NAME = $accounts[0].name
        LogOk "Found existing storage account: $ST_NAME"
    } else {
        $ST_NAME = $DEFAULT_ST
        Log "No storage account found. Creating '$ST_NAME'..."
        az storage account create `
            --name $ST_NAME `
            --resource-group $RG_NAME `
            --location $LOCATION `
            --sku Standard_LRS `
            --kind StorageV2 `
            --enable-large-file-share `
            --output none
        LogOk "Created storage account: $ST_NAME"
    }
}

Log "Fetching storage account key..."
$ST_KEY = az storage account keys list `
    --account-name $ST_NAME `
    --resource-group $RG_NAME `
    --query '[0].value' `
    --output tsv

if (-not $ST_KEY) { throw "Could not retrieve key for storage account '$ST_NAME'." }
LogOk "Storage key retrieved."

# ── 2. Create file shares (idempotent) ────────────────────────────────────────
foreach ($share in @($SOURCE_SHARE, $OUTPUT_SHARE)) {
    Log "Ensuring file share '$share' exists..."
    $existing = az storage share-rm list `
        --storage-account $ST_NAME `
        --resource-group $RG_NAME `
        --query "[?name=='$share']" `
        --output json | ConvertFrom-Json
    if ($existing -and $existing.Count -gt 0) {
        LogOk "Share '$share' already exists — skipping."
    } else {
        az storage share-rm create `
            --storage-account $ST_NAME `
            --resource-group $RG_NAME `
            --name $share `
            --quota $ShareQuotaGiB `
            --output none
        LogOk "Created share '$share' (quota: ${ShareQuotaGiB} GiB)."
    }
}

# ── 3. Resolve Container Apps environment name ────────────────────────────────
Log "Reading Container App configuration..."
$caJson = az containerapp show `
    --name $CA_NAME `
    --resource-group $RG_NAME `
    --output json | ConvertFrom-Json

$envResourceId = $caJson.properties.managedEnvironmentId
$CA_ENV_NAME   = $envResourceId.Split('/')[-1]
Log "Container Apps environment: $CA_ENV_NAME"

# ── 4. Register file shares with Container Apps environment (idempotent) ──────
foreach ($entry in @(
    [PSCustomObject]@{ EnvName = $SOURCE_ENV; Share = $SOURCE_SHARE },
    [PSCustomObject]@{ EnvName = $OUTPUT_ENV; Share = $OUTPUT_SHARE }
)) {
    Log "Registering env storage '$($entry.EnvName)' → share '$($entry.Share)'..."
    az containerapp env storage set `
        --name $CA_ENV_NAME `
        --resource-group $RG_NAME `
        --storage-name $entry.EnvName `
        --azure-file-account-name $ST_NAME `
        --azure-file-account-key $ST_KEY `
        --azure-file-share-name $entry.Share `
        --access-mode ReadWrite `
        --output none
    LogOk "Env storage '$($entry.EnvName)' registered."
}

# ── 5. Patch Container App to add volumes + volume mounts ─────────────────────
Log "Patching Container App with volume mounts..."

# Work on the full properties object (REST PATCH preserves unset fields)
$patch = $caJson | ConvertTo-Json -Depth 30 | ConvertFrom-Json

# ─ Volumes (add/replace; keep any existing non-storage volumes) ────────────
$newVolumes = @(
    [PSCustomObject]@{ name = $SOURCE_ENV; storageType = 'AzureFile'; storageName = $SOURCE_ENV },
    [PSCustomObject]@{ name = $OUTPUT_ENV; storageType = 'AzureFile'; storageName = $OUTPUT_ENV }
)
$existingVolumes = @()
if ($patch.properties.template.PSObject.Properties['volumes'] -and $patch.properties.template.volumes) {
    $existingVolumes = @($patch.properties.template.volumes | Where-Object { $_.name -notin @($SOURCE_ENV, $OUTPUT_ENV) })
}
$patch.properties.template | Add-Member -MemberType NoteProperty -Name 'volumes' -Value ($existingVolumes + $newVolumes) -Force

# ─ Volume mounts (add/replace; keep any existing non-storage mounts) ──────
$newMounts = @(
    [PSCustomObject]@{ volumeName = $SOURCE_ENV; mountPath = $MOUNT_SOURCE },
    [PSCustomObject]@{ volumeName = $OUTPUT_ENV; mountPath = $MOUNT_OUTPUT }
)
$container = $patch.properties.template.containers[0]
$existingMounts = @()
if ($container.PSObject.Properties['volumeMounts'] -and $container.volumeMounts) {
    $existingMounts = @($container.volumeMounts | Where-Object { $_.volumeName -notin @($SOURCE_ENV, $OUTPUT_ENV) })
}
$container | Add-Member -MemberType NoteProperty -Name 'volumeMounts' -Value ($existingMounts + $newMounts) -Force
$patch.properties.template.containers[0] = $container

# ─ Strip properties added by newer API versions that older versions reject ─
# identitySettings and runtime are not in the 2024-03-01 ContainerAppConfiguration
# schema; sending them causes a 400. PATCH in ARM merges at top level, so
# omitting them here does not remove them from the live resource.
foreach ($unsupported in @('identitySettings', 'runtime')) {
    if ($patch.properties.PSObject.Properties[$unsupported]) {
        $patch.properties.PSObject.Properties.Remove($unsupported)
        Log "  Stripped unsupported property '$unsupported' from PATCH body."
    }
}

# ─ Write PATCH body to temp file and apply ────────────────────────────────
$tmpFile = [System.IO.Path]::GetTempFileName()
try {
    $patch | ConvertTo-Json -Depth 30 | Out-File -FilePath $tmpFile -Encoding utf8 -NoNewline

    $sub = az account show --query id --output tsv
    $patchUrl = "https://management.azure.com/subscriptions/${sub}/resourceGroups/${RG_NAME}/providers/Microsoft.App/containerApps/${CA_NAME}?api-version=${API_VER}"

    $restOut = az rest `
        --method patch `
        --uri $patchUrl `
        --headers 'Content-Type=application/json' `
        --body "@${tmpFile}" `
        --output json 2>&1

    if ($LASTEXITCODE -ne 0) {
        throw "az rest PATCH failed (exit $LASTEXITCODE): $restOut"
    }

    LogOk "Container App patched with volume mounts."
} finally {
    Remove-Item -Path $tmpFile -Force -ErrorAction SilentlyContinue
}

# ── 6. Summary ────────────────────────────────────────────────────────────────
Log ""
Log "=================================================================="
Log "Phase 5 complete — Azure File Storage mounted."
Log ""
Log "Mounts:"
Log "  /mnt/source  ← Azure File Share '$SOURCE_SHARE' (${ST_NAME})"
Log "  /mnt/output  ← Azure File Share '$OUTPUT_SHARE' (${ST_NAME})"
Log ""
Log "Update these app settings in the portal or via Settings page:"
Log "  source_root_path    = $MOUNT_SOURCE"
Log "  output_folder_path  = $MOUNT_OUTPUT"
Log ""
Log "Verify:"
Log "  Portal: Container App > Revisions → latest revision shows new volumes"
Log "  Portal: Container Apps Environment > Storage → source-storage, output-storage"
Log "  Portal: Storage Account > File shares → source-files, output-files"
Log "=================================================================="
