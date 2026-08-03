-- DealFlow AI — Email Integration
-- Migration 005: Email logging table (mirrors sms_logs for the outreach drip)
CREATE TABLE IF NOT EXISTS email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT,
  status TEXT DEFAULT 'sent',
  provider_id TEXT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_logs_lead_id ON email_logs (lead_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_created_at ON email_logs (created_at);
