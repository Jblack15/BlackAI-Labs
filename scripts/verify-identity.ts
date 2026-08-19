// PH1 Identity-wiring verification — settings form + comms signature + reply-to.
//
// Verifies, against the LIVE DB, that the owner's identity values are read and
// round-tripped end-to-end, that the outbound email/postcard templates and the
// Reply-To header are wired to business_profile, that the settings server fn is
// owner-gated (401 without cookie), and that the public pages were untouched.
//
// The DB is left byte-identical to the owner's saved business_profile row
// (backup + restore in try/finally), and any test-created audit rows (channel
// 'settings_identity' or auth test sessions) are removed.
//
// Run:  bun run scripts/verify-identity.ts   (DATABASE_URL must be set)
//
// HTTP/auth checks use direct middleware invocation (same pattern as verify-b14
// §7) and run against the env that serves the current source tree:
// VERIFY_BASE_URL overrides when the target moves; default http://localhost:3001.
import { neon } from "@neondatabase/serverless";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SESSION_COOKIE, requireOwnerMiddleware } from "../src/lib/auth.ts";

const sql = neon(process.env.DATABASE_URL!);
const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3001";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// The owner's saved identity (verified 2026-08-18). The verify script restores
// these exact values (and the original updated_at + audit baseline) afterwards.
const SAVED = {
  business_name: "DealForge Properties",
  contact_name: "Joshua Black",
  phone: "(210) 555-0142",
  website: "dealforgeproperties.com",
  return_address: "123 Main St, San Antonio TX 78205",
  email: "dealforge-properties-8480c335@ctomail.io",
};

// --- Pre-test state ------------------------------------------------------------
const preRow = (await sql`SELECT * FROM business_profile WHERE id = 1`)[0] as Record<string, unknown> | undefined;
const auditBaselineId = ((await sql`SELECT COALESCE(MAX(id),0)::int AS n FROM outreach_audit_log`)[0] as { n: number }).n;

