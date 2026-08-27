-- SP32 CMS Schema
-- Run: wrangler d1 execute sp32-cms --file=schema.sql

CREATE TABLE IF NOT EXISTS articles (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT    NOT NULL UNIQUE,
  title        TEXT    NOT NULL,
  lead         TEXT,
  body         TEXT,
  category     TEXT    NOT NULL DEFAULT 'szkolne',  -- szkolne | projekty | ogloszenia
  status       TEXT    NOT NULL DEFAULT 'draft',    -- draft | published
  featured     INTEGER NOT NULL DEFAULT 0,
  cover_url    TEXT,
  cover_caption TEXT,
  author       TEXT    NOT NULL DEFAULT 'Redakcja',
  tags         TEXT,                                -- comma-separated
  published_at TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_articles_status       ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_category     ON articles(category);
CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_slug         ON articles(slug);
CREATE INDEX IF NOT EXISTS idx_articles_featured     ON articles(featured);

CREATE TABLE IF NOT EXISTS galleries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT    NOT NULL UNIQUE,
  title        TEXT    NOT NULL,
  description  TEXT,
  cover_url    TEXT,
  status       TEXT    NOT NULL DEFAULT 'draft',
  cohort_year  INTEGER,          -- rok ukończenia szkoły przez klasę (RODO: retencja)
  consent_id   TEXT,             -- nr papierowej zgody rodzica (np. ZG/2026/042)
  published_at TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_galleries_status ON galleries(status);
CREATE INDEX IF NOT EXISTS idx_galleries_slug   ON galleries(slug);

CREATE TABLE IF NOT EXISTS gallery_images (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  gallery_id INTEGER NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  url        TEXT    NOT NULL,
  caption    TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gallery_images_gallery ON gallery_images(gallery_id, sort_order);

CREATE TABLE IF NOT EXISTS media (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  r2_key      TEXT NOT NULL UNIQUE,
  url         TEXT NOT NULL,
  filename    TEXT,
  mime_type   TEXT,
  size_bytes  INTEGER,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
