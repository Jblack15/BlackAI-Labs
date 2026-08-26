// DealFlow AI — Manual Dial call-outcome verification (run: bun run scripts/verify-call-outcomes.ts)
//
// Dry-runs the quick call-outcome logging path the owner uses while working the
// prioritized 868 dial list (src/lib/log-call-outcome.ts). For each of the 7
// outcomes (answered / voicemail / no_answer / interested / not_interested /
// wrong_number / dnc) it verifies:
//   · a channel='voice', direction='outbound' audit row is written with the
//     outcome code as status
//   · the correct lead mutation fires (status / flags / next_action / stage)
//   · dnc and wrong_number permanently suppress the lead (hard flags + consent)
//   · interested advances the DEAL pipeline to the earliest contacted stage
// All test rows are removed at the end.
import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
const sql = neon(process.env.DATABASE_URL!);
let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
const createdLeads: string[] = [];
const day = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
async function makeLead(name: string): Promise<string> {
  const id = randomUUID();
  createdLeads.push(id);
  const phone = `+1210${String(5550000 + (createdLeads.length * 7) % 9000).padStart(7, "0")}`;
  await sql`INSERT INTO leads (id, full_name, phone, property_address, property_city, property_state, property_zip, lead_source, status, contactable, outreach_status, score, score_factors)
            VALUES (${id}, ${name}, ${phone}, '1009 Conv St', 'San Antonio', 'TX', '78201', 'tax-delinquent', 'new', true, 'new', 8, '{"equity":120000,"foreclosure_factor":"high","estimated_mao":180000}')`;
  return id;
}
async function viewAudit(leadId: string): Promise<Array<Record<string, unknown>>> {
  return (await sql`SELECT channel, direction, status, reason, contact_value FROM outreach_audit_log WHERE lead_id = ${leadId} AND channel='voice' ORDER BY created_at DESC`) as Array<Record<string, unknown>>;
}
async function cleanup() {
  for (const id of createdLeads) {
    await sql`DELETE FROM outreach_audit_log WHERE lead_id = ${id}`;
    await sql`DELETE FROM consent_records WHERE lead_id = ${id}`;
    await sql`DELETE FROM outreach_sequences WHERE lead_id = ${id}`;
    await sql`DELETE FROM sms_logs WHERE lead_id = ${id}`;
    await sql`DELETE FROM email_logs WHERE lead_id = ${id}`;
    await sql`DELETE FROM mail_logs WHERE lead_id = ${id}`;
    await sql`DELETE FROM pipeline_events WHERE lead_id = ${id}`;
    await sql`DELETE FROM leads WHERE id = ${id}`;
  }
}

const { logCallOutcome } = await import("../src/lib/log-call-outcome.ts");
const OP = "verify-call-outcomes";

console.log("== 1. answered → contacted feel (connected) + audit ==");
const a = await makeLead("CallOutcome Answered A");
const ra = await logCallOutcome(a, { outcome: "answered", sellerSummary: "Owner picked up, brief." }, { operator: OP });
const ar = (await sql`SELECT outreach_status, last_contact_at FROM leads WHERE id = ${a}`)[0] as any;
ok("answered log succeeded", ra.success, ra.error || "");
ok("answered → status connected (contacted)", ar.outreach_status === "connected", ar.outreach_status);
ok("answered stamps last_contact_at", ar.last_contact_at !== null);
const aa = await viewAudit(a);
ok("answered writes voice/outbound audit row", aa.length >= 1 && aa[0].channel === "voice" && aa[0].direction === "outbound" && aa[0].status === "answered", JSON.stringify(aa[0]));

console.log("== 2. voicemail → attempted + retry +1d ==");
const b = await makeLead("CallOutcome Voicemail B");
const dueB = new Date(Date.now() + 1 * 86400000).toISOString().slice(0, 10);
const rb = await logCallOutcome(b, { outcome: "voicemail", sellerSummary: "Left a message", nextAction: "retry call", nextActionDue: dueB }, { operator: OP });
const br = (await sql`SELECT outreach_status, next_action, next_action_due FROM leads WHERE id = ${b}`)[0] as any;
ok("voicemail log succeeded", rb.success, rb.error || "");
ok("voicemail → status contact_attempted", br.outreach_status === "contact_attempted", br.outreach_status);
ok("voicemail → next_action 'retry call'", br.next_action === "retry call", String(br.next_action));
ok("voicemail → next_action_due ~1 day out", day(br.next_action_due) === dueB, `${day(br.next_action_due)} vs ${dueB}`);
const ba = await viewAudit(b);
ok("voicemail writes voice/outbound audit row", ba.length >= 1 && ba[0].status === "voicemail", JSON.stringify(ba[0]));

console.log("== 3. no_answer → attempted + retry +1d ==");
const c = await makeLead("CallOutcome NoAnswer C");
const dueC = new Date(Date.now() + 1 * 86400000).toISOString().slice(0, 10);
const rc = await logCallOutcome(c, { outcome: "no_answer", sellerSummary: "No answer", nextAction: "retry call", nextActionDue: dueC }, { operator: OP });
const cr = (await sql`SELECT outreach_status, next_action, next_action_due FROM leads WHERE id = ${c}`)[0] as any;
ok("no_answer log succeeded", rc.success, rc.error || "");
ok("no_answer → status contact_attempted", cr.outreach_status === "contact_attempted", cr.outreach_status);
ok("no_answer → next_action 'retry call'", cr.next_action === "retry call", String(cr.next_action));
ok("no_answer → next_action_due ~1 day out", day(cr.next_action_due) === dueC, `${day(cr.next_action_due)} vs ${dueC}`);

