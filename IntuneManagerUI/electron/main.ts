import { app, BrowserWindow, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import Database from 'better-sqlite3'
import { initializeAuth, registerAuthHandlers } from './ipc/auth'
import { registerPsBridgeHandlers } from './ipc/ps-bridge'
import { registerAiAgentHandlers } from './ipc/ai-agent'
import { registerSettingsHandlers } from './ipc/settings'

// Resolve the database path to Electron's userData directory (local, not synced)
const USER_DATA = app.getPath('userData')
const DB_PATH = path.join(USER_DATA, 'intunemanager.db')
const SCHEMA_PATH = path.join(__dirname, '..', 'db', 'schema.sql')

let win: BrowserWindow | null = null
let db: Database.Database | null = null

function createDatabase(): Database.Database {
  fs.mkdirSync(USER_DATA, { recursive: true })
  const database = new Database(DB_PATH)

  // Apply schema
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8')
  database.exec(schema)

  // Migrations — run once for existing DBs that predate schema additions
  try {
    const cols = database.prepare("PRAGMA table_info(tenant_config)").all() as Array<{ name: string }>
    if (!cols.some(c => c.name === 'token_expiry')) {
      database.exec("ALTER TABLE tenant_config ADD COLUMN token_expiry TEXT")
    }
  } catch { /* non-fatal — DB may not exist yet */ }

  // Seed default path settings from project structure
  const projectRoot = path.join(__dirname, '..', '..', '..')
  const toolPath = path.join(projectRoot, 'IntuneWinAppUtil.exe')
  const sourceRoot = path.join(projectRoot, 'Source')
  const outputFolder = path.join(projectRoot, 'Output')

  const upsert = database.prepare(
    'INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)'
  )
  upsert.run('intunewin_tool_path', toolPath)
  upsert.run('source_root_path', sourceRoot)
  upsert.run('output_folder_path', outputFolder)

  return database
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'IntuneManager',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    show: false
  })

  // Open external links in system browser
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Show window once ready to avoid white flash
  window.once('ready-to-show', () => {
    window.show()
  })

  // Load the renderer
  if (process.env.VITE_DEV_SERVER_URL) {
    window.loadURL(process.env.VITE_DEV_SERVER_URL)
    window.webContents.openDevTools()
  } else {
    window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  return window
}

app.whenReady().then(() => {
  try {
    db = createDatabase()
    initializeAuth(db)

    // Clean up expired sessions before any handler registration
    try {
      db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run()
    } catch { /* non-fatal */ }

    // Register IPC handlers BEFORE creating window so renderer calls never miss them
    registerAuthHandlers(db)
    registerSettingsHandlers(db)

    win = createWindow()

    registerPsBridgeHandlers(win, db)
    registerAiAgentHandlers(win, db)
  } catch (err) {
    console.error('Startup error:', err)
    app.quit()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    db?.close()
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && db) {
    win = createWindow()
    registerPsBridgeHandlers(win, db)
    registerAiAgentHandlers(win, db)
  }
})
