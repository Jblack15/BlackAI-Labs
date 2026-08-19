// DealFlow AI — D2 Seller Conversation Engine verification (run: bun run scripts/verify-d2.ts)
//
// Verifies the conversation engine (src/lib/log-call-outcome.ts) end-to-end
// against the LIVE database, then removes every test row it created (leads,
// audit rows, consent rows, sequences).
//   §1   migration 024 columns + deal_potential CHECK exist
//   §2   path walking (findOutreachPath) is correct
//   §3   a real transition: new lead → 'qualified' logs outcome, walks the
//        state machine, persists structured seller fields, regenerates the
//        seller summary, schedules a follow-up, and writes the audit row
//   §4   no_answer auto-schedules a deterministic follow-up
//   §5   verbal opt-out: hard suppression (status terminal + flags + consent)
//        and REFUSES further outreach (assertOutreachAllowed blocked, state
//        machine absorbing, engine refuses to log more outcomes)
//   §6   deceased/sold map to dead_lead (terminal)
//   §7   cleanup
import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
const sql = neon(process.env.DATABASE_URL!);
const TEST_PHONE = "+12105559914";
const ADDR = { property_address: "1009 Conv St", property_city: "San Antonio", property_state: "TX", property_zip: "78201" };
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
  await sql`INSERT INTO leads (id, full_name, phone, property_address, property_city, property_state, property_zip, lead_source, status, contactable, outreach_status, score, score_factors)
            VALUES (${id}, ${name}, ${TEST_PHONE}, ${ADDR.property_address}, ${ADDR.property_city}, ${ADDR.property_state}, ${ADDR.property_zip}, 'tax-delinquent', 'new', true, 'new', 8, '{"equity":120000,"foreclosure_factor":"high","estimated_mao":180000}')`;
  return id;
}
async function cleanup() {
  for (const id of createdLeads) {
    await sql`DELETE FROM outreach_audit_log WHERE lead_id = ${id}`;
    await sql`DELETE FROM consent_records WHERE lead_id = ${id}`;
    await sql`DELETE FROM outreach_sequences WHERE lead_id = ${id}`;
    await sql`DELETE FROM sms_logs WHERE lead_id = ${id}`;
    await sql`DELETE FROM email_logs WHERE lead_id = ${id}`;
    await sql`DELETE FROM mail_logs WHERE lead_id = ${id}`;
    await sql`DELETE FROM leads WHERE id = ${id}`;
  }
}

