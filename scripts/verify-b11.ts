// PH1-B11 verification — Human approval gates (owner approve/reject dashboard
// + enforcement in the state machine + audit trail).
// Rerunnable: reapplies migration 019 idempotently, asserts the schema
// (checks, defaults, index), exercises the full request → decide → enforce
// flow on TEMP leads/campaign spend (created and deleted in-script), proves
// the state-machine gate blocks offer without approval and allows after,
// proves the contract_signed gate, the spend-over-cap gate and the campaign
// status gate, greps the wiring, and ends with UI route checks (run after
// publish — server on :3000).
//
// DB is left pristine: temp leads, all approval_requests rows, all
// channel='approval' audit rows, and any temp cost entries are removed before
// the script finishes. Real seeded data (campaigns, planned entries, 7150
// leads) is untouched.
//
// Run:  bun run scripts/verify-b11.ts
import { neon } from "@neondatabase/serverless";
import { readFileSync, readFileSync as read } from "node:fs";
import { join } from "node:path";
const sql = neon(process.env.DATABASE_URL!);
let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
const {
  requestApproval,
  decideApproval,
  pendingApprovals,
  approvalHistory,
  hasApproval,
  pendingApprovalCount,
  leadApprovalStatus,
} = await import("../src/lib/approvals.ts");
const { transitionOutreachStatus } = await import("../src/lib/outreach-status.ts");
const { recordCampaignSpend, updateCampaignStatus } = await import("../src/lib/campaign-economics.ts");

const TEMP_MARKER = "B11 verify temp";
/** Create a throwaway lead (real row, unique marker). */
async function makeTempLead(): Promise<string> {
  const ts = Date.now();
  const rows = (await sql`
    INSERT INTO leads (full_name, property_address, property_city, property_state, property_zip)
    VALUES (${`${TEMP_MARKER} ${ts}`}, ${`${TEMP_MARKER} ${ts} St`}, 'San Antonio', 'TX', '78207')
    RETURNING id
  `) as Array<{ id: string }>;
  return String(rows[0].id);
}
/** Drive a lead to a given outreach status through the state machine. */
async function driveTo(leadId: string, target: string, opts: Record<string, unknown> = {}): Promise<boolean> {
  const chain: Record<string, string> = {
    new: "contactable",
    contactable: "contact_attempted",
    contact_attempted: "connected",
    connected: "qualified",
    qualified: "offer",
    offer: "negotiation",
    negotiation: "contract_sent",
    contract_sent: "contract_signed",
  };
  let cur = "new";
  while (cur !== target) {
    const next = chain[cur] ?? (target as string);
    const res = await transitionOutreachStatus(leadId, next, {
      reason: "verify-b11 chain",
      operator: "verify-b11",
      ...opts,
    });
    if (!res.success) return res.error ?? false;
    cur = next;
  }
  return true;
}

