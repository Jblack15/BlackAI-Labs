-- DealFlow AI — Premium Leads Queue + Disposition (migration 021)
-- PH1-B13: the 13 high-value SFR leads with NO standard buyer fit.
--
-- The research (research/premium-13-disposition-2026-08-12.md) identified 13
-- premium SFR leads (MAO $494K-$1.22M, 11/13 free-and-clear, 5+yr tax-delq).
-- MAO ~= EV for all of them (near-market ceilings, NOT distressed discounts)
-- so they have zero fit with the 22 flipper buyers in the buyer database.
-- They are parked in a premium queue with a per-lead disposition plan instead
-- of being dispatched to flippers.
--
-- What is added to leads:
--   premium_lead         BOOLEAN NOT NULL DEFAULT false — true for exactly the
--                        13 researched leads (backfilled by scripts/backfill-
--                        premium-13.ts from the research APNs — NULL-free).
--   disposition_status   TEXT NULL — identified / outreach_ready /
--                        in_jv_discussion / under_offer / hold / deprioritized.
--                        NULL = not yet dispositioned (honest default).
--   disposition_strategy TEXT NULL — short free-text disposition plan from the
--                        research (licensed-agent JV (TREC no-referral-fee),
--                        developer land-sale, hold for tax-sale angle, etc).
--   target_buyer_type    TEXT NULL — investor / developer / licensed_agent_jv /
--                        land_assembler / other. 'investor' means a flipper
--                        investor — the 22-buyer database is NEVER linked to
--                        premium leads (near-market ceilings).
--   disposition_notes    TEXT NULL — real research/CSV facts (lien per export,
--                        probate/overlay flags, comp-verification reminders).
--   disposition_updated_at TIMESTAMPTZ NULL — last disposition edit/backfill.
--
-- Disposition edits are written to outreach_audit_log (channel='disposition')
-- by src/lib/premium-queue.ts saveDisposition() — the audit trail lives in the
-- compliance core, not duplicated here.
--
-- Idempotent: every statement is guarded (ADD COLUMN IF NOT EXISTS / DROP
-- CONSTRAINT IF EXISTS / CREATE INDEX IF NOT EXISTS) so the migration runner is
-- safe to re-run.
--
-- NOTE for the migration runner: no semicolons inside comment lines and no
-- literal dollar-quote openers inside comments.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS premium_lead BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS disposition_status TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS disposition_strategy TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS target_buyer_type TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS disposition_notes TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS disposition_updated_at TIMESTAMPTZ;
-- Constrain the disposition vocabulary (drop-then-add is idempotent — NULL = not yet dispositioned)
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_disposition_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_disposition_status_check CHECK (
  disposition_status IS NULL OR disposition_status IN (
    'identified', 'outreach_ready', 'in_jv_discussion', 'under_offer',
    'hold', 'deprioritized'
  )
);
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_target_buyer_type_check;
ALTER TABLE leads ADD CONSTRAINT leads_target_buyer_type_check CHECK (
  target_buyer_type IS NULL OR target_buyer_type IN (
    'investor', 'developer', 'licensed_agent_jv', 'land_assembler', 'other'
  )
);
-- Index for the dashboard Premium Queue panel and CRM premium filter
CREATE INDEX IF NOT EXISTS idx_leads_premium_lead ON leads (premium_lead);
