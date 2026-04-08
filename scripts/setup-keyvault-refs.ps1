#Requires -Version 5.1
<#
.SYNOPSIS
    Phase 4b — one-time setup: reads live secret values from the running
    Container App, stores them in Azure Key Vault, and wires KV references
    back onto the Container App via Managed Identity.

.DESCRIPTION
    No manual secret entry required. The script pulls current values directly
    from the Container App (plaintext env vars or Container App secrets via
    the listSecrets REST API), stores them in Key Vault, then converts the
    Container App env vars to secretref: mappings pointing at KV.

    Run this ONCE before the next CI deploy (the updated workflow no longer
    passes --set-env-vars, so KV refs must be in place first).

    Prerequisites:
      - az CLI installed and logged in  (az login)
      - Contributor or Owner on rg-intunemanager-prod
      - Key Vault Administrator or Key Vault Secrets Officer on kv-intunemgr-prod

.EXAMPLE
    .\scripts\setup-keyvault-refs.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$KV_NAME      = 'kv-intunemgr-prod'
$CA_NAME      = 'ca-intunemanager-prod'
$RG_NAME      = 'rg-intunemanager-prod'
$REDIRECT_URI = 'https://ca-intunemanager-prod.yellowforest-c85ceb60.eastus.azurecontainerapps.io/api/auth/ms-callback'

