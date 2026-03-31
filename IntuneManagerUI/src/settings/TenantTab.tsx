import { useEffect, useState } from 'react'
import { useTenant } from '../contexts/TenantContext'

export default function TenantTab() {
  const { tenant, connect, disconnect, refreshStatus } = useTenant()
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    refreshStatus()
  }, [refreshStatus])

  const handleConnect = async (useDeviceCode = false) => {
    setError('')
    setConnecting(true)
    const result = await connect(useDeviceCode)
    setConnecting(false)
    if (!result.success) setError(result.error ?? 'Connection failed')
  }

  const handleDisconnect = async () => {
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
              {connecting ? 'Opening browser...' : '  Sign in with Microsoft Account'}
            </button>
            <button
              className="btn-secondary"
              onClick={() => handleConnect(true)}
              disabled={connecting}
              style={{ width: '100%' }}
            >
              Use Device Code (for restricted environments)
            </button>
          </div>
        )}

        {error && <p className="error-text" style={{ marginTop: 8 }}>{error}</p>}
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-400)', lineHeight: 1.6 }}>
        <strong style={{ color: 'var(--text-200)' }}>Required permissions:</strong><br />
        DeviceManagementApps.ReadWrite.All, DeviceManagementConfiguration.Read.All
      </div>
    </div>
  )
}
