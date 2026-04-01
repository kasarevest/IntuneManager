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

// Schema inlined to avoid dependency on an external file that may not be
// present inside the asar archive when running from a packaged build.
const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    username             TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash        TEXT NOT NULL,
    role                 TEXT NOT NULL CHECK(role IN ('superadmin','admin','viewer')),
    created_at           TEXT NOT NULL DEFAULT (datetime('now')),
    last_login           TEXT,
    must_change_password INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_config (
    id                     INTEGER PRIMARY KEY CHECK(id=1),
    tenant_id              TEXT,
    tenant_display_name    TEXT,
    username               TEXT,
    token_expiry           TEXT,
    connected_at           TEXT,
    updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_deployments (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id           TEXT NOT NULL UNIQUE,
    app_name         TEXT NOT NULL,
    winget_id        TEXT,
    intune_app_id    TEXT,
    deployed_version TEXT,
    operation        TEXT NOT NULL CHECK(operation IN ('deploy','update')),
    status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK(status IN ('pending','running','success','failed','cancelled')),
    error_message    TEXT,
    intunewin_path   TEXT,
    performed_by     INTEGER REFERENCES users(id),
    started_at       TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at     TEXT,
    log_snapshot     TEXT
);

INSERT OR IGNORE INTO app_settings (key, value) VALUES ('default_min_os', 'W10_21H2');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('log_retention_days', '30');
`

let win: BrowserWindow | null = null
let db: Database.Database | null = null

function createDatabase(): Database.Database {
  fs.mkdirSync(USER_DATA, { recursive: true })
  const database = new Database(DB_PATH)

  // Apply schema
  database.exec(SCHEMA_SQL)

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
