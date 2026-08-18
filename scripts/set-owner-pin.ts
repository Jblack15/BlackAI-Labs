// DealFlow AI — Set / rotate the owner PIN (auth_credentials id=1).
//
// Usage:  OWNER_PIN=<pin> bun run scripts/set-owner-pin.ts
//
// - Validates OWNER_PIN is set and at least 8 characters.
// - Hashes the PIN with the app's own hashPin (scrypt, N=16384 r=8 p=1,
//   keylen=64, 16-byte random salt — self-describing format) and upserts the
//   single credential row (id=1, role='owner').
// - Revokes ALL live sessions (revoke_reason='pin_rotated') — old sessions die
//   immediately (PIN rotation = revoke-all + set; no forget-password flow for a
//   single owner, spec §3).
// - Writes one audit row (channel='auth', status='revoked').
// - NEVER echoes the PIN. OWNER_PIN is TRANSIENT process-lifetime input only:
//   the app runtime never reads it, it is never stored, never in client code,
//   never in migrations or seed files (spec §3).
import { neon } from "@neondatabase/serverless";
import { hashPin, logAuthAudit } from "../src/lib/auth.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const pin = process.env.OWNER_PIN;
if (!pin || pin.length < 8) {
  console.error("OWNER_PIN must be set and at least 8 characters (transient input only — never stored)");
  process.exit(1);
}

const sql = neon(url);
try {
  const pinHash = await hashPin(pin);
  await sql`
    INSERT INTO auth_credentials (id, role, pin_hash)
    VALUES (1, 'owner', ${pinHash})
    ON CONFLICT (id) DO UPDATE SET pin_hash = EXCLUDED.pin_hash, role = 'owner', updated_at = now()
  `;
  await sql`UPDATE auth_sessions SET revoked_at = now(), revoke_reason = 'pin_rotated' WHERE revoked_at IS NULL`;
  await logAuthAudit({ status: "revoked", reason: "Owner PIN set — all sessions revoked", operator: "owner" });
  console.log("Owner PIN set/rotated — all sessions revoked. (The PIN itself is never echoed.)");
  process.exit(0);
} catch (err) {
  console.error("Failed to set owner PIN:", err instanceof Error ? err.message : String(err));
  process.exit(1);
}
