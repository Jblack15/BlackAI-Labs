-- Automation pipeline support tables and enrichment fields
ALTER TABLE leads ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS response_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_leads_enriched_at ON leads (enriched_at);
-- NOTE: the `notifications` table is defined ONCE, in 002_notifications.sql
-- (columns: body / is_read — the set the code reads). Defining it here too
-- caused a schema conflict (message/read vs body/is_read). Do not re-add it.
CREATE TABLE IF NOT EXISTS outreach_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  channel TEXT NOT NULL, step INTEGER NOT NULL, status TEXT DEFAULT 'scheduled', scheduled_for TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now(), UNIQUE(lead_id, channel, step)
);
CREATE INDEX IF NOT EXISTS idx_outreach_due ON outreach_sequences(status, scheduled_for);
