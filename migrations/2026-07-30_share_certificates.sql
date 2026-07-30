CREATE TABLE IF NOT EXISTS share_certificates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  owner_id INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'pending_order', 'cancelled')),
  order_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sc_company ON share_certificates(company_id);
CREATE INDEX IF NOT EXISTS idx_sc_owner ON share_certificates(owner_id);
CREATE INDEX IF NOT EXISTS idx_sc_company_owner ON share_certificates(company_id, owner_id);
CREATE INDEX IF NOT EXISTS idx_sc_company_owner_status ON share_certificates(company_id, owner_id, status);
CREATE INDEX IF NOT EXISTS idx_sc_order ON share_certificates(order_id);
CREATE INDEX IF NOT EXISTS idx_sc_status ON share_certificates(status);
