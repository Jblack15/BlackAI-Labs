-- DealFlow AI — Seller Pipeline CRM fields (migration 014)
-- Production hardening build #8 (PH1-B8): the seller-facing deal record.
--
-- Adds the seller-CRM columns to leads so a seller's deal terms are captured
-- as REAL operator/seller-entered data (never seeded, never fabricated):
--
--   asking_price          NUMERIC    — seller's asking price (if stated)
--   desired_close         DATE       — seller's desired closing date
--   occupancy             TEXT       — owner / tenant / vacant / unknown
--   motivation            TEXT       — why the seller is selling (notes)
--   mortgage_balance      NUMERIC    — outstanding mortgage, if disclosed
--   mortgage_lender       TEXT       — lender name, if disclosed
--   lien_info             TEXT       — other liens / title encumbrances
--   last_contact_at       TIMESTAMPTZ — last real contact with the seller
--   next_action           TEXT       — the next step the operator plans
--   next_action_due       DATE       — when that next step is due
--   seller_notes          TEXT       — free-form operator notes
--   seller_summary        TEXT       — data-derived summary (lib/seller-summary)
--   seller_summary_updated_at TIMESTAMPTZ — when the summary was (re)generated
--
-- Every column starts NULL for all 7,150 leads. The summary generator
-- (src/lib/seller-summary.ts) reads only REAL data and says "unknown —
-- requires seller contact" for anything not recorded. This migration does not
-- touch outreach_status, score, score_factors or priority_queue (B6/B7).
--
-- NOTE for the migration runner: no semicolons inside comment lines.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS asking_price NUMERIC;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS desired_close DATE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS occupancy TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS motivation TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS mortgage_balance NUMERIC;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS mortgage_lender TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lien_info TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_contact_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_action TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_action_due DATE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS seller_notes TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS seller_summary TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS seller_summary_updated_at TIMESTAMPTZ;
-- Constrain the occupancy vocabulary (drop-then-add is idempotent and NULL means not recorded)
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_occupancy_check;
ALTER TABLE leads ADD CONSTRAINT leads_occupancy_check CHECK (
  occupancy IS NULL OR occupancy IN ('owner', 'tenant', 'vacant', 'unknown')
);
-- Index for "work next actions due" queries
CREATE INDEX IF NOT EXISTS idx_leads_next_action_due ON leads (next_action_due);
CREATE INDEX IF NOT EXISTS idx_leads_last_contact_at ON leads (last_contact_at);
