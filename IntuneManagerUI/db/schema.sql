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

-- Default settings (will be overwritten by user config)
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('default_min_os', 'W10_21H2');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('log_retention_days', '30');
