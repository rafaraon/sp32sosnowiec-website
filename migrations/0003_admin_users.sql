-- Tabela zarządzania dostępem do panelu administracyjnego
CREATE TABLE IF NOT EXISTS admin_users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT UNIQUE NOT NULL COLLATE NOCASE,
  name        TEXT NOT NULL DEFAULT '',
  role        TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('admin','editor')),
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_by  TEXT
);

-- Indeks na email (frequent lookup)
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email COLLATE NOCASE);
