-- DealFlow AI — Click2Mail Direct Mail Integration
-- Migration 007: mail_logs table tracks every physical postcard send (single
-- and bulk). Mirrors sms_logs/email_logs: one row per attempted piece.
CREATE TABLE IF NOT EXISTS mail_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  campaign TEXT,
  template TEXT,
  status TEXT DEFAULT 'sent',
  sent_at TIMESTAMPTZ DEFAULT now(),
  cost NUMERIC(10, 2),
  provider_id TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_mail_logs_lead_id ON mail_logs (lead_id);
CREATE INDEX IF NOT EXISTS idx_mail_logs_sent_at ON mail_logs (sent_at);