try {
  console.log("== 1. Business identity read ==");
  const { getBusinessProfile } = await import("../src/lib/compliance.ts");
  const profile = await getBusinessProfile();
  ok("profile read returns business_name", profile.business_name === SAVED.business_name, profile.business_name);
  ok("profile read returns contact_name", profile.contact_name === SAVED.contact_name, profile.contact_name ?? "");
  ok("profile read returns phone", profile.phone === SAVED.phone, profile.phone ?? "");
  ok("profile read returns website", profile.website === SAVED.website, profile.website ?? "");
  ok("profile read returns return_address", profile.return_address === SAVED.return_address, profile.return_address ?? "");
  ok("profile read returns email", profile.email === SAVED.email, profile.email ?? "");
  const dbRow = (await sql`SELECT business_name, contact_name, phone, website, return_address, email FROM business_profile WHERE id = 1`)[0] as Record<string, string>;
  ok("all six fields present in DB row", !!dbRow.business_name && !!dbRow.contact_name && !!dbRow.phone && !!dbRow.website && !!dbRow.return_address && !!dbRow.email, JSON.stringify(Object.keys(dbRow)));

  console.log("== 2. Save validation ==");
  const { validateBusinessProfile } = await import("../src/lib/compliance.ts");
  ok("valid save passes validation", validateBusinessProfile(SAVED).valid);
  ok("empty phone rejected", !validateBusinessProfile({ ...SAVED, phone: "" }).valid && (validateBusinessProfile({ ...SAVED, phone: "" }).error?.includes("Phone") ?? false));
  ok("bad email rejected", !validateBusinessProfile({ ...SAVED, email: "not-an-email" }).valid && (validateBusinessProfile({ ...SAVED, email: "not-an-email" }).error?.includes("Email") ?? false));
  ok("bare-domain website accepted (URL-or-empty)", validateBusinessProfile({ ...SAVED }).valid, "dealforgeproperties.com");

  console.log("== 3. Save round-trip (same values -> audit + restore) ==");
  const { saveBusinessProfile } = await import("../src/lib/compliance.ts");
  const saved = await saveBusinessProfile(SAVED);
  ok("save success", saved.success === true, saved.error ?? "");
  ok("save returns contact_name", saved.profile.contact_name === SAVED.contact_name, saved.profile.contact_name ?? "");
  ok("save returns all six fields intact",
    saved.profile.business_name === SAVED.business_name &&
    saved.profile.phone === SAVED.phone &&
    saved.profile.website === SAVED.website &&
    saved.profile.return_address === SAVED.return_address &&
    saved.profile.email === SAVED.email,
    "six-field round-trip");
  const auditRows = (await sql`SELECT channel FROM outreach_audit_log WHERE id > ${auditBaselineId} AND channel='settings_identity'`) as { channel: string }[];
  ok("audit row written (channel='settings_identity') on update", auditRows.length >= 1, `${auditRows.length} row(s)`);

  console.log("== 4. Reply-to + template wiring references business_profile (grep) ==");
  const emailOut = readFileSync(join(process.cwd(), "src/lib/email-outreach.ts"), "utf8");
  const postTpl = readFileSync(join(process.cwd(), "src/lib/postcard-templates.ts"), "utf8");
  const click2 = readFileSync(join(process.cwd(), "src/lib/click2mail.ts"), "utf8");
  const compliance = readFileSync(join(process.cwd(), "src/lib/compliance.ts"), "utf8");
  const settings = readFileSync(join(process.cwd(), "src/routes/settings.tsx"), "utf8");
  ok("email-outreach sets Reply-To header", emailOut.includes("replyTo") && emailOut.includes("transport.sendMail"), "replyTo in sendMail");
  ok("reply-to resolves from profile.email", emailOut.includes("profile.email") && emailOut.includes("replyTo = profile.email"), "replyTo<-profile.email");
  ok("email identity carries contactName from profile.contact_name", emailOut.includes("contactName: profile.contact_name"), "contactName<-profile.contact_name");
  ok("email footer renders contactName", emailOut.includes("contactName") && emailOut.includes("signature"), "email signature");
  ok("postcard identity carries contactName", postTpl.includes("contactName") && postTpl.includes("[CONTACT_NAME]"), "postcard contact placeholder");
  ok("click2mail passes profile.contact_name into postcard identity", click2.includes("contactName: profile.contact_name"), "click2mail contactName");
  ok("compliance persists contact_name", compliance.includes("contact_name") && compliance.includes("EXCLUDED.contact_name"), "compliance contact_name");

  console.log("== 5. Settings server fn is owner-gated (grep + 401 without cookie) ==");
  ok("saveIdentity declared with requireOwnerMiddleware", /const saveIdentity = createServerFn\(\{ method: "POST", middleware: \[requireOwnerMiddleware\] \}\)/.test(settings), "settings saveIdentity gated");
  const middlewareServer = (requireOwnerMiddleware as unknown as {
    options: { server: (opts: {
      request: Request; pathname: string; context: Record<string, unknown>; handlerType: "serverFn";
      next: (opts?: { context?: unknown }) => unknown;
    }) => Promise<unknown> };
  }).options.server;
  async function invokeGuard(request: Request): Promise<unknown> {
    return middlewareServer({
      request,
      pathname: "/settings",
      context: {},
      handlerType: "serverFn",
      next: async () => ({ request, pathname: "/settings", context: {}, response: new Response("ok", { status: 200 }) }),
    });
  }
  const noCookie = (await invokeGuard(new Request(`${BASE}/settings`))) as Response;
  ok("owner-gated server fn returns 401 without cookie", noCookie instanceof Response && noCookie.status === 401, `status=${noCookie.status}`);
  const badCookie = (await invokeGuard(new Request(`${BASE}/settings`, { headers: { cookie: `${SESSION_COOKIE}=garbage` } }))) as Response;
  ok("owner-gated server fn returns 401 on invalid cookie", badCookie instanceof Response && badCookie.status === 401, `status=${badCookie.status}`);

  console.log("== 6. Public pages unchanged (no identity wiring on public routes) ==");
  const publicRoutes = ["src/routes/index.tsx", "src/routes/get-offer.tsx", "src/routes/sell-fast.tsx", "src/routes/calculator.tsx", "src/routes/thank-you.tsx"];
  for (const f of publicRoutes) {
    const src = readFileSync(join(process.cwd(), f), "utf8");
    ok(`${f} does not reference business_profile or contact_name`, !src.includes("business_profile") && !src.includes("contact_name"), "clean");
  }
  // Confirm only owner-gated route files were touched this build.
  const changedRoutes = execSync("git diff --name-only main...HEAD -- src/routes/ 2>/dev/null || git diff --name-only -- src/routes/", { encoding: "utf8" })
    .split("\n").map((l) => l.trim()).filter(Boolean);
  for (const f of changedRoutes) {
    ok(`changed route ${f} is owner-gated (settings|crm)`, f === "src/routes/settings.tsx" || f === "src/routes/crm.tsx", f);
  }
  // Only public pages we see over HTTP should still return 200 (smoke).
  try {
    const res = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(8000) });
    ok("public landing page returns 200", res.status === 200, `status=${res.status}`);
  } catch (e) {
    ok("public landing page returns 200", false, e instanceof Error ? e.message : String(e));
  }
} finally {
  // --- Restore owner's saved values exactly (byte-identical row) ---
  if (preRow) {
    await sql`
      INSERT INTO business_profile (id, business_name, contact_name, phone, website, return_address, email, updated_at)
      VALUES (1, ${String(preRow.business_name ?? SAVED.business_name)}, ${preRow.contact_name ? String(preRow.contact_name) : null}, ${preRow.phone ? String(preRow.phone) : null}, ${preRow.website ? String(preRow.website) : null}, ${preRow.return_address ? String(preRow.return_address) : null}, ${preRow.email ? String(preRow.email) : null}, ${preRow.updated_at ? new Date(String(preRow.updated_at)) : new Date()})
      ON CONFLICT (id) DO UPDATE SET
        business_name = EXCLUDED.business_name,
        contact_name = EXCLUDED.contact_name,
        phone = EXCLUDED.phone,
        website = EXCLUDED.website,
        return_address = EXCLUDED.return_address,
        email = EXCLUDED.email,
        updated_at = EXCLUDED.updated_at
    `;
  } else {
    await sql`INSERT INTO business_profile (id, business_name, contact_name, phone, website, return_address, email)
      VALUES (1, ${SAVED.business_name}, ${SAVED.contact_name}, ${SAVED.phone}, ${SAVED.website}, ${SAVED.return_address}, ${SAVED.email})
      ON CONFLICT (id) DO NOTHING`;
  }
  // Remove test-created audit rows (and any auth test sessions) so the DB is clean.
  await sql`DELETE FROM outreach_audit_log WHERE id > ${auditBaselineId} AND channel='settings_identity'`;
  await sql`DELETE FROM auth_sessions WHERE user_agent = 'verify-identity'`;
}

console.log(`\nRESULT: ${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
