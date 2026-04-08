/**
 * graph-auth.ts
 * Server-side Microsoft Graph authentication using @azure/msal-node.
 * Replaces the MSAL.NET PS-script approach that fails on Linux.
 *
 * Three flows supported:
 *   1. Authorization Code Flow   — browser redirects via ConfidentialClientApplication
 *                                  (sends client_secret; required when app has a secret in Azure AD)
 *   2. Device Code Flow          — PublicClientApplication (no secret needed for device flow)
 *   3. Silent refresh            — acquireTokenSilent via MSAL token cache
 *
 * Token persistence:
 *   - CCA token cache → app_settings key 'msal_cache_cca' (auth code path)
 *   - PCA token cache → app_settings key 'msal_cache_pca' (device code path)
 *   - TenantConfig stores latest access_token + display metadata for PS script injection and UI
 */

import * as msal from '@azure/msal-node'
import { encrypt, decrypt } from './encryption'
import prisma from '../db'

const SCOPES = [
  'DeviceManagementApps.ReadWrite.All',
  'DeviceManagementConfiguration.Read.All',
  'User.Read',
  'offline_access',
]

const CCA_CACHE_KEY = 'msal_cache_cca'
const PCA_CACHE_KEY = 'msal_cache_pca'

export interface DeviceCodeInfo {
  userCode: string
  verificationUri: string
  message: string
}

export class GraphAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GraphAuthError'
  }
}

function makeCachePlugin(dbKey: string): msal.ICachePlugin {
  return {
    async beforeCacheAccess(cacheContext: msal.TokenCacheContext): Promise<void> {
      const row = await prisma.appSetting.findUnique({ where: { key: dbKey } })
      if (row?.value) {
        const serialized = decrypt(row.value)
        if (serialized) cacheContext.tokenCache.deserialize(serialized)
      }
    },
    async afterCacheAccess(cacheContext: msal.TokenCacheContext): Promise<void> {
      if (cacheContext.cacheHasChanged) {
        const serialized = cacheContext.tokenCache.serialize()
        await prisma.appSetting.upsert({
          where: { key: dbKey },
          update: { value: encrypt(serialized), updated_at: new Date() },
          create: { key: dbKey, value: encrypt(serialized) },
        })
      }
    },
  }
}

// ConfidentialClientApplication — used for Authorization Code flow.
// Azure AD requires the client_secret when the app registration has one defined.
function getCCA(): msal.ConfidentialClientApplication {
  const clientId = process.env.AZURE_CLIENT_ID
  const clientSecret = process.env.AZURE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new GraphAuthError('AZURE_CLIENT_ID and AZURE_CLIENT_SECRET environment variables are required')
  }
  return new msal.ConfidentialClientApplication({
    auth: {
      clientId,
      authority: 'https://login.microsoftonline.com/organizations',
      clientSecret,
    },
    cache: { cachePlugin: makeCachePlugin(CCA_CACHE_KEY) },
    system: {
      loggerOptions: {
        loggerCallback: () => {},
        piiLoggingEnabled: false,
        logLevel: msal.LogLevel.Error,
      },
    },
  })
}

// PublicClientApplication — used for Device Code flow only.
// Device code does not use the client_secret.
function getPCA(): msal.PublicClientApplication {
  const clientId = process.env.AZURE_CLIENT_ID
  if (!clientId) throw new GraphAuthError('AZURE_CLIENT_ID environment variable is required')
  return new msal.PublicClientApplication({
    auth: {
      clientId,
      authority: 'https://login.microsoftonline.com/organizations',
    },
    cache: { cachePlugin: makeCachePlugin(PCA_CACHE_KEY) },
    system: {
      loggerOptions: {
        loggerCallback: () => {},
        piiLoggingEnabled: false,
        logLevel: msal.LogLevel.Error,
      },
    },
  })
}

// Save access token + display metadata to TenantConfig.
// Refresh tokens are managed by the MSAL cache plugin — not stored here.
async function saveMetadata(result: msal.AuthenticationResult): Promise<void> {
  await prisma.tenantConfig.upsert({
    where: { id: 1 },
    update: {
      access_token: encrypt(result.accessToken),
      refresh_token: null,
      token_expiry: result.expiresOn?.toISOString() ?? null,
      username: result.account?.username ?? result.account?.name ?? null,
      tenant_id: result.account?.tenantId ?? null,
      updated_at: new Date(),
    },
    create: {
      id: 1,
      access_token: encrypt(result.accessToken),
      refresh_token: null,
      token_expiry: result.expiresOn?.toISOString() ?? null,
      username: result.account?.username ?? result.account?.name ?? null,
      tenant_id: result.account?.tenantId ?? null,
    },
  })
}

