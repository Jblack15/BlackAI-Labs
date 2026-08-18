-- DealFlow AI — Auth / RBAC / session store (migration 022, PH1-B14)
-- Owner-only authentication for the DealForge operating system.
--   auth_credentials — single-row table (id=1, same pattern as business_profile).
--     Holds ONLY the owner's scrypt hash (scrypt$N$r$p$salt$hash). Starts EMPTY:
--     no PIN is ever seeded or shipped. scripts/set-owner-pin.ts inserts the
--     real credential when the owner sets it (OWNER_PIN is transient env input
--     only, never stored, never in client code). role CHECK admits future
--     agent/assistant roles WITHOUT migration. Only 'owner' is enforced today.
--   auth_sessions — one row per login, opaque bearer token hashed at rest
--     (token_hash = sha256 hex of the raw token. The raw token lives only in
--     the owner's HttpOnly cookie). 24h absolute expiry. Logout and PIN
--     rotation revoke rows. Starts EMPTY.
-- Audit: every auth event writes one outreach_audit_log row (channel='auth',
-- direction='internal', status login_ok/login_failed/blocked/logout/revoked)
-- via src/lib/auth.ts — the audit trail lives in the compliance core, not
-- duplicated here (same rule as migrations 019/020/021).
CREATE TABLE IF NOT EXISTS auth_credentials (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'agent', 'assistant')),
  pin_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'agent', 'assistant')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ,
  ip TEXT,
  user_agent TEXT,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions (expires_at);
