CREATE TABLE IF NOT EXISTS rodo_audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at       TEXT NOT NULL DEFAULT (datetime('now')),
  albums_count INTEGER NOT NULL DEFAULT 0,
  payload      TEXT NOT NULL DEFAULT '[]'
);
