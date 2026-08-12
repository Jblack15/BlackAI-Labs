-- DealFlow AI — Outreach Status State Machine (migration 012)
-- Production hardening build #6 (PH1-B6): the CONTACT pipeline spine that the
-- command center (B10) will read
--
-- Adds leads.outreach_status (the contact lifecycle) alongside the existing
-- leads.pipeline_stage (the 19-stage DEAL pipeline, migration 008) which is
-- NOT touched. Vocabulary is the full spec state set from business plan
-- rev 18 Phase 1:
--   new, contactable, outreach_queued, contact_attempted, connected, qualified,
--   offer, negotiation, contract_sent, contract_signed, buyer_matched, title,
--   closed, assignment_paid, dnc, do_not_mail, opted_out, invalid_contact,
--   wrong_number, not_interested, follow_up, dead_lead
--
-- Backfill: every existing lead is genuinely 'new' — no outreach has happened
-- (the 5-lead reset in Sprint 0 already corrected false contacted status, and
-- the pilot is staged but NOTHING SENT). The column DEFAULT 'new' covers new
-- inserts — the backfill below only stamps outreach_status_updated_at.
--
-- All statements are idempotent so the runner is safe to re-run
--
-- NOTE for the migration runner: this file contains NO semicolons inside
-- comment lines and no literal dollar-quote openers inside comments

-- 1. Outreach status column + timestamp on leads
ALTER TABLE leads ADD COLUMN IF NOT EXISTS outreach_status TEXT NOT NULL DEFAULT 'new';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS outreach_status_updated_at TIMESTAMPTZ;

-- 2. CHECK constraint on the spec vocabulary (drop-then-add is idempotent)
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_outreach_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_outreach_status_check CHECK (
  outreach_status IN (
    'new', 'contactable', 'outreach_queued', 'contact_attempted', 'connected',
    'qualified', 'offer', 'negotiation', 'contract_sent', 'contract_signed',
    'buyer_matched', 'title', 'closed', 'assignment_paid', 'dnc', 'do_not_mail',
    'opted_out', 'invalid_contact', 'wrong_number', 'not_interested',
    'follow_up', 'dead_lead'
  )
);

-- 3. Backfill: stamp the timestamp for existing rows (status stays 'new')
UPDATE leads
SET outreach_status_updated_at = COALESCE(outreach_status_updated_at, updated_at, created_at, now())
WHERE outreach_status_updated_at IS NULL;

-- 4. Index for CRM filters and the command center (B10)
CREATE INDEX IF NOT EXISTS idx_leads_outreach_status ON leads (outreach_status);
