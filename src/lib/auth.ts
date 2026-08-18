// DealFlow AI — Owner Authentication / RBAC core (PH1-B14, part 1)
//
// Server-only module (like compliance.ts — never import from client code).
// Zero-spend: only Node/Bun built-ins (node:crypto scrypt / timingSafeEqual /
// randomBytes / createHash) + the existing Postgres schema from migration 022.
// No new dependencies, no paid auth service.
//
// Design (spec §2/§3/§4, all decided):
//   - Session = opaque random bearer token (32 bytes base64url) delivered as an
//     HttpOnly cookie (`df_session`); the raw token is NEVER stored — only
//     sha256(token) hex lives in auth_sessions.token_hash, so a DB read cannot
//     steal sessions. 24h ABSOLUTE expiry (no sliding); logout and PIN rotation
//     revoke rows. Valid session = row found AND revoked_at IS NULL AND
//     expires_at > now().
//   - Credential = single DB row auth_credentials(id=1, role='owner') holding
//     ONLY the scrypt hash. Table starts EMPTY (no seed, ever) — until the
//     owner runs scripts/set-owner-pin.ts, login reports the honest
//     "not configured" state.
//   - PIN hashing = crypto.scrypt (N=16384, r=8, p=1, keylen=64) with a 16-byte
//     random salt, self-describing format `scrypt$N$r$p$salt_b64$hash_b64`.
//     Verification recomputes the derived key and compares with
//     timingSafeEqual — never `===` on hashes.
//   - Enforcement = per-server-fn request middleware `requireOwnerMiddleware`
//     (createMiddleware({type:'request'})). Every createServerFn in an OWNER
//     route file gets `middleware: [requireOwnerMiddleware]`. Server functions
//     cannot set response headers, so the login/logout/status protocol lives in
//     API routes (src/routes/api/auth/*) using the server.handlers pattern.
//   - Rate limit = in-memory per-IP (Map<ip,{fails,firstFailAt,lockedUntil}>),
//     15-min window, max 5 failed attempts -> 15-min lockout. IP from
//     x-forwarded-for (first value) -> cf-connecting-ip -> x-real-ip ->
//     'unknown'. HONEST LIMITATION (documented per spec): this is per-instance —
//     on the single-instance deployment it is effective; on multi-instance
//     serverless it is best-effort, which is acceptable for a single human
//     owner. resetLoginRateLimit() is exported for tests.
//   - CSRF = SameSite=Lax + JSON POST bodies + same-origin fetches (no CORS
//     config exists) is sufficient for this app. createCsrfMiddleware (available
//     in this TanStack Start version) is an OPTIONAL future hardening, not
//     required — noted here per spec, not implemented.
//   - Audit = logAuthAudit(), a thin wrapper over logOutreachAudit
//     (~/lib/compliance) with channel='auth', direction='internal'. The audit
//     trail lives in the compliance core (migration 019 rule), so no audit
//     table migration was needed.
import { createMiddleware } from "@tanstack/react-start";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { sql } from "~/db";
import { logOutreachAudit, type OutreachAuditStatus } from "~/lib/compliance";

// --- Session constants (spec §2) --------------------------------------------

export const SESSION_COOKIE = "df_session";
export const SESSION_TTL_MS = 86_400_000; // 24h absolute, no sliding
export const SESSION_MAX_AGE_SECONDS = 86_400;

// --- PIN hashing (spec §3) ---------------------------------------------------

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_SALT_BYTES = 16;

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

