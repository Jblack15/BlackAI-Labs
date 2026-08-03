-- Automation pipeline support tables and enrichment fields
ALTER TABLE leads ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS response_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_leads_enriched_at ON leads (enriched_at);
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  type TEXT NOT NULL, title TEXT NOT NULL, message TEXT, read BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS outreach_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  channel TEXT NOT NULL, step INTEGER NOT NULL, status TEXT DEFAULT 'scheduled', scheduled_for TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now(), UNIQUE(lead_id, channel, step)
);
CREATE INDEX IF NOT EXISTS idx_outreach_due ON outreach_sequences(status, scheduled_for);
