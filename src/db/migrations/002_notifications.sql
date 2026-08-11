-- DealFlow AI — Migration 002: Notifications + UTM Tracking
-- Adds notification infrastructure and UTM campaign tracking columns.

-- 1. Notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL DEFAULT 'new_lead',
  title TEXT NOT NULL,
  body TEXT,
  lead_id UUID REFERENCES leads(id),
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Idempotent backfill: when 002_automation.sql created `notifications` first
-- (with message/read columns), the CREATE above is skipped — add the columns
-- this file owns so the indexes below don't fail on re-runs.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS body TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications (created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications (is_read);

-- 2. UTM tracking columns on leads
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_source TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_medium TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_campaign TEXT;
