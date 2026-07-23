CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT,
  email TEXT UNIQUE,
  password TEXT,
  balance NUMERIC DEFAULT 0,
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS companies (
  id SERIAL PRIMARY KEY,
  name TEXT,
  ticker TEXT,
  description TEXT,
  share_price NUMERIC,
  total_shares INTEGER,
  initial_price NUMERIC,
  initial_shares INTEGER
);

CREATE TABLE IF NOT EXISTS holdings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  shares_owned INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  type TEXT,
  shares INTEGER,
  price_per_share NUMERIC,
  total_amount NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS currency_purchases (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  paypal_order_id TEXT,
  amount_cents NUMERIC,
  status TEXT DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS price_history (
  id SERIAL PRIMARY KEY,
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  price NUMERIC,
  timestamp BIGINT
);

CREATE TABLE IF NOT EXISTS bank_fund (
  id SERIAL PRIMARY KEY,
  balance NUMERIC DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  trading_enabled INTEGER DEFAULT 1,
  trading_open_hour INTEGER DEFAULT 0,
  trading_close_hour INTEGER DEFAULT 24
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  type TEXT,
  shares INTEGER,
  price_per_share NUMERIC,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE companies DISABLE ROW LEVEL SECURITY;
ALTER TABLE holdings DISABLE ROW LEVEL SECURITY;
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE currency_purchases DISABLE ROW LEVEL SECURITY;
ALTER TABLE price_history DISABLE ROW LEVEL SECURITY;
ALTER TABLE bank_fund DISABLE ROW LEVEL SECURITY;
ALTER TABLE settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE orders DISABLE ROW LEVEL SECURITY;

INSERT INTO bank_fund (id, balance) VALUES (1, 0) ON CONFLICT DO NOTHING;
INSERT INTO settings (id, trading_enabled, trading_open_hour, trading_close_hour) VALUES (1, 1, 0, 24) ON CONFLICT DO NOTHING;

INSERT INTO companies (name, ticker, description, share_price, total_shares, initial_price, initial_shares) VALUES
('NovaTech Industries', 'NVTK', 'Leading tech innovator in AI and cloud computing', 15000, 5000, 15000, 5000),
('Global Energy Corp', 'GEC', 'Renewable energy solutions worldwide', 8500, 8000, 8500, 8000),
('MediVita Pharmaceuticals', 'MDVT', 'Biotech and pharmaceutical research', 22000, 3000, 22000, 3000),
('SkyLine Aerospace', 'SKLA', 'Space technology and aviation', 35000, 2000, 35000, 2000),
('FreshHarvest Foods', 'FRHV', 'Organic food production and distribution', 4500, 12000, 4500, 12000),
('CryptoVault Digital', 'CVDC', 'Cryptocurrency exchange and blockchain services', 12000, 6000, 12000, 6000),
('UrbanBuild Construction', 'UBLD', 'Smart city infrastructure and construction', 6800, 7000, 6800, 7000),
('AquaPure Systems', 'AQPS', 'Water purification and environmental tech', 9200, 5500, 9200, 5500),
('NeuralLink Gaming', 'NRLG', 'VR/AR gaming and immersive experiences', 18500, 4000, 18500, 4000),
('Titan Steel Works', 'TSTL', 'Advanced materials and metallurgy', 5500, 10000, 5500, 10000);

DO $$
DECLARE
  comp RECORD;
  i INTEGER;
BEGIN
  FOR comp IN SELECT id, share_price FROM companies LOOP
    FOR i IN 0..23 LOOP
      INSERT INTO price_history (company_id, price, timestamp)
      VALUES (comp.id, ROUND(comp.share_price * (1 + (random() - 0.5) * 0.06)), (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT - (23 - i) * 3600000);
    END LOOP;
  END LOOP;
END $$;
