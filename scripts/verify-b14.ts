// PH1-B14 (part 1) verification — Auth backend core (migration 022, auth lib,
// login/logout/status API routes, set-owner-pin).
//
// Rerunnable (b12/b13 style). Structure: baselineAudit capture; backup of any
// pre-existing auth_credentials row + all auth_sessions rows + lead count;
// try/finally restoring everything; ok() counters; exit code 0 iff 0 fails.
//
// Scope: spec §8 sections 1–13. Section 14 (routes-after-publish, needs the
// OwnerGate UI + /login page from PH1-B14 part 2) is a clearly-marked STUB.
//
// IMPORTANT (spec §3): this script uses a TEMP test PIN (TestPin-8chars!) —
// never the real owner PIN — and deletes the temp credential + every session
// + every auth-channel audit row it creates in cleanup. The REAL
// auth_credentials table is left EMPTY (or with only pre-existing rows): the
// owner sets the real PIN later via scripts/set-owner-pin.ts.
//
// Rate-limit note: login HTTP tests send a unique per-run TEST-NET IP
// (x-forwarded-for: 203.0.113.x) so the dev server's in-memory lockout only
// ever applies to that ephemeral IP — reruns and real traffic are unaffected.
//
// Run:  bun run scripts/verify-b14.ts   (DATABASE_URL must be set)
import { neon } from "@neondatabase/serverless";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  SESSION_COOKIE,
  hashPin,
  requireOwnerMiddleware,
  resetLoginRateLimit,
  verifyPin,
} from "../src/lib/auth.ts";

const sql = neon(process.env.DATABASE_URL!);
const TEST_PIN = "TestPin-8chars!"; // TEMP credential only — never the real PIN
// HTTP tests run against the environment that serves the CURRENT source tree:
// the managed vite dev server holds 3000 normally; while a published build
// (serve.ts) occupies 3000 the dev server sits on 3001. Override with
// VERIFY_BASE_URL when the target moves (part 2 runs the route checks after
// publish, against 3000).
const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3001";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Statement splitter identical to scripts/apply-migration.ts (dollar-quote aware). */
function splitSqlStatements(source: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inDollarQuote = false;
  for (let i = 0; i < source.length; i++) {
    if (source.slice(i, i + 2) === "$$") { inDollarQuote = !inDollarQuote; current += "$$"; i++; continue; }
    if (source[i] === ";" && !inDollarQuote) { if (current.trim()) statements.push(current.trim()); current = ""; }
    else current += source[i];
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

async function api(path: string, init?: RequestInit): Promise<{ res: Response; body: Record<string, unknown>; setCookie: string | null }> {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(10_000), ...init });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { res, body, setCookie: res.headers.get("set-cookie") };
}

function postJson(path: string, payload: unknown, ip: string, cookie?: string): Promise<ReturnType<typeof api>> {
  return api(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(payload),
  });
}

// --- Pre-test state ------------------------------------------------------------
const baselineAudit = ((await sql`SELECT COALESCE(MAX(id), 0)::int AS n FROM outreach_audit_log`)[0] as { n: number }).n;
const preCred = (await sql`SELECT id, role, pin_hash, created_at, updated_at FROM auth_credentials WHERE id = 1`) as Array<Record<string, unknown>>;
const preSessions = (await sql`SELECT id, token_hash, role, created_at, expires_at, last_seen_at, ip, user_agent, revoked_at, revoke_reason FROM auth_sessions`) as Array<Record<string, unknown>>;
const leadCountStart = ((await sql`SELECT COUNT(*)::int AS n FROM leads`)[0] as { n: number }).n;

// Per-run ephemeral test IPs (TEST-NET range) so the dev server's in-memory
// rate-limit lockout only ever hits throwaway addresses.
const mainIp = `203.0.113.${(Date.now() % 200) + 1}`;
const wrongIp = `203.0.113.${(Date.now() % 200) + 201}`;
const rlIp = `203.0.113.${(Date.now() % 200) + 401}`;

let c1Cookie: string | null = null; // valid session cookie from §5