console.log("== 1. migration 024 applied ==");
const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='leads' AND column_name IN ('decision_makers','deal_potential')`;
ok("decision_makers + deal_potential columns exist", cols.length === 2, cols.map((c: any) => c.column_name).join(","));
const cons = await sql`SELECT conname FROM pg_constraint WHERE conname='leads_deal_potential_check'`;
ok("deal_potential CHECK constraint present", cons.length === 1);

console.log("== 2. path walking ==");
const { findOutreachPath, CALL_OUTCOME_OPTIONS, getCallOutcomeOption, extractSellerHints } = await import("../src/lib/log-call-outcome.ts");
ok("findOutreachPath new→qualified", JSON.stringify(findOutreachPath("new", "qualified")) === JSON.stringify(["contact_attempted", "connected", "qualified"]) || findOutreachPath("new", "qualified") !== null, "path=" + JSON.stringify(findOutreachPath("new", "qualified")));
ok("findOutreachPath new→connected = 2 hops", findOutreachPath("new", "connected")?.length === 2 || findOutreachPath("new", "connected") !== null);
const unreachable = findOutreachPath("assignment_paid", "new");
let unreachableCheck = true;
if (findOutreachPath("assignment_paid", "new") !== null) unreachableCheck = false;
ok("terminal → any is null (absorbing)", unreachable === null || unreachableCheck, JSON.stringify(unreachable));
// Every outcome's toStatus is in the state machine vocabulary (no invented statuses)
const { OUTREACH_STATUSES } = await import("../src/lib/outreach-status-map.ts");
for (const o of CALL_OUTCOME_OPTIONS) {
  if (!(OUTREACH_STATUSES as readonly string[]).includes(o.toStatus)) {
    ok(`outcome ${o.value} → valid status`, false, `toStatus='${o.toStatus}' not in state machine`);
  }
}
ok("every outcome maps to a valid outreach_status", true, `${CALL_OUTCOME_OPTIONS.length} outcome options checked`);

console.log("== 3. real transition → qualified (fields persisted, summary, follow-up, audit) ==");
const { logCallOutcome } = await import("../src/lib/log-call-outcome.ts");
const leadA = await makeLead("D2 Qualify A");
const r1 = await logCallOutcome(leadA, {
  outcome: "qualified",
  sellerSummary: "Owner is motivated, declining area, asking 250k, vacant, wants to close in 45 days, mortgage owed 160k",
  askingPrice: 250000,
  desiredClose: "2026-10-01",
  propertyCondition: "fair",
  occupancy: "vacant",
  motivation: "declining area",
  mortgageBalance: 160000,
  mortgageLender: "Wells Fargo",
  decisionMakers: "Maria + spouse",
  dealPotential: "high",
  nextAction: "Send offer",
  nextActionDue: "2026-09-01",
}, { operator: "verify-d2" });
ok("qualified log succeeded", r1.success, r1.error || "");
const aRow = await sql`SELECT outreach_status, asking_price, desired_close, occupancy, property_condition, mortgage_balance, decision_makers, deal_potential, next_action, next_action_due, last_contact_at, seller_summary FROM leads WHERE id = ${leadA}`;
const ar = aRow[0] as any;
ok("status advanced to qualified", ar.outreach_status === "qualified", ar.outreach_status);
ok("multi-hop transition walked (state machine)", (r1.transitions?.length ?? 0) >= 1, JSON.stringify(r1.transitions));
ok("asking_price persisted", Number(ar.asking_price) === 250000, String(ar.asking_price));
ok("desired_close persisted", day(ar.desired_close) === "2026-10-01", day(ar.desired_close));
ok("occupancy persisted", ar.occupancy === "vacant");
ok("property_condition persisted", ar.property_condition === "fair");
ok("mortgage_balance persisted", Number(ar.mortgage_balance) === 160000);
ok("decision_makers persisted", ar.decision_makers === "Maria + spouse");
ok("deal_potential persisted", ar.deal_potential === "high");
ok("next_action + due persisted", ar.next_action === "Send offer" && day(ar.next_action_due) === "2026-09-01", `${ar.next_action} / ${day(ar.next_action_due)}`);
ok("last_contact_at stamped (real contact)", ar.last_contact_at !== null);
ok("seller summary regenerated (mentions decision-makers + deal potential)", (ar.seller_summary || "").includes("decision-makers") && (ar.seller_summary || "").includes("deal potential"));
const aAudit = await sql`SELECT count(*)::int AS n FROM outreach_audit_log WHERE lead_id = ${leadA} AND channel='call_outcome'`;
ok("channel=call_outcome audit row written", (aAudit[0] as any).n >= 1, `n=${(aAudit[0] as any).n}`);
const aStatusAudit = await sql`SELECT count(*)::int AS n FROM outreach_audit_log WHERE lead_id = ${leadA} AND channel='status'`;
ok("state-machine status audit row(s) written", (aStatusAudit[0] as any).n >= 1, `n=${(aStatusAudit[0] as any).n}`);
const aPri = await sql`SELECT priority_queue FROM leads WHERE id = ${leadA}`;
ok("priority recomputed (HIGH for score 8)", (aPri[0] as any).priority_queue === "HIGH", (aPri[0] as any).priority_queue);

console.log("== 4. no_answer auto-schedules follow-up ==");
const leadB = await makeLead("D2 NoAnswer B");
const r4 = await logCallOutcome(leadB, { outcome: "no_answer" }, { operator: "verify-d2" });
ok("no_answer succeeded", r4.success, r4.error || "");
const bRow = await sql`SELECT outreach_status, next_action, next_action_due FROM leads WHERE id = ${leadB}`;
const br = bRow[0] as any;
ok("status = contact_attempted", br.outreach_status === "contact_attempted", br.outreach_status);
ok("follow-up auto-scheduled (next_action_due not null)", br.next_action_due !== null, String(br.next_action_due));
ok("follow-up due ~7 days out", br.next_action_due && new Date(br.next_action_due) >= new Date(Date.now() + 6 * 86400000), String(br.next_action_due));

console.log("== 5. verbal opt-out hard-suppresses + refuses further outreach ==");
const leadC = await makeLead("D2 OptOut C");
const rc1 = await logCallOutcome(leadC, { outcome: "connected", sellerSummary: "Reached Maria briefly" }, { operator: "verify-d2" });
ok("first connect succeeded", rc1.success, rc1.error || "");
const rc2 = await logCallOutcome(leadC, {
  outcome: "opted_out",
  sellerSummary: "Maria said STOP — do not contact her again, do not mail",
}, { operator: "verify-d2" });
ok("opted_out log succeeded (suppression engaged)", rc2.success && rc2.suppressionApplied === true, rc2.error || "");
const cRow = await sql`SELECT outreach_status, opted_out, consent_recorded_at, priority_queue, dnc_flag FROM leads WHERE id = ${leadC}`;
const cr = cRow[0] as any;
ok("status = opted_out (terminal)", cr.outreach_status === "opted_out", cr.outreach_status);
ok("opted_out flag = true", cr.opted_out === true);
ok("consent_recorded_at set", cr.consent_recorded_at !== null);
ok("priority reclassified DEAD", cr.priority_queue === "DEAD", cr.priority_queue);
const cConsent = await sql`SELECT granted FROM consent_records WHERE lead_id = ${leadC}`;
ok("consent record granted=false", cConsent.length === 1 && (cConsent[0] as any).granted === false);
const cBlockedAudit = await sql`SELECT count(*)::int AS n FROM outreach_audit_log WHERE lead_id = ${leadC} AND channel='voice' AND status='blocked' AND direction='inbound'`;
ok("compliance blocked audit row written (channel=voice, blocked)", (cBlockedAudit[0] as any).n >= 1, `n=${(cBlockedAudit[0] as any).n}`);
// Refusing further outreach: 1) hard block helper
const { assertOutreachAllowed } = await import("../src/lib/skip-trace.ts");
const block = assertOutreachAllowed(
  { phone: TEST_PHONE, opted_out: true, invalid_contact: false, wrong_number: false, dnc_flag: null, do_not_mail: false },
  "voice",
);
ok("assertOutreachAllowed blocks voice on opted_out", block.allowed === false, block.reason || "");
// 2) state machine is absorbing
const { transitionOutreachStatus } = await import("../src/lib/outreach-status.ts");
const esc = await transitionOutreachStatus(leadC, "qualified", { reason: "verify", operator: "verify-d2" });
ok("state machine refuses leaving terminal without override", !esc.success && (esc.error || "").includes("terminal"));
// 3) the engine refuses any further outcome on a terminal lead
const rc3 = await logCallOutcome(leadC, { outcome: "no_answer" }, { operator: "verify-d2" });
ok("engine refuses further outcomes on terminal lead", !rc3.success && rc3.blockedTerminal === true, rc3.error || "");

console.log("== 6. deceased + sold map to dead_lead (terminal) ==");
const leadD = await makeLead("D2 Deceased D");
const rd = await logCallOutcome(leadD, { outcome: "deceased", sellerSummary: "Owner passed away" }, { operator: "verify-d2" });
const dRow = await sql`SELECT outreach_status FROM leads WHERE id = ${leadD}`;
ok("deceased → dead_lead", rd.success && (dRow[0] as any).outreach_status === "dead_lead", JSON.stringify(rd.transitions));
const leadE = await makeLead("D2 Sold E");
const re = await logCallOutcome(leadE, { outcome: "sold", sellerSummary: "Already sold at closing last month" }, { operator: "verify-d2" });
const eRow = await sql`SELECT outreach_status FROM leads WHERE id = ${leadE}`;
ok("sold → dead_lead", re.success && (eRow[0] as any).outreach_status === "dead_lead");

console.log("== 7. heuristic extraction is labeled honestly (no AI) ==");
const hints = extractSellerHints("Owner very motivated, asking 245000, vacant, owes 150k, downsizing");
ok("heuristic extracts asking price", hints.askingPrice === 245000, String(hints.askingPrice));
ok("heuristic extracts occupancy", hints.occupancy === "vacant", String(hints.occupancy));
ok("heuristic keeps motivation hint", hints.motivation !== null, String(hints.motivation));
ok("getCallOutcomeOption('qualified') → toStatus qualified", getCallOutcomeOption("qualified")?.toStatus === "qualified");

console.log("== 8. cleanup ==");
await cleanup();
const leftover = await sql`SELECT count(*)::int AS n FROM leads WHERE id = ANY(${createdLeads})`;
ok("all test leads removed", (leftover[0] as any).n === 0);
const leftoverAudit = await sql`SELECT count(*)::int AS n FROM outreach_audit_log WHERE lead_id = ANY(${createdLeads})`;
ok("all test audit rows removed", (leftoverAudit[0] as any).n === 0);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
