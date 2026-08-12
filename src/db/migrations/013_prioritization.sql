-- DealFlow AI — Lead Prioritization Queues (migration 013)
-- Production hardening build #7 (PH1-B7): make the DATABASE the source of
-- truth for lead scoring and the HOT/HIGH/MEDIUM/LOW/DEAD priority queues.
-- Before this migration the PropStream-adapted scores existed only in CSVs
-- (/home/team/shared/leads/lead-scores-ps-taxdelq.csv) and the CRM showed a
-- client-side heuristic (leadScore) that disagreed with the real scoring.
--
-- What is added:
--   leads.apn                TEXT  — Assessor Parcel Number (stable key from the
--                                    PropStream export, enables future re-matching
--                                    and cross-source dedupe)
--   leads.score              NUMERIC (0-10) — the REAL PropStream-adapted score
--                                    from today's pull. NULL = unscored (the 594
--                                    legacy leads keep NULL, never fabricated).
--   leads.score_factors      JSONB — full scoring dimensions (distress, equity,
--                                    equity_band, velocity, contactability, ev,
--                                    estimated_arv, estimated_mao, years_delq,
--                                    owner_occupied, is_entity, foreclosure_factor,
--                                    rank, batch, do_not_mail, has_phone, sfr_gate)
--   leads.priority_queue     TEXT  — computed queue (column added in migration 010,
--                                    now constrained). NULL = not yet computed.
--   leads.priority_updated_at TIMESTAMPTZ — last time the queue was computed.
--
-- Priority rules live in src/lib/prioritization.ts (computePriorityQueue) —
-- the owner tunes them there, not in SQL. This migration only stores the result.
--
-- All statements are idempotent so the migration runner is safe to re-run.
-- NOTE for the migration runner: this file contains no semicolons inside
-- comment lines and no dollar-quote blocks.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS apn TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS score NUMERIC;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS score_factors JSONB;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS priority_updated_at TIMESTAMPTZ;
-- Constrain the queue vocabulary (drop-then-add is idempotent, NULL = not yet computed)
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_priority_queue_check;
ALTER TABLE leads ADD CONSTRAINT leads_priority_queue_check CHECK (
  priority_queue IS NULL OR priority_queue IN ('HOT', 'HIGH', 'MEDIUM', 'LOW', 'DEAD')
);
-- Indexes for the CRM filter, the dashboard next-25 panel and refreshPriorities
CREATE INDEX IF NOT EXISTS idx_leads_score ON leads (score);
CREATE INDEX IF NOT EXISTS idx_leads_priority_queue ON leads (priority_queue);
