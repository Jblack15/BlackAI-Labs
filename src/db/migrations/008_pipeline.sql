-- DealFlow AI — Deal Pipeline (migration 008)
-- Canonical deal stages, stage-change audit trail, and auto-trigger rules.
-- All statements are idempotent so the migration runner is safe to re-run.

CREATE TABLE IF NOT EXISTS pipeline_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  description TEXT,
  color TEXT,
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS pipeline_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  triggered_by TEXT NOT NULL DEFAULT 'manual',
  agent_name TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pipeline_events_lead_id ON pipeline_events (lead_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_events_created_at ON pipeline_events (created_at);

CREATE TABLE IF NOT EXISTS pipeline_automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_stage TEXT,
  to_stage TEXT,
  trigger_condition JSONB,
  action_type TEXT NOT NULL DEFAULT 'transition',
  action_config JSONB,
  is_active BOOLEAN DEFAULT true
);

-- Canonical stage column on leads (idempotent; added by 006, kept for safety).
ALTER TABLE leads ADD COLUMN IF NOT EXISTS pipeline_stage TEXT DEFAULT 'new_lead';

-- Seed the 19 canonical deal stages (idempotent).
INSERT INTO pipeline_stages (name, display_order, description, color) VALUES
  ('new_lead',            1,  'Lead captured from any source, awaiting enrichment.',            'slate'),
  ('property_enrichment', 2,  'Owner, property and lien data being enriched/skip-traced.',      'blue'),
  ('ai_qualification',    3,  'AI agent scoring motivation, equity and distress signals.',       'cyan'),
  ('seller_contacted',    4,  'First outreach sent to the seller.',                             'purple'),
  ('follow_up',           5,  'Nurturing the seller across the follow-up sequence.',            'violet'),
  ('deal_analysis',       6,  'ARV, repairs and MAO being calculated by the deal analyst.',      'teal'),
  ('offer_recommendation', 7, 'AI recommends an offer range for human review.',                  'indigo'),
  ('human_approval',      8,  'Offer awaiting human approval gate.',                            'amber'),
  ('offer_sent',          9,  'Approved offer presented to the seller.',                        'orange'),
  ('negotiation',         10, 'Back-and-forth with the seller on price and terms.',             'pink'),
  ('contract_prepared',   11, 'Contract drafted for the agreed terms.',                         'sky'),
  ('contract_sent',       12, 'Contract sent to the seller for signature.',                     'fuchsia'),
  ('contract_signed',     13, 'Signed contract in hand — deal is under contract.',              'emerald'),
  ('buyer_matching',      14, 'Matching the contract to cash buyers in the database.',          'lime'),
  ('buyer_contacted',     15, 'Buyer engaged on the assignment.',                               'green'),
  ('assignment',          16, 'Assignment agreement signed with the end buyer.',                'gold'),
  ('closing',             17, 'Title/escrow working toward close.',                             'yellow'),
  ('closed_won',          18, 'Deal closed — profit captured.',                                 'gold'),
  ('closed_lost',         19, 'Deal fell through or was abandoned.',                             'red')
ON CONFLICT (name) DO NOTHING;
