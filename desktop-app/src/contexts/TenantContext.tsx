import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import type { TenantInfo } from '../types/app'
import { ipcPsGetTenantConfig, ipcPsDisconnectTenant } from '../lib/api'

export interface DeviceCodeInfo {
  userCode: string
  verificationUri: string
  message: string
}

interface ConnectResult {
  success: boolean
  error?: string
  deviceCode?: DeviceCodeInfo
}

interface TenantContextValue {
  tenant: TenantInfo
  tenantChecked: boolean  // true once the initial DB status check has completed
  refreshStatus: () => Promise<void>
  connect: (useDeviceCode?: boolean) => Promise<ConnectResult>
  disconnect: () => Promise<void>
}

const TenantContext = createContext<TenantContextValue | null>(null)

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const [tenant, setTenant] = useState<TenantInfo>({ isConnected: false })
  const [tenantChecked, setTenantChecked] = useState(false)

  const refreshStatus = useCallback(async () => {
    const res = await ipcPsGetTenantConfig()
    setTenant({
      isConnected: res.isConnected ?? false,
      username: res.username,
      tenantId: res.tenantId,
      expiresInMinutes: res.expiresInMinutes
    })
    setTenantChecked(true)
  }, [])

  useEffect(() => {
    refreshStatus()
    const interval = setInterval(refreshStatus, 60_000)
    return () => clearInterval(interval)
  }, [refreshStatus])

  const connect = useCallback(async (useDeviceCode = false): Promise<ConnectResult> => {
    if (!useDeviceCode) {
      // OAuth2 Authorization Code Flow — redirect the browser to Microsoft login.
      // The server will exchange the code and save tokens; after redirect back to /
      // the 60s poll will pick up the connected state.
      window.location.href = '/api/auth/ms-login'
      return { success: true }
    }

    // Device Code Flow — ask server to start polling, return code info to display
    try {
      const res = await fetch('/api/auth/ms-device-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(() => {
            const token = sessionStorage.getItem('intunemanager_session')
            return token ? { Authorization: `Bearer ${token}` } : {}
          })()
        }
      })
      const data = await res.json() as { success: boolean; userCode?: string; verificationUri?: string; message?: string; error?: string }
      if (!data.success) {
        return { success: false, error: data.error ?? 'Device code request failed' }
      }
      return {
        success: true,
        deviceCode: {
          userCode: data.userCode!,
          verificationUri: data.verificationUri!,
          message: data.message ?? ''
        }
      }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }, [])

  const disconnect = useCallback(async () => {
    await ipcPsDisconnectTenant()
    setTenant({ isConnected: false })
    setTenantChecked(true)
  }, [])

  return (
    <TenantContext.Provider value={{ tenant, tenantChecked, refreshStatus, connect, disconnect }}>
      {children}
    </TenantContext.Provider>
  )
}

export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantContext)
  if (!ctx) throw new Error('useTenant must be used within TenantProvider')
  return ctx
}
