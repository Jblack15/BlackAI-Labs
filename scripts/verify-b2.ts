// PH1-B2 verification script — run: bun run scripts/verify-b2.ts
// Verifies the compliance core against the LIVE database, then removes every
// test row it created (leads, audit rows, consent rows, logs) and restores the
// business_profile to its defaults.
import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";

const sql = neon(process.env.DATABASE_URL!);
const TEST_PHONE = "+12105559901";
const TEST_EMAIL = "verify-b2@example.com";
const TEST_ADDR = { property_address: "999 Verify St", property_city: "San Antonio", property_state: "TX", property_zip: "78201" };

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("== 1. assertOutreachAllowed matrix (in-memory) ==");
const { assertOutreachAllowed } = await import("../src/lib/skip-trace.ts");
const base = { phone: TEST_PHONE, email: TEST_EMAIL, ...TEST_ADDR };
ok("no phone blocks sms", !assertOutreachAllowed({ email: TEST_EMAIL }, "sms").allowed);
ok("no email blocks email", !assertOutreachAllowed({ phone: TEST_PHONE }, "email").allowed);
ok("no address blocks mail", !assertOutreachAllowed({ ...base, property_address: null }, "mail").allowed);
ok("DNC blocks sms", !assertOutreachAllowed({ ...base, dnc_flag: "DNC" }, "sms").allowed);
ok("DNC does NOT block email", assertOutreachAllowed({ ...base, dnc_flag: "DNC" }, "email").allowed);
ok("DNC does NOT block mail", assertOutreachAllowed({ ...base, dnc_flag: "DNC" }, "mail").allowed);
ok("do_not_mail blocks mail", !assertOutreachAllowed({ ...base, do_not_mail: true }, "mail").allowed);
ok("do_not_mail does NOT block sms", assertOutreachAllowed({ ...base, do_not_mail: true }, "sms").allowed);
ok("opted_out blocks all channels", !assertOutreachAllowed({ ...base, opted_out: true }, "email").allowed && !assertOutreachAllowed({ ...base, opted_out: true }, "mail").allowed && !assertOutreachAllowed({ ...base, opted_out: true }, "sms").allowed);
ok("wrong_number blocks sms", !assertOutreachAllowed({ ...base, wrong_number: true }, "sms").allowed);
ok("wrong_number does NOT block email/mail", assertOutreachAllowed({ ...base, wrong_number: true }, "email").allowed && assertOutreachAllowed({ ...base, wrong_number: true }, "mail").allowed);
ok("invalid_contact blocks sms+email", !assertOutreachAllowed({ ...base, invalid_contact: true }, "sms").allowed && !assertOutreachAllowed({ ...base, invalid_contact: true }, "email").allowed);
const reason = assertOutreachAllowed({ ...base, dnc_flag: "DNC" }, "sms").reason || "";
ok("block reason is descriptive", reason.includes("suppressed") && reason.includes("DNC"), reason);

console.log("== 2. create test lead ==");
const leadId = randomUUID();
await sql`INSERT INTO leads (id, full_name, phone, email, property_address, property_city, property_state, property_zip, lead_source, status)
          VALUES (${leadId}, 'B2 Verify Contact', ${TEST_PHONE}, ${TEST_EMAIL}, ${TEST_ADDR.property_address}, ${TEST_ADDR.property_city}, ${TEST_ADDR.property_state}, ${TEST_ADDR.property_zip}, 'tax-delinquent', 'new')`;
const ctRow = await sql`SELECT contactable, trace_status FROM leads WHERE id = ${leadId}`;
ok("trigger computed contactable=true after insert (phone+email, no flags)", ctRow[0].contactable === true);

console.log("== 3. identity guard blocks sends when profile empty ==");
const { getBusinessProfile, saveBusinessProfile, assertBusinessIdentity, handleOptOut, recordSuppression, getComplianceSummary, logOutreachAudit } = await import("../src/lib/compliance.ts");
const profileBefore = await getBusinessProfile();
// Ensure a clean default profile (empty website/return_address/phone/email).
await saveBusinessProfile({ business_name: "DealForge Properties", phone: "", website: "", return_address: "", email: "" });
const idCheckEmail = await assertBusinessIdentity("email");
ok("email identity guard blocks with empty website", !idCheckEmail.allowed && idCheckEmail.reason?.includes("business identity not configured"), idCheckEmail.reason || "");
const idCheckMail = await assertBusinessIdentity("mail");
ok("mail identity guard blocks with empty return_address", !idCheckMail.allowed && idCheckMail.reason?.includes("business identity not configured"), idCheckMail.reason || "");

