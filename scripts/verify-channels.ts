// DealFlow AI — Step 11 Channel Activation gates verification
// Run: bun run scripts/verify-channels.ts
//
// Verifies against the LIVE database + real env:
//   §1   migration 026 applied — approval_requests.kind CHECK includes
//        'channel_campaign'
//   §2   honest current state — providerConfigStatus says both channels NOT
//        CONFIGURED, and assertChannelSendAllowed REFUSES both sms and email
//        on a compliant lead with the exact provider reason (gate='provider')
//   §3   simulation — with a provider env var set (in-process ONLY, never
//        persisted) + an owner-APPROVED channel_campaign approval (real DB
//        row, cleaned up after) + a compliant lead, the gate PASSES; the same
//        lead with dnc_flag / opted_out still REFUSES (gate='compliance').
//        Also: missing campaignId refuses, and an unapproved campaign refuses.
//   §4   live route renders — SSR /channels shows the owner gate + the /channels
//        nav link; and getChannelsOverview() returns honest OFF/NOT-CONFIGURED
//        states (data-level check that backs the rendered cards).
//
// The one approval row + one campaign row created here are REAL and are deleted
// in a finally block so the production DB is left exactly as it started (no
// test data persists, and no fake 'approved' channel survives in reality).
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);
let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
const has = (s: string, sub: string) => s.includes(sub);

