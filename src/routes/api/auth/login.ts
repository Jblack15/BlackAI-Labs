// POST /api/auth/login — the auth protocol (public by design, spec §1/§2).
//
// Body: { pin }. Success mints a 24h session and sets the df_session HttpOnly
// cookie (Set-Cookie can only be set in an API route — server functions cannot
// set response headers). Failures return {ok:false, error} with NO cookie and
// NO oracle about which part failed (internal audit distinguishes). If the
// request already carries a valid session, returns alreadyAuthenticated:true
// without minting a new row (idempotent). Purges stale sessions (>30 days) on
// success. Rate-limited in memory per IP (5 fails / 15 min -> 15-min lockout).
//
// Responses:
//   201 {ok:true, role:'owner'}                        fresh login
//   200 {ok:true, role:'owner', alreadyAuthenticated:true}  idempotent repeat
//   401 {ok:false, error}                              wrong PIN / bad body / not configured
//   429 {ok:false, locked:true, error}                 rate-limit lockout
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import {
  SESSION_TTL_MS,
  checkLoginRateLimit,
  getClientIp,
  getSessionFromRequest,
  logAuthAudit,
  randomToken,
  recordLoginFailure,
  sessionCookie,
  sha256Hex,
  verifyPin,
} from "~/lib/auth";

async function login({ request }: { request: Request }): Promise<Response> {
  const ip = getClientIp(request);
  const noStore = { "Cache-Control": "no-store" };

  // Idempotent: an already-authenticated request is answered without minting a
  // second session row (spec §2 — the client gate retries may hit this path).
  const existing = await getSessionFromRequest(request);
  if (existing) {
    return Response.json({ ok: true, role: existing.role, alreadyAuthenticated: true }, { status: 200, headers: noStore });
  }

  // Rate limit check (before any work — a locked IP never reaches verify).
  if (checkLoginRateLimit(ip).locked) {
    await logAuthAudit({
      status: "blocked",
      reason: `Login blocked — rate limit exceeded (${ip})`,
      operator: `ip:${ip}`,
      contactValue: ip,
    });
    return Response.json(
      { ok: false, locked: true, error: "Too many attempts — try again in a few minutes" },
      { status: 429, headers: noStore },
    );
  }

  // Body: { pin } — malformed body is treated as a failed attempt (generic copy).
  let pin: unknown;
  try {
    const body = (await request.json()) as { pin?: unknown };
    pin = body?.pin;
  } catch {
    pin = undefined;
  }
  if (typeof pin !== "string" || pin.length === 0) {
    await logAuthAudit({ status: "login_failed", reason: "Login failed (wrong PIN)", operator: `ip:${ip}`, contactValue: ip });
    return Response.json({ ok: false, error: "Sign-in failed — check the PIN and try again" }, { status: 401, headers: noStore });
  }

  // Credential: single row auth_credentials(id=1). Empty table is the honest
  // "not configured" state (spec §3 — never seeded, never a default PIN).
  const creds = (await sql`
    SELECT id, role, pin_hash FROM auth_credentials WHERE id = 1 LIMIT 1
  `) as Array<{ id: number; role: string; pin_hash: string }>;
  if (!creds.length) {
    await logAuthAudit({
      status: "login_failed",
      reason: "Login blocked — no owner PIN configured",
      operator: `ip:${ip}`,
      contactValue: ip,
    });
    return Response.json(
      { ok: false, error: "Sign-in is not configured yet — set the owner PIN first (scripts/set-owner-pin.ts)" },
      { status: 401, headers: noStore },
    );
  }

  const valid = await verifyPin(pin, creds[0].pin_hash);
  if (!valid) {
    const rl = recordLoginFailure(ip);
    await logAuthAudit({
      status: rl.triggered ? "blocked" : "login_failed",
      reason: rl.triggered ? `Login blocked — rate limit exceeded (${ip})` : "Login failed (wrong PIN)",
      operator: `ip:${ip}`,
      contactValue: ip,
    });
    if (rl.locked) {
      return Response.json(
        { ok: false, locked: true, error: "Too many attempts — try again in a few minutes" },
        { status: 429, headers: noStore },
      );
    }
    return Response.json({ ok: false, error: "Sign-in failed — check the PIN and try again" }, { status: 401, headers: noStore });
  }

  // Success: mint a 24h session. Raw token lives ONLY in the cookie; the DB
  // stores sha256(token) hex (spec §2 — a DB read cannot steal sessions).
  const token = randomToken();
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const userAgent = request.headers.get("user-agent");
  await sql`
    INSERT INTO auth_sessions (token_hash, role, expires_at, ip, user_agent)
    VALUES (${tokenHash}, 'owner', ${expiresAt}, ${ip}, ${userAgent})
  `;
  // Lazy purge of stale sessions (>30 days old), spec §2.
  await sql`DELETE FROM auth_sessions WHERE revoked_at IS NOT NULL OR expires_at < now() - interval '30 days'`;
  await logAuthAudit({ status: "login_ok", reason: "Login success (owner)", operator: "owner" });
  return Response.json(
    { ok: true, role: "owner" },
    { status: 201, headers: { ...noStore, "Set-Cookie": sessionCookie(token) } },
  );
}

export const Route = createFileRoute("/api/auth/login")({
  server: {
    handlers: {
      POST: login,
    },
  },
} as never);
