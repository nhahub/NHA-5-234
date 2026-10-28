import Database from 'better-sqlite3';

export const db = new Database(process.env.DB_FILE || 'autodeployers.db');
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS deployments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  repo_url TEXT NOT NULL,
  environment TEXT NOT NULL,
  replicas INTEGER NOT NULL,
  app_port INTEGER NOT NULL DEFAULT 3000,
  node_port INTEGER,
  status TEXT NOT NULL DEFAULT 'queued',
  stage TEXT,
  app_url TEXT,
  logs TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deployment_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
// Added after the first release; wrap in try/catch so existing databases upgrade in place.
try { db.exec("ALTER TABLE deployments ADD COLUMN template TEXT"); } catch { /* column already exists */ }
