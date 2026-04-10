import React, { useState, useEffect, useRef, useCallback } from 'react'
import type { AppSettings } from '../types/app'
import { ipcSettingsGet, ipcSettingsSave, ipcDialogOpenFile, ipcDialogOpenFolder, ipcAwsSsoLogin, ipcSettingsClearAiCache, ipcValidatePath } from '../lib/api'

type PathStatus = 'idle' | 'checking' | 'ok' | 'not_found' | 'empty'

function PathIcon({ status }: { status: PathStatus }) {
  if (status === 'checking') return <span style={{ color: 'var(--text-400)', fontSize: 14, flexShrink: 0 }}>⋯</span>
  if (status === 'ok') return <span style={{ color: 'var(--success)', fontSize: 14, flexShrink: 0 }}>✅</span>
  if (status === 'not_found') return <span style={{ color: 'var(--error)', fontSize: 14, flexShrink: 0 }}>❌</span>
  return null
}

export default function GeneralTab() {
  const [settings, setSettings] = useState<AppSettings>({
    intunewinToolPath: '',
    sourceRootPath: '',
    outputFolderPath: '',
    claudeApiKey: '',
    defaultMinOs: 'W10_21H2',
    logRetentionDays: 30,
    awsRegion: '',
    awsBedrockModelId: ''
  })
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [wintunerHash, setWintunerHash] = useState('')

  // SCRUM-92/93/94: path validation
  const [intunewinStatus, setIntunewinStatus] = useState<PathStatus>('idle')
  const [sourceRootStatus, setSourceRootStatus] = useState<PathStatus>('idle')
  const [outputStatus, setOutputStatus] = useState<PathStatus>('idle')
  const debounceRefs = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const validatePath = useCallback(async (value: string, setter: (s: PathStatus) => void) => {
    if (!value.trim()) { setter('empty'); return }
    setter('checking')
    try {
      const res = await ipcValidatePath(value.trim())
      setter(res.exists ? 'ok' : 'not_found')
    } catch {
      setter('idle')
    }
  }, [])

  const debouncedValidate = useCallback((field: string, value: string, setter: (s: PathStatus) => void) => {
    clearTimeout(debounceRefs.current[field])
    debounceRefs.current[field] = setTimeout(() => validatePath(value, setter), 600)
  }, [validatePath])

  const hasPathError = intunewinStatus === 'not_found' || sourceRootStatus === 'not_found' || outputStatus === 'not_found'
  const [claudeApiKeyConfigured, setClaudeApiKeyConfigured] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [ssoLoggingIn, setSsoLoggingIn] = useState(false)
  const [ssoStatus, setSsoStatus] = useState<{ success: boolean; message: string } | null>(null)
  const [clearingCache, setClearingCache] = useState(false)
  const [cacheCleared, setCacheCleared] = useState(false)

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
          logRetentionDays: res.logRetentionDays ?? 30,
          awsRegion: res.awsRegion || 'us-east-1',
          awsBedrockModelId: res.awsBedrockModelId || 'us.anthropic.claude-sonnet-4-5-20250929-v1:0'
        })
        setClaudeApiKeyConfigured(res.claudeApiKeyConfigured ?? false)
        const savedTheme = (res.theme ?? 'dark') as 'dark' | 'light'
        setTheme(savedTheme)
        document.documentElement.dataset.theme = savedTheme
        setWintunerHash(res.wintunerExpectedHash ?? '')
        // Validate paths on load
        if (res.intunewinToolPath) validatePath(res.intunewinToolPath, setIntunewinStatus)
        if (res.sourceRootPath) validatePath(res.sourceRootPath, setSourceRootStatus)
        if (res.outputFolderPath) validatePath(res.outputFolderPath, setOutputStatus)
      }
    }
    load()
  }, [validatePath])

  const handleThemeToggle = async (newTheme: 'dark' | 'light') => {
    setTheme(newTheme)
    document.documentElement.dataset.theme = newTheme
    await ipcSettingsSave({ theme: newTheme })
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Validate: at least one Claude connection method must be configured
    const apiKeyPresent = claudeApiKeyConfigured || (settings.claudeApiKey.length > 0 && !settings.claudeApiKey.includes('*'))
    const bedrockPresent = settings.awsRegion.trim().length > 0 && settings.awsBedrockModelId.trim().length > 0
    if (!apiKeyPresent && !bedrockPresent) {
      setError('At least one Claude connection method is required: configure a Direct API Key or fill in the AWS Bedrock region and model ID.')
      return
    }

    setSaving(true)
    const res = await ipcSettingsSave({
      intunewinToolPath: settings.intunewinToolPath,
      sourceRootPath: settings.sourceRootPath,
      outputFolderPath: settings.outputFolderPath,
      claudeApiKey: settings.claudeApiKey,
      defaultMinOs: settings.defaultMinOs,
      logRetentionDays: settings.logRetentionDays,
      awsRegion: settings.awsRegion,
      awsBedrockModelId: settings.awsBedrockModelId,
      wintunerExpectedHash: wintunerHash
    })
    setSaving(false)
    if (res.success) {
      // If a new real API key was saved, mark it as configured
      if (settings.claudeApiKey.length > 0 && !settings.claudeApiKey.includes('*')) {
        setClaudeApiKeyConfigured(true)
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } else {
      setError(res.error ?? 'Save failed')
    }
  }

  const handleSsoLogin = async () => {
    setSsoStatus(null)
    setSsoLoggingIn(true)
    const res = await ipcAwsSsoLogin()
    setSsoLoggingIn(false)
    setSsoStatus(res.success
      ? { success: true, message: 'AWS SSO login successful.' }
      : { success: false, message: res.error ?? 'AWS SSO login failed.' }
    )
  }

  const handleClearCache = async () => {
    setClearingCache(true)
    const res = await ipcSettingsClearAiCache()
    setClearingCache(false)
    if (res.success) {
      setCacheCleared(true)
      setTimeout(() => setCacheCleared(false), 2500)
    }
  }

  const f = (field: keyof AppSettings, val: string | number) =>
    setSettings(prev => ({ ...prev, [field]: val }))

  const apiKeyPresent = claudeApiKeyConfigured || (settings.claudeApiKey.length > 0 && !settings.claudeApiKey.includes('*'))
  const bedrockPresent = settings.awsRegion.trim().length > 0 && settings.awsBedrockModelId.trim().length > 0

  return (
    <div style={{ maxWidth: 560 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>General Settings</h2>
      <p style={{ color: 'var(--text-400)', fontSize: 13, marginBottom: 24 }}>
        Configure tool paths and API keys.
      </p>

      <form onSubmit={handleSave}>
        {/* ── Paths ─────────────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Paths</h3>

          <div className="form-group">
            <label>IntuneWinAppUtil.exe Path</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                value={settings.intunewinToolPath}
                onChange={e => { f('intunewinToolPath', e.target.value); debouncedValidate('intunewin', e.target.value, setIntunewinStatus) }}
                placeholder="C:\...\IntuneWinAppUtil.exe"
                style={{ flex: 1 }}
              />
              <PathIcon status={intunewinStatus} />
              <button
                type="button"
                className="btn-secondary"
                style={{ flexShrink: 0 }}
                onClick={async () => {
                  const path = await ipcDialogOpenFile('Select IntuneWinAppUtil.exe', [
                    { name: 'Executable', extensions: ['exe'] },
                    { name: 'All Files', extensions: ['*'] }
                  ])
                  if (path) { f('intunewinToolPath', path); validatePath(path, setIntunewinStatus) }
                }}
              >
                Browse
              </button>
            </div>
          </div>

          <div className="form-group">
            <label>Source Root Folder</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                value={settings.sourceRootPath}
                onChange={e => { f('sourceRootPath', e.target.value); debouncedValidate('sourceRoot', e.target.value, setSourceRootStatus) }}
                placeholder="C:\...\Source"
                style={{ flex: 1 }}
              />
              <PathIcon status={sourceRootStatus} />
              <button
                type="button"
                className="btn-secondary"
                style={{ flexShrink: 0 }}
                onClick={async () => {
                  const path = await ipcDialogOpenFolder('Select Source Root Folder')
                  if (path) { f('sourceRootPath', path); validatePath(path, setSourceRootStatus) }
                }}
              >
                Browse
              </button>
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Output Folder</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                value={settings.outputFolderPath}
                onChange={e => { f('outputFolderPath', e.target.value); debouncedValidate('output', e.target.value, setOutputStatus) }}
                placeholder="C:\...\Output"
                style={{ flex: 1 }}
              />
              <PathIcon status={outputStatus} />
              <button
                type="button"
                className="btn-secondary"
                style={{ flexShrink: 0 }}
                onClick={async () => {
                  const path = await ipcDialogOpenFolder('Select Output Folder')
                  if (path) { f('outputFolderPath', path); validatePath(path, setOutputStatus) }
                }}
              >
                Browse
              </button>
            </div>
          </div>
        </div>

        {/* ── Claude AI Connection ───────────────────────────────────── */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Claude AI Connection</h3>
            <p style={{ fontSize: 12, color: 'var(--text-400)', margin: 0 }}>
              Configure at least one connection method to enable AI-powered features.
            </p>
          </div>

          {/* Method 1: Direct API */}
          <div style={styles.methodBlock}>
            <div style={styles.methodHeader}>
              <div style={styles.methodBadge(apiKeyPresent)}>
                {apiKeyPresent ? '✓' : '1'}
              </div>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Direct Claude API</span>
              {apiKeyPresent && (
                <span style={{ fontSize: 11, color: 'var(--success, #4ade80)', marginLeft: 6 }}>Configured</span>
              )}
            </div>

            <div className="form-group" style={{ marginBottom: 0, marginTop: 12 }}>
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

          <div style={styles.methodDivider}>
            <span style={styles.methodDividerLabel}>or</span>
          </div>

          {/* Method 2: AWS Bedrock (SSO) */}
          <div style={styles.methodBlock}>
            <div style={styles.methodHeader}>
              <div style={styles.methodBadge(bedrockPresent)}>
                {bedrockPresent ? '✓' : '2'}
              </div>
              <span style={{ fontWeight: 600, fontSize: 13 }}>AWS Bedrock (SSO)</span>
              {bedrockPresent && (
                <span style={{ fontSize: 11, color: 'var(--success, #4ade80)', marginLeft: 6 }}>Configured</span>
              )}
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-500)', margin: '8px 0 12px' }}>
              Use your organization's AWS Bedrock environment to access Claude via AWS SSO.
            </p>

            <div className="form-group">
              <label>AWS Region</label>
              <input
                value={settings.awsRegion}
                onChange={e => f('awsRegion', e.target.value)}
                placeholder="us-east-1"
              />
            </div>

            <div className="form-group">
              <label>Bedrock Model ID</label>
              <input
                value={settings.awsBedrockModelId}
                onChange={e => f('awsBedrockModelId', e.target.value)}
                placeholder="us.anthropic.claude-sonnet-4-5-20250929-v1:0"
              />
              <p style={{ fontSize: 11, color: 'var(--text-500)', marginTop: 4 }}>
                Must be a Claude model available in your Bedrock account.
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleSsoLogin}
                disabled={ssoLoggingIn}
                style={{ flexShrink: 0 }}
              >
                {ssoLoggingIn ? 'Opening SSO login...' : 'Login with AWS SSO'}
              </button>
              {ssoStatus && (
                <span style={{ fontSize: 12, color: ssoStatus.success ? 'var(--success, #4ade80)' : 'var(--error, #f87171)' }}>
                  {ssoStatus.message}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── AI Cache ──────────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>AI Cache</h3>
          <p style={{ fontSize: 12, color: 'var(--text-400)', marginBottom: 12 }}>
            App catalog recommendations are cached locally. Clear this if switching AI connections or after updating your Bedrock model.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button type="button" className="btn-secondary" onClick={handleClearCache} disabled={clearingCache} style={{ flexShrink: 0 }}>
              {clearingCache ? 'Clearing...' : 'Clear AI Cache'}
            </button>
            {cacheCleared && <span style={{ fontSize: 12, color: 'var(--success, #4ade80)' }}>Cache cleared — reload App Catalog to refresh.</span>}
          </div>
        </div>

        {/* ── Defaults ──────────────────────────────────────────────── */}
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

        {/* ── Security ──────────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Security</h3>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>WinTuner Module Hash (SHA-256)</label>
            <input
              value={wintunerHash}
              onChange={e => setWintunerHash(e.target.value)}
              placeholder="Leave empty to skip hash verification"
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
            <p style={{ fontSize: 11, color: 'var(--text-500)', marginTop: 4 }}>
              Pin the expected SHA-256 hash of WinTuner.psd1. When set, WinTuner operations will fail if the hash does not match — protecting against supply chain attacks.
            </p>
          </div>
        </div>

        {/* ── Appearance ────────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Appearance</h3>
          <p style={{ fontSize: 12, color: 'var(--text-400)', marginBottom: 12 }}>Choose between dark and light theme.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className={theme === 'dark' ? 'btn-primary' : 'btn-secondary'}
              style={{ flexShrink: 0 }}
              onClick={() => handleThemeToggle('dark')}
            >
              Dark
            </button>
            <button
              type="button"
              className={theme === 'light' ? 'btn-primary' : 'btn-secondary'}
              style={{ flexShrink: 0 }}
              onClick={() => handleThemeToggle('light')}
            >
              Light
            </button>
          </div>
        </div>

        {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}

        {hasPathError && (
          <p className="error-text" style={{ marginBottom: 12 }}>
            One or more paths were not found. Fix the paths above before saving.
          </p>
        )}

        <button type="submit" className="btn-primary" disabled={saving || hasPathError} style={{ padding: '9px 24px' }}>
          {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save Settings'}
        </button>
      </form>
    </div>
  )
}

const styles = {
  methodBlock: {
    padding: '14px 16px',
    background: 'var(--bg-700)',
    borderRadius: 'var(--radius)',
    border: '1px solid var(--border)'
  } as React.CSSProperties,

  methodHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8
  } as React.CSSProperties,

  methodBadge: (active: boolean): React.CSSProperties => ({
    width: 22,
    height: 22,
    borderRadius: '50%',
    background: active ? '#14532d' : 'var(--bg-600)',
    border: `1px solid ${active ? '#22c55e' : 'var(--border)'}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 700,
    color: active ? '#4ade80' : 'var(--text-400)',
    flexShrink: 0
  }),

  methodDivider: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    margin: '12px 0'
  } as React.CSSProperties,

  methodDividerLabel: {
    fontSize: 11,
    color: 'var(--text-500)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    background: 'var(--bg-800)',
    padding: '0 8px',
    position: 'relative' as const,
    zIndex: 1
  } as React.CSSProperties
}