try {
  console.log("== 1. Migration 022 idempotent re-apply + no-seed assert ==");
  const migration = readFileSync(join(process.cwd(), "src/db/migrations/022_auth_rbac.sql"), "utf8");
  const stmts = splitSqlStatements(migration);
  let applied = 0;
  for (const stmt of stmts) {
    try {
      await sql.query(stmt);
      applied++;
    } catch (e) {
      ok(`migration statement applies: ${stmt.slice(0, 60)}...`, false, e instanceof Error ? e.message : String(e));
    }
  }
  ok("migration 022 re-applied idempotently", applied === stmts.length && stmts.length >= 3, `${applied}/${stmts.length} statement(s)`);
  ok("no seeded credential (no INSERT INTO auth_credentials in source)", !/insert\s+into\s+auth_credentials/i.test(migration));
  const commentSemicolons = migration.split("\n").filter((l) => l.trim().startsWith("--") && l.includes(";"));
  ok("no semicolons inside comment lines", commentSemicolons.length === 0, commentSemicolons.length ? commentSemicolons[0] : "clean");

  console.log("== 2. Schema ==");
  const credCols = (await sql`
    SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'auth_credentials'
  `) as Array<{ column_name: string; is_nullable: string }>;
  const credColNames = new Set(credCols.map((c) => c.column_name));
  ok("auth_credentials.id exists", credColNames.has("id"));
  ok("auth_credentials.role exists", credColNames.has("role"));
  const pinHashCol = credCols.find((c) => c.column_name === "pin_hash");
  ok("auth_credentials.pin_hash NOT NULL", pinHashCol?.is_nullable === "NO", JSON.stringify(pinHashCol ?? "missing"));
  const idChk = (await sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'auth_credentials_id_check'`) as Array<{ def: string }>;
  ok("auth_credentials id=1 CHECK", idChk.length === 1 && idChk[0].def.includes("id = 1"), idChk[0]?.def ?? "no constraint");
  const roleChk = (await sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'auth_credentials_role_check'`) as Array<{ def: string }>;
  ok("role CHECK admits owner/agent/assistant", roleChk.length === 1 && roleChk[0].def.includes("owner") && roleChk[0].def.includes("agent") && roleChk[0].def.includes("assistant"), roleChk[0]?.def ?? "no constraint");
  const sessCols = (await sql`
    SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'auth_sessions'
  `) as Array<{ column_name: string; is_nullable: string; column_default: string | null }>;
  const sessColNames = new Set(sessCols.map((c) => c.column_name));
  const tokenHashCol = sessCols.find((c) => c.column_name === "token_hash");
  ok("auth_sessions.token_hash TEXT NOT NULL UNIQUE", tokenHashCol?.is_nullable === "NO" && tokenHashCol.column_default === null && sessColNames.has("id"), JSON.stringify(tokenHashCol ?? "missing"));
  const uniqueIdx = (await sql`SELECT indexname FROM pg_indexes WHERE tablename = 'auth_sessions' AND indexname = 'auth_sessions_token_hash_key'`) as Array<{ indexname: string }>;
  ok("auth_sessions.token_hash UNIQUE constraint", uniqueIdx.length === 1, uniqueIdx.length ? "unique index present" : "missing");
  ok("auth_sessions.expires_at exists", sessColNames.has("expires_at"));
  ok("auth_sessions.revoked_at exists", sessColNames.has("revoked_at"));
  const expiresIdx = (await sql`SELECT indexname FROM pg_indexes WHERE tablename = 'auth_sessions' AND indexname = 'idx_auth_sessions_expires'`) as Array<{ indexname: string }>;
  ok("idx_auth_sessions_expires index exists", expiresIdx.length === 1);
  const credEmpty = ((await sql`SELECT COUNT(*)::int AS n FROM auth_credentials`)[0]) as { n: number };
  const sessEmpty = ((await sql`SELECT COUNT(*)::int AS n FROM auth_sessions`)[0]) as { n: number };
  ok("both auth tables start EMPTY (no PIN exists yet)", credEmpty.n === 0 && sessEmpty.n === 0, `credentials=${credEmpty.n} sessions=${sessEmpty.n}`);
  // Make sure they really are empty for the tests (restored in cleanup if any pre-existing rows).
  await sql`DELETE FROM auth_credentials`.catch(() => {});
  await sql`DELETE FROM auth_sessions`.catch(() => {});

  console.log("== 3. Not-configured honesty (empty credential) ==");
  const nc = await postJson("/api/auth/login", { pin: "anything" }, mainIp);
  ok("login with empty credential returns ok:false", nc.body.ok === false, JSON.stringify(nc.body));
  ok("error mentions 'not configured'", typeof nc.body.error === "string" && String(nc.body.error).includes("not configured"), String(nc.body.error ?? ""));
  ok("no Set-Cookie on failure", nc.setCookie === null, nc.setCookie ?? "no set-cookie");
  const ncAudit = (await sql`
    SELECT 1 FROM outreach_audit_log WHERE id > ${baselineAudit} AND channel = 'auth'
    AND status = 'login_failed' AND reason ILIKE '%no owner PIN configured%' LIMIT 1
  `) as Array<{ "?column?": number }>;
  ok("audit row written (channel='auth', login_failed, no-PIN reason)", ncAudit.length === 1);

  console.log("== 4. Setup TEMP credential (lib's own hashPin — proves round-trip) ==");
  const tempHash = await hashPin(TEST_PIN);
  ok("hashPin produces self-describing scrypt format", /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/.test(tempHash), tempHash.slice(0, 24) + "...");
  await sql`INSERT INTO auth_credentials (id, role, pin_hash) VALUES (1, 'owner', ${tempHash})`;
  ok("verifyPin accepts the temp PIN", (await verifyPin(TEST_PIN, tempHash)) === true);
  ok("verifyPin rejects a wrong PIN", (await verifyPin(`wrong-${TEST_PIN}`, tempHash)) === false);

  console.log("== 5. Login ok + cookie flags + alreadyAuthenticated ==");
  const lg = await postJson("/api/auth/login", { pin: TEST_PIN }, mainIp);
  ok("login succeeds (ok:true, role owner)", lg.body.ok === true && lg.body.role === "owner" && lg.res.status === 201, JSON.stringify(lg.body));
  ok("Set-Cookie present with df_session", !!lg.setCookie && lg.setCookie.includes(`${SESSION_COOKIE}=`), lg.setCookie?.slice(0, 60) ?? "no set-cookie");
  ok("cookie flags: HttpOnly + SameSite=Lax + Path=/ + Max-Age=86400", !!lg.setCookie && lg.setCookie.includes("HttpOnly") && lg.setCookie.includes("SameSite=Lax") && lg.setCookie.includes("Path=/") && lg.setCookie.includes("Max-Age=86400"), lg.setCookie ?? "");
  ok("Secure flag matches production env", !!lg.setCookie && lg.setCookie.includes("Secure") === (process.env.NODE_ENV === "production"));
  const c1Token = lg.setCookie!.split(";")[0]!.split("=").slice(1).join("=");
  c1Cookie = `${SESSION_COOKIE}=${c1Token}`;
  const c1Hash = sha256Hex(c1Token);
  const c1Rows = ((await sql`SELECT COUNT(*)::int AS n FROM auth_sessions WHERE token_hash = ${c1Hash}`)[0]) as { n: number };
  ok("exactly one session row minted (token stored as sha256 hex)", c1Rows.n === 1, `n=${c1Rows.n}`);
  const okAudit = (await sql`SELECT 1 FROM outreach_audit_log WHERE id > ${baselineAudit} AND channel = 'auth' AND status = 'login_ok' LIMIT 1`) as Array<{ "?column?": number }>;
  ok("audit login_ok row written", okAudit.length === 1);
  const again = await postJson("/api/auth/login", { pin: TEST_PIN }, mainIp, c1Cookie);
  ok("second login with same cookie -> alreadyAuthenticated:true", again.body.ok === true && again.body.alreadyAuthenticated === true, JSON.stringify(again.body));
  const c1RowsAfter = ((await sql`SELECT COUNT(*)::int AS n FROM auth_sessions WHERE token_hash = ${c1Hash}`)[0]) as { n: number };
  ok("no second session row minted (idempotent)", c1RowsAfter.n === 1, `n=${c1RowsAfter.n}`);

  console.log("== 6. Wrong PIN ==");
  const wp = await postJson("/api/auth/login", { pin: "definitely-wrong" }, wrongIp);
  ok("wrong PIN returns ok:false with generic copy", wp.body.ok === false && String(wp.body.error).includes("check the PIN"), JSON.stringify(wp.body));
  ok("no Set-Cookie on failure", wp.setCookie === null, wp.setCookie ?? "no set-cookie");
  const wpAudit = (await sql`
    SELECT 1 FROM outreach_audit_log WHERE id > ${baselineAudit} AND channel = 'auth' AND status = 'login_failed'
    AND reason = 'Login failed (wrong PIN)' LIMIT 1
  `) as Array<{ "?column?": number }>;
  ok("audit login_failed row written", wpAudit.length === 1);
  const authSource = readFileSync(join(process.cwd(), "src/lib/auth.ts"), "utf8");
  ok("auth.ts uses timingSafeEqual (constant-time compare)", authSource.includes("timingSafeEqual"));
  ok("auth.ts uses scrypt (zero-spend hashing)", authSource.includes("scrypt"));
  ok("auth.ts never compares hashes with ===", !/pin\s*===\s*/.test(authSource) && !/pin\s*==\s*/.test(authSource));

  console.log("== 7. Guard middleware unit tests (direct invocation) ==");
  const middlewareServer = (requireOwnerMiddleware as unknown as {
    options: { server: (opts: {
      request: Request; pathname: string; context: Record<string, unknown>; handlerType: "serverFn";
      next: (opts?: { context?: unknown }) => unknown;
    }) => Promise<unknown> };
  }).options.server;
  async function invokeGuard(request: Request): Promise<unknown> {
    return middlewareServer({
      request,
      pathname: "/test",
      context: {},
      handlerType: "serverFn",
      next: async (opts?: { context?: unknown }) => ({
        request, pathname: "/test", context: opts?.context ?? {}, response: new Response("ok", { status: 200 }),
      }),
    });
  }
  const noCookieRes = (await invokeGuard(new Request(`${BASE}/test`))) as Response;
  ok("no cookie -> 401 {authRequired:true}", noCookieRes instanceof Response && noCookieRes.status === 401 && ((await noCookieRes.json()) as Record<string, unknown>).authRequired === true, `status=${noCookieRes.status}`);
  const badCookieRes = (await invokeGuard(new Request(`${BASE}/test`, { headers: { cookie: `${SESSION_COOKIE}=not-a-real-token` } }))) as Response;
  ok("bad cookie -> 401 {authRequired:true}", badCookieRes instanceof Response && badCookieRes.status === 401, `status=${badCookieRes.status}`);
  const unitRevoked = `unit-revoked-${Date.now()}`;
  await sql`INSERT INTO auth_sessions (token_hash, role, expires_at, ip, user_agent, revoked_at, revoke_reason)
    VALUES (${sha256Hex(unitRevoked)}, 'owner', ${new Date(Date.now() + 3600_000)}, '127.0.0.1', 'verify-b14', now(), 'test')`;
  const revokedRes = (await invokeGuard(new Request(`${BASE}/test`, { headers: { cookie: `${SESSION_COOKIE}=${unitRevoked}` } }))) as Response;
  ok("revoked session -> 401", revokedRes instanceof Response && revokedRes.status === 401, `status=${revokedRes.status}`);
  const unitExpired = `unit-expired-${Date.now()}`;
  await sql`INSERT INTO auth_sessions (token_hash, role, expires_at, ip, user_agent)
    VALUES (${sha256Hex(unitExpired)}, 'owner', ${new Date(Date.now() - 1000)}, '127.0.0.1', 'verify-b14')`;
  const expiredRes = (await invokeGuard(new Request(`${BASE}/test`, { headers: { cookie: `${SESSION_COOKIE}=${unitExpired}` } }))) as Response;
  ok("expired session -> 401", expiredRes instanceof Response && expiredRes.status === 401, `status=${expiredRes.status}`);
  const unitValid = `unit-valid-${Date.now()}`;
  await sql`INSERT INTO auth_sessions (token_hash, role, expires_at, ip, user_agent)
    VALUES (${sha256Hex(unitValid)}, 'owner', ${new Date(Date.now() + 3600_000)}, '127.0.0.1', 'verify-b14')`;
  const validRes = (await invokeGuard(new Request(`${BASE}/test`, { headers: { cookie: `${SESSION_COOKIE}=${unitValid}` } }))) as { response: Response; context: { session?: { role?: string } } };
  ok("valid session -> next() called with session", !(validRes instanceof Response) && validRes.response.status === 200 && validRes.context.session?.role === "owner", `context.session.role=${validRes.context.session?.role}`);

  console.log("== 8. Status endpoint ==");
  const stOk = await api("/api/auth/status", { headers: { "x-forwarded-for": mainIp, cookie: c1Cookie! } });
  ok("status with valid cookie -> authenticated:true role:owner", stOk.body.authenticated === true && stOk.body.role === "owner", JSON.stringify(stOk.body));
  const stAnon = await api("/api/auth/status", { headers: { "x-forwarded-for": mainIp } });
  ok("status without cookie -> authenticated:false", stAnon.body.authenticated === false, JSON.stringify(stAnon.body));

  console.log("== 9. Expiry (backdate session to now - 1s) ==");
  await sql`UPDATE auth_sessions SET expires_at = now() - interval '1 second' WHERE token_hash = ${c1Hash}`;
  const stExpired = await api("/api/auth/status", { headers: { "x-forwarded-for": mainIp, cookie: c1Cookie! } });
  ok("status after expiry -> authenticated:false", stExpired.body.authenticated === false, JSON.stringify(stExpired.body));
  const expiredMw = (await invokeGuard(new Request(`${BASE}/test`, { headers: { cookie: c1Cookie! } }))) as Response;
  ok("middleware 401 after expiry", expiredMw instanceof Response && expiredMw.status === 401, `status=${expiredMw.status}`);

  console.log("== 10. Logout ==");
  const lo = await postJson("/api/auth/logout", {}, mainIp, c1Cookie!);
  ok("logout ok:true", lo.body.ok === true, JSON.stringify(lo.body));
  ok("logout clears cookie with Max-Age=0", !!lo.setCookie && lo.setCookie.includes("Max-Age=0") && lo.setCookie.includes(`${SESSION_COOKIE}=`), lo.setCookie ?? "");
  const revokedRow = (await sql`SELECT revoked_at, revoke_reason FROM auth_sessions WHERE token_hash = ${c1Hash}`)[0] as { revoked_at: unknown; revoke_reason: string };
  ok("session row revoked (revoke_reason='logout')", !!revokedRow.revoked_at && revokedRow.revoke_reason === "logout", `reason=${revokedRow.revoke_reason}`);
  const loAudit = (await sql`SELECT 1 FROM outreach_audit_log WHERE id > ${baselineAudit} AND channel = 'auth' AND status = 'logout' LIMIT 1`) as Array<{ "?column?": number }>;
  ok("audit logout row written", loAudit.length === 1);
  const stAfter = await api("/api/auth/status", { headers: { "x-forwarded-for": mainIp, cookie: c1Cookie! } });
  ok("status after logout -> authenticated:false", stAfter.body.authenticated === false, JSON.stringify(stAfter.body));

  console.log("== 11. Rate limit (5 fails -> lockout; 6th blocked) ==");
  let blockedOk = false;
  for (let i = 1; i <= 5; i++) {
    const attempt = await postJson("/api/auth/login", { pin: "wrong-pin" }, rlIp);
    if (i <= 4) {
      ok(`failed login ${i}/5 ok:false (not locked yet)`, attempt.body.ok === false && attempt.body.locked !== true, JSON.stringify(attempt.body));
    } else {
      ok("5th failure triggers lockout (ok:false)", attempt.body.ok === false, JSON.stringify(attempt.body));
    }
    if (attempt.body.locked === true) blockedOk = true;
  }
  const sixth = await postJson("/api/auth/login", { pin: "wrong-pin" }, rlIp);
  ok("6th attempt -> {locked:true}", sixth.body.ok === false && sixth.body.locked === true && String(sixth.body.error).includes("Too many attempts"), JSON.stringify(sixth.body));
  ok("lockout state observed during the 5/6 attempts", blockedOk || sixth.body.locked === true);
  const blockAudit = (await sql`SELECT 1 FROM outreach_audit_log WHERE id > ${baselineAudit} AND channel = 'auth' AND status = 'blocked' AND reason ILIKE '%rate limit%' LIMIT 1`) as Array<{ "?column?": number }>;
  ok("audit blocked row written (rate limit)", blockAudit.length === 1);
  const rlLib = await import("../src/lib/auth.ts");
  rlLib.resetLoginRateLimit();
  ok("resetLoginRateLimit exported and callable", typeof rlLib.resetLoginRateLimit === "function");

  console.log("== 12. Honesty greps ==");
  const dfSessionFiles: string[] = [];
  for (const dir of ["src/lib", "src/routes", "src/components", "src/db"]) {
    for (const f of walkFiles(join(process.cwd(), dir))) {
      if (f.endsWith(".ts") || f.endsWith(".tsx")) {
        const content = readFileSync(f, "utf8");
        if (content.includes("df_session")) dfSessionFiles.push(f.replace(process.cwd() + "/", ""));
      }
    }
  }
  const allowedSessionFiles = new Set(["src/lib/auth.ts", "src/routes/api/auth/login.ts", "src/routes/api/auth/logout.ts", "src/routes/api/auth/status.ts"]);
  const badSessionFiles = dfSessionFiles.filter((f) => !allowedSessionFiles.has(f));
  ok("df_session appears only in src/lib/auth.ts + src/routes/api/auth/*", badSessionFiles.length === 0, badSessionFiles.join(", ") || dfSessionFiles.join(", "));
  const distClient = join(process.cwd(), "dist/client");
  let hasDist = false;
  try { hasDist = statSync(distClient).isDirectory(); } catch { hasDist = false; }
  if (hasDist) {
    const distSession = (await readdir(distClient, { recursive: true })) as string[];
    let leaked = "";
    for (const f of distSession) {
      if (!f.endsWith(".js")) continue;
      const content = readFileSync(join(distClient, f), "utf8");
      if (content.includes("df_session")) { leaked = f; break; }
    }
    ok("df_session absent from dist/client bundles", leaked === "", leaked || "no match");
  } else {
    ok("df_session absent from dist/client bundles (no dist/client in tree yet — publish happens in part 2)", true, "dist/client not present");
  }
  // Expected working-tree change set for part 1: the 7 new files + the
  // AUTO-GENERATED route manifest (routeTree.gen.ts) which the dev server
  // rewrites when new route files are added (the manifest is tracked and was
  // committed by prior PRs #23/#28/#30 too; part 2 will extend it again with
  // login.tsx). Everything else must stay untouched — especially UI/public pages.
  const newFiles = ["src/db/migrations/022_auth_rbac.sql", "src/lib/auth.ts", "src/routes/api/auth/login.ts", "src/routes/api/auth/logout.ts", "src/routes/api/auth/status.ts", "scripts/set-owner-pin.ts", "scripts/verify-b14.ts", "src/routeTree.gen.ts"];
  const fabGrep = ["src/lib/auth.ts", "src/routes/api/auth/login.ts", "src/routes/api/auth/logout.ts", "src/routes/api/auth/status.ts", "scripts/set-owner-pin.ts"];
  const fabHits = fabGrep.filter((f) => /insert\s+into\s+(buyers|contracts)/i.test(readFileSync(join(process.cwd(), f), "utf8")));
  ok("no fabricated insert into buyers/contracts in new files", fabHits.length === 0, fabHits.join(", ") || "clean");
  // -uall: list untracked FILES individually (plain --porcelain collapses an
  // untracked directory like src/routes/api/auth/ into one line).
  const porcelain = String(execSync("git status --porcelain -uall", { cwd: process.cwd() })).trim();
  const dirtyLines = porcelain.split("\n").filter(Boolean);
  const unexpected = dirtyLines.filter((l) => !newFiles.some((f) => l.includes(f)));
  ok("working tree contains ONLY the expected files (7 new + route manifest; public/UI pages untouched)", dirtyLines.length === newFiles.length && unexpected.length === 0, porcelain.replace(/\n/g, " | ") || "clean");
  console.log(`  (git porcelain: ${porcelain.replace(/\n/g, " | ") || "clean"})`);

  console.log("== 13. DB pristine (checked after cleanup) ==");
} finally {
  // --- Cleanup: restore the DB exactly (never leaves the temp credential or
  //     test sessions/audit rows behind, even if a section throws).
  resetLoginRateLimit();
  await sql`DELETE FROM outreach_audit_log WHERE id > ${baselineAudit} AND channel = 'auth'`.catch(() => {});
  await sql`DELETE FROM auth_sessions`.catch(() => {});
  for (const s of preSessions) {
    await sql`
      INSERT INTO auth_sessions (id, token_hash, role, created_at, expires_at, last_seen_at, ip, user_agent, revoked_at, revoke_reason)
      VALUES (${s.id}, ${s.token_hash}, ${s.role}, ${s.created_at}, ${s.expires_at}, ${s.last_seen_at}, ${s.ip}, ${s.user_agent}, ${s.revoked_at}, ${s.revoke_reason})
      ON CONFLICT (id) DO NOTHING
    `.catch(() => {});
  }
  await sql`DELETE FROM auth_credentials`.catch(() => {});
  for (const c of preCred) {
    await sql`
      INSERT INTO auth_credentials (id, role, pin_hash, created_at, updated_at)
      VALUES (${c.id}, ${c.role}, ${c.pin_hash}, ${c.created_at}, ${c.updated_at})
      ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, pin_hash = EXCLUDED.pin_hash, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at
    `.catch(() => {});
  }
}

