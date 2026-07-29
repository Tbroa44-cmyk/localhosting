-- Press releases table
CREATE TABLE IF NOT EXISTS press_releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('positive', 'negative')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