$REQUIRED_KEYS = @('DATABASE_URL', 'APP_SECRET_KEY', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET')

function Log([string]$msg) { Write-Host "[setup-kv] $msg" }

# ── 1. Read current env vars from the Container App ───────────────────────────
Log "Reading env vars from Container App '$CA_NAME'..."
$caJson = az containerapp show `
    --name $CA_NAME `
    --resource-group $RG_NAME `
    --output json | ConvertFrom-Json

$envVars = $caJson.properties.template.containers[0].env
# $envVars is an array of {name, value} or {name, secretRef} objects

# ── 2. Resolve secretRef values via listSecrets REST API ──────────────────────
# Some env vars may point to Container App secrets (secretRef) rather than
# storing values inline. The listSecrets API returns actual secret values.
$resolvedSecrets = @{}   # secretRef-name → plaintext value

$secretRefNames = $envVars | Where-Object { $_.secretRef } | ForEach-Object { $_.secretRef }
if ($secretRefNames) {
    Log "Fetching Container App secret values via REST API..."
    $sub = az account show --query id --output tsv
    $listSecretsUrl = "https://management.azure.com/subscriptions/${sub}/resourceGroups/${RG_NAME}/providers/Microsoft.App/containerApps/${CA_NAME}/listSecrets?api-version=2023-05-01"
    $secretsList = az rest --method post --url $listSecretsUrl --output json | ConvertFrom-Json
    foreach ($s in $secretsList.value) {
        $resolvedSecrets[$s.name] = $s.value
    }
    Log "Fetched $($resolvedSecrets.Count) secret value(s)."
}

# ── 3. Build a flat key→value map for the 4 required env vars ─────────────────
$values = @{}
foreach ($key in $REQUIRED_KEYS) {
    $entry = $envVars | Where-Object { $_.name -eq $key } | Select-Object -First 1
    if (-not $entry) {
        throw "Required env var '$key' not found on Container App. Check the Azure Portal and add it manually before re-running."
    }
    if ($entry.PSObject.Properties['value'] -and $entry.value) {
        $values[$key] = $entry.value
        Log "  $key = (plaintext env var)"
    } elseif ($entry.PSObject.Properties['secretRef'] -and $entry.secretRef) {
        $ref = $entry.secretRef
        if (-not $resolvedSecrets.ContainsKey($ref)) {
            throw "secretRef '$ref' for env var '$key' was not returned by listSecrets. The secret may already be a KV reference — re-run after verifying the Container App state."
        }
        $values[$key] = $resolvedSecrets[$ref]
        Log "  $key = (resolved from secretRef '$ref')"
    } else {
        throw "Env var '$key' exists but has no value or secretRef."
    }
}

Log "All 4 secret values resolved."

# ── 4. Resolve Managed Identity ───────────────────────────────────────────────
Log "Checking Container App Managed Identity..."
$identityJson = $caJson.identity
$identityType = $identityJson.type

if ($identityType -match 'SystemAssigned') {
    $principalId = $identityJson.principalId
    $identityRef = 'system'
    Log "Using system-assigned MI (principalId: $principalId)"
} elseif ($identityType -eq 'UserAssigned') {
    $uaResourceId = ($identityJson.userAssignedIdentities.PSObject.Properties.Name)[0]
    $principalId  = $identityJson.userAssignedIdentities.$uaResourceId.principalId
    $identityRef  = $uaResourceId
    Log "Using user-assigned MI (resourceId: $uaResourceId)"
} else {
    throw @"
Container App has no Managed Identity. Enable one first:
  az containerapp identity assign --system-assigned -n $CA_NAME -g $RG_NAME
Then re-run this script.
"@
}

# ── 5. Assign Key Vault Secrets User role to MI ───────────────────────────────
Log "Fetching Key Vault details..."
$kvId  = az keyvault show --name $KV_NAME --resource-group $RG_NAME --query id --output tsv
$kvUri = az keyvault show --name $KV_NAME --resource-group $RG_NAME --query 'properties.vaultUri' --output tsv
$kvUri = $kvUri.TrimEnd('/')

Log "Assigning 'Key Vault Secrets User' to MI on vault (idempotent)..."
az role assignment create `
    --role 'Key Vault Secrets User' `
    --assignee $principalId `
    --scope $kvId `
    --output none

Log "Waiting 30s for RBAC propagation..."
Start-Sleep -Seconds 30

# ── 6. Store secrets in Key Vault ─────────────────────────────────────────────
$kvMap = @{
    'DATABASE-URL'        = $values['DATABASE_URL']
    'APP-SECRET-KEY'      = $values['APP_SECRET_KEY']
    'AZURE-CLIENT-ID'     = $values['AZURE_CLIENT_ID']
    'AZURE-CLIENT-SECRET' = $values['AZURE_CLIENT_SECRET']
}

foreach ($kvKey in $kvMap.Keys) {
    Log "Writing $kvKey to Key Vault..."
    az keyvault secret set `
        --vault-name $KV_NAME `
        --name $kvKey `
        --value $kvMap[$kvKey] `
        --output none
}
Log "All 4 secrets written to Key Vault."

# ── 7. Register KV references as Container App secrets ───────────────────────
Log "Configuring Key Vault references on Container App..."
az containerapp secret set `
    --name $CA_NAME `
    --resource-group $RG_NAME `
    --secrets `
        "database-url=keyvaultref:${kvUri}/secrets/DATABASE-URL,identityref:${identityRef}" `
        "app-secret-key=keyvaultref:${kvUri}/secrets/APP-SECRET-KEY,identityref:${identityRef}" `
        "azure-client-id=keyvaultref:${kvUri}/secrets/AZURE-CLIENT-ID,identityref:${identityRef}" `
        "azure-client-secret=keyvaultref:${kvUri}/secrets/AZURE-CLIENT-SECRET,identityref:${identityRef}"

# ── 8. Map env vars to secretrefs ─────────────────────────────────────────────
Log "Mapping Container App env vars to secretrefs..."
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
Log "Phase 4b complete."
Log ""
Log "Verify before next CI run:"
Log "  - Portal: Container App > Secrets  → 4 entries, type 'Key Vault ref'"
Log "  - Portal: Container App > Env vars → 4 secretref: mappings"
Log "  - App loads and Settings > Tenant shows Connected"
Log ""
Log "The committed workflow already drops --set-env-vars."
Log "All future deploys will use Key Vault references automatically."
Log "====================================================================="
