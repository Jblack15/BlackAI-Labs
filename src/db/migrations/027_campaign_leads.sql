--
-- DealForge Properties — Lead <-> campaign membership (migration 027)
--
-- Records WHICH lead ids belong to WHICH campaign so a batch-send tool can
-- resolve a campaign's recipients (Batch 1 vs Batch 2, etc.). Previously the
-- staging script created 16 "Email Batch N 2026-08" campaigns + their
-- owner-approval rows, but nothing tied lead ids to a campaign — so a send
-- tool could not tell one batch from another. This table is that link.
--
-- Semantics:
--   * campaign_id FK -> campaigns(id) ON DELETE CASCADE (a campaign's
--     membership disappears if the campaign is deleted).
--   * lead_id is a plain UUID (the task's specified schema). Primary key is
--     (campaign_id, lead_id) so a lead belongs to a given campaign at most
--     once, and a lead may legitimately appear on multiple DIFFERENT campaigns
--     (e.g. a follow-up campaign), which is why lead_id is not itself the PK.
--
-- Idempotent: guarded with IF NOT EXISTS so the migration runner is safe to
-- re-run. No semicolons inside comment lines (runner rule).
CREATE TABLE IF NOT EXISTS campaign_leads (
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL,
  PRIMARY KEY (campaign_id, lead_id)
);
CREATE INDEX IF NOT EXISTS idx_campaign_leads_lead_id ON campaign_leads (lead_id);
CREATE INDEX IF NOT EXISTS idx_campaign_leads_campaign_id ON campaign_leads (campaign_id);
