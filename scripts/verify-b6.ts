// PH1-B6 verification script — run: bun run scripts/verify-b6.ts
// Verifies the outreach status state machine against the LIVE database, then
// removes every test row it created (leads, audit rows, consent rows, logs).
// Mirrors scripts/verify-b2.ts.
import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
const sql = neon(process.env.DATABASE_URL!);
const TEST_PHONE = "+12105559906";
const TEST_EMAIL = "verify-b6@example.com";
const TEST_ADDR = { property_address: "998 Verify St", property_city: "San Antonio", property_state: "TX", property_zip: "78201" };
let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
const createdLeads: string[] = [];

console.log("== 1. migration 012 applied ==");
const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='leads' AND column_name IN ('outreach_status','outreach_status_updated_at')`;
ok("outreach_status + updated_at columns exist", cols.length === 2, cols.map((c) => (c as { column_name: string }).column_name).join(","));
const cons = await sql`SELECT conname FROM pg_constraint WHERE conname='leads_outreach_status_check'`;
ok("CHECK constraint present", cons.length === 1);
const dist = await sql`SELECT outreach_status, count(*)::int AS n FROM leads GROUP BY 1`;
ok("all existing leads are honestly 'new'", dist.length === 1 && (dist[0] as { outreach_status: string; n: number }).outreach_status === "new", JSON.stringify(dist));
const nullUpd = await sql`SELECT count(*)::int AS n FROM leads WHERE outreach_status_updated_at IS NULL`;
ok("no null outreach_status_updated_at", (nullUpd[0] as { n: number }).n === 0);

console.log("== 2. valid transition + audit row ==");
const { transitionOutreachStatus, noteOutreachAttempt, markOutreachQueued, getOutreachStatusHistory } = await import("../src/lib/outreach-status.ts");
const leadA = randomUUID();
createdLeads.push(leadA);
await sql`INSERT INTO leads (id, full_name, phone, email, property_address, property_city, property_state, property_zip, lead_source, status)
          VALUES (${leadA}, 'B6 Verify A', ${TEST_PHONE}, ${TEST_EMAIL}, ${TEST_ADDR.property_address}, ${TEST_ADDR.property_city}, ${TEST_ADDR.property_state}, ${TEST_ADDR.property_zip}, 'tax-delinquent', 'new')`;
const r1 = await transitionOutreachStatus(leadA, "contactable", { reason: "verify: got contact info", operator: "verify-b6" });
ok("new → contactable accepted", r1.success, `${r1.from} → ${r1.to}`);
const aRow = await sql`SELECT outreach_status, outreach_status_updated_at FROM leads WHERE id = ${leadA}`;
ok("lead row updated", (aRow[0] as { outreach_status: string }).outreach_status === "contactable");
const aAudit = await sql`SELECT channel, direction, status, reason, operator FROM outreach_audit_log WHERE lead_id = ${leadA} AND channel='status'`;
ok("audit row written (channel=status, direction=internal, status=sent)", aAudit.length === 1 && (aAudit[0] as { channel: string; direction: string; status: string }).channel === "status" && (aAudit[0] as { direction: string }).direction === "internal" && (aAudit[0] as { status: string }).status === "sent", JSON.stringify(aAudit[0]));

console.log("== 3. invalid jump rejected ==");
const r2 = await transitionOutreachStatus(leadA, "contract_signed", { reason: "verify", operator: "verify-b6" });
ok("contactable → contract_signed rejected", !r2.success && (r2.error || "").includes("Invalid transition"), r2.error || "");
const r3 = await transitionOutreachStatus(leadA, "new", { reason: "verify", operator: "verify-b6" });
ok("contactable → new rejected (no regression)", !r3.success, r3.error || "");

console.log("== 4. full forward path ==");
const FORWARD = ["outreach_queued", "contact_attempted", "connected", "qualified", "offer", "negotiation", "contract_sent", "contract_signed", "buyer_matched", "title", "closed", "assignment_paid"];
let forwardOk = true;
for (const to of FORWARD) {
  const r = await transitionOutreachStatus(leadA, to, { reason: "verify forward", operator: "verify-b6" });
  if (!r.success) { forwardOk = false; console.log(`    failed ${to}: ${r.error}`); }
}
const aFinal = await sql`SELECT outreach_status FROM leads WHERE id = ${leadA}`;
ok("forward chain contactable → assignment_paid", forwardOk && (aFinal[0] as { outreach_status: string }).outreach_status === "assignment_paid");
const aAuditCount = await sql`SELECT count(*)::int AS n FROM outreach_audit_log WHERE lead_id = ${leadA} AND channel='status'`;
ok("13 status audit rows total (one per transition)", (aAuditCount[0] as { n: number }).n === 13, `n=${(aAuditCount[0] as { n: number }).n}`);

console.log("== 5. terminal states are absorbing ==");
const leadB = randomUUID();
createdLeads.push(leadB);
await sql`INSERT INTO leads (id, full_name, phone, email, property_address, property_city, property_state, property_zip, lead_source, status)
          VALUES (${leadB}, 'B6 Verify B', ${TEST_PHONE}, ${TEST_EMAIL}, ${TEST_ADDR.property_address}, ${TEST_ADDR.property_city}, ${TEST_ADDR.property_state}, ${TEST_ADDR.property_zip}, 'tax-delinquent', 'new')`;
const rb1 = await transitionOutreachStatus(leadB, "dnc", { reason: "verify terminal", operator: "verify-b6" });
ok("new → dnc (terminal) accepted", rb1.success);
const rb2 = await transitionOutreachStatus(leadB, "contactable", { reason: "verify", operator: "verify-b6" });
ok("dnc → contactable rejected without override (absorbing)", !rb2.success && (rb2.error || "").includes("terminal"), rb2.error || "");
const rb3 = await transitionOutreachStatus(leadB, "contactable", { reason: "verify override", operator: "verify-b6", override: true });
ok("dnc → contactable accepted with explicit override", rb3.success);
const rb4 = await transitionOutreachStatus(leadB, "opted_out", { reason: "verify", operator: "verify-b6", override: true });
ok("contactable → opted_out (terminal) accepted", rb4.success);
const rb5 = await transitionOutreachStatus(leadB, "not_interested", { reason: "verify no override fields", operator: "verify-b6" });
ok("opted_out → not_interested rejected without override", !rb5.success, rb5.error || "");

console.log("== 6. send-path helper bumps contact_attempted ==");
const leadC = randomUUID();
createdLeads.push(leadC);
await sql`INSERT INTO leads (id, full_name, phone, email, property_address, property_city, property_state, property_zip, lead_source, status)
          VALUES (${leadC}, 'B6 Verify C', ${TEST_PHONE}, ${TEST_EMAIL}, ${TEST_ADDR.property_address}, ${TEST_ADDR.property_city}, ${TEST_ADDR.property_state}, ${TEST_ADDR.property_zip}, 'tax-delinquent', 'new')`;
const rq = await markOutreachQueued(leadC);
ok("new → outreach_queued (queued outreach)", rq.success, `${rq.from} → ${rq.to}`);
const rn = await noteOutreachAttempt(leadC, "email", "sent");
ok("outreach_queued → contact_attempted (send path bump)", rn.success && rn.to === "contact_attempted", `${rn.from} → ${rn.to}`);
const cRow = await sql`SELECT outreach_status FROM leads WHERE id = ${leadC}`;
ok("lead C status = contact_attempted", (cRow[0] as { outreach_status: string }).outreach_status === "contact_attempted");
const rn2 = await noteOutreachAttempt(leadC, "email", "sent");
ok("second send does not regress (stays contact_attempted)", rn2.success && rn2.to === "contact_attempted");
const rn3 = await noteOutreachAttempt(leadB, "email", "sent"); // leadB is terminal (opted_out)
ok("send bump on terminal lead is a no-op (no status change)", rn3.success && rn3.to === rn3.from, `from=${rn3.from} to=${rn3.to}`);

console.log("== 7. send-path wiring (code inspection) ==");
const { readFileSync } = await import("node:fs");
const sms = readFileSync("src/lib/sms.ts", "utf8");
const email = readFileSync("src/lib/email-outreach.ts", "utf8");
const c2m = readFileSync("src/lib/click2mail.ts", "utf8");
ok("sms.ts calls noteOutreachAttempt on real send", sms.includes("noteOutreachAttempt(leadId, \"sms\", \"sent\")"));
ok("email-outreach.ts calls noteOutreachAttempt on real send", email.includes("noteOutreachAttempt(opts.leadId, \"email\", \"sent\")"));
ok("click2mail.ts calls noteOutreachAttempt on job submit", c2m.includes("noteOutreachAttempt(lead.id, \"mail\", \"sent\")"));
const auditC = await sql`SELECT reason FROM outreach_audit_log WHERE lead_id = ${leadC} AND channel='status' ORDER BY id`;
ok("bump wrote a status audit row with reason", (auditC as { reason: string }[]).some((a) => (a.reason || "").includes("Outreach sent via email")));
const history = await getOutreachStatusHistory(leadC);
ok("getOutreachStatusHistory returns rows (newest first)", history.length >= 2 && history[0].to === "contact_attempted", JSON.stringify(history[0]));

console.log("== 8. terminal mark syncs suppression flag + consent ==");
// mirror of the CRM markTerminalStatus handler for opted_out
const { recordSuppression } = await import("../src/lib/compliance.ts");
const leadD = randomUUID();
createdLeads.push(leadD);
await sql`INSERT INTO leads (id, full_name, phone, email, property_address, property_city, property_state, property_zip, lead_source, status)
          VALUES (${leadD}, 'B6 Verify D', ${TEST_PHONE}, ${TEST_EMAIL}, ${TEST_ADDR.property_address}, ${TEST_ADDR.property_city}, ${TEST_ADDR.property_state}, ${TEST_ADDR.property_zip}, 'tax-delinquent', 'new')`;
const rd1 = await transitionOutreachStatus(leadD, "opted_out", { reason: "verify terminal", operator: "verify-b6" });
await recordSuppression(leadD, "opted_out", { operator: "verify-b6", detail: "verify-b6" });
const dRow = await sql`SELECT opted_out, consent_recorded_at FROM leads WHERE id = ${leadD}`;
const dConsent = await sql`SELECT granted FROM consent_records WHERE lead_id = ${leadD}`;
ok("opted_out flag + consent_recorded_at set", (dRow[0] as { opted_out: boolean; consent_recorded_at: unknown }).opted_out === true && (dRow[0] as { consent_recorded_at: unknown }).consent_recorded_at !== null);
ok("consent record granted=false written", dConsent.length === 1 && (dConsent[0] as { granted: boolean }).granted === false);

console.log("== 9. cleanup ==");
for (const id of createdLeads) {
  await sql`DELETE FROM outreach_audit_log WHERE lead_id = ${id}`;
  await sql`DELETE FROM consent_records WHERE lead_id = ${id}`;
  await sql`DELETE FROM sms_logs WHERE lead_id = ${id}`;
  await sql`DELETE FROM email_logs WHERE lead_id = ${id}`;
  await sql`DELETE FROM mail_logs WHERE lead_id = ${id}`;
  await sql`DELETE FROM outreach_sequences WHERE lead_id = ${id}`;
  await sql`DELETE FROM leads WHERE id = ${id}`;
}
const leftover = await sql`SELECT count(*)::int AS n FROM leads WHERE id = ANY(${createdLeads})`;
ok("all test leads removed", (leftover[0] as { n: number }).n === 0);
const leftoverAudit = await sql`SELECT count(*)::int AS n FROM outreach_audit_log WHERE lead_id = ANY(${createdLeads})`;
ok("all test audit rows removed", (leftoverAudit[0] as { n: number }).n === 0);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
