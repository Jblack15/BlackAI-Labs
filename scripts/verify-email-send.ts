// ─────────────────────────────────────────────────────────────────────────────
// DealForge — verify EMAIL SEND PIPELINE (fail-closed, opt-out-aware)
// Run: bun scripts/verify-email-send.ts
// Expect 0 FAIL. Live-DB proof that:
//   (a) sendSellerEmail() refuses with gate=provider for every lead TODAY
//       (no SMTP provider configured; zero-spend mode $0).
//   (b) templates are grounded/honest: identity present, opt-out present,
//       no fabricated value/urgency/relationship claims, no banned phrases.
//   (c) emailableLeadIds(campaignId) == [] today (provider not configured).
//   (d) SIMULATION: with in-process SMTP env + an owner-approved
//       'channel_campaign' approval, a compliant lead PASSES the gate while a
//       opted-out lead still REFUSES; emailableLeadIds honors suppression.
//       Test rows/approvals/env are cleaned up in finally.
// ─────────────────────────────────────────────────────────────────────────────
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
const has = (s: string, sub: string) => s.toLowerCase().includes(sub.toLowerCase());

console.log("== imports ==");
const { sendSellerEmail, emailableLeadIds, SellerEmailBlockedError } =
  await import("../src/lib/email-send");
const { EMAIL_TEMPLATES, propertyRef, greetingName } = await import("../src/lib/email-templates");
const { assertChannelSendAllowed } = await import("../src/lib/channel-gates");
ok("modules import cleanly", typeof sendSellerEmail === "function" && typeof emailableLeadIds === "function");

console.log("== (a) sendSellerEmail refuses with gate=provider for every lead today ==");
// Real leads with an email on file.
const real = (await sql`
  SELECT id, email, full_name, property_address, property_city, property_state, property_zip
  FROM leads WHERE email IS NOT NULL AND email <> '' LIMIT 3
`) as any[];
ok("DB has email-having leads to test against", real.length > 0, `n=${real.length}`);
for (const L of real.slice(0, 3)) {
  const lead = { id: L.id, email: L.email, full_name: L.full_name, property_address: L.property_address, property_city: L.property_city, property_state: L.property_state, property_zip: L.property_zip };
  try {
    await sendSellerEmail(lead, { campaignId: "00000000-0000-0000-0000-000000000000", template: "initial" });
    ok(`real lead ${L.email} refused (gate=provider)`, false, "it did NOT refuse (gate leaked!)");
  } catch (e) {
    const g = e instanceof SellerEmailBlockedError ? e.gate : "unknown";
    const reason = e instanceof Error ? e.message : String(e);
    ok(`real lead ${L.email} refuses gate=provider`, g === "provider", `gate=${g}`);
    ok(`  reason names NOT CONFIGURED`, has(reason, "NOT CONFIGURED"));
  }
}
// A synthetic always-compliant lead must also refuse (provider gate first).
try {
  await sendSellerEmail({ email: "someone@example.com" }, { campaignId: "00000000-0000-0000-0000-000000000000", template: "initial" });
  ok("synthetic compliant lead refused (gate=provider)", false, "no throw");
} catch (e) {
  ok("synthetic compliant lead refuses gate=provider", e instanceof SellerEmailBlockedError && e.gate === "provider");
}
// An opted-out lead TODAY also refuses on provider (gate order) — the channel
// can't even get to compliance while SMTP is unconfigured.
try {
  await sendSellerEmail({ email: "x@example.com", opted_out: true }, { campaignId: "00000000-0000-0000-0000-000000000000", template: "initial" });
  ok("opted-out lead refused today (gate=provider first)", false, "no throw");
} catch (e) {
  ok("opted-out lead refuses gate=provider today (provider checked first)", e instanceof SellerEmailBlockedError && e.gate === "provider");
}

