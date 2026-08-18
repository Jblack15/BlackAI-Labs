-- DealFlow AI — Title/closing workflow (migration 020)
-- PH1-B12: the last mile of the deal lifecycle — contract → title → closed →
-- assignment paid. Extends the EXISTING contracts table (migration 003:
-- lead_id, buyer_id, contract_type, status, purchase_price, assignment_fee,
-- earnest_money, closing_date, contract_data — 0 rows today) with:
--
--   * campaign_id            — B10b campaign-economics auto-activates the
--                              revenue path the moment this column exists (it
--                              detects the column via information_schema).
--   * assignment_fee_cents   — the CANONICAL tracked fee ($15K target lives
--                              here, NULL = not yet recorded). The legacy
--                              assignment_fee NUMERIC column is kept as the
--                              dollar mirror so B10b's revenue SUM keeps
--                              reading dollars without a code change.
--   * title_company / escrow_account — where the deal actually closes.
--   * close_date (actual) and expected_close_date (target) — closing_date is
--                              left untouched as the legacy echo.
--   * closing_deadlines JSONB — deadline echo (title objection, financing,
--                              close date) rendered on the contract detail.
--   * status: the existing TEXT column is REUSED — default moves 'draft' →
--              'new' and a CHECK constraint pins the closing vocabulary
--              (new → title_open → title_clear → docs_sent → docs_signed →
--              funded → closed, plus cancelled).
--   * closing_checklist_items — one row per step of a contract's closing.
--              NOT seeded here: a checklist belongs to a contract, and the
--              standard 8-step checklist is seeded by lib/closing.ts
--              createContract() (there are 0 contracts today — migration
--              seeding would create orphan rows that can never exist).
--
-- Idempotent: every statement is guarded (ADD COLUMN IF NOT EXISTS / DROP
-- CONSTRAINT IF EXISTS / CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT
-- EXISTS) so the migration runner is safe to re-run.
--
-- NOTE for the migration runner: no semicolons inside comment lines and no
-- literal dollar-quote openers inside comments.

-- 1. contracts — closing workflow columns
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES campaigns(id);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS assignment_fee_cents INT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS title_company TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS escrow_account TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS close_date DATE;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS expected_close_date DATE;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS closing_deadlines JSONB;

-- 2. status: reuse the existing column. Default 'draft' → 'new' and CHECK on
--    the closing vocabulary. Drop-then-add is idempotent and legacy rows
--    (none today) are normalised to 'new' first so ADD CONSTRAINT never fails.
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_status_check;
ALTER TABLE contracts ALTER COLUMN status SET DEFAULT 'new';
UPDATE contracts
SET status = 'new'
WHERE status IS NULL OR status NOT IN (
  'new', 'title_open', 'title_clear', 'docs_sent', 'docs_signed',
  'funded', 'closed', 'cancelled'
);
ALTER TABLE contracts ADD CONSTRAINT contracts_status_check CHECK (
  status IN (
    'new', 'title_open', 'title_clear', 'docs_sent', 'docs_signed',
    'funded', 'closed', 'cancelled'
  )
);

-- 3. indexes for the closing workflow reads
CREATE INDEX IF NOT EXISTS idx_contracts_campaign_id ON contracts (campaign_id);
CREATE INDEX IF NOT EXISTS idx_contracts_close_date ON contracts (close_date);

-- 4. closing_checklist_items — per-contract closing steps
CREATE TABLE IF NOT EXISTS closing_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  done BOOLEAN NOT NULL DEFAULT false,
  due_date DATE,
  completed_at TIMESTAMPTZ,
  operator TEXT,
  position INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_closing_checklist_contract ON closing_checklist_items (contract_id, position);
