/**
 * graph-auth.ts
 * Server-side Microsoft Graph authentication using @azure/msal-node.
 * Replaces the MSAL.NET PS-script approach that fails on Linux.
 *
 * Three flows supported:
 *   1. Authorization Code + PKCE  — browser redirects (getAuthUrl / handleCallback)
 *   2. Device Code Flow           — for restricted/headless environments (startDeviceCodeFlow)
 *   3. Silent refresh             — getAccessToken() auto-refreshes via MSAL token cache
 *
 * Token persistence strategy:
 *   - MSAL's full token cache (including refresh tokens) is serialized, AES-256-CBC encrypted,
 *     and stored in the `app_settings` table under key 'msal_token_cache'.
 *     The cachePlugin wires this up transparently — we never access raw refresh tokens.
 *   - TenantConfig stores the latest access token + display metadata (username, expiry)
 *     so PS scripts can receive an injected token and the UI can show the connected user.
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

const TOKEN_CACHE_KEY = 'msal_token_cache'
const PKCE_VERIFIER_KEY = 'msal_pkce_verifier'

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

// Persists MSAL's internal token cache to the DB.
// MSAL calls beforeCacheAccess to load and afterCacheAccess to save on every token operation.
const cachePlugin: msal.ICachePlugin = {
  async beforeCacheAccess(cacheContext: msal.TokenCacheContext): Promise<void> {
    const row = await prisma.appSetting.findUnique({ where: { key: TOKEN_CACHE_KEY } })
    if (row?.value) {
      const serialized = decrypt(row.value)
      if (serialized) cacheContext.tokenCache.deserialize(serialized)
    }
  },
  async afterCacheAccess(cacheContext: msal.TokenCacheContext): Promise<void> {
    if (cacheContext.cacheHasChanged) {
      const serialized = cacheContext.tokenCache.serialize()
      await prisma.appSetting.upsert({
        where: { key: TOKEN_CACHE_KEY },
        update: { value: encrypt(serialized), updated_at: new Date() },
        create: { key: TOKEN_CACHE_KEY, value: encrypt(serialized) },
      })
    }
  },
}

function getPCA(): msal.PublicClientApplication {
  const clientId = process.env.AZURE_CLIENT_ID
  if (!clientId) throw new GraphAuthError('AZURE_CLIENT_ID environment variable is required')
  return new msal.PublicClientApplication({
    auth: {
      clientId,
      authority: 'https://login.microsoftonline.com/organizations',
    },
    cache: { cachePlugin },
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
      username: result.account?.username ?? null,
      tenant_id: result.account?.tenantId ?? null,
      updated_at: new Date(),
    },
    create: {
      id: 1,
      access_token: encrypt(result.accessToken),
      refresh_token: null,
      token_expiry: result.expiresOn?.toISOString() ?? null,
      username: result.account?.username ?? null,
      tenant_id: result.account?.tenantId ?? null,
    },
  })
}

/**
 * Generate the Microsoft OAuth2 authorization URL (Authorization Code + PKCE flow).
 * Stores the PKCE verifier in the DB for use during handleCallback.
 * Frontend should redirect the browser to this URL.
 */
export async function getAuthUrl(state: string): Promise<string> {
  const redirectUri = process.env.AZURE_REDIRECT_URI
  if (!redirectUri) throw new GraphAuthError('AZURE_REDIRECT_URI environment variable is required')

  const cryptoProvider = new msal.CryptoProvider()
  const { verifier, challenge } = await cryptoProvider.generatePkceCodes()

  await prisma.appSetting.upsert({
    where: { key: PKCE_VERIFIER_KEY },
    update: { value: encrypt(verifier), updated_at: new Date() },
    create: { key: PKCE_VERIFIER_KEY, value: encrypt(verifier) },
  })

  return getPCA().getAuthCodeUrl({
    scopes: SCOPES,
    redirectUri,
    state,
    codeChallenge: challenge,
    codeChallengeMethod: 'S256',
  })
}

/**
 * Exchange the authorization code (from the OAuth callback) for tokens.
 * Uses the PKCE verifier saved during getAuthUrl.
 * MSAL cache plugin persists the full token cache (including refresh token) to AppSetting.
 */
export async function handleCallback(code: string): Promise<void> {
  const redirectUri = process.env.AZURE_REDIRECT_URI
  if (!redirectUri) throw new GraphAuthError('AZURE_REDIRECT_URI environment variable is required')

  const verifierRow = await prisma.appSetting.findUnique({ where: { key: PKCE_VERIFIER_KEY } })
  if (!verifierRow?.value) throw new GraphAuthError('PKCE verifier not found — restart the sign-in flow')
  const codeVerifier = decrypt(verifierRow.value)
  if (!codeVerifier) throw new GraphAuthError('PKCE verifier decryption failed — restart the sign-in flow')

  const result = await getPCA().acquireTokenByCode({ code, scopes: SCOPES, redirectUri, codeVerifier })
  if (!result) throw new GraphAuthError('acquireTokenByCode returned null')
  await saveMetadata(result)

  // Clean up the one-time PKCE verifier
  await prisma.appSetting.delete({ where: { key: PKCE_VERIFIER_KEY } }).catch(() => {})
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
      deviceCodeCallback: (response: msal.DeviceCodeResponse) => {
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
          // Device code info already returned; log background polling failure only
          console.error('[graph-auth] Device code polling failed:', err.message)
        }
      })
  })
}

/**
 * Get a valid access token for Graph API calls.
 * Returns the cached access token if it has more than 5 minutes remaining.
 * Otherwise uses MSAL acquireTokenSilent which leverages the persisted refresh token.
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

  // Token expired or expiring soon — acquire silently using MSAL's cached refresh token
  const pca = getPCA()
  const accounts = await pca.getTokenCache().getAllAccounts()
  if (!accounts.length) {
    throw new GraphAuthError('No cached MSAL account — sign in again via Settings > Tenant Integration')
  }

  const result = await pca.acquireTokenSilent({ account: accounts[0], scopes: SCOPES })
  if (!result) throw new GraphAuthError('Silent token refresh returned null')
  await saveMetadata(result)
  return result.accessToken
}
