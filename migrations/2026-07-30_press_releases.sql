CREATE TABLE IF NOT EXISTS press_releases (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('positive', 'negative')),
  severity INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE press_releases ADD COLUMN IF NOT EXISTS severity INTEGER NOT NULL DEFAULT 1;
