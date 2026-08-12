-- DealFlow AI — Campaign economics + automatic spending control (migration 018)
-- PH1-B10b: per-campaign economics (cost per lead / qualified opp / contract,
-- revenue, net profit) and the PAUSE/RED flag engine. This migration only adds
-- two attribution columns plus REAL backfill — the economics math lives in
-- src/lib/campaign-economics.ts and the flag logic in campaignHealth().
--
-- Honesty contract (owner directive 2026-08-12):
--   * lead_count = the REAL number of leads attributed to the campaign
--     (PropStream campaign #1063894 targets the top-1000 list = 978 imported
--     leads, verified 2026-08-12). NULL means "unknown" — never 0-fake.
--   * spend_cap_cents = the owner-approved spend ceiling in cents — NULL = no
--     cap set. The pilot's cap is its planned budget: $600 = 60000 cents. The
--     dialer pilot has no cap (0 budget, nothing sent, trial not signed up).
--   * Per-campaign revenue attribution (contracts.campaign_id + fee tracking)
--     lands in B12. This migration does NOT invent a contracts fee/attribution
--     column — we prefer reading what exists.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS plus UPDATEs guarded by IS NULL so the
-- migration runner is safe to re-run and never clobbers real later values.
--
-- NOTE for the migration runner: no semicolons inside comment lines and no
-- literal dollar-quote openers inside comments.

-- 1. Attributed lead count (NULL = unknown, never 0-fake)
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS lead_count INT;

-- 2. Owner-approved spend ceiling (NULL = no cap set)
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS spend_cap_cents INT;

-- 3. Real backfill — pilot direct-mail campaign: 978 attributed leads
--    (PropStream campaign #1063894, top-1000 list, imported 2026-08-12).
UPDATE campaigns SET lead_count = 978
WHERE name = 'Pilot Bexar Top1000 2026-08' AND lead_count IS NULL;

-- 4. Dialer pilot targets the same top-1000 list = 978 leads (same real list).
UPDATE campaigns SET lead_count = 978
WHERE name = 'Dialer Pilot Bexar Top1000 2026-08' AND lead_count IS NULL;

-- 5. Pilot spend cap = its owner-approved planned budget ($600 = 60000 cents).
UPDATE campaigns SET spend_cap_cents = 60000
WHERE name = 'Pilot Bexar Top1000 2026-08' AND spend_cap_cents IS NULL;
