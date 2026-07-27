-- ============================================================
-- Migration: Bot system, trading controls, bank, password resets
-- Run this in Supabase SQL Editor (safe to run multiple times)
-- ============================================================

-- 1. Users: add banned_until and ban_count columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_count INTEGER DEFAULT 0;

-- 2. Settings: add emergency_close, emergency_message, trading_days, bots_enabled
ALTER TABLE settings ADD COLUMN IF NOT EXISTS emergency_close INTEGER DEFAULT 0;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS emergency_message TEXT DEFAULT 'Markets under maintenance';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS trading_days TEXT DEFAULT '1,2,3,4,5,6,7';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS bots_enabled INTEGER DEFAULT 1;

-- 3. Orders: add original_shares, request_id
ALTER TABLE orders ADD COLUMN IF NOT EXISTS original_shares INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS request_id TEXT;

-- 4. Users: add xp, level
ALTER TABLE users ADD COLUMN IF NOT EXISTS xp INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS level INTEGER DEFAULT 1;

-- 5. Comments table
CREATE TABLE IF NOT EXISTS comments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  comment TEXT,
  likes INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Comment likes table
CREATE TABLE IF NOT EXISTS comment_likes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  comment_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, comment_id)
);

-- 7. Ko-fi payments table
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

-- 8. Password resets table
CREATE TABLE IF NOT EXISTS password_resets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  code TEXT,
  expires_at TIMESTAMPTZ,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Custom date ranges table
CREATE TABLE IF NOT EXISTS custom_date_ranges (
  id SERIAL PRIMARY KEY,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  label TEXT,
  enabled INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. User bank accounts table
CREATE TABLE IF NOT EXISTS user_bank_accounts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE NOT NULL,
  balance INTEGER DEFAULT 0,
  last_balance_update TIMESTAMPTZ DEFAULT NOW(),
  last_company_pick TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. User bank investments table
CREATE TABLE IF NOT EXISTS user_bank_investments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  company_id INTEGER NOT NULL,
  weight REAL DEFAULT 0,
  entry_price INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, company_id)
);

-- 12. Disable RLS on all new tables
ALTER TABLE comments DISABLE ROW LEVEL SECURITY;
ALTER TABLE comment_likes DISABLE ROW LEVEL SECURITY;
ALTER TABLE kofi_payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE password_resets DISABLE ROW LEVEL SECURITY;
ALTER TABLE custom_date_ranges DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_bank_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_bank_investments DISABLE ROW LEVEL SECURITY;

-- 13. Ensure settings row has the new columns populated
UPDATE settings SET
  emergency_close = COALESCE(emergency_close, 0),
  emergency_message = COALESCE(emergency_message, 'Markets under maintenance'),
  trading_days = COALESCE(trading_days, '1,2,3,4,5,6,7'),
  bots_enabled = COALESCE(bots_enabled, 1)
WHERE id = 1;

-- Done!
