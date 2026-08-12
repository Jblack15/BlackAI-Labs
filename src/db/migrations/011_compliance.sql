-- DealFlow AI — Compliance Core (migration 011)
-- Production hardening build #2 (PH1-B2): full suppression enforcement, the
-- outreach audit trail, consent records, and the business identity profile
--
-- Extends B1 (migration 010): B1 added dnc_flag + a hard block, this build
-- adds the remaining suppression flags (do_not_mail / opted_out /
-- invalid_contact / wrong_number), a consent trail, an audit log for EVERY
-- outbound attempt (sent, attempted, or blocked), and the business_profile
-- the identity guard requires before any outbound send
--
-- All statements are idempotent (IF NOT EXISTS / OR REPLACE) so the runner is
-- safe to re-run. `contactable` remains trigger-maintained and now ALSO
-- respects the new suppression flags
--
-- NOTE for the migration runner: this file contains NO semicolons inside
-- comment lines (the runner splits statements on semicolons and does not
-- understand comments, so a comment containing one would break the split)

-- 1. Suppression + consent columns on leads
ALTER TABLE leads ADD COLUMN IF NOT EXISTS do_not_mail BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS opted_out BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS invalid_contact BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS wrong_number BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS consent_recorded_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS consent_source TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_opted_out ON leads (opted_out);
CREATE INDEX IF NOT EXISTS idx_leads_do_not_mail ON leads (do_not_mail);

-- 2. Outreach audit log — one row per outbound attempt (sent/attempted/blocked)
--    and per inbound event (opt-out, received reply). lead_id is uuid to match
--    leads.id (the leads table stores uuid ids, not int)
CREATE TABLE IF NOT EXISTS outreach_audit_log (
  id SERIAL PRIMARY KEY,
  lead_id UUID,
  channel TEXT NOT NULL,            -- sms / email / mail / voice / manual
  direction TEXT NOT NULL,           -- outbound / inbound
  status TEXT NOT NULL,              -- sent / attempted / blocked / failed / received
  reason TEXT,                       -- block reason when status='blocked' (or failure detail)
  contact_value TEXT,                -- the phone/email/address used
  content_preview TEXT,              -- truncated to 200 chars
  operator TEXT,                     -- who triggered it (manual actions) or NULL (automated)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_outreach_audit_lead ON outreach_audit_log (lead_id);
CREATE INDEX IF NOT EXISTS idx_outreach_audit_created ON outreach_audit_log (created_at);

-- 3. Consent records — one row per explicit consent / opt-out event
CREATE TABLE IF NOT EXISTS consent_records (
  id SERIAL PRIMARY KEY,
  lead_id UUID,
  channel TEXT NOT NULL,
  granted BOOLEAN NOT NULL,
  source TEXT NOT NULL,              -- sms-reply / phone / email / form / manual
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_consent_records_lead ON consent_records (lead_id);

-- 4. Business identity profile — single-row table (id is always 1). The
--    identity guard (lib/compliance.ts) refuses every outbound send until the
--    fields a channel needs are filled, closing the "Joshua Black default"
--    class of problem: nothing ever goes out in a name the owner did not set
CREATE TABLE IF NOT EXISTS business_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  business_name TEXT NOT NULL DEFAULT 'DealForge Properties',
  phone TEXT,
  website TEXT,
  return_address TEXT,
  email TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO business_profile (id, business_name, phone, website, return_address, email)
VALUES (1, 'DealForge Properties', NULL, NULL, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- 5. contactable trigger — extended so ANY suppression flag (dnc_flag or the
--    new boolean columns) forces contactable=false. The dnc_flag text values
--    remain supported for backward compatibility with B1 import paths, and
--    the new boolean columns are checked directly
CREATE OR REPLACE FUNCTION leads_recompute_contactable() RETURNS trigger AS $$
BEGIN
  NEW.contactable := (
    (
      COALESCE(NULLIF(btrim(NEW.phone), ''), '') <> ''
      OR COALESCE(NULLIF(btrim(NEW.email), ''), '') <> ''
    )
    AND COALESCE(NEW.dnc_flag, '') NOT IN ('DNC', 'DO_NOT_MAIL', 'OPTED_OUT', 'INVALID', 'WRONG_NUMBER')
    AND NOT COALESCE(NEW.do_not_mail, false)
    AND NOT COALESCE(NEW.opted_out, false)
    AND NOT COALESCE(NEW.invalid_contact, false)
    AND NOT COALESCE(NEW.wrong_number, false)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_leads_contactable ON leads;
CREATE TRIGGER trg_leads_contactable
  BEFORE INSERT OR UPDATE OF phone, email, dnc_flag, do_not_mail, opted_out, invalid_contact, wrong_number ON leads
  FOR EACH ROW EXECUTE FUNCTION leads_recompute_contactable();

-- 6. Backfill: recompute contactable from current data (idempotent)
UPDATE leads SET contactable = (
  (
    COALESCE(NULLIF(btrim(phone), ''), '') <> ''
    OR COALESCE(NULLIF(btrim(email), ''), '') <> ''
  )
  AND COALESCE(dnc_flag, '') NOT IN ('DNC', 'DO_NOT_MAIL', 'OPTED_OUT', 'INVALID', 'WRONG_NUMBER')
  AND NOT COALESCE(do_not_mail, false)
  AND NOT COALESCE(opted_out, false)
  AND NOT COALESCE(invalid_contact, false)
  AND NOT COALESCE(wrong_number, false)
);
