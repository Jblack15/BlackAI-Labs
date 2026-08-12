-- DealFlow AI — Human approval gates (migration 019, PH1-B11)
-- Owner approval-request store. Every legally/financially significant action
-- (offer, contract, assignment, spend above cap, campaign change, sensitive
-- seller communication) is gated behind an approval_request row that a human
-- (the owner) approves or rejects from the /approvals dashboard. The gate
-- enforcers live in src/lib/approvals.ts (hasApproval) + the state-machine and
-- campaign enforcement points wired in B11.
--
-- Real data only: this table starts EMPTY and stays empty until a real
-- offer / contract / spend / campaign change is requested. No fake approvals
-- are ever seeded — zero pending requests is the correct production state.
--
-- Audit trail: every create/decide also writes one outreach_audit_log row
-- (channel='approval', direction='internal', status='requested'/'approved'/
-- 'rejected', operator) so approval history is visible in the same trail as
-- sends and status changes.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS, safe to
-- re-run (the migration runner guards every statement).
--
-- NOTE for the migration runner: no semicolons inside comment lines and no
-- literal dollar-quote openers inside comments.
-- 1. Approval requests
CREATE TABLE IF NOT EXISTS approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('offer', 'contract', 'assignment', 'spend', 'campaign_change', 'sensitive_communication')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  ref_type TEXT NOT NULL CHECK (ref_type IN ('lead', 'contract', 'campaign', 'none')),
  ref_id UUID,
  amount_cents INT,
  details TEXT,
  requested_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  decided_by TEXT,
  decision_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_approval_requests_status_kind ON approval_requests (status, kind);