/**
 * Generate the Microsoft OAuth2 authorization URL.
 * Uses ConfidentialClientApplication so the token exchange includes the client_secret.
 * Frontend should redirect the browser to this URL.
 */
export function getAuthUrl(state: string): Promise<string> {
  const redirectUri = process.env.AZURE_REDIRECT_URI
  if (!redirectUri) throw new GraphAuthError('AZURE_REDIRECT_URI environment variable is required')
  return getCCA().getAuthCodeUrl({ scopes: SCOPES, redirectUri, state })
}

/**
 * Exchange the authorization code (from the OAuth callback) for tokens.
 * Uses CCA — sends client_secret to satisfy Azure AD's confidential client requirement.
 */
export async function handleCallback(code: string): Promise<void> {
  const redirectUri = process.env.AZURE_REDIRECT_URI
  if (!redirectUri) throw new GraphAuthError('AZURE_REDIRECT_URI environment variable is required')
  const result = await getCCA().acquireTokenByCode({ code, scopes: SCOPES, redirectUri })
  if (!result) throw new GraphAuthError('acquireTokenByCode returned null')
  await saveMetadata(result)
}

/**
 * Start the Device Code flow.
 * Returns device code info immediately so the frontend can display it.
 * MSAL polls in the background; tokens are saved when the user completes auth on their device.
 */
export function startDeviceCodeFlow(): Promise<DeviceCodeInfo> {
  return new Promise<DeviceCodeInfo>((resolve, reject) => {
    let resolved = false
    const pca = getPCA()

    const tokenPromise = pca.acquireTokenByDeviceCode({
      scopes: SCOPES,
      deviceCodeCallback: (response) => {
        if (!resolved) {
          resolved = true
          resolve({
            userCode: response.userCode,
            verificationUri: response.verificationUri,
            message: response.message,
          })
        }
      },
    })

    // Runs in background — saves tokens when user completes auth on their device
    tokenPromise
      .then((result: msal.AuthenticationResult | null) => {
        if (result) return saveMetadata(result)
      })
      .catch((err: Error) => {
        if (!resolved) {
          reject(err)
        } else {
          console.error('[graph-auth] Device code polling failed:', err.message)
        }
      })
  })
}

/**
 * Get a valid access token for Graph API calls.
 * Returns the cached access token if it has more than 5 minutes remaining.
 * Otherwise uses acquireTokenSilent (checks CCA cache first, then PCA cache).
 * Throws GraphAuthError if the tenant is not connected.
 */
export async function getAccessToken(): Promise<string> {
  const row = await prisma.tenantConfig.findUnique({ where: { id: 1 } })

  if (!row?.access_token) {
    throw new GraphAuthError('Tenant not connected — sign in via Settings > Tenant Integration')
  }

  const expiry = row.token_expiry ? new Date(row.token_expiry) : null
  const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000)

  if (expiry && expiry > fiveMinFromNow) {
    return decrypt(row.access_token)
  }

  // Try CCA silent refresh first (used after auth code flow)
  try {
    const cca = getCCA()
    const ccaAccounts = await cca.getTokenCache().getAllAccounts()
    if (ccaAccounts.length) {
      const result = await cca.acquireTokenSilent({ account: ccaAccounts[0], scopes: SCOPES })
      if (result) {
        await saveMetadata(result)
        return result.accessToken
      }
    }
  } catch {
    // Fall through to PCA
  }

  // Try PCA silent refresh (used after device code flow)
  const pca = getPCA()
  const pcaAccounts = await pca.getTokenCache().getAllAccounts()
  if (pcaAccounts.length) {
    const result = await pca.acquireTokenSilent({ account: pcaAccounts[0], scopes: SCOPES })
    if (result) {
      await saveMetadata(result)
      return result.accessToken
    }
  }

  throw new GraphAuthError('Token refresh failed — sign in again via Settings > Tenant Integration')
}
