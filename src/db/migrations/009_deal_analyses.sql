-- DealFlow AI — Migration 009: Deal analysis persistence
-- Saves every deal calculator run (src/routes/calculator.tsx) so numbers can be
-- reloaded, compared over time, and later fed to buyer matching and underwriting.
-- All statements are idempotent so the migration runner is safe to re-run.
-- NOTE: the migration splitter treats any semicolon outside a dollar-quote
-- block as a statement boundary, so comments must not contain semicolons and
-- must not contain a literal double-dollar sign.

CREATE TABLE IF NOT EXISTS deal_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  -- Input fields (what the calculator computes from)
  arv NUMERIC NOT NULL DEFAULT 0,
  repairs NUMERIC NOT NULL DEFAULT 0,
  max_offer NUMERIC NOT NULL DEFAULT 0,
  assignment_fee NUMERIC NOT NULL DEFAULT 0,
  closing_costs NUMERIC NOT NULL DEFAULT 0,
  holding_costs NUMERIC NOT NULL DEFAULT 0,
  -- Output fields
  projected_profit NUMERIC NOT NULL DEFAULT 0,
  roi NUMERIC NOT NULL DEFAULT 0,
  margin NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deal_analyses_lead_id ON deal_analyses (lead_id);
CREATE INDEX IF NOT EXISTS idx_deal_analyses_created_at ON deal_analyses (created_at);