console.log("== (b) templates grounded/honest — identity + opt-out present, no fabricated claims ==");
const identity = {
  businessName: "DealForge Properties",
  contactName: "Joshua Black",
  website: "https://dealforgeproperties.com",
  phone: "(210) 555-0142",
  email: "dealforge-properties-8480c335@ctomail.io",
  returnAddress: "123 Main St, San Antonio TX 78205",
};
const sampleLead = { full_name: "Odilo Molina", property_address: "123 Cottonwood Ln", property_city: "San Antonio", property_state: "TX", property_zip: "78205" };
ok("propertyRef cites stored address only", has(propertyRef(sampleLead), "123 Cottonwood Ln") && has(propertyRef(sampleLead), "San Antonio"));
ok("greetingName uses stored name", greetingName(sampleLead) === "Odilo Molina");
// Heuristic honesty list — phrases/claims we must NEVER emit because they are
// not grounded in stored facts (no comps/ARV/value/urgency/relationship).
const FORBIDDEN = [
  "$", "arV", "after repair value", "comps", "comparable", "your house is worth",
  "we have a buyer", "cash offer", "act now", "asap", "final notice",
  "only 1 spot", "limited time", "urgent", "guarantee", "close in 7 days",
  "your cousin", "your neighbor", "urgently",
];
let allGrounded = true;
for (const t of EMAIL_TEMPLATES) {
  const subj = t.subject(sampleLead, identity);
  const html = t.html(sampleLead, identity);
  const text = t.text(sampleLead, identity);
  const full = [subj, html, text].join(" ");
  const missingIdentity =
    !has(html, "DealForge Properties") || !has(html, "Joshua Black") || !has(html, "San Antonio") || !has(html, "123 Main St, San Antonio TX 78205");
  const missingOptOut = !(has(html, "STOP") || has(html, "unsubscribe") || has(html, "remove you"));
  const banned = FORBIDDEN.filter((f) => has(full, f));
  if (missingIdentity || missingOptOut || banned.length) allGrounded = false;
  ok(`template '${t.key}' identity present (business + contact + San Antonio + postal)`, !missingIdentity);
  ok(`template '${t.key}' opt-out instruction present`, !missingOptOut);
  ok(`template '${t.key}' no forbidden/fabricated phrases`, banned.length === 0, banned.length ? `banned=${banned.join(", ")}` : "");
}
ok("ALL templates grounded/honest", allGrounded);

console.log("== (c) emailableLeadIds returns [] today (no provider) ==");
const idsToday = await emailableLeadIds("00000000-0000-0000-0000-000000000000");
ok("emailableLeadIds([]) today (provider not configured)", idsToday.length === 0, `n=${idsToday.length}`);

console.log("== (d) simulation: SMTP env + owner-approved campaign ==");
// Keep real env safe; restore in finally.
const hadSmtp = { h: process.env.SMTP_HOST, u: process.env.SMTP_USER, p: process.env.SMTP_PASS };
process.env.SMTP_HOST = "verify.smtp.example";
process.env.SMTP_USER = "verify";
process.env.SMTP_PASS = "verify";

