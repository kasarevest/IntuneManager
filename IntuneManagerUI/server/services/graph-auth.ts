/**
 * graph-auth.ts
 * Server-side Microsoft Graph authentication using @azure/msal-node.
 * Replaces the MSAL.NET PS-script approach that fails on Linux.
 *
 * Three flows supported:
 *   1. Authorization Code Flow  — browser redirects (getAuthUrl / handleCallback)
 *   2. Device Code Flow         — for restricted/headless environments (startDeviceCodeFlow)
 *   3. Silent refresh           — getAccessToken() auto-refreshes before expiry
 */

import * as msal from '@azure/msal-node'
import { encrypt, decrypt } from './encryption'
import prisma from '../db'

const SCOPES = [
  'DeviceManagementApps.ReadWrite.All',
  'DeviceManagementConfiguration.Read.All',
  'User.Read',
  'offline_access',  // required for refresh token
]

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
    system: {
      loggerOptions: {
        loggerCallback: () => {},  // suppress MSAL verbose logs
        piiLoggingEnabled: false,
        logLevel: msal.LogLevel.Error,
      },
    },
  })
}

async function saveTokens(result: msal.AuthenticationResult): Promise<void> {
  if (!result.refreshToken) {
    throw new GraphAuthError('No refresh token returned — ensure offline_access scope is requested')
  }
  await prisma.tenantConfig.upsert({
    where: { id: 1 },
    update: {
      access_token: encrypt(result.accessToken),
      refresh_token: encrypt(result.refreshToken),
      token_expiry: result.expiresOn?.toISOString() ?? null,
      username: result.account?.username ?? null,
      tenant_id: result.account?.tenantId ?? null,
      updated_at: new Date(),
    },
    create: {
      id: 1,
      access_token: encrypt(result.accessToken),
      refresh_token: encrypt(result.refreshToken),
      token_expiry: result.expiresOn?.toISOString() ?? null,
      username: result.account?.username ?? null,
      tenant_id: result.account?.tenantId ?? null,
    },
  })
}

/**
 * Generate the Microsoft OAuth2 authorization URL.
 * Frontend should redirect the browser to this URL.
 */
export function getAuthUrl(state: string): Promise<string> {
  const redirectUri = process.env.AZURE_REDIRECT_URI
  if (!redirectUri) throw new GraphAuthError('AZURE_REDIRECT_URI environment variable is required')
  return getCCA().getAuthCodeUrl({ scopes: SCOPES, redirectUri, state })
}

/**
 * Exchange the authorization code (from the OAuth callback) for tokens.
 * Saves encrypted tokens to the database.
 */
export async function handleCallback(code: string): Promise<void> {
  const redirectUri = process.env.AZURE_REDIRECT_URI
  if (!redirectUri) throw new GraphAuthError('AZURE_REDIRECT_URI environment variable is required')
  const result = await getCCA().acquireTokenByCode({ code, scopes: SCOPES, redirectUri })
  if (!result) throw new GraphAuthError('acquireTokenByCode returned null')
  await saveTokens(result)
}

/**
 * Start the Device Code flow.
 * Returns device code info immediately so the frontend can display it.
 * MSAL polls in the background; tokens are saved when the user completes auth.
 */
export function startDeviceCodeFlow(): Promise<DeviceCodeInfo> {
  return new Promise<DeviceCodeInfo>((resolve, reject) => {
    let resolved = false
    const cca = getCCA()

    const tokenPromise = cca.acquireTokenByDeviceCode({
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
      .then((result) => {
        if (result) return saveTokens(result)
      })
      .catch((err: Error) => {
        if (!resolved) {
          reject(err)
        } else {
          // Already returned device code info; log background failure only
          console.error('Device code polling failed:', err.message)
        }
      })
  })
}

/**
 * Get a valid access token for Graph API calls.
 * Reads from DB; auto-refreshes if the token expires within 5 minutes.
 * Throws GraphAuthError if the tenant is not connected.
 */
export async function getAccessToken(): Promise<string> {
  const row = await prisma.tenantConfig.findUnique({ where: { id: 1 } })

  if (!row?.access_token || !row?.refresh_token) {
    throw new GraphAuthError('Tenant not connected — sign in via Settings > Tenant Integration')
  }

  const expiry = row.token_expiry ? new Date(row.token_expiry) : null
  const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000)

  if (expiry && expiry > fiveMinFromNow) {
    return decrypt(row.access_token)
  }

  // Token expired or expiring soon — refresh
  const refreshToken = decrypt(row.refresh_token)
  const result = await getCCA().acquireTokenByRefreshToken({ refreshToken, scopes: SCOPES })
  if (!result) throw new GraphAuthError('Token refresh returned null')
  await saveTokens(result)
  return result.accessToken
}
