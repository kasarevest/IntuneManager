import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import type { TenantInfo } from '../types/app'
import { ipcPsGetTenantConfig, ipcPsConnectTenant, ipcPsDisconnectTenant } from '../lib/ipc'

interface TenantContextValue {
  tenant: TenantInfo
  tenantChecked: boolean  // true once the initial DB status check has completed
  refreshStatus: () => Promise<void>
  connect: (useDeviceCode?: boolean) => Promise<{ success: boolean; error?: string }>
  disconnect: () => Promise<void>
}

const TenantContext = createContext<TenantContextValue | null>(null)

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const [tenant, setTenant] = useState<TenantInfo>({ isConnected: false })
  const [tenantChecked, setTenantChecked] = useState(false)

  const refreshStatus = useCallback(async () => {
    // Also called on-demand from individual pages
    // Read from DB-persisted tenant config — not from PS process state (which is ephemeral)
    const res = await ipcPsGetTenantConfig()
    setTenant({
      isConnected: res.isConnected ?? false,
      username: res.username,
      tenantId: res.tenantId,
      expiresInMinutes: res.expiresInMinutes
    })
    setTenantChecked(true)
  }, [])

  // Load tenant state on app start, then re-check every 60 s so the topbar
  // status and expiresInMinutes stay accurate across all pages without each
  // page needing to call refreshStatus() manually.
  useEffect(() => {
    refreshStatus()
    const interval = setInterval(refreshStatus, 60_000)
    return () => clearInterval(interval)
  }, [refreshStatus])

  const connect = useCallback(async (useDeviceCode = false) => {
    const res = await ipcPsConnectTenant(useDeviceCode)
    if (res.success) {
      // Use the data returned directly from connect — don't call refreshStatus()
      // which spawns a new PS process with no auth state (module state doesn't persist between processes)
      const expiry = res.tokenExpiry ? new Date(res.tokenExpiry) : null
      const expiresInMinutes = expiry ? Math.round((expiry.getTime() - Date.now()) / 60000) : undefined
      setTenant({
        isConnected: true,
        username: res.username,
        tenantId: res.tenantId,
        expiresInMinutes
      })
      setTenantChecked(true)
      return { success: true }
    }
    return { success: false, error: res.error ?? 'Connection failed' }
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
