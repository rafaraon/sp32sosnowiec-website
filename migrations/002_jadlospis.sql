CREATE TABLE IF NOT EXISTS jadlospis (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start TEXT    NOT NULL,  -- ISO Monday "YYYY-MM-DD"
  day_num    INTEGER NOT NULL,  -- 1=pon 2=wt 3=sr 4=czw 5=pt
  zupa       TEXT,
  drugie     TEXT,
  kompot     TEXT,
  uwagi      TEXT,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(week_start, day_num)
);
CREATE INDEX IF NOT EXISTS idx_jadlospis_week ON jadlospis(week_start);