/**
 * Hash a PIN into the self-describing storage format:
 *   scrypt$16384$8$1$<salt_base64>$<hash_base64>
 * Salt is 16 random bytes per call (never reused).
 */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const key = await scryptAsync(pin, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

/**
 * Verify a PIN against a stored scrypt hash. Parses the self-describing
 * parameters, recomputes the derived key with the same N/r/p, and compares
 * with timingSafeEqual (never `===` on hashes — constant-time by construction).
 * Any malformed/unknown hash format fails closed (returns false).
 */
export async function verifyPin(pin: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p) || n <= 0 || r <= 0 || p <= 0) {
    return false;
  }
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4] ?? "", "base64");
    expected = Buffer.from(parts[5] ?? "", "base64");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  try {
    const actual = await scryptAsync(pin, salt, expected.length, { N: n, r, p });
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// --- Cookie helpers (spec §2) ------------------------------------------------

/** Parse a Cookie request header into a key -> value map (first value wins). */
export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key && out[key] === undefined) out[key] = value;
  }
  return out;
}

/** Serialize a Set-Cookie value (used only by the /api/auth/* routes). */
export function serializeCookie(
  name: string,
  value: string,
  opts: { maxAge?: number; httpOnly?: boolean; sameSite?: "Lax" | "Strict" | "None"; path?: string; secure?: boolean } = {},
): string {
  let cookie = `${name}=${value}`;
  if (opts.maxAge !== undefined) cookie += `; Max-Age=${opts.maxAge}`;
  if (opts.path) cookie += `; Path=${opts.path}`;
  if (opts.httpOnly) cookie += "; HttpOnly";
  if (opts.sameSite) cookie += `; SameSite=${opts.sameSite}`;
  if (opts.secure) cookie += "; Secure";
  return cookie;
}

/** The df_session cookie with the exact flag set spec §2 requires. */
export function sessionCookie(value: string, maxAgeSeconds = SESSION_MAX_AGE_SECONDS): string {
  return serializeCookie(SESSION_COOKIE, value, {
    maxAge: maxAgeSeconds,
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
  });
}

// --- Sessions (spec §2) -------------------------------------------------------

export type AuthSession = { id: string; role: string };

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Resolve the session (if any) for an incoming request. Reads the df_session
 * cookie, looks up auth_sessions by sha256(token), and returns {id, role} only
 * for a live session (row found, not revoked, not expired). Missing/bad/
 * revoked/expired/DB-error all fail closed to null. Optionally throttles the
 * last_seen_at heartbeat to at most one UPDATE per 30 minutes per session.
 */
export async function getSessionFromRequest(request: Request): Promise<AuthSession | null> {
  const cookies = parseCookies(request.headers.get("cookie"));
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = sha256Hex(token);
  try {
    const rows = (await sql`
      SELECT id, role, expires_at, revoked_at, last_seen_at
      FROM auth_sessions
      WHERE token_hash = ${tokenHash}
      LIMIT 1
    `) as Array<{
      id: string;
      role: string;
      expires_at: Date | string;
      revoked_at: Date | string | null;
      last_seen_at: Date | string | null;
    }>;
    if (!rows.length) return null;
    const row = rows[0];
    if (row.revoked_at) return null;
    if (new Date(String(row.expires_at)).getTime() <= Date.now()) return null;
    const lastSeen = row.last_seen_at ? new Date(String(row.last_seen_at)).getTime() : 0;
    if (Date.now() - lastSeen > 30 * 60_000) {
      // Heartbeat throttled to ≤1 write per 30 min — best effort, never
      // allowed to fail session validation.
      await sql`UPDATE auth_sessions SET last_seen_at = now() WHERE id = ${row.id}`.catch(() => {});
    }
    return { id: row.id, role: row.role };
  } catch {
    return null;
  }
}

// --- Enforcement middleware (spec §4) ----------------------------------------

/**
 * Request middleware for every createServerFn in an OWNER route file. Valid
 * owner session -> next({ context: { session } }); otherwise a 401 JSON
 * {authRequired:true} with Cache-Control: no-store (honest sign-in response,
 * never fake data). Only role 'owner' is enforced today (spec §6 — future
 * roles need no migration, just a requireRole(...) helper in a later phase).
 */