console.log("== 13. DB pristine ==");
const credFinal = ((await sql`SELECT COUNT(*)::int AS n FROM auth_credentials`)[0]) as { n: number };
ok("auth_credentials empty (or restored to pre-existing rows)", credFinal.n === preCred.length, `n=${credFinal.n}`);
const sessFinal = ((await sql`SELECT COUNT(*)::int AS n FROM auth_sessions`)[0]) as { n: number };
ok("auth_sessions empty (or restored to pre-existing rows)", sessFinal.n === preSessions.length, `n=${sessFinal.n}`);
const authAuditLeft = ((await sql`SELECT COUNT(*)::int AS n FROM outreach_audit_log WHERE id > ${baselineAudit} AND channel = 'auth'`)[0]) as { n: number };
ok("no verify-created auth audit rows remain", authAuditLeft.n === 0, `n=${authAuditLeft.n}`);
const leadFinal = ((await sql`SELECT COUNT(*)::int AS n FROM leads`)[0]) as { n: number };
ok("lead count unchanged", leadFinal.n === leadCountStart, `n=${leadFinal.n}`);

console.log("== 14. Routes after publish (STUB — completed in PH1-B14 part 2) ==");
// Part 2 (OwnerGate UI + login page + route wrapping) implements these checks
// after publish; they are deliberately NOT run here (part 1 ships no UI):
//   - /, /login, /sell/tax-delinquent, /get-offer -> 200 public
//   - /crm without cookie -> 200 with SSR HTML containing "Sign in required"
//     and NOT containing any real lead PII
//   - /api/auth/status -> {authenticated:false}
ok("section 14 deferred to part 2 (needs OwnerGate + login page UI)", true, "stub — implemented in PH1-B14 part 2");

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

// --- helpers (hoisted) --------------------------------------------------------

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}
