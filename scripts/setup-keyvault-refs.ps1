#Requires -Version 5.1
<#
.SYNOPSIS
    Phase 4b — one-time setup: stores secrets in Azure Key Vault and wires
    them as Key Vault references on the Container App via Managed Identity.

.DESCRIPTION
    Run this ONCE before pushing the Phase 4b workflow update (which removes
    --set-env-vars from the CI deploy step). Order matters:
      1. Run this script  (configures KV refs so Container App can read them)
      2. Push workflow    (removes plaintext --set-env-vars from CI)

    Prerequisites:
      - az CLI installed and logged in (az login)
      - You are Owner or Contributor on rg-intunemanager-prod AND
        have Key Vault Administrator / Key Vault Secrets Officer on the vault
      - The Container App already has a Managed Identity (check Portal or
        az containerapp show --query "identity")

.PARAMETER DatabaseUrl
    Full Prisma/MSSQL connection string — same value as GitHub Secret DATABASE_URL.

.PARAMETER AppSecretKey
    JWT signing key — same value as GitHub Secret APP_SECRET_KEY.
    CRITICAL: must be the exact same value currently in use or all existing
    user sessions and encrypted DB tokens will be invalidated.

.PARAMETER AzureClientId
    Azure AD App Registration client ID — same value as GitHub Secret AZURE_CLIENT_ID.

.PARAMETER AzureClientSecret
    Azure AD App Registration client secret — same value as GitHub Secret AZURE_CLIENT_SECRET.

.EXAMPLE
    .\scripts\setup-keyvault-refs.ps1 `
        -DatabaseUrl "Server=tcp:...;..." `
        -AppSecretKey "..." `
        -AzureClientId "..." `
        -AzureClientSecret "..."
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]      $DatabaseUrl,
    [Parameter(Mandatory)] [SecureString]$AppSecretKey,
    [Parameter(Mandatory)] [string]      $AzureClientId,
    [Parameter(Mandatory)] [SecureString]$AzureClientSecret
)

$ErrorActionPreference = 'Stop'

$KV_NAME      = 'kv-intunemgr-prod'
$CA_NAME      = 'ca-intunemanager-prod'
$RG_NAME      = 'rg-intunemanager-prod'
$REDIRECT_URI = 'https://ca-intunemanager-prod.yellowforest-c85ceb60.eastus.azurecontainerapps.io/api/auth/ms-callback'

function Log([string]$msg) { Write-Host "[setup-kv] $msg" }

# ── 1. Resolve Managed Identity ──────────────────────────────────────────────
Log "Checking Container App identity type..."
$identityJson = az containerapp show `
    --name $CA_NAME `
    --resource-group $RG_NAME `
    --query identity `
    --output json | ConvertFrom-Json

$identityType = $identityJson.type   # "SystemAssigned", "UserAssigned", or "SystemAssigned,UserAssigned"
Log "Identity type: $identityType"

if ($identityType -match 'SystemAssigned') {
    $principalId = $identityJson.principalId
    $identityRef = 'system'
    Log "Using system-assigned MI, principalId=$principalId"
} elseif ($identityType -eq 'UserAssigned') {
    $uaKeys = $identityJson.userAssignedIdentities.PSObject.Properties.Name
    $uaResourceId = $uaKeys[0]
    $principalId  = $identityJson.userAssignedIdentities.$uaResourceId.principalId
    $identityRef  = $uaResourceId
    Log "Using user-assigned MI, resourceId=$uaResourceId"
} else {
    throw "Container App has no Managed Identity. Enable it first:`n  az containerapp identity assign --system-assigned -n $CA_NAME -g $RG_NAME"
}

# ── 2. Assign Key Vault Secrets User role to MI ───────────────────────────────
Log "Fetching Key Vault resource ID..."
$kvId  = az keyvault show --name $KV_NAME --resource-group $RG_NAME --query id --output tsv
$kvUri = az keyvault show --name $KV_NAME --resource-group $RG_NAME --query "properties.vaultUri" --output tsv
$kvUri = $kvUri.TrimEnd('/')

Log "Assigning 'Key Vault Secrets User' role to MI on vault..."
az role assignment create `
    --role 'Key Vault Secrets User' `
    --assignee $principalId `
    --scope $kvId `
    --output none

Log "Waiting 30s for RBAC propagation (Lesson 011)..."
Start-Sleep -Seconds 30

# ── 3. Store secrets in Key Vault ─────────────────────────────────────────────
$appSecretPlain    = [System.Net.NetworkCredential]::new('', $AppSecretKey).Password
$clientSecretPlain = [System.Net.NetworkCredential]::new('', $AzureClientSecret).Password

Log "Writing DATABASE-URL to Key Vault..."
az keyvault secret set --vault-name $KV_NAME --name 'DATABASE-URL'         --value $DatabaseUrl       --output none
Log "Writing APP-SECRET-KEY to Key Vault..."
az keyvault secret set --vault-name $KV_NAME --name 'APP-SECRET-KEY'       --value $appSecretPlain    --output none
Log "Writing AZURE-CLIENT-ID to Key Vault..."
az keyvault secret set --vault-name $KV_NAME --name 'AZURE-CLIENT-ID'      --value $AzureClientId     --output none
Log "Writing AZURE-CLIENT-SECRET to Key Vault..."
az keyvault secret set --vault-name $KV_NAME --name 'AZURE-CLIENT-SECRET'  --value $clientSecretPlain --output none
Log "All 4 secrets stored."

# ── 4. Register KV references as Container App secrets ────────────────────────
Log "Configuring Key Vault references on Container App..."
az containerapp secret set `
    --name $CA_NAME `
    --resource-group $RG_NAME `
    --secrets `
        "database-url=keyvaultref:${kvUri}/secrets/DATABASE-URL,identityref:${identityRef}" `
        "app-secret-key=keyvaultref:${kvUri}/secrets/APP-SECRET-KEY,identityref:${identityRef}" `
        "azure-client-id=keyvaultref:${kvUri}/secrets/AZURE-CLIENT-ID,identityref:${identityRef}" `
        "azure-client-secret=keyvaultref:${kvUri}/secrets/AZURE-CLIENT-SECRET,identityref:${identityRef}"

# ── 5. Map env vars to secretrefs + set REDIRECT_URI as plaintext ─────────────
Log "Mapping env vars to secretrefs on Container App..."
az containerapp update `
    --name $CA_NAME `
    --resource-group $RG_NAME `
    --set-env-vars `
        'DATABASE_URL=secretref:database-url' `
        'APP_SECRET_KEY=secretref:app-secret-key' `
        'AZURE_CLIENT_ID=secretref:azure-client-id' `
        'AZURE_CLIENT_SECRET=secretref:azure-client-secret' `
        "AZURE_REDIRECT_URI=${REDIRECT_URI}" `
    --output none

Log ""
Log "====================================================================="
Log "Phase 4b setup complete."
Log ""
Log "Verify:"
Log "  1. Portal: Container App > Secrets — shows 4 KV refs"
Log "  2. Portal: Container App > Env vars — shows secretref: mappings"
Log "  3. App still loads + Settings > Tenant shows Connected"
Log ""
Log "NEXT STEP:"
Log "  Push the Phase 4b workflow commit to master."
Log "  The workflow no longer passes --set-env-vars so the Container App"
Log "  reads all secrets via Key Vault on every revision."
Log "====================================================================="
