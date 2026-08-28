CREATE TABLE IF NOT EXISTS projekty (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tytul      TEXT NOT NULL,
  opis       TEXT,
  kategoria  TEXT NOT NULL DEFAULT 'ogolny',
  icon       TEXT DEFAULT '📌',
  rok_od     INTEGER,
  rok_do     INTEGER,
  link       TEXT,
  kolejnosc  INTEGER DEFAULT 0,
  aktywny    INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
