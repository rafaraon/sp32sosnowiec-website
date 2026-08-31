-- Aktualności
CREATE TABLE IF NOT EXISTS news (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  slug          TEXT UNIQUE NOT NULL,
  excerpt       TEXT,
  body_html     TEXT,
  cover_r2_key  TEXT,
  published_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  author_email  TEXT
);

-- Galerie — albumy
CREATE TABLE IF NOT EXISTS gallery_albums (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,
  slug            TEXT UNIQUE NOT NULL,
  school_year     TEXT NOT NULL,
  class_label     TEXT,
  graduation_year INTEGER NOT NULL,
  event_date      TEXT,
  cover_r2_key    TEXT,
  published       INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Galerie — zdjęcia
CREATE TABLE IF NOT EXISTS gallery_photos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id        INTEGER NOT NULL REFERENCES gallery_albums(id) ON DELETE CASCADE,
  r2_key          TEXT NOT NULL,
  r2_key_thumb    TEXT,
  consent_ref     TEXT,
  graduation_year INTEGER NOT NULL,
  anonymized      INTEGER NOT NULL DEFAULT 0,
  anonymized_at   TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Dokumenty
CREATE TABLE IF NOT EXISTS documents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category    TEXT NOT NULL CHECK(category IN ('dokumenty','zfss','druki','rodo')),
  title       TEXT NOT NULL,
  r2_key      TEXT NOT NULL,
  file_type   TEXT,
  file_size   INTEGER,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  published   INTEGER NOT NULL DEFAULT 1,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  uploaded_by TEXT
);

-- Specjaliści
CREATE TABLE IF NOT EXISTS specialists (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  role         TEXT NOT NULL UNIQUE CHECK(role IN ('psycholog','pedagog','doradca','pielegnarka')),
  name         TEXT NOT NULL,
  title_prefix TEXT,
  room         TEXT,
  phone_ext    TEXT,
  hours        TEXT NOT NULL DEFAULT '[]',
  active       INTEGER NOT NULL DEFAULT 1,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Jadłospis
CREATE TABLE IF NOT EXISTS menu_weeks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start  TEXT NOT NULL UNIQUE,
  r2_key      TEXT,
  notes       TEXT,
  published   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Wnioski RODO
CREATE TABLE IF NOT EXISTS consent_requests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  student_name    TEXT NOT NULL,
  class_label     TEXT,
  graduation_year INTEGER,
  request_type    TEXT NOT NULL CHECK(request_type IN ('withdrawal','deletion')),
  requested_at    TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at     TEXT,
  resolved_by     TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','resolved')),
  notes           TEXT
);

-- Seed: specjaliści (dane z istniejących stron)
INSERT OR IGNORE INTO specialists (role, name, title_prefix, room, phone_ext, hours) VALUES
  ('psycholog', 'Agnieszka Żak', 'mgr', '21', NULL,
   '[{"day":"Poniedziałek","from":"8:00","to":"15:40"},{"day":"Wtorek","from":"8:00","to":"15:40"},{"day":"Środa","from":"10:00","to":"16:00"},{"day":"Czwartek","from":"8:00","to":"15:00"},{"day":"Piątek","from":"8:00","to":"13:00"}]'),
  ('pedagog', 'Edyta Kołton', 'mgr', '20', '24',
   '[{"day":"Poniedziałek","from":"8:00","to":"15:40"},{"day":"Wtorek","from":"8:50","to":"15:40"},{"day":"Środa","from":"10:30","to":"16:00"},{"day":"Czwartek","from":"8:00","to":"12:00"},{"day":"Piątek","from":"8:00","to":"13:00"}]'),
  ('doradca', 'Dorota Zalas', 'mgr', '06', NULL,
   '[{"day":"Wtorek","from":"13:00","to":"16:00"},{"day":"Środa","from":"8:00","to":"15:00"}]'),
  ('pielegnarka', 'Agnieszka Gnacik', NULL, NULL, NULL,
   '[{"day":"Wtorek","from":"7:30","to":"11:30"},{"day":"Środa","from":"11:00","to":"15:00"},{"day":"Czwartek","from":"11:00","to":"15:00"},{"day":"Piątek","from":"7:30","to":"15:00"}]');
