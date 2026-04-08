/**
 * ms-auth.ts
 * OAuth2 routes for Microsoft tenant authentication.
 * Replaces PS-script MSAL.NET flow with server-side @azure/msal-node.
 *
 * GET  /api/auth/ms-login       — redirect browser to Microsoft login page
 * GET  /api/auth/ms-callback    — receive OAuth code, exchange for tokens, redirect to /
 * POST /api/auth/ms-device-code — start device code flow, return code info to display
 */

import { Router } from 'express'
import { getAuthUrl, handleCallback, startDeviceCodeFlow } from '../services/graph-auth'
import { requireAuth } from '../middleware/auth'

const router = Router()

// Redirect the browser to Microsoft's OAuth2 authorization endpoint
router.get('/api/auth/ms-login', async (_req, res) => {
  try {
    const authUrl = getAuthUrl('intunemanager')
    res.redirect(authUrl)
  } catch (err) {
    console.error('ms-login error:', (err as Error).message)
    res.status(500).send(`Authentication setup error: ${(err as Error).message}`)
  }
})

// Microsoft redirects here after the user logs in
router.get('/api/auth/ms-callback', async (req, res) => {
  const { code, error, error_description } = req.query as Record<string, string>

  if (error) {
    console.error('OAuth callback error:', error, error_description)
    return res.redirect(`/?auth_error=${encodeURIComponent(error_description ?? error)}`)
  }

  if (!code) {
    return res.redirect('/?auth_error=missing_code')
  }

  try {
    await handleCallback(code)
    res.redirect('/')
  } catch (err) {
    console.error('ms-callback token exchange error:', (err as Error).message)
    res.redirect(`/?auth_error=${encodeURIComponent((err as Error).message)}`)
  }
})

// Start the Device Code flow — returns code info for the frontend to display
router.post('/api/auth/ms-device-code', requireAuth as import('express').RequestHandler, async (_req, res) => {
  try {
    const deviceCodeInfo = await startDeviceCodeFlow()
    res.json({ success: true, ...deviceCodeInfo })
  } catch (err) {
    console.error('ms-device-code error:', (err as Error).message)
    res.json({ success: false, error: (err as Error).message })
  }
})

export default router
