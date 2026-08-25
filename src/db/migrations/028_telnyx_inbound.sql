ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS provider_id TEXT;

CREATE TABLE IF NOT EXISTS sms_inbound_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID,
  from_phone TEXT,
  to_phone TEXT,
  message TEXT NOT NULL,
  message_id TEXT,
  profile_id TEXT,
  handled_optout BOOLEAN NOT NULL DEFAULT false,
  raw_json TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_inbound_from_phone ON sms_inbound_log (from_phone);

CREATE INDEX IF NOT EXISTS idx_sms_inbound_received_at ON sms_inbound_log (received_at);