const stamp = Date.now();
const compliantEmail = `verify-compliant-${stamp}@example.com`;
const optedEmail = `verify-opted-${stamp}@example.com`;
let campaignId: string | null = null;
let approvalId: string | null = null;
let compliantLeadId: string | null = null;
let optedOutLeadId: string | null = null;
try {
  const camp = await sql`INSERT INTO campaigns (name, channel, status, planned_budget_cents, notes)
    VALUES (${`verify-email-${stamp}`}, 'email', 'planned', 0, 'verify-temp') RETURNING id`;
  campaignId = String((camp as any[])[0].id);

  // Compliant temp lead (supply all required no-default columns).
  const compliant = await sql`INSERT INTO leads (full_name, property_address, property_city, property_state, property_zip, email)
    VALUES ('Verify Buyer', '900 Verify St', 'San Antonio', 'TX', '78205', ${compliantEmail}) RETURNING id`;
  compliantLeadId = String((compliant as any[])[0].id);
  // Opted-out temp lead.
  const opted = await sql`INSERT INTO leads (full_name, property_address, property_city, property_state, property_zip, email, opted_out)
    VALUES ('Verify Opted', '901 Verify St', 'San Antonio', 'TX', '78205', ${optedEmail}, true) RETURNING id`;
  optedOutLeadId = String((opted as any[])[0].id);

  // No approval yet -> still refused on campaign gate (provider now passes).
  const rNoApproval = await assertChannelSendAllowed("email", { email: `${compliantEmail}` }, { campaignId });
  ok("campaign NOT yet approved refuses (gate=campaign)", rNoApproval.allowed === false && rNoApproval.gate === "campaign",
    rNoApproval.allowed === false ? rNoApproval.reason : "allowed");

  const a = await sql`INSERT INTO approval_requests (kind,status,ref_type,ref_id,details,requested_by)
    VALUES ('channel_campaign','approved','campaign',${campaignId},'verify simulation','verify') RETURNING id`;
  approvalId = String((a as any[])[0].id);

  // Compliant lead PASSES the full gate.
  const rPass = await assertChannelSendAllowed("email", { email: `${compliantEmail}` }, { campaignId });
  ok("compliant lead PASSES gate under sim (provider+campaign+compliance)", rPass.allowed === true,
    rPass.allowed === false ? rPass.reason : `gates=${rPass.allowed ? rPass.gates.join(",") : ""}`);

  // Opted-out lead REFUSES at compliance even under full gate.
  try {
    await sendSellerEmail({ email: `${optedEmail}`, opted_out: true }, { campaignId, template: "initial" });
    ok("opted-out lead REFUSES under sim (gate=compliance)", false, "did not throw");
  } catch (e) {
    ok("opted-out lead refuses gate=compliance under sim", e instanceof SellerEmailBlockedError && e.gate === "compliance");
  }

  // emailableLeadIds honors suppression: includes compliant, excludes opted-out.
  const ids = await emailableLeadIds(campaignId);
  ok("emailableLeadIds active under sim (returns lead ids)", ids.length >= 1, `n=${ids.length}`);
  ok("emailableLeadIds includes the compliant lead", compliantLeadId !== null && ids.includes(compliantLeadId));
  ok("emailableLeadIds EXCLUDES the opted-out lead", optedOutLeadId === null || !ids.includes(optedOutLeadId));
} finally {
  if (approvalId) await sql`DELETE FROM approval_requests WHERE id=${approvalId}`;
  if (campaignId) await sql`DELETE FROM campaigns WHERE id=${campaignId}`;
  if (compliantLeadId) await sql`DELETE FROM leads WHERE id=${compliantLeadId}`;
  if (optedOutLeadId) await sql`DELETE FROM leads WHERE id=${optedOutLeadId}`;
  if (hadSmtp.h === undefined) delete process.env.SMTP_HOST; else process.env.SMTP_HOST = hadSmtp.h;
  if (hadSmtp.u === undefined) delete process.env.SMTP_USER; else process.env.SMTP_USER = hadSmtp.u;
  if (hadSmtp.p === undefined) delete process.env.SMTP_PASS; else process.env.SMTP_PASS = hadSmtp.p;
}
// After cleanup (env restored, rows gone) we're back to gate=provider.
const backToProvider = await emailableLeadIds("00000000-0000-0000-0000-000000000000");
ok("after cleanup emailableLeadIds [] again (provider restored)", backToProvider.length === 0, `n=${backToProvider.length}`);
const leftoverApprovals = await sql`SELECT count(*)::int AS n FROM approval_requests WHERE kind='channel_campaign' AND ref_id=${campaignId ?? "00000000-0000-0000-0000-000000000000"}`;
ok("no channel_campaign approval rows left for temp campaign", (leftoverApprovals as any[])[0].n === 0);

console.log(`\nVERIFY RESULT: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