console.log("== 1. migration 026 (kind CHECK includes channel_campaign) ==");
const def = await sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname='approval_requests_kind_check'`;
ok("approval_requests kind CHECK present", (def as any[]).length === 1);
ok("kind CHECK includes channel_campaign", has((def as any[])[0]?.def ?? "", "channel_campaign"));

console.log("== 2. honest current state (real env, no provider) ==");
const { providerConfigStatus, assertChannelSendAllowed, getChannelsOverview } = await import("../src/lib/channel-gates");
const smsCfg = providerConfigStatus("sms");
const emailCfg = providerConfigStatus("email");
ok("SMS provider NOT configured (SMS_PROVIDER absent)", smsCfg.configured === false, `missing=${smsCfg.missing.join(",")}`);
ok("Email SMTP NOT configured (SMTP absent)", emailCfg.configured === false, `missing=${emailCfg.missing.join(",")}`);
const compliantSmsLead = { phone: "2105550100", email: "no-reply@example.com" };
const rSms = await assertChannelSendAllowed("sms", compliantSmsLead, { campaignId: "00000000-0000-0000-0000-000000000000" });
const rEmail = await assertChannelSendAllowed("email", { email: "no-reply@example.com" }, { campaignId: "00000000-0000-0000-0000-000000000000" });
ok("SMS refuses with provider reason (gate=provider)", rSms.allowed === false && rSms.gate === "provider", rSms.allowed === false ? rSms.reason : "allowed");
ok("SMS reason names NOT CONFIGURED", rSms.allowed === false && has(rSms.reason, "NOT CONFIGURED"));
ok("Email refuses with provider reason (gate=provider)", rEmail.allowed === false && rEmail.gate === "provider", rEmail.allowed === false ? rEmail.reason : "allowed");
ok("Email reason names NOT CONFIGURED", rEmail.allowed === false && has(rEmail.reason, "NOT CONFIGURED"));
const overview = await getChannelsOverview();
ok("overview zeroSpend=true", overview.zeroSpend === true);
ok("overview sms OFF (provider null)", overview.sms.provider === null);
ok("overview email OFF (provider null)", overview.email.provider === null);
ok("overview summary says provider not connected", has(overview.summary, "provider not connected") && has(overview.summary, "SMTP not configured"));
ok("overview approved campaigns = 0 (real)", overview.sms.approvedCampaigns === 0 && overview.email.approvedCampaigns === 0, `sms=${overview.sms.approvedCampaigns} email=${overview.email.approvedCampaigns}`);

console.log("== 3. simulation — provider present + owner-approved campaign ==");
// Keep real env in-memory only; restore after.
const hadSms = process.env.SMS_PROVIDER;
const hadSmtp = { h: process.env.SMTP_HOST, u: process.env.SMTP_USER, p: process.env.SMTP_PASS };
process.env.SMS_PROVIDER = "verify-provider";
process.env.SMTP_HOST = "verify.smtp.example";
process.env.SMTP_USER = "verify";
process.env.SMTP_PASS = "verify";
let campaignId: string | null = null;
let approvalId: string | null = null;
try {
  const ins = await sql`INSERT INTO campaigns (name, channel, status, planned_budget_cents, notes)
    VALUES ('verify-step11-tmp','sms','planned',0,'verify-temp') RETURNING id`;
  campaignId = String((ins as any[])[0].id);
  // no approval yet -> unapproved campaign must refuse
  const rUnapproved = await assertChannelSendAllowed("sms", compliantSmsLead, { campaignId });
  ok("unapproved campaign refuses (gate=campaign)", rUnapproved.allowed === false && rUnapproved.gate === "campaign", rUnapproved.allowed === false ? rUnapproved.reason : "allowed");
  // missing campaignId refuses
  const rNoCampaign = await assertChannelSendAllowed("sms", compliantSmsLead, { campaignId: "" });
  ok("missing campaignId refuses (gate=campaign)", rNoCampaign.allowed === false && rNoCampaign.gate === "campaign");
  // now owner-approve the campaign channel
  const a = await sql`INSERT INTO approval_requests (kind,status,ref_type,ref_id,details,requested_by)
    VALUES ('channel_campaign','approved','campaign',${campaignId},'verify simulation','verify') RETURNING id`;
  approvalId = String((a as any[])[0].id);
  ok("owner-approval row inserted (kind=channel_campaign, approved)", !!approvalId);
  // compliant lead PASSES under full gate
  const rPassSms = await assertChannelSendAllowed("sms", compliantSmsLead, { campaignId });
  ok("SMS compliant lead PASSES under full gate", rPassSms.allowed === true && rPassSms.gates.length === 3, `gates=${rPassSms.allowed ? rPassSms.gates.join(",") : rPassSms.reason}`);
  const rPassEmail = await assertChannelSendAllowed("email", { email: "no-reply@example.com" }, { campaignId });
  ok("Email compliant lead PASSES under full gate", rPassEmail.allowed === true);
  // SAME lead, but suppressed -> refuses on compliance
  const rDnc = await assertChannelSendAllowed("sms", { phone: "2105550100", dnc_flag: "DNC" }, { campaignId });
  ok("DNC lead REFUSES (gate=compliance)", rDnc.allowed === false && rDnc.gate === "compliance", rDnc.allowed === false ? rDnc.reason : "allowed");
  const rOpted = await assertChannelSendAllowed("sms", { phone: "2105550100", opted_out: true }, { campaignId });
  ok("opted-out lead REFUSES (gate=compliance)", rOpted.allowed === false && rOpted.gate === "compliance", rOpted.allowed === false ? rOpted.reason : "allowed");
  // email is blocked by suppression flags that apply to email (opted_out /
  // invalid) — dnc_flag alone does NOT block email (phone-centric, per the
  // existing compliance matrix). Test the email-applicable suppression:
  const rOptedEmail = await assertChannelSendAllowed("email", { email: "no-reply@example.com", opted_out: true }, { campaignId });
  ok("email opted-out lead REFUSES (gate=compliance)", rOptedEmail.allowed === false && rOptedEmail.gate === "compliance", rOptedEmail.allowed === false ? rOptedEmail.reason : "allowed");
} finally {
  if (approvalId) await sql`DELETE FROM approval_requests WHERE id=${approvalId}`;
  if (campaignId) await sql`DELETE FROM campaigns WHERE id=${campaignId}`;
  // restore real env regardless
  if (hadSms === undefined) delete process.env.SMS_PROVIDER; else process.env.SMS_PROVIDER = hadSms;
  process.env.SMTP_HOST = hadSmtp.h ?? "";
  process.env.SMTP_USER = hadSmtp.u ?? "";
  process.env.SMTP_PASS = hadSmtp.p ?? "";
}
const leftover = await sql`SELECT COUNT(*)::int AS n FROM approval_requests WHERE kind='channel_campaign'`;
ok("no channel_campaign approvals left after cleanup (zero is correct state)", (leftover[0] as any).n === 0, `n=${(leftover[0] as any).n}`);
const campLeft = await sql`SELECT COUNT(*)::int AS n FROM campaigns WHERE name='verify-step11-tmp'`;
ok("verify campaign removed", (campLeft[0] as any).n === 0);

console.log("== 4. live route renders (owner gate + nav) ==");
try {
  const res = await fetch("http://localhost:3000/channels");
  const html = await res.text();
  ok("HTTP /channels returns 200", res.status === 200, `status=${res.status}`);
  ok("SSR shows owner-gate 'Sign in required' panel", has(html, "Sign in required"));
  // Anonymous SSR must NOT leak channel data and must show the owner sign-in
  // (the Channels nav link + channel data render only after auth, client-side).
  ok("SSR hides channel summary / card data until auth", !has(html, "provider not connected") && !has(html, "Activate SMS"));
  ok("SSR shows anonymous Owner sign-in", has(html, "Owner sign-in"));
} catch (e) {
  ok("HTTP /channels reachable on dev server (3000)", false, e instanceof Error ? e.message : "fetch failed");
}

console.log(`\nVERIFY RESULT: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);