-- DealFlow AI — Buyer marketplace (migration 016)
-- PH1-B5: turn the 22-buyer network into a real buyer marketplace
--
-- buyers gains the richer buy-box (JSONB), verification fields and
-- deal-history counters. buyer_deal_events is the audit trail behind the
-- counters and every counter change goes through the atomic
-- recordBuyerDealEvent() lib fn (src/lib/buyer-marketplace.ts) so a counter
-- is NEVER bumped without its event row and vice versa
--
-- Honesty contract: every new column starts at the honest default
--   buy_box           '{}'        (no fabricated criteria)
--   active            true        (default-visible: a real workflow flags
--                                  inactive, nothing invents deactivation)
--   last_verified_at  NULL        (nobody has been re-verified: the UI
--                                  "Mark verified" button is the only writer)
--   verified_phone    false, then set true ONLY for buyers whose phone was
--                                  harvested from live public listings.
--                                  20 of 22 buyers have such a phone today
--                                  (BiggerPockets and Opendoor have none)
--   deals_*           0           (no fabricated deal history)
--
-- Idempotent: every ALTER guards with IF NOT EXISTS and the verified_phone
-- UPDATE is a plain re-computation (same 20 rows every run). The event table
-- uses CREATE TABLE IF NOT EXISTS with its CHECK baked into the table body
ALTER TABLE buyers ADD COLUMN IF NOT EXISTS buy_box JSONB DEFAULT '{}'::jsonb;
ALTER TABLE buyers ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE buyers ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;
ALTER TABLE buyers ADD COLUMN IF NOT EXISTS verified_phone BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE buyers ADD COLUMN IF NOT EXISTS deals_received INT NOT NULL DEFAULT 0;
ALTER TABLE buyers ADD COLUMN IF NOT EXISTS deals_viewed INT NOT NULL DEFAULT 0;
ALTER TABLE buyers ADD COLUMN IF NOT EXISTS deals_rejected INT NOT NULL DEFAULT 0;
ALTER TABLE buyers ADD COLUMN IF NOT EXISTS deals_purchased INT NOT NULL DEFAULT 0;
-- verified_phone = true exactly for the buyers whose phone exists and was
-- collected from live public listings (the 20-row verified set: reruns keep
-- the same result)
UPDATE buyers SET verified_phone = true WHERE phone IS NOT NULL AND btrim(phone) <> '';
CREATE TABLE IF NOT EXISTS buyer_deal_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id UUID NOT NULL REFERENCES buyers(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  event TEXT NOT NULL CHECK (event IN ('received', 'viewed', 'rejected', 'purchased')),
  operator TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_buyer_deal_events_buyer_id ON buyer_deal_events (buyer_id);
CREATE INDEX IF NOT EXISTS idx_buyer_deal_events_deal_id ON buyer_deal_events (deal_id);
