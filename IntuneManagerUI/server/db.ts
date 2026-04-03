import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

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

export function createDatabase(dbPath?: string): Database.Database {
  const resolvedPath = dbPath ?? path.join(__dirname, '..', '..', 'intunemanager.db')
  const dir = path.dirname(resolvedPath)
  fs.mkdirSync(dir, { recursive: true })

  const database = new Database(resolvedPath)

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
