import { useEffect, useRef, useState } from 'react'
import { useTenant, type DeviceCodeInfo } from '../contexts/TenantContext'

export default function TenantTab() {
  const { tenant, connect, disconnect, refreshStatus } = useTenant()
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')
  const [deviceCode, setDeviceCode] = useState<DeviceCodeInfo | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    refreshStatus()
    // Surface any auth_error that Microsoft or the callback route returned via query param
    const params = new URLSearchParams(window.location.search)
    const authError = params.get('auth_error')
    if (authError) {
      setError(`Sign-in failed: ${decodeURIComponent(authError)}`)
      // Remove the query param without reloading the page
      const clean = window.location.pathname + window.location.hash
      window.history.replaceState(null, '', clean)
    }
  }, [refreshStatus])

  // Poll every 5s while waiting for device code completion
  useEffect(() => {
    if (!deviceCode) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      return
    }
    pollRef.current = setInterval(async () => {
      await refreshStatus()
      if (tenant.isConnected) {
        setDeviceCode(null)
        setConnecting(false)
      }
    }, 5000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [deviceCode, tenant.isConnected, refreshStatus])

  const handleConnect = async (useDeviceCode = false) => {
    setError('')
    setDeviceCode(null)
    setConnecting(true)
    const result = await connect(useDeviceCode)
    if (!result.success) {
      setConnecting(false)
      setError(result.error ?? 'Connection failed')
    } else if (result.deviceCode) {
      // Spinner stays active; deviceCode panel shown; polling starts via useEffect
      setDeviceCode(result.deviceCode)
    }
    // For OAuth redirect (useDeviceCode = false), result.success = true and the page
    // navigates away — no state update needed.
  }

  const handleDisconnect = async () => {
    setDeviceCode(null)
    setConnecting(false)
    setError('')
    await disconnect()
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>Tenant Integration</h2>
      <p style={{ color: 'var(--text-400)', fontSize: 13, marginBottom: 24 }}>
        Connect your Microsoft 365 / Azure AD tenant to manage Intune apps.
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            background: tenant.isConnected ? '#14532d' : 'var(--bg-700)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18
          }}>
            {tenant.isConnected ? '✓' : '○'}
          </div>
          <div>
            <div style={{ fontWeight: 600 }}>
              {tenant.isConnected ? 'Connected' : 'Not Connected'}
            </div>
            {tenant.isConnected && (
              <div style={{ color: 'var(--text-400)', fontSize: 12 }}>
                {tenant.username}
                {tenant.tenantId && ` · ${tenant.tenantId}`}
                {tenant.expiresInMinutes != null && ` · Token expires in ${tenant.expiresInMinutes}m`}
              </div>
            )}
          </div>
        </div>

        {tenant.isConnected ? (
          <button className="btn-secondary" onClick={handleDisconnect} style={{ width: '100%' }}>
            Disconnect
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              className="btn-primary"
              onClick={() => handleConnect(false)}
              disabled={connecting}
              style={{ width: '100%', padding: 10 }}
            >
              Sign in with Microsoft Account
            </button>
            <button
              className="btn-secondary"
              onClick={() => handleConnect(true)}
              disabled={connecting}
              style={{ width: '100%' }}
            >
              {connecting && deviceCode ? 'Waiting for authentication...' : 'Use Device Code (for restricted environments)'}
            </button>
          </div>
        )}

        {error && <p className="error-text" style={{ marginTop: 8 }}>{error}</p>}
      </div>

      {/* Device code panel — shown while waiting for the user to authenticate on another device */}
      {deviceCode && (
        <div className="card" style={{ marginBottom: 16, borderLeft: '3px solid var(--accent)' }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Complete sign-in on another device</div>
          <p style={{ fontSize: 13, color: 'var(--text-400)', marginBottom: 12 }}>
            Go to the URL below and enter the code to authenticate:
          </p>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--text-400)', marginBottom: 2 }}>Sign-in URL</div>
            <a
              href={deviceCode.verificationUri}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 14, color: 'var(--accent)' }}
            >
              {deviceCode.verificationUri}
            </a>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-400)', marginBottom: 2 }}>Code</div>
            <div style={{
              fontFamily: 'monospace', fontSize: 22, fontWeight: 700,
              letterSpacing: 4, color: 'var(--text-100)',
              background: 'var(--bg-700)', padding: '8px 12px', borderRadius: 6,
              display: 'inline-block'
            }}>
              {deviceCode.userCode}
            </div>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-400)', marginTop: 10 }}>
            Checking for authentication every 5 seconds...
          </p>
        </div>
      )}

      <div style={{ fontSize: 12, color: 'var(--text-400)', lineHeight: 1.6 }}>
        <strong style={{ color: 'var(--text-200)' }}>Required permissions:</strong><br />
        DeviceManagementApps.ReadWrite.All, DeviceManagementConfiguration.Read.All
      </div>
    </div>
  )
}