export const requireOwnerMiddleware = createMiddleware({
  type: "request",
}).server(async ({ request, next }) => {
  const session = await getSessionFromRequest(request);
  if (!session || session.role !== "owner") {
    return Response.json({ authRequired: true, error: "Sign in required" }, {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return next({ context: { session } });
});

// --- Login rate limiter (spec §2) ---------------------------------------------
// In-memory, per-IP. HONEST LIMITATION: per-instance state — on the
// single-instance deployment this is effective; on multi-instance serverless
// it is best-effort (acceptable for a single human owner, documented per spec).

const RATE_WINDOW_MS = 15 * 60_000;
const RATE_MAX_FAILS = 5;
const RATE_LOCKOUT_MS = 15 * 60_000;

type RateLimitState = { fails: number; firstFailAt: number; lockedUntil: number };
const loginRateLimits = new Map<string, RateLimitState>();

/** Client IP: x-forwarded-for (first value) -> cf-connecting-ip -> x-real-ip -> 'unknown'. */
export function getClientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || "unknown";
}

/** True when this IP is currently locked out (or has max fails within the window). */
export function checkLoginRateLimit(ip: string): { locked: boolean } {
  const now = Date.now();
  const state = loginRateLimits.get(ip);
  if (!state) return { locked: false };
  if (now - state.firstFailAt > RATE_WINDOW_MS) {
    loginRateLimits.delete(ip);
    return { locked: false };
  }
  if (state.lockedUntil && now < state.lockedUntil) return { locked: true };
  if (state.fails >= RATE_MAX_FAILS) return { locked: true };
  return { locked: false };
}

/**
 * Record one failed login for an IP. Returns locked=true once the 5-fail
 * threshold within the 15-min window is reached (and starts the 15-min
 * lockout). triggered=true only on the attempt that creates the lockout.
 */
export function recordLoginFailure(ip: string): { locked: boolean; triggered: boolean } {
  const now = Date.now();
  let state = loginRateLimits.get(ip);
  if (!state || now - state.firstFailAt > RATE_WINDOW_MS) {
    state = { fails: 0, firstFailAt: now, lockedUntil: 0 };
    loginRateLimits.set(ip, state);
  }
  state.fails += 1;
  if (state.fails >= RATE_MAX_FAILS && state.lockedUntil === 0) {
    state.lockedUntil = now + RATE_LOCKOUT_MS;
    return { locked: true, triggered: true };
  }
  if (state.lockedUntil && now < state.lockedUntil) return { locked: true, triggered: false };
  return { locked: false, triggered: false };
}

/** Clear all rate-limit state (tests / operator reset). */
export function resetLoginRateLimit(): void {
  loginRateLimits.clear();
}

// --- Auth audit (spec §5) ------------------------------------------------------

export type AuthAuditStatus = "login_ok" | "login_failed" | "blocked" | "logout" | "revoked";

/**
 * One audit row per auth event — a thin wrapper over logOutreachAudit with
 * channel='auth' and direction='internal' (house style: the audit trail lives
 * in the compliance core; outreach_audit_log has no CHECK on status, so the
 * auth vocabulary needs no audit-table migration). lead_id is always NULL;
 * contact_value = IP for failures, NULL for successes; operator = 'owner' on
 * success/logout, 'ip:<addr>' on failures (spec §5 table).
 */
export async function logAuthAudit(opts: {
  status: AuthAuditStatus;
  reason: string;
  operator?: string | null;
  contactValue?: string | null;
}): Promise<void> {
  await logOutreachAudit({
    // channel/direction are cast: the compliance type only knows outbound
    // channels, but outreach_audit_log is free-text (no CHECK) and 'auth' /
    // 'internal' is the decided vocabulary for this trail (spec §5).
    channel: "auth" as unknown as OutreachChannel,
    direction: "internal" as unknown as "outbound" | "inbound",
    status: opts.status as unknown as OutreachAuditStatus,
    reason: opts.reason,
    operator: opts.operator ?? null,
    contactValue: opts.contactValue ?? null,
  });
}
