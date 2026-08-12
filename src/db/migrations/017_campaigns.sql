-- DealFlow AI — Campaigns + campaign cost tracking (migration 017)
-- PH1-B10a: command center + funnel metrics + campaign cost tracking.
-- Spending-control logic (flag + pause recommendations) ships in B10b next —
-- this migration only records REAL money facts: what the owner approved
-- (kind='planned') vs what was actually spent (kind='actual').
--
-- Honesty contract (owner directive 2026-08-12):
--   * campaign_cost_entries are REAL MONEY records. kind='planned' = committed
--     by the owner but NOT spent. kind='actual' = money that actually moved.
--     Nothing is 'actual' until it is.
--   * The pilot campaigns below are staged but NOTHING has been sent:
--       - "Pilot Bexar Top1000 2026-08" (direct_mail): owner-approved cap $600
--         = $465.85 base (847 × $0.55) + $134.15 postage/setup allowance
--         (exact total hidden pending PropStream billing state). status
--         'planned', planned_budget_cents 60000, NO actual entries.
--       - "Dialer Pilot Bexar Top1000 2026-08" (voice): BatchDialer trial NOT
--         signed up, 0/150 calls placed → status 'planned', 0 budget.
--
-- Idempotent: every statement is guarded (IF NOT EXISTS / NOT EXISTS) so the
-- migration runner is safe to re-run — no duplicate campaigns, no duplicate
-- cost entries, no constraint errors.
--
-- NOTE for the migration runner: no semicolons inside comment lines and no
-- literal dollar-quote openers inside comments.

-- 1. Campaigns table
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('direct_mail', 'voice', 'email', 'sms', 'skip_trace', 'other')),
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'paused', 'completed', 'cancelled')),
  started_at TIMESTAMPTZ,
  planned_budget_cents INT NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Cost entries — one row per planned/actual money record
CREATE TABLE IF NOT EXISTS campaign_cost_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  amount_cents INT NOT NULL CHECK (amount_cents >= 0),
  kind TEXT NOT NULL CHECK (kind IN ('planned', 'actual')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  operator TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_campaign_cost_entries_campaign_id ON campaign_cost_entries (campaign_id);

-- 3. Seed the pilot direct-mail campaign (idempotent)
INSERT INTO campaigns (name, channel, status, planned_budget_cents, notes)
SELECT 'Pilot Bexar Top1000 2026-08', 'direct_mail', 'planned', 60000,
       'owner-approved cap $600, nothing spent — direct mail 847 × $0.55 ≈ $465.85 base + $134.15 postage/setup allowance'
WHERE NOT EXISTS (SELECT 1 FROM campaigns WHERE name = 'Pilot Bexar Top1000 2026-08');

INSERT INTO campaign_cost_entries (campaign_id, amount_cents, kind, operator, note)
SELECT c.id, 46585, 'planned', 'owner', 'direct mail base 847 × $0.55 ≈ $465.85 — owner-approved cap'
FROM campaigns c
WHERE c.name = 'Pilot Bexar Top1000 2026-08'
  AND NOT EXISTS (
    SELECT 1 FROM campaign_cost_entries e
    WHERE e.campaign_id = c.id AND e.amount_cents = 46585 AND e.kind = 'planned'
  );

INSERT INTO campaign_cost_entries (campaign_id, amount_cents, kind, operator, note)
SELECT c.id, 13415, 'planned', 'owner', 'postage/setup allowance — exact total hidden pending PropStream billing state'
FROM campaigns c
WHERE c.name = 'Pilot Bexar Top1000 2026-08'
  AND NOT EXISTS (
    SELECT 1 FROM campaign_cost_entries e
    WHERE e.campaign_id = c.id AND e.amount_cents = 13415 AND e.kind = 'planned'
  );

-- 4. Seed the dialer pilot (planned, 0 budget — trial not signed up, nothing sent)
INSERT INTO campaigns (name, channel, status, planned_budget_cents, notes)
SELECT 'Dialer Pilot Bexar Top1000 2026-08', 'voice', 'planned', 0,
       'BatchDialer trial NOT signed up — 0/150 calls placed, nothing spent. Blocked on owner: trial signup + dialer scope decision.'
WHERE NOT EXISTS (SELECT 1 FROM campaigns WHERE name = 'Dialer Pilot Bexar Top1000 2026-08');