console.log("== 4. sendEmail blocked by identity guard + audit row ==");
const { sendEmail } = await import("../src/lib/email-outreach.ts");
const r1 = await sendEmail({ to: TEST_EMAIL, subject: "verify", html: "<p>x</p>", leadId });
ok("sendEmail blocked when identity empty", !r1.success && r1.error?.includes("business identity not configured"), r1.error || "");
let audit = await sql`SELECT status, reason, channel FROM outreach_audit_log WHERE lead_id = ${leadId} ORDER BY id`;
ok("audit row written for identity-blocked email", audit.some((a) => a.status === "blocked" && a.channel === "email" && a.reason?.includes("identity")));

console.log("== 5. sendEmail blocked by suppression + audit row ==");
await saveBusinessProfile({ business_name: "DealForge Properties", phone: "(210) 555-0199", website: "https://dealforge.example", return_address: "100 Main St, San Antonio, TX 78205", email: "hello@dealforge.example" });
await sql`UPDATE leads SET opted_out = true, consent_recorded_at = now(), consent_source = 'verify' WHERE id = ${leadId}`;
const r2 = await sendEmail({ to: TEST_EMAIL, subject: "verify", html: "<p>x</p>", leadId });
ok("sendEmail blocked when opted_out", !r2.success && r2.error?.includes("suppressed"), r2.error || "");
audit = await sql`SELECT status, reason FROM outreach_audit_log WHERE lead_id = ${leadId} ORDER BY id`;
ok("audit row written for suppression-blocked email", audit.some((a) => a.status === "blocked" && a.reason?.includes("suppressed")));

console.log("== 6. sendSms blocked + audit ==");
const { sendSms } = await import("../src/lib/sms.ts");
const r3 = await sendSms(TEST_PHONE, "verify sms", leadId);
ok("sendSms blocked when opted_out", !r3.success && r3.error?.includes("suppressed"), r3.error || "");
audit = await sql`SELECT status, reason, channel FROM outreach_audit_log WHERE lead_id = ${leadId} ORDER BY id`;
ok("audit row written for suppression-blocked sms", audit.some((a) => a.status === "blocked" && a.channel === "sms" && a.reason?.includes("suppressed")));

console.log("== 7. mail: do_not_mail blocks + audit; DNC does not ==");
const { sendPostcards } = await import("../src/lib/click2mail.ts");
await sql`UPDATE leads SET opted_out = false, do_not_mail = true, dnc_flag = 'DNC' WHERE id = ${leadId}`;
const mailRes = await sendPostcards([{ id: leadId, name: "B2 Verify Contact", ...TEST_ADDR, suppression: "DNC", do_not_mail: true, opted_out: false }]);
ok("sendPostcards blocks do_not_mail lead", !mailRes.success && mailRes.error === "All leads are suppressed — nothing mailed", mailRes.error || "");
audit = await sql`SELECT status, reason, channel FROM outreach_audit_log WHERE lead_id = ${leadId} ORDER BY id`;
ok("audit row written for mail-blocked piece", audit.some((a) => a.status === "blocked" && a.channel === "mail" && a.reason?.includes("mail not permitted")));
const mailDncOnly = await sendPostcards([{ id: leadId, name: "B2 Verify Contact", ...TEST_ADDR, suppression: "DNC", do_not_mail: false, opted_out: false }]);
ok("mail with DNC-only (no do_not_mail) passes suppression (fails only on Click2Mail not configured)", mailDncOnly.failed === 1 && mailDncOnly.error?.includes("Click2Mail not configured"), mailDncOnly.error || "");

console.log("== 8. audit 'sent' path (logOutreachAudit direct = same code used on success) ==");
await logOutreachAudit({ leadId, channel: "email", direction: "outbound", status: "sent", contactValue: TEST_EMAIL, contentPreview: "verify sent row" });
audit = await sql`SELECT status FROM outreach_audit_log WHERE lead_id = ${leadId} AND status = 'sent'`;
ok("audit 'sent' row written", audit.length >= 1);

