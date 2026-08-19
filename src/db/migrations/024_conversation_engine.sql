-- DealFlow AI — Seller Conversation Engine (D2, migration 024)
-- Write-side owner-input capture columns. Adds the two structured seller
-- decision-capture fields the Conversation Engine form needs that do NOT yet
-- exist on leads (audited 2026-08-19):
--
--   decision_makers   TEXT — who must approve the sale (names + relationship),
--                            captured from the owner's post-call summary. Free
--                            text holds more than one signer where needed
--                            (spouse, co-owner, heir, POA), so one TEXT column
--                            holds a readable list, not a fixed vocab.
--   deal_potential    TEXT — the owner's flag for whether this lead is worth
--                            chasing (matches the /operations "deal potential"
--                            vocabulary). Constrained to the four-value
--                            vocabulary with NULL meaning not yet assessed.
--
-- Both start NULL for every lead (nothing fabricated). The engine writes them
-- only from what the owner records after a call.
-- NOTE for the migration runner: no semicolons inside comment lines.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS decision_makers TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS deal_potential TEXT;
-- Constrain deal_potential to the assessment vocabulary (drop-then-add is
-- idempotent and NULL means not assessed)
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_deal_potential_check;
ALTER TABLE leads ADD CONSTRAINT leads_deal_potential_check CHECK (
  deal_potential IS NULL OR deal_potential IN ('high', 'medium', 'low', 'none')
);
