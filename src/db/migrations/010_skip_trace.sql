-- DealFlow AI — Skip-Trace Monitoring + Contactability (migration 010)
-- Production hardening build #1 (PH1-B1): per-lead trace status, the
-- contactable/non-contactable split, and the skip-trace job registry that
-- powers stall detection, duplicate-job prevention and the backup/manual
-- trace workflow.
--
-- All statements are idempotent so the migration runner is safe to re-run.
-- `contactable` is a DERIVED column: a BEFORE INSERT/UPDATE trigger recomputes
-- it from phone/email + suppression flags, so it can never drift out of sync.

-- 1. Per-lead trace status columns.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS trace_status TEXT NOT NULL DEFAULT 'NOT_TRACED';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS trace_source TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS traced_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS dnc_flag TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS contactable BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS priority_queue TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_trace_status ON leads (trace_status);
CREATE INDEX IF NOT EXISTS idx_leads_contactable ON leads (contactable);

-- 2. Skip-trace job registry (one row per PropStream Connect / manual batch).
CREATE TABLE IF NOT EXISTS skip_trace_jobs (
  id SERIAL PRIMARY KEY,
  list_name TEXT NOT NULL,
  propstream_group_id TEXT,
  status TEXT NOT NULL DEFAULT 'RUNNING',
  total_leads INT,
  traced_count INT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_progress_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_skip_trace_jobs_status ON skip_trace_jobs (status);
CREATE INDEX IF NOT EXISTS idx_skip_trace_jobs_list_group ON skip_trace_jobs (list_name, propstream_group_id);

-- 3. Derived `contactable` — kept in sync by trigger whenever phone, email or
--    dnc_flag changes (INSERT always fires, UPDATE only when one of those
--    columns is touched). Suppression values below are checked IF PRESENT
--    (the full suppression table lands in the compliance build, PH1-B2).
CREATE OR REPLACE FUNCTION leads_recompute_contactable() RETURNS trigger AS $$
BEGIN
  NEW.contactable := (
    (
      COALESCE(NULLIF(btrim(NEW.phone), ''), '') <> ''
      OR COALESCE(NULLIF(btrim(NEW.email), ''), '') <> ''
    )
    AND COALESCE(NEW.dnc_flag, '') NOT IN ('DNC', 'DO_NOT_MAIL', 'OPTED_OUT', 'INVALID', 'WRONG_NUMBER')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_leads_contactable ON leads;
CREATE TRIGGER trg_leads_contactable
  BEFORE INSERT OR UPDATE OF phone, email, dnc_flag ON leads
  FOR EACH ROW EXECUTE FUNCTION leads_recompute_contactable();

-- 4. Backfill for existing rows (idempotent recompute from current data).
UPDATE leads SET contactable = (
  (
    COALESCE(NULLIF(btrim(phone), ''), '') <> ''
    OR COALESCE(NULLIF(btrim(email), ''), '') <> ''
  )
  AND COALESCE(dnc_flag, '') NOT IN ('DNC', 'DO_NOT_MAIL', 'OPTED_OUT', 'INVALID', 'WRONG_NUMBER')
);
