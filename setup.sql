CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT,
  email TEXT UNIQUE,
  password TEXT,
  balance NUMERIC DEFAULT 0,
  is_admin BOOLEAN DEFAULT FALSE,
  allowed INTEGER DEFAULT 0,
  xp INTEGER DEFAULT 0,
  level INTEGER DEFAULT 1,
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
  trading_close_hour INTEGER DEFAULT 24,
  emergency_close INTEGER DEFAULT 0,
  emergency_message TEXT DEFAULT 'Markets under maintenance',
  trading_days TEXT DEFAULT '1,2,3,4,5,6,7'
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  type TEXT,
  shares INTEGER,
  original_shares INTEGER,
  price_per_share NUMERIC,
  status TEXT DEFAULT 'pending',
  request_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  comment TEXT,
  likes INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comment_likes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  comment_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, comment_id)
);

CREATE TABLE IF NOT EXISTS kofi_payments (
  id SERIAL PRIMARY KEY,
  kofi_url TEXT,
  email TEXT,
  from_name TEXT,
  amount_cents INTEGER,
  coins INTEGER,
  user_id INTEGER,
  status TEXT DEFAULT 'pending',
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS password_resets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  code TEXT,
  expires_at TIMESTAMPTZ,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS custom_date_ranges (
  id SERIAL PRIMARY KEY,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  label TEXT,
  enabled INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_bank_accounts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE NOT NULL,
  balance INTEGER DEFAULT 0,
  last_balance_update TIMESTAMPTZ DEFAULT NOW(),
  last_company_pick TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_bank_accounts DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS user_bank_investments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  company_id INTEGER NOT NULL,
  weight REAL DEFAULT 0,
  entry_price INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, company_id)
);

ALTER TABLE user_bank_investments DISABLE ROW LEVEL SECURITY;
ALTER TABLE custom_date_ranges DISABLE ROW LEVEL SECURITY;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS original_shares INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS request_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS xp INTEGER DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS level INTEGER DEFAULT 1;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS emergency_close INTEGER DEFAULT 0;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS emergency_message TEXT DEFAULT 'Markets under maintenance';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS trading_days TEXT DEFAULT '1,2,3,4,5,6,7';

ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE companies DISABLE ROW LEVEL SECURITY;
ALTER TABLE holdings DISABLE ROW LEVEL SECURITY;
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE currency_purchases DISABLE ROW LEVEL SECURITY;
ALTER TABLE price_history DISABLE ROW LEVEL SECURITY;
ALTER TABLE bank_fund DISABLE ROW LEVEL SECURITY;
ALTER TABLE settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE comments DISABLE ROW LEVEL SECURITY;
ALTER TABLE comment_likes DISABLE ROW LEVEL SECURITY;
ALTER TABLE kofi_payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE password_resets DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_bank_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_bank_investments DISABLE ROW LEVEL SECURITY;
ALTER TABLE custom_date_ranges DISABLE ROW LEVEL SECURITY;

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
