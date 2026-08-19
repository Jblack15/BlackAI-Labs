-- DealFlow AI — Channel Activation gates (migration 026, Step 11)
-- Owner-gated outbound channel option (SMS / email). NO sending code lives in
-- this migration. It only widens the approval_requests.kind CHECK so the
-- EXISTING human-approval store can carry per-campaign channel approvals
-- (kind = 'channel_campaign', ref_type = 'campaign', ref_id = campaign UUID).
--
-- Reuse existing approvals instead of a new table: requestApproval() creates a
-- pending 'channel_campaign' request (dup-guarded), the owner approves or
-- rejects it from the EXISTING /approvals dashboard, and
-- hasApproval('channel_campaign','campaign', campaignId) is the run-time gate.
-- The channel stays OFF for a campaign until an approved row exists.
--
-- The provider gate is NOT a DB object. It is provider-config presence (env),
-- enforced in src/lib/channel-gates.ts. Absent today, so every channel
-- hard-refuses every send and zero-spend mode keeps each channel OFF.
--
-- Idempotent: the kind CHECK is dropped only when it exists, then recreated
-- with the new kind included (safe to re-run after a partial failure).
--
-- NOTE for the migration runner: no semicolons inside comment lines and no
-- literal dollar-quote openers inside comments (this file follows both rules)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'approval_requests_kind_check'
      AND conrelid = 'approval_requests'::regclass
  ) THEN
    ALTER TABLE approval_requests DROP CONSTRAINT approval_requests_kind_check;
  END IF;
END $$;

ALTER TABLE approval_requests
  ADD CONSTRAINT approval_requests_kind_check CHECK (
    kind IN ('offer', 'contract', 'assignment', 'spend', 'campaign_change',
             'sensitive_communication', 'channel_campaign')
  );