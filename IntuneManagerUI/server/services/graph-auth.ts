/**
 * graph-auth.ts
 * Server-side Microsoft Graph authentication via direct HTTP calls to Microsoft OAuth endpoints.
 *
 * Replaces @azure/msal-node entirely — MSAL v2.x omits client_secret from token requests
 * when PKCE is involved (causes AADSTS7000218 regardless of CCA/PCA configuration).
 * Direct HTTP gives us full control over every parameter sent to the token endpoint.
 *
 * Flows:
 *   1. Authorization Code + client_secret  — getAuthUrl / handleCallback
 *   2. Device Code                         — startDeviceCodeFlow (polls in background)
 *   3. Refresh token                       — getAccessToken (auto-refreshes from stored token)
 */

import { encrypt, decrypt } from './encryption'
import prisma from '../db'

const AUTHORITY = 'https://login.microsoftonline.com/organizations/oauth2/v2.0'

const SCOPES = [
  'DeviceManagementApps.ReadWrite.All',
  'DeviceManagementConfiguration.Read.All',
  'User.Read',
  'offline_access',
].join(' ')

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

function requireEnv(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env.AZURE_CLIENT_ID
  const clientSecret = process.env.AZURE_CLIENT_SECRET
  const redirectUri = process.env.AZURE_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) {
    throw new GraphAuthError('AZURE_CLIENT_ID, AZURE_CLIENT_SECRET and AZURE_REDIRECT_URI are required')
  }
  return { clientId, clientSecret, redirectUri }
}

function parseJwt(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1]
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

async function saveTokens(tokens: {
  access_token: string
  refresh_token?: string
  expires_in: number
  id_token?: string
}): Promise<void> {
  const claims = tokens.id_token ? parseJwt(tokens.id_token) : {}
  const username =
    (claims.preferred_username as string | undefined) ??
    (claims.unique_name as string | undefined) ??
    (claims.upn as string | undefined) ??
    null
  const tenantId = (claims.tid as string | undefined) ?? null
  const expiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

  await prisma.tenantConfig.upsert({
    where: { id: 1 },
    update: {
      access_token: encrypt(tokens.access_token),
      refresh_token: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
      token_expiry: expiry,
      username,
      tenant_id: tenantId,
      updated_at: new Date(),
    },
    create: {
      id: 1,
      access_token: encrypt(tokens.access_token),
      refresh_token: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
      token_expiry: expiry,
      username,
      tenant_id: tenantId,
    },
  })
}

/**
 * Build the Microsoft OAuth2 authorization URL.
 * Standard authorization code flow — no PKCE (client_secret is used instead).
 */
export function getAuthUrl(state: string): string {
  const { clientId, redirectUri } = requireEnv()
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SCOPES,
    response_mode: 'query',
    state,
  })
  return `${AUTHORITY}/authorize?${params}`
}

/**
 * Exchange the authorization code for tokens.
 * Sends client_secret explicitly in the POST body — satisfies AADSTS7000218.
 */
export async function handleCallback(code: string): Promise<void> {
  const { clientId, clientSecret, redirectUri } = requireEnv()

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    scope: SCOPES,
  })

  const res = await fetch(`${AUTHORITY}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  const data = await res.json() as Record<string, unknown>
  if (!res.ok) {
    const desc = (data.error_description ?? data.error ?? `HTTP ${res.status}`) as string
    throw new GraphAuthError(desc)
  }

  await saveTokens({
    access_token: data.access_token as string,
    refresh_token: data.refresh_token as string | undefined,
    expires_in: (data.expires_in as number) ?? 3600,
    id_token: data.id_token as string | undefined,
  })
}

/**
 * Start the Device Code flow.
 * Returns the user_code + verification_uri immediately so the frontend can display them.
 * Polls the token endpoint in the background; saves tokens on completion.
 */
export function startDeviceCodeFlow(): Promise<DeviceCodeInfo> {
  const { clientId } = requireEnv()

  return new Promise<DeviceCodeInfo>((resolve, reject) => {
    let resolved = false

    const start = async () => {
      const initBody = new URLSearchParams({ client_id: clientId, scope: SCOPES })
      const initRes = await fetch(`${AUTHORITY}/devicecode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: initBody.toString(),
      })
      if (!initRes.ok) {
        const err = await initRes.json() as Record<string, unknown>
        throw new GraphAuthError((err.error_description ?? err.error ?? 'Device code request failed') as string)
      }

      const info = await initRes.json() as {
        device_code: string
        user_code: string
        verification_uri: string
        message: string
        expires_in: number
        interval: number
      }

      resolved = true
      resolve({ userCode: info.user_code, verificationUri: info.verification_uri, message: info.message })

      // Poll in background
      await pollDeviceCode(clientId, info.device_code, info.interval)
    }

    start().catch((err: Error) => {
      if (!resolved) reject(err)
      else console.error('[graph-auth] Device code error:', err.message)
    })
  })
}

async function pollDeviceCode(clientId: string, deviceCode: string, intervalSec: number): Promise<void> {
  let interval = intervalSec

  while (true) {
    await new Promise(r => setTimeout(r, interval * 1000))

    const body = new URLSearchParams({
      client_id: clientId,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
    })

    const res = await fetch(`${AUTHORITY}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    const data = await res.json() as Record<string, unknown>

    if (data.access_token) {
      await saveTokens({
        access_token: data.access_token as string,
        refresh_token: data.refresh_token as string | undefined,
        expires_in: (data.expires_in as number) ?? 3600,
        id_token: data.id_token as string | undefined,
      })
      return
    }

    const error = data.error as string | undefined
    if (error === 'authorization_pending') continue
    if (error === 'slow_down') { interval += 5; continue }
    throw new GraphAuthError(`Device code polling failed: ${error ?? 'unknown error'}`)
  }
}

/**
 * Get a valid access token for Graph API calls.
 * Returns the cached token if more than 5 minutes remain; otherwise refreshes via stored refresh_token.
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

  if (!row.refresh_token) {
    throw new GraphAuthError('Token expired — sign in again via Settings > Tenant Integration')
  }

  const { clientId, clientSecret } = requireEnv()
  const refreshToken = decrypt(row.refresh_token)

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: SCOPES,
  })

  const res = await fetch(`${AUTHORITY}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  const data = await res.json() as Record<string, unknown>
  if (!res.ok) {
    const desc = (data.error_description ?? data.error ?? `HTTP ${res.status}`) as string
    throw new GraphAuthError(`Token refresh failed: ${desc}`)
  }

  await saveTokens({
    access_token: data.access_token as string,
    refresh_token: (data.refresh_token as string | undefined) ?? refreshToken,
    expires_in: (data.expires_in as number) ?? 3600,
  })
  return data.access_token as string
}