console.log("== 4. interested → connected + pipeline advances to seller_contacted + higher potential ==");
const d = await makeLead("CallOutcome Interested D");
const dueD = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
const rd = await logCallOutcome(d, { outcome: "interested", sellerSummary: "Wants to sell, will call back", nextAction: "follow up", nextActionDue: dueD }, { operator: OP });
const dr = (await sql`SELECT outreach_status, pipeline_stage, deal_potential, last_contact_at, next_action FROM leads WHERE id = ${d}`)[0] as any;
ok("interested log succeeded", rd.success, rd.error || "");
ok("interested → status connected", dr.outreach_status === "connected", dr.outreach_status);
ok("interested → pipeline_stage seller_contacted", dr.pipeline_stage === "seller_contacted", dr.pipeline_stage);
ok("interested → deal_potential bumped", dr.deal_potential === "high", String(dr.deal_potential));
ok("interested stamps last_contact_at", dr.last_contact_at !== null);
ok("interested → next_action 'follow up'", dr.next_action === "follow up", String(dr.next_action));

console.log("== 5. not_interested → terminal ==");
const e = await makeLead("CallOutcome NotInterested E");
const re = await logCallOutcome(e, { outcome: "not_interested", sellerSummary: "Not selling" }, { operator: OP });
const er = (await sql`SELECT outreach_status FROM leads WHERE id = ${e}`)[0] as any;
ok("not_interested log succeeded", re.success, re.error || "");
ok("not_interested → status not_interested (terminal)", er.outreach_status === "not_interested", er.outreach_status);

console.log("== 6. wrong_number → hard-suppresses (wrong_number + invalid_contact + not contactable) ==");
const f = await makeLead("CallOutcome WrongNumber F");
const rf = await logCallOutcome(f, { outcome: "wrong_number", sellerSummary: "Wrong number" }, { operator: OP });
const fr = (await sql`SELECT outreach_status, wrong_number, invalid_contact, contactable, priority_queue FROM leads WHERE id = ${f}`)[0] as any;
ok("wrong_number log succeeded", rf.success && rf.suppressionApplied === true, rf.error || "");
ok("wrong_number flag = true", fr.wrong_number === true);
ok("wrong_number → invalid_contact = true", fr.invalid_contact === true);
ok("wrong_number → contactable = false", fr.contactable === false);
ok("wrong_number → status terminal wrong_number", fr.outreach_status === "wrong_number", fr.outreach_status);
ok("wrong_number → priority DEAD", fr.priority_queue === "DEAD", String(fr.priority_queue));
const fb = await viewAudit(f);
ok("wrong_number writes voice/outbound audit row", fb.some((r) => r.channel === "voice" && r.direction === "outbound" && r.status === "wrong_number"), JSON.stringify(fb[0]));

console.log("== 7. dnc → routes through handleOptOut + DNC flag + consent + refused outreach ==");
const g = await makeLead("CallOutcome DNC G");
const rg = await logCallOutcome(g, { outcome: "dnc", sellerSummary: "On DNC, do not call" }, { operator: OP });
const gr = (await sql`SELECT outreach_status, dnc_flag, opted_out, consent_recorded_at, priority_queue FROM leads WHERE id = ${g}`)[0] as any;
ok("dnc log succeeded (via handleOptOut)", rg.success && rg.suppressionApplied === true, rg.error || "");
ok("dnc → dnc_flag 'DNC'", gr.dnc_flag === "DNC", String(gr.dnc_flag));
ok("dnc → opted_out true (handleOptOut path)", gr.opted_out === true);
ok("dnc → consent_recorded_at set", gr.consent_recorded_at !== null);
ok("dnc → status terminal dnc", gr.outreach_status === "dnc", gr.outreach_status);
ok("dnc → priority DEAD", gr.priority_queue === "DEAD", String(gr.priority_queue));
const gConsent = await sql`SELECT granted FROM consent_records WHERE lead_id = ${g}`;
ok("dnc → consent record granted=false", (gConsent[0] as any)?.granted === false, JSON.stringify(gConsent));
// refused further outreach
const rg2 = await logCallOutcome(g, { outcome: "no_answer" }, { operator: OP });
ok("dnc → refuses further outcomes", !rg2.success && rg2.blockedTerminal === true, rg2.error || "");

console.log("== 8. still-contactable lead keeps working (answered path re-runnable) ==");
const h = await makeLead("CallOutcome Reusable H");
const rh1 = await logCallOutcome(h, { outcome: "voicemail", sellerSummary: "VM", nextAction: "retry call", nextActionDue: new Date(Date.now() + 86400000).toISOString().slice(0, 10) }, { operator: OP });
const rh2 = await logCallOutcome(h, { outcome: "answered", sellerSummary: "Picked up 2nd try" }, { operator: OP });
ok("non-terminal lead can log again (voicemail→answered)", rh1.success && rh2.success, `${rh1.error || ""} ${rh2.error || ""}`);

console.log("== 9. cleanup ==");
await cleanup();
const leftover = await sql`SELECT count(*)::int AS n FROM leads WHERE id = ANY(${createdLeads})`;
ok("all test leads removed", (leftover[0] as any).n === 0);
const leftoverAudit = await sql`SELECT count(*)::int AS n FROM outreach_audit_log WHERE lead_id = ANY(${createdLeads})`;
ok("all test audit rows removed", (leftoverAudit[0] as any).n === 0);
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