console.log("== 9. handleOptOut flips opted_out + consent + audit ==");
await sql`UPDATE leads SET opted_out = false, consent_recorded_at = NULL, consent_source = NULL, do_not_mail = false WHERE id = ${leadId}`;
const optOut = await handleOptOut(TEST_PHONE, "sms", { source: "sms-reply", detail: "STOP received" });
ok("handleOptOut resolves by contact value", optOut.success && optOut.leadId === leadId);
const leadAfter = await sql`SELECT opted_out, consent_recorded_at, consent_source FROM leads WHERE id = ${leadId}`;
ok("opted_out=true + consent timestamps set", leadAfter[0].opted_out === true && leadAfter[0].consent_recorded_at !== null && leadAfter[0].consent_source === "sms-reply");
const consent = await sql`SELECT channel, granted, source FROM consent_records WHERE lead_id = ${leadId}`;
ok("consent record written (granted=false)", consent.some((c) => c.granted === false && c.source === "sms-reply"));
audit = await sql`SELECT status, direction FROM outreach_audit_log WHERE lead_id = ${leadId} AND direction = 'inbound'`;
ok("inbound audit row written for opt-out", audit.some((a) => a.status === "received"));

console.log("== 10. recordSuppression (CRM button path) ==");
const sup = await recordSuppression(leadId, "wrong_number", { operator: "verify-user" });
ok("recordSuppression sets wrong_number + audits", sup.success);
const wn = await sql`SELECT wrong_number FROM leads WHERE id = ${leadId}`;
ok("wrong_number=true persisted", wn[0].wrong_number === true);

console.log("== 11. contactable trigger respects suppression flags ==");
await sql`UPDATE leads SET opted_out = false, wrong_number = false, do_not_mail = false, invalid_contact = false, dnc_flag = NULL WHERE id = ${leadId}`;
let c = await sql`SELECT contactable FROM leads WHERE id = ${leadId}`;
ok("contactable=true with contact + no flags", c[0].contactable === true);
await sql`UPDATE leads SET opted_out = true WHERE id = ${leadId}`;
c = await sql`SELECT contactable FROM leads WHERE id = ${leadId}`;
ok("contactable=false when opted_out", c[0].contactable === false);
await sql`UPDATE leads SET opted_out = false, do_not_mail = true WHERE id = ${leadId}`;
c = await sql`SELECT contactable FROM leads WHERE id = ${leadId}`;
ok("contactable=false when do_not_mail", c[0].contactable === false);
await sql`UPDATE leads SET do_not_mail = false, invalid_contact = true WHERE id = ${leadId}`;
c = await sql`SELECT contactable FROM leads WHERE id = ${leadId}`;
ok("contactable=false when invalid_contact", c[0].contactable === false);
await sql`UPDATE leads SET invalid_contact = false, wrong_number = true WHERE id = ${leadId}`;
c = await sql`SELECT contactable FROM leads WHERE id = ${leadId}`;
ok("contactable=false when wrong_number", c[0].contactable === false);

console.log("== 12. compliance summary (settings panel) ==");
const summary = await getComplianceSummary();
ok("summary loads", !!summary && summary.audit_log_rows >= 0);
ok("channels honest (email NOT CONNECTED)", summary.channels.email.status === "NOT CONNECTED");
ok("channels honest (sms NOT CONNECTED)", summary.channels.sms.status === "NOT CONNECTED");
ok("suppression counts reflect test lead", summary.suppression.wrong_number >= 1);

console.log("== 13. CLEANUP ==");
await sql`DELETE FROM outreach_audit_log WHERE lead_id = ${leadId}`;
await sql`DELETE FROM consent_records WHERE lead_id = ${leadId}`;
await sql`DELETE FROM sms_logs WHERE lead_id = ${leadId}`;
await sql`DELETE FROM email_logs WHERE lead_id = ${leadId}`;
await sql`DELETE FROM mail_logs WHERE lead_id = ${leadId}`;
await sql`DELETE FROM leads WHERE id = ${leadId}`;
await saveBusinessProfile({ business_name: profileBefore.business_name || "DealForge Properties", phone: profileBefore.phone || "", website: profileBefore.website || "", return_address: profileBefore.return_address || "", email: profileBefore.email || "" });
const leftover = await sql`SELECT count(*)::int AS n FROM leads WHERE id = ${leadId}`;
ok("test lead removed", leftover[0].n === 0);
const leftoverAudit = await sql`SELECT count(*)::int AS n FROM outreach_audit_log WHERE lead_id = ${leadId}`;
ok("audit rows cleaned", leftoverAudit[0].n === 0);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