console.log("== 1. migration 019 idempotent (reapply) ==");
const migrationSource = readFileSync(join(process.cwd(), "src/db/migrations/019_approval_requests.sql"), "utf8");
function splitSqlStatements(source: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inDollar = false;
  for (let i = 0; i < source.length; i++) {
    if (source.slice(i, i + 2) === "$$") { inDollar = !inDollar; cur += "$$"; i++; continue; }
    if (source[i] === ";" && !inDollar) { if (cur.trim()) out.push(cur.trim()); cur = ""; }
    else cur += source[i];
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const stmts = splitSqlStatements(migrationSource);
for (const st of stmts) {
  try { await sql.query(st); } catch (e) { ok(`reapply statement`, false, e instanceof Error ? e.message : "err"); }
}
ok("migration 019 re-applies cleanly (all statements)", stmts.length > 0, `${stmts.length} statements`);
ok("migration has NO seed inserts (0 requests is correct)", !/INSERT INTO approval_requests/i.test(migrationSource), "");
ok("migration comment has no semicolons inside comments", !/--[^\n]*;/.test(migrationSource.replace(/\n/g, "\n")), "");

console.log("== 2. schema — approval_requests ==");
const cols = (await sql`
  SELECT column_name, is_nullable, column_default, data_type
  FROM information_schema.columns WHERE table_name = 'approval_requests' ORDER BY ordinal_position
`) as Array<{ column_name: string; is_nullable: string; column_default: string | null; data_type: string }>;
const colMap = new Map(cols.map((c) => [c.column_name, c]));
ok("id UUID PK", colMap.get("id")?.data_type === "uuid", "");
ok("kind TEXT NOT NULL", colMap.get("kind")?.is_nullable === "NO" && colMap.get("kind")?.data_type === "text", "");
ok("status TEXT NOT NULL default 'pending'", colMap.get("status")?.is_nullable === "NO" && colMap.get("status")?.column_default?.includes("pending") === true, `default=${colMap.get("status")?.column_default}`);
ok("ref_type TEXT NOT NULL", colMap.get("ref_type")?.is_nullable === "NO", "");
ok("ref_id UUID NULL", colMap.get("ref_id")?.is_nullable === "YES" && colMap.get("ref_id")?.data_type === "uuid", "");
ok("amount_cents INT NULL", colMap.get("amount_cents")?.is_nullable === "YES" && colMap.get("amount_cents")?.data_type === "integer", "");
ok("requested_by TEXT NOT NULL", colMap.get("requested_by")?.is_nullable === "NO", "");
ok("created_at TIMESTAMPTZ NOT NULL default now()", colMap.get("created_at")?.column_default?.includes("now()") === true, "");
ok("decided_at / decided_by / decision_note present", ["decided_at", "decided_by", "decision_note"].every((c) => colMap.has(c)), "");
// CHECK constraints
const checks = (await sql`
  SELECT conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint WHERE conrelid = 'approval_requests'::regclass
`) as Array<{ conname: string; def: string }>;
const checkDefs = checks.map((c) => c.def).join(" ");
ok("kind CHECK includes all 6 kinds", ["offer", "contract", "assignment", "spend", "campaign_change", "sensitive_communication"].every((k) => checkDefs.includes(k)), "");
ok("status CHECK includes pending/approved/rejected/cancelled", ["pending", "approved", "rejected", "cancelled"].every((s) => checkDefs.includes(s)), "");
ok("ref_type CHECK includes lead/contract/campaign/none", ["lead", "contract", "campaign", "none"].every((t) => checkDefs.includes(t)), "");
const idx = (await sql`
  SELECT indexname FROM pg_indexes WHERE tablename = 'approval_requests' AND indexname = 'idx_approval_requests_status_kind'
`) as Array<{ indexname: string }>;
ok("index (status, kind) exists", idx.length === 1, "");
ok("table starts empty (0 requests — correct production state)", ((await sql`SELECT COUNT(*)::int AS n FROM approval_requests`)[0] as { n: number }).n === 0, "");

console.log("== 3. request → decide flow writes audit rows ==");
const leadA = await makeTempLead();
const reqA = await requestApproval({ kind: "offer", refType: "lead", refId: leadA, amountCents: 150000, details: "verify-b11 offer request", operator: "verify-b11" });
ok("requestApproval creates pending request", reqA.success === true && typeof reqA.id === "string", JSON.stringify(reqA));
const audReq = (await sql`
  SELECT COUNT(*)::int AS n FROM outreach_audit_log WHERE channel = 'approval' AND lead_id = ${leadA} AND status = 'requested'
`)[0] as { n: number };
ok("audit row written on create (channel=approval, status=requested)", audReq.n === 1, `n=${audReq.n}`);
const pendCount = await pendingApprovalCount();
ok("pendingApprovalCount reflects the request", pendCount >= 1, `count=${pendCount}`);
const pend = await pendingApprovals();
ok("pendingApprovals lists it with ref label + amount", pend.some((p) => p.id === reqA.id && p.kind === "offer" && p.amountCents === 150000 && p.refType === "lead"), "");
const decA = await decideApproval(reqA.id!, { approved: true, note: "verify-b11 approved", operator: "owner" });
ok("decideApproval approves (only pending can be decided)", decA.success === true && decA.status === "approved", JSON.stringify(decA));
const decDup = await decideApproval(reqA.id!, { approved: true, note: "double", operator: "owner" });
ok("deciding twice is rejected", decDup.success === false, decDup.error ?? "");
const audDec = (await sql`
  SELECT COUNT(*)::int AS n FROM outreach_audit_log WHERE channel = 'approval' AND lead_id = ${leadA} AND status = 'approved'
`)[0] as { n: number };
ok("audit row written on decide (status=approved)", audDec.n === 1, `n=${audDec.n}`);
const hist = await approvalHistory(10);
ok("approvalHistory includes the decided row", hist.some((h) => h.id === reqA.id && h.status === "approved" && h.decidedBy === "owner"), "");
const hasA = await hasApproval("offer", "lead", leadA);
ok("hasApproval('offer','lead') true after approval", hasA === true, "");
const leadStatus = await leadApprovalStatus(leadA);
ok("leadApprovalStatus reports approved offer", leadStatus.some((s) => s.kind === "offer" && s.approved && !s.pending), JSON.stringify(leadStatus));

console.log("== 4. dup guard — no two PENDING same kind+ref ==");
const leadB = await makeTempLead();
const reqB1 = await requestApproval({ kind: "contract", refType: "lead", refId: leadB, operator: "verify-b11" });
const reqB2 = await requestApproval({ kind: "contract", refType: "lead", refId: leadB, operator: "verify-b11" });
ok("second pending request for same kind+ref returns duplicate", reqB1.success && reqB2.success && reqB2.duplicate === true && reqB1.id === reqB2.id, JSON.stringify(reqB2));
const pendContract = (await sql`
  SELECT COUNT(*)::int AS n FROM approval_requests WHERE kind = 'contract' AND ref_type = 'lead' AND ref_id = ${leadB} AND status = 'pending'
`)[0] as { n: number };
ok("only ONE pending row exists", pendContract.n === 1, `n=${pendContract.n}`);

console.log("== 5. state-machine enforcement: offer blocked without approval, allowed after ==");
const leadC = await makeTempLead();
ok("drive lead to qualified", await driveTo(leadC, "qualified"), "");
const blockedOffer = await transitionOutreachStatus(leadC, "offer", { reason: "verify", operator: "verify-b11", requireApproval: { kind: "offer", refId: leadC } });
ok("offer transition BLOCKED without approval", blockedOffer.success === false && blockedOffer.error!.includes("requires approved approval_request"), blockedOffer.error ?? "");
const stAfterBlock = (await sql`SELECT outreach_status FROM leads WHERE id = ${leadC}`)[0] as { outreach_status: string };
ok("lead still qualified after block (nothing written)", stAfterBlock.outreach_status === "qualified", stAfterBlock.outreach_status);
const reqC = await requestApproval({ kind: "offer", refType: "lead", refId: leadC, amountCents: 120000, details: "verify-b11 offer", operator: "verify-b11" });
await decideApproval(reqC.id!, { approved: true, note: "owner approved offer", operator: "owner" });
const allowedOffer = await transitionOutreachStatus(leadC, "offer", { reason: "verify", operator: "verify-b11", requireApproval: { kind: "offer", refId: leadC } });
ok("offer transition ALLOWED after approval", allowedOffer.success === true && allowedOffer.to === "offer", JSON.stringify(allowedOffer));
// negotiation is gated by the SAME approved offer request (rev 18: negotiation beyond approved params)
const negOk = await transitionOutreachStatus(leadC, "negotiation", { reason: "verify", operator: "verify-b11", requireApproval: { kind: "offer", refId: leadC } });
ok("negotiation allowed with approved offer request (same gate)", negOk.success === true && negOk.to === "negotiation", JSON.stringify(negOk));
// contract_signed requires an approved CONTRACT request
const blockedContract = await transitionOutreachStatus(leadC, "contract_signed", { reason: "verify", operator: "verify-b11", requireApproval: { kind: "contract", refId: leadC } });
ok("contract_signed BLOCKED without contract approval", blockedContract.success === false && blockedContract.error!.includes("requires approved approval_request"), blockedContract.error ?? "");
const reqC2 = await requestApproval({ kind: "contract", refType: "lead", refId: leadC, operator: "verify-b11" });
await decideApproval(reqC2.id!, { approved: true, note: "owner approved contract", operator: "owner" });
const allowedContract = await transitionOutreachStatus(leadC, "contract_signed", { reason: "verify", operator: "verify-b11", requireApproval: { kind: "contract", refId: leadC } });
ok("contract_signed ALLOWED after contract approval", allowedContract.success === true && allowedContract.to === "contract_signed", JSON.stringify(allowedContract));
// pending (not yet decided) request must NOT unlock the gate
const leadD = await makeTempLead();
await driveTo(leadD, "qualified");
await requestApproval({ kind: "offer", refType: "lead", refId: leadD, operator: "verify-b11" });
const pendingNotEnough = await transitionOutreachStatus(leadD, "offer", { reason: "verify", operator: "verify-b11", requireApproval: { kind: "offer", refId: leadD } });
ok("pending (undecided) request does NOT unlock the gate", pendingNotEnough.success === false, pendingNotEnough.error ?? "");

console.log("== 6. spend gate: over-cap blocked without approved spend, allowed with ==");
const campRows = (await sql`SELECT id, spend_cap_cents FROM campaigns ORDER BY created_at ASC LIMIT 1`) as Array<{ id: string; spend_cap_cents: number | null }>;
const campId = String(campRows[0].id);
const cap = campRows[0].spend_cap_cents;
ok("pilot campaign has a spend cap (60000)", cap === 60000, `cap=${cap}`);
const spend1 = await recordCampaignSpend(campId, 10000, "verify-b11", { note: "verify-b11 temp row" });
ok("spend within cap allowed WITHOUT approval", spend1.success === true, spend1.error ?? "");
const spend2 = await recordCampaignSpend(campId, 60000, "verify-b11", { note: "verify-b11 temp row" });
ok("spend OVER cap BLOCKED without approval", spend2.success === false && spend2.error!.includes("requires approved approval_request"), spend2.error ?? "");
const noCostAdded = (await sql`
  SELECT COUNT(*)::int AS n FROM campaign_cost_entries WHERE note LIKE 'verify-b11 temp row%' AND amount_cents = 60000
`)[0] as { n: number };
ok("blocked spend wrote NO cost entry", noCostAdded.n === 0, `n=${noCostAdded.n}`);
const reqSpend = await requestApproval({ kind: "spend", refType: "campaign", refId: campId, amountCents: 60000, details: "verify-b11 over-cap spend", operator: "verify-b11" });
const dupSpend = await requestApproval({ kind: "spend", refType: "campaign", refId: campId, amountCents: 1, details: "dup", operator: "verify-b11" });
ok("dup guard also works for campaign refs", dupSpend.success === true && dupSpend.duplicate === true, JSON.stringify(dupSpend));
await decideApproval(reqSpend.id!, { approved: true, note: "owner approved over-cap spend", operator: "owner" });
const spend3 = await recordCampaignSpend(campId, 60000, "verify-b11", { note: "verify-b11 temp row" });
ok("spend OVER cap allowed after approval", spend3.success === true, spend3.error ?? "");

console.log("== 7. campaign status gate ==");
const beforeStatus = (await sql`SELECT status FROM campaigns WHERE id = ${campId}`)[0] as { status: string };
const changeBlocked = await updateCampaignStatus(campId, "paused", "verify-b11");
ok("status change BLOCKED without campaign_change approval", changeBlocked.success === false && changeBlocked.error!.includes("requires approved approval_request"), changeBlocked.error ?? "");
const stStill = (await sql`SELECT status FROM campaigns WHERE id = ${campId}`)[0] as { status: string };
ok("campaign status unchanged after block", stStill.status === beforeStatus.status, stStill.status);
const reqChange = await requestApproval({ kind: "campaign_change", refType: "campaign", refId: campId, details: "verify-b11 pause", operator: "verify-b11" });
await decideApproval(reqChange.id!, { approved: true, note: "owner approved pause", operator: "owner" });
const changeOk = await updateCampaignStatus(campId, "paused", "verify-b11");
ok("status change allowed after campaign_change approval", changeOk.success === true, changeOk.error ?? "");
await updateCampaignStatus(campId, "planned", "verify-b11");
const stRestored = (await sql`SELECT status FROM campaigns WHERE id = ${campId}`)[0] as { status: string };
ok("campaign restored to planned (cleanup)", stRestored.status === "planned", stRestored.status);
// budget/cap edit also gated
const reqChange2 = await requestApproval({ kind: "campaign_change", refType: "campaign", refId: campId, details: "verify-b11 cap edit", operator: "verify-b11" });
await decideApproval(reqChange2.id!, { approved: true, note: "owner approved cap edit", operator: "owner" });
const capEdit = await updateCampaignStatus(campId, "planned", "verify-b11", { spendCapCents: 70000 });
ok("budget/cap edit allowed with campaign_change approval", capEdit.success === true, capEdit.error ?? "");
await sql`UPDATE campaigns SET spend_cap_cents = ${cap} WHERE id = ${campId}`;
const capRestored = (await sql`SELECT spend_cap_cents FROM campaigns WHERE id = ${campId}`)[0] as { spend_cap_cents: number | null };
ok("spend cap restored to original (cleanup)", capRestored.spend_cap_cents === cap, `cap=${capRestored.spend_cap_cents}`);

console.log("== 8. wiring + honesty greps ==");
const SRC = join(process.cwd(), "src");
const crmSrc = read(join(SRC, "routes/crm.tsx"), "utf8");
const statusSrc = read(join(SRC, "lib/outreach-status.ts"), "utf8");
const mapSrc = read(join(SRC, "lib/outreach-status-map.ts"), "utf8");
const approvalsRoute = read(join(SRC, "routes/approvals.tsx"), "utf8");
const headerSrc = read(join(SRC, "components/Header.tsx"), "utf8");
const ecoSrc = read(join(SRC, "lib/campaign-economics.ts"), "utf8");
ok("CRM setOutreachStatus wires the gate (offer/negotiation/contract_signed)", crmSrc.includes("requireApproval: gate") && crmSrc.includes('kind: "offer" as const') && crmSrc.includes('kind: "contract" as const'), "");
ok("CRM modal has Request approval button", crmSrc.includes("Request approval") && crmSrc.includes("handleRequestApproval"), "");
ok("CRM modal routes owner to /approvals after request", crmSrc.includes('window.location.href = "/approvals"'), "");
ok("state-machine header documents the gate", statusSrc.includes("requireApproval") && statusSrc.includes("requires approved"), "");
ok("state-map header documents offer/negotiation/contract_signed gates", mapSrc.includes("HUMAN APPROVAL GATES") && mapSrc.includes("contract_signed"), "");
ok("approvals route has honest empty state", approvalsRoute.includes("No approval requests — nothing pending"), "");
ok("approvals route has approve/reject + note", approvalsRoute.includes("Approve") && approvalsRoute.includes("Reject") && approvalsRoute.includes("Decision note"), "");
ok("approvals route lists kind descriptions incl. sensitive_communication", approvalsRoute.includes("sensitive_communication"), "");
ok("header has Approvals nav + pending badge", headerSrc.includes("Approvals") && headerSrc.includes("ApprovalBadge"), "");
ok("campaign lib documents the enforcement points", ecoSrc.includes("requires approved approval_request") && ecoSrc.includes("recordCampaignSpend") && ecoSrc.includes("updateCampaignStatus"), "");
ok("no fake approvals seeded anywhere", !/INSERT INTO approval_requests/i.test(migrationSource) && !/seedApproval|approval.*INSERT/i.test(crmSrc), "");

console.log("== 9. DB left pristine ==");
const tempLeadIds = (await sql`SELECT id FROM leads WHERE full_name LIKE ${`${TEMP_MARKER} %`}`) as Array<{ id: string }>;
for (const r of tempLeadIds) {
  await sql`DELETE FROM outreach_audit_log WHERE lead_id = ${r.id}`;
  await sql`DELETE FROM approval_requests WHERE ref_type = 'lead' AND ref_id = ${r.id}`;
  await sql`DELETE FROM leads WHERE id = ${r.id}`;
}
await sql`DELETE FROM approval_requests`; // only verify-created rows (table was empty before)
await sql`DELETE FROM outreach_audit_log WHERE channel = 'approval'`;
await sql`DELETE FROM campaign_cost_entries WHERE note LIKE 'verify-b11 temp row%'`;
const aCount = (await sql`SELECT COUNT(*)::int AS n FROM approval_requests`)[0] as { n: number };
const audCount = (await sql`SELECT COUNT(*)::int AS n FROM outreach_audit_log WHERE channel = 'approval'`)[0] as { n: number };
const leadCount = (await sql`SELECT COUNT(*)::int AS n FROM leads WHERE full_name LIKE ${`${TEMP_MARKER} %`}`)[0] as { n: number };
const costCount = (await sql`SELECT COUNT(*)::int AS n FROM campaign_cost_entries WHERE note LIKE 'verify-b11 temp row%'`)[0] as { n: number };
const actSum = (await sql`SELECT COALESCE(SUM(amount_cents),0)::int AS n FROM campaign_cost_entries WHERE kind = 'actual'`)[0] as { n: number };
ok("approval_requests empty (0 rows)", aCount.n === 0, `n=${aCount.n}`);
ok("channel='approval' audit rows removed", audCount.n === 0, `n=${audCount.n}`);
ok("temp leads removed", leadCount.n === 0, `n=${leadCount.n}`);
ok("temp cost entries removed", costCount.n === 0, `n=${costCount.n}`);
ok("actual spend back to 0", actSum.n === 0, `actual=${actSum.n}`);
const leadTotal = (await sql`SELECT COUNT(*)::int AS n FROM leads`)[0] as { n: number };
ok("lead count unchanged (7150 real leads intact)", leadTotal.n === 7150, `n=${leadTotal.n}`);

console.log("== 10. UI routes 200 (run after publish) ==");
for (const route of ["/", "/approvals", "/crm", "/command-center", "/settings"]) {
  try {
    const res = await fetch(`http://localhost:3000${route}`, { signal: AbortSignal.timeout(8000) });
    ok(`GET ${route}`, res.status === 200, `status ${res.status}`);
  } catch {
    ok(`GET ${route}`, false, "server unreachable — run after publish");
  }
}
try {
  const html = await (await fetch("http://localhost:3000/approvals", { signal: AbortSignal.timeout(8000) })).text();
  ok("SSR /approvals renders the shell", html.includes("Approvals") && html.includes("approval queue"), `len=${html.length}`);
} catch {
  ok("SSR /approvals renders the shell", false, "server unreachable — run after publish");
}
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
