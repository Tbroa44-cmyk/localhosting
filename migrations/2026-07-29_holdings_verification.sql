-- Holdings verification & audit system
-- Run this migration on Supabase SQL Editor

-- 1. Audit table: logs every share change
CREATE TABLE IF NOT EXISTS holdings_audit (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  company_id BIGINT NOT NULL,
  action TEXT NOT NULL,
  delta BIGINT NOT NULL DEFAULT 0,
  shares_before BIGINT NOT NULL DEFAULT 0,
  shares_after BIGINT NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  order_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_holdings_audit_user ON holdings_audit (user_id);
CREATE INDEX IF NOT EXISTS idx_holdings_audit_company ON holdings_audit (company_id);
CREATE INDEX IF NOT EXISTS idx_holdings_audit_created ON holdings_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_holdings_audit_source ON holdings_audit (source);

-- 2. Unique constraint: one holding row per user+company
-- First clean up any existing duplicates
DO $$
DECLARE
  dup RECORD;
  total_shares BIGINT;
  keep_id BIGINT;
  del_ids BIGINT[];
BEGIN
  FOR dup IN
    SELECT user_id, company_id, COUNT(*) as cnt
    FROM holdings
    GROUP BY user_id, company_id
    HAVING COUNT(*) > 1
  LOOP
    SELECT array_agg(id ORDER BY id), SUM(shares_owned)
    INTO del_ids, total_shares
    FROM holdings
    WHERE user_id = dup.user_id AND company_id = dup.company_id;

    keep_id := del_ids[1];
    del_ids := del_ids[2:];

    UPDATE holdings SET shares_owned = total_shares WHERE id = keep_id;

    IF array_length(del_ids, 1) > 0 THEN
      EXECUTE format(
        'DELETE FROM holdings WHERE id = ANY($1::bigint[])',
        del_ids
      );
    END IF;
  END LOOP;
END $$;

-- Now add the unique constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'holdings_user_company_unique'
  ) THEN
    ALTER TABLE holdings ADD CONSTRAINT holdings_user_company_unique UNIQUE (user_id, company_id);
  END IF;
END $$;

-- 3. Audit trigger: auto-logs every INSERT/UPDATE/DELETE on holdings
CREATE OR REPLACE FUNCTION holdings_audit_trigger_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO holdings_audit (user_id, company_id, action, delta, shares_before, shares_after, source, created_at)
    VALUES (NEW.user_id, NEW.company_id, 'create', NEW.shares_owned, 0, NEW.shares_owned, 'db_trigger', NOW());
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO holdings_audit (user_id, company_id, action, delta, shares_before, shares_after, source, created_at)
    VALUES (NEW.user_id, NEW.company_id,
      CASE WHEN NEW.shares_owned > OLD.shares_owned THEN 'add' ELSE 'remove' END,
      NEW.shares_owned - OLD.shares_owned,
      OLD.shares_owned, NEW.shares_owned, 'db_trigger', NOW());
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO holdings_audit (user_id, company_id, action, delta, shares_before, shares_after, source, created_at)
    VALUES (OLD.user_id, OLD.company_id, 'delete', -OLD.shares_owned, OLD.shares_owned, 0, 'db_trigger', NOW());
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS holdings_audit_trigger ON holdings;
CREATE TRIGGER holdings_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON holdings
  FOR EACH ROW
  EXECUTE FUNCTION holdings_audit_trigger_fn();

-- 4. Add holder_count column to price_history for "Holders" chart tab
ALTER TABLE price_history ADD COLUMN IF NOT EXISTS holder_count INTEGER;
