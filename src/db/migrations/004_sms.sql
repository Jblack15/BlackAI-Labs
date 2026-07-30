-- DealFlow AI — SMS Integration
-- Migration 004: SMS logging table

CREATE TABLE IF NOT EXISTS sms_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id),
  to_phone TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'sent',
  twilio_sid TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_logs_lead_id ON sms_logs (lead_id);
CREATE INDEX IF NOT EXISTS idx_sms_logs_created_at ON sms_logs (created_at);
