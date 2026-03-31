import React, { useState, useEffect } from 'react'
import type { AppSettings } from '../types/app'
import { ipcSettingsGet, ipcSettingsSave, ipcDialogOpenFile, ipcDialogOpenFolder } from '../lib/ipc'

export default function GeneralTab() {
  const [settings, setSettings] = useState<AppSettings>({
    intunewinToolPath: '',
    sourceRootPath: '',
    outputFolderPath: '',
    claudeApiKey: '',
    defaultMinOs: 'W10_21H2',
    logRetentionDays: 30
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      const res = await ipcSettingsGet()
      if (res.success) {
        setSettings({
          intunewinToolPath: res.intunewinToolPath ?? '',
          sourceRootPath: res.sourceRootPath ?? '',
          outputFolderPath: res.outputFolderPath ?? '',
          claudeApiKey: res.claudeApiKey ?? '',
          defaultMinOs: res.defaultMinOs ?? 'W10_21H2',
          logRetentionDays: res.logRetentionDays ?? 30
        })
      }
    }
    load()
  }, [])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    const res = await ipcSettingsSave({
      intunewinToolPath: settings.intunewinToolPath,
      sourceRootPath: settings.sourceRootPath,
      outputFolderPath: settings.outputFolderPath,
      claudeApiKey: settings.claudeApiKey,
      defaultMinOs: settings.defaultMinOs,
      logRetentionDays: settings.logRetentionDays
    })
    setSaving(false)
    if (res.success) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } else {
      setError(res.error ?? 'Save failed')
    }
  }

  const f = (field: keyof AppSettings, val: string | number) =>
    setSettings(prev => ({ ...prev, [field]: val }))

  return (
    <div style={{ maxWidth: 560 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>General Settings</h2>
      <p style={{ color: 'var(--text-400)', fontSize: 13, marginBottom: 24 }}>
        Configure tool paths and API keys.
      </p>

      <form onSubmit={handleSave}>
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Paths</h3>

          <div className="form-group">
            <label>IntuneWinAppUtil.exe Path</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={settings.intunewinToolPath}
                onChange={e => f('intunewinToolPath', e.target.value)}
                placeholder="C:\...\IntuneWinAppUtil.exe"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn-secondary"
                style={{ flexShrink: 0 }}
                onClick={async () => {
                  const path = await ipcDialogOpenFile('Select IntuneWinAppUtil.exe', [
                    { name: 'Executable', extensions: ['exe'] },
                    { name: 'All Files', extensions: ['*'] }
                  ])
                  if (path) f('intunewinToolPath', path)
                }}
              >
                Browse
              </button>
            </div>
          </div>

          <div className="form-group">
            <label>Source Root Folder</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={settings.sourceRootPath}
                onChange={e => f('sourceRootPath', e.target.value)}
                placeholder="C:\...\Source"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn-secondary"
                style={{ flexShrink: 0 }}
                onClick={async () => {
                  const path = await ipcDialogOpenFolder('Select Source Root Folder')
                  if (path) f('sourceRootPath', path)
                }}
              >
                Browse
              </button>
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Output Folder</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={settings.outputFolderPath}
                onChange={e => f('outputFolderPath', e.target.value)}
                placeholder="C:\...\Output"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn-secondary"
                style={{ flexShrink: 0 }}
                onClick={async () => {
                  const path = await ipcDialogOpenFolder('Select Output Folder')
                  if (path) f('outputFolderPath', path)
                }}
              >
                Browse
              </button>
            </div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Claude AI</h3>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Anthropic API Key</label>
            <input
              type="password"
              value={settings.claudeApiKey}
              onChange={e => f('claudeApiKey', e.target.value)}
              placeholder="sk-ant-..."
              autoComplete="off"
            />
            <p style={{ fontSize: 11, color: 'var(--text-500)', marginTop: 4 }}>
              Stored encrypted using your machine's unique key. Never sent anywhere except Anthropic.
            </p>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Defaults</h3>

          <div className="form-group">
            <label>Minimum OS (default)</label>
            <select value={settings.defaultMinOs} onChange={e => f('defaultMinOs', e.target.value)}>
              <option value="W10_1803">Windows 10 1803</option>
              <option value="W10_1809">Windows 10 1809</option>
              <option value="W10_1903">Windows 10 1903</option>
              <option value="W10_1909">Windows 10 1909</option>
              <option value="W10_2004">Windows 10 2004</option>
              <option value="W10_20H2">Windows 10 20H2</option>
              <option value="W10_21H1">Windows 10 21H1</option>
              <option value="W10_21H2">Windows 10 21H2</option>
              <option value="W10_22H2">Windows 10 22H2</option>
              <option value="W11_21H2">Windows 11 21H2</option>
              <option value="W11_22H2">Windows 11 22H2</option>
              <option value="W11_23H2">Windows 11 23H2</option>
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Log Retention (days)</label>
            <input
              type="number"
              min={1}
              max={365}
              value={settings.logRetentionDays}
              onChange={e => f('logRetentionDays', parseInt(e.target.value) || 30)}
              style={{ width: 120 }}
            />
          </div>
        </div>

        {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}

        <button type="submit" className="btn-primary" disabled={saving} style={{ padding: '9px 24px' }}>
          {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save Settings'}
        </button>
      </form>
    </div>
  )
}
