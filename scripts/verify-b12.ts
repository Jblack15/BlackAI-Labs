// PH1-B12 verification — Title/closing workflow (contract → title → closed →
// assignment paid).
// Rerunnable: reapplies migration 020 idempotently, asserts the schema
// (contracts closing columns + status CHECK + closing_checklist_items + FK
// cascade), then exercises the whole closing lifecycle on REAL data:
//   * createContract on a REAL scored lead (top score) — writes the contract
//     row linked to lead + campaign, seeds the standard 8-step checklist
//     (done=false), writes the contract audit row,
//   * B10b revenue auto-activation — campaignEconomics() reports
//     revenueTrackable and real per-campaign revenue from the temp contract
//     (the revenue note disappears once campaign_id exists),
//   * computeClosingProfit — NULL fee → net "—" (honest), with fee → number,
//   * checklist toggle — completed_at + operator written, cleared on reopen,
//   * dueAttention — overdue checklist step + expected close within 7 days,
//   * recordAssignmentPaid — BLOCKED without an approved 'assignment'
//     approval (pending does not unlock), ALLOWED after the owner approves;
//     contract → 'closed', close_date set, lead walked along the closing arc
//     (contract_signed → buyer_matched → title → closed → assignment_paid)
//     through the B6 state machine,
//   * routes 200 after publish.
// DB is left pristine EVEN IF a section throws: the cleanup lives in a
// finally block — temp contracts (and their checklists), temp approval
// requests and every audit row the script created are removed; the real lead
// is restored to its original outreach_status; lead count stays 7150.
//
// Run:  bun run scripts/verify-b12.ts
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = neon(process.env.DATABASE_URL!);
let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
const {
  createContract,
  updateClosingChecklistItem,
  getClosingChecklist,
  computeClosingProfit,
  dueAttention,
  recordAssignmentPaid,
  listContracts,
  getContractDetail,
  requestAssignmentApproval,
  STANDARD_CLOSING_CHECKLIST,
} = await import("../src/lib/closing.ts");
const { requestApproval, decideApproval, hasApproval } = await import("../src/lib/approvals.ts");
const { transitionOutreachStatus } = await import("../src/lib/outreach-status.ts");
const { campaignEconomics } = await import("../src/lib/campaign-economics.ts");

/** Audit rows created before the script started are never touched. */
const baselineAudit = ((await sql`SELECT COALESCE(MAX(id), 0)::int AS n FROM outreach_audit_log`)[0] as { n: number }).n;
let leadId: string | null = null;
let contractId = "";
let contractBId = "";
let reqAssignId = "";
let originalStatus = "";
let leadRowBefore: { outreach_status: string; outreach_status_updated_at: Date | null; updated_at: Date | null } | null = null;

function todayIso(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split("T")[0];
}

console.log("== 1. migration 020 idempotent (reapply) ==");
const migrationSource = readFileSync(join(process.cwd(), "src/db/migrations/020_closing_workflow.sql"), "utf8");
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
ok("migration 020 re-applies cleanly (all statements)", stmts.length > 0, `${stmts.length} statements`);
ok("migration has NO checklist seed inserts (seeding is per-contract via lib)", !/INSERT INTO closing_checklist_items/i.test(migrationSource), "");
ok("migration comment has no semicolons inside comments", !/--[^\n]*;/.test(migrationSource), "");

console.log("== 2. schema — contracts closing columns ==");
const cols = (await sql`
  SELECT column_name, is_nullable, column_default, data_type
  FROM information_schema.columns WHERE table_name = 'contracts' ORDER BY ordinal_position
`) as Array<{ column_name: string; is_nullable: string; column_default: string | null; data_type: string }>;
const colMap = new Map(cols.map((c) => [c.column_name, c]));
ok("campaign_id UUID NULL REFERENCES campaigns", colMap.get("campaign_id")?.data_type === "uuid" && colMap.get("campaign_id")?.is_nullable === "YES", "");
ok("lead_id UUID NULL (reused from 003)", colMap.get("lead_id")?.data_type === "uuid" && colMap.get("lead_id")?.is_nullable === "YES", "");
ok("assignment_fee_cents INT NULL", colMap.get("assignment_fee_cents")?.data_type === "integer" && colMap.get("assignment_fee_cents")?.is_nullable === "YES", "");
ok("title_company / escrow_account TEXT NULL", colMap.get("title_company")?.data_type === "text" && colMap.get("escrow_account")?.data_type === "text", "");
ok("close_date / expected_close_date DATE NULL", colMap.get("close_date")?.data_type === "date" && colMap.get("expected_close_date")?.data_type === "date", "");
ok("closing_deadlines JSONB NULL", colMap.get("closing_deadlines")?.data_type === "jsonb" && colMap.get("closing_deadlines")?.is_nullable === "YES", "");
ok("status default 'new' (was 'draft')", colMap.get("status")?.column_default?.includes("new") === true, `default=${colMap.get("status")?.column_default}`);
const checks = (await sql`
  SELECT conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint WHERE conrelid = 'contracts'::regclass
`) as Array<{ conname: string; def: string }>;
const statusCheck = checks.find((c) => c.conname === "contracts_status_check")?.def ?? "";
ok("status CHECK pins the closing vocabulary", ["new", "title_open", "title_clear", "docs_sent", "docs_signed", "funded", "closed", "cancelled"].every((s) => statusCheck.includes(s)), "");
const fks = checks.map((c) => c.def).join(" ");
ok("campaign_id FK references campaigns", fks.includes("REFERENCES campaigns(id)"), "");

console.log("== 3. schema — closing_checklist_items ==");
const clCols = (await sql`
  SELECT column_name, is_nullable, column_default, data_type
  FROM information_schema.columns WHERE table_name = 'closing_checklist_items' ORDER BY ordinal_position
`) as Array<{ column_name: string; is_nullable: string; column_default: string | null; data_type: string }>;
const clMap = new Map(clCols.map((c) => [c.column_name, c]));
ok("id UUID PK", clMap.get("id")?.data_type === "uuid", "");
ok("contract_id UUID NOT NULL", clMap.get("contract_id")?.data_type === "uuid" && clMap.get("contract_id")?.is_nullable === "NO", "");
ok("label TEXT NOT NULL", clMap.get("label")?.is_nullable === "NO", "");
ok("done BOOLEAN NOT NULL default false", clMap.get("done")?.is_nullable === "NO" && clMap.get("done")?.column_default?.includes("false") === true, `default=${clMap.get("done")?.column_default}`);
ok("due_date DATE NULL", clMap.get("due_date")?.data_type === "date" && clMap.get("due_date")?.is_nullable === "YES", "");
ok("completed_at TIMESTAMPTZ NULL", clMap.get("completed_at")?.data_type === "timestamp with time zone", "");
ok("operator TEXT NULL", clMap.get("operator")?.data_type === "text", "");
const clChecks = (await sql`
  SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'closing_checklist_items'::regclass
`) as Array<{ def: string }>;
ok("FK ON DELETE CASCADE to contracts", clChecks.some((c) => c.def.includes("REFERENCES contracts(id) ON DELETE CASCADE")), "");
ok("table starts empty", ((await sql`SELECT COUNT(*)::int AS n FROM closing_checklist_items`)[0] as { n: number }).n === 0, "");

// ═══════════════════════════════════════════════════════════════════════════
// DB exercise — cleanup runs in the finally block no matter what happens here
// ═══════════════════════════════════════════════════════════════════════════
try {
  console.log("== 4. createContract on a REAL scored lead ==");
  const scored = (await sql`
    SELECT id, outreach_status, score FROM leads
    WHERE score IS NOT NULL ORDER BY score DESC, id ASC LIMIT 1
  `) as Array<{ id: string; outreach_status: string; score: number }>;
  ok("a real scored lead exists", scored.length === 1, scored[0] ? `score=${scored[0].score}` : "none");
  if (!scored.length) throw new Error("no scored lead");
  leadId = String(scored[0].id);
  originalStatus = scored[0].outreach_status;
  leadRowBefore = (await sql`
    SELECT outreach_status, outreach_status_updated_at, updated_at FROM leads WHERE id = ${leadId}
  `)[0] as { outreach_status: string; outreach_status_updated_at: Date | null; updated_at: Date | null };

  // Drive the real lead to contract_signed through the B6 state machine with
  // the B11 gates respected (offer + contract approvals requested + decided).
  async function driveToContractSigned(id: string): Promise<boolean> {
    const chain = [
      "contactable", "contact_attempted", "connected", "qualified", "offer", "negotiation", "contract_sent", "contract_signed",
    ];
    const cur = ((await sql`SELECT outreach_status FROM leads WHERE id = ${id}`)[0] as { outreach_status: string }).outreach_status;
    const start = chain.indexOf(cur);
    if (start === chain.length - 1) return true; // already contract_signed
    for (let i = start + 1; i < chain.length; i++) {
      const next = chain[i];
      const gate =
        next === "offer" || next === "negotiation"
          ? { kind: "offer" as const, refId: id }
          : next === "contract_signed"
            ? { kind: "contract" as const, refId: id }
            : undefined;
      const res = await transitionOutreachStatus(id, next, {
        reason: "verify-b12 drive to contract_signed",
        operator: "verify-b12",
        requireApproval: gate,
      });
      if (!res.success) {
        if (gate) {
          const req = await requestApproval({ kind: gate.kind, refType: "lead", refId: id, operator: "verify-b12", details: "verify-b12 temp gate approval" });
          if (!req.success) return false;
          const dec = await decideApproval(String(req.id), { approved: true, note: "verify-b12 approved temp gate", operator: "verify-b12" });
          if (!dec.success) return false;
          const retry = await transitionOutreachStatus(id, next, { reason: "verify-b12 drive to contract_signed", operator: "verify-b12", requireApproval: gate });
          if (!retry.success) return false;
        } else {
          return false;
        }
      }
    }
    return true;
  }
  ok("drive real lead to contract_signed (B11 gates respected)", await driveToContractSigned(leadId), "");

  const campRows = (await sql`SELECT id, name FROM campaigns ORDER BY created_at ASC LIMIT 1`) as Array<{ id: string; name: string }>;
  const pilotCampaignId = String(campRows[0].id);
  ok("pilot campaign found for link test", campRows.length === 1 && campRows[0].name.includes("Pilot"), campRows[0]?.name ?? "");

  const created = await createContract({
    leadId,
    campaignId: pilotCampaignId,
    contractType: "assignment",
    assignmentFeeCents: 1_500_000,
    earnestMoneyCents: 100_000,
    expectedCloseDate: todayIso(30),
    titleCompany: "verify-b12 Title Co",
    escrowAccount: "ESCROW-VERIFY-1",
    closingDeadlines: { titleObjectionDeadline: todayIso(24), financingDeadline: todayIso(20), closeDate: todayIso(30) },
    operator: "verify-b12",
    createChecklist: true,
  });
  ok("createContract writes the contract row", created.success === true && typeof created.id === "string", JSON.stringify(created));
  contractId = created.success ? created.id : "";
  const cRow = (await sql`
    SELECT lead_id, campaign_id, status, assignment_fee_cents, assignment_fee, expected_close_date,
           title_company, escrow_account, closing_deadlines, contract_type
    FROM contracts WHERE id = ${contractId}
  `)[0] as {
    lead_id: string; campaign_id: string; status: string; assignment_fee_cents: number; assignment_fee: string;
    expected_close_date: Date; title_company: string; escrow_account: string; closing_deadlines: unknown; contract_type: string;
  };
  ok("links lead + campaign", String(cRow.lead_id) === leadId && String(cRow.campaign_id) === pilotCampaignId, "");
  ok("status 'new' + contract_type 'assignment'", cRow.status === "new" && cRow.contract_type === "assignment", cRow.status);
  ok("assignment_fee_cents = 1500000 + dollar mirror 15000", Number(cRow.assignment_fee_cents) === 1_500_000 && Number(cRow.assignment_fee) === 15000, `fee=${cRow.assignment_fee_cents} mirror=${cRow.assignment_fee}`);
  ok("expected_close_date written (echo to closing_date)", new Date(cRow.expected_close_date).toISOString().slice(0, 10) === todayIso(30), "");
  ok("title/escrow/deadlines written", cRow.title_company === "verify-b12 Title Co" && cRow.escrow_account === "ESCROW-VERIFY-1" && cRow.closing_deadlines !== null, "");
  const checklist = await getClosingChecklist(contractId);
  ok("standard checklist seeded (8 steps, all done=false)", checklist.length === STANDARD_CLOSING_CHECKLIST.length && checklist.every((i) => !i.done), `n=${checklist.length}`);
  ok("checklist labels match the industry-standard steps", STANDARD_CLOSING_CHECKLIST.every((s, i) => checklist[i]?.label === s.label), "");
  ok("checklist due dates derived from expected close", checklist[0].dueDate === todayIso(30 - 21) && checklist[7].dueDate === todayIso(30), `first=${checklist[0].dueDate} last=${checklist[7].dueDate}`);
  const auditCreated = (await sql`
    SELECT COUNT(*)::int AS n FROM outreach_audit_log WHERE channel = 'contract' AND lead_id = ${leadId} AND reason LIKE '%verify-b12%' AND id > ${baselineAudit}
  `)[0] as { n: number };
  ok("contract creation audit row written (channel=contract, marker in reason)", auditCreated.n >= 1, `n=${auditCreated.n}`);
  const list = await listContracts();
  ok("listContracts includes the temp contract with campaign name + address", list.some((c) => c.id === contractId && c.campaignName !== null && c.address !== null), "");

  console.log("== 5. B10b revenue auto-activation (campaign_id present) ==");
  const eco = await campaignEconomics({ qualifiedPlus: 0, offerPlus: 0, contractSignedPlus: 0 });
  ok("revenueTrackable = true (column detected → note gone)", eco.revenueTrackable === true, "");
  const pilot = eco.campaigns.find((c) => c.id === pilotCampaignId);
  ok("pilot campaign revenueCents = 1500000 from the temp contract", pilot?.revenueCents === 1_500_000, `rev=${pilot?.revenueCents}`);
  ok("pilot campaign revenueNote is null (B10b note disappears)", pilot?.revenueNote === null, String(pilot?.revenueNote));

  console.log("== 6. computeClosingProfit — NULL-fee honesty + with-fee math ==");
  const profitA = await computeClosingProfit(contractId);
  ok("with fee: net = 1500000 − 0", profitA.success === true && profitA.netCents === 1_500_000 && profitA.costsCents === 0, JSON.stringify(profitA));
  const createdB = await createContract({
    leadId,
    contractType: "assignment",
    operator: "verify-b12",
    createChecklist: false,
  });
  ok("second temp contract created WITHOUT a fee", createdB.success === true, JSON.stringify(createdB));
  contractBId = createdB.success ? createdB.id : "";
  const profitB = await computeClosingProfit(contractBId);
  ok("NULL fee → net is null (profit renders '—', never $0)", profitB.success === true && profitB.assignmentFeeCents === null && profitB.netCents === null, JSON.stringify(profitB));
  await sql`UPDATE contracts SET assignment_fee_cents = 1_650_000, assignment_fee = 16500 WHERE id = ${contractBId}`;
  const profitB2 = await computeClosingProfit(contractBId);
  ok("with fee: net = 1650000 (after fee recorded)", profitB2.success === true && profitB2.netCents === 1_650_000, JSON.stringify(profitB2));

  console.log("== 7. checklist toggle — completed_at + operator, audit-logged ==");
  const firstItem = checklist[0];
  const toggle1 = await updateClosingChecklistItem(firstItem.id, true, "verify-b12");
  ok("toggle done=true succeeds", toggle1.success === true, toggle1.success ? "" : (toggle1 as { error: string }).error);
  const itemAfter = ((await sql`
    SELECT done, completed_at, operator FROM closing_checklist_items WHERE id = ${firstItem.id}
  `)[0]) as { done: boolean; completed_at: Date | null; operator: string | null };
  ok("completed_at + operator written", itemAfter.done === true && itemAfter.completed_at !== null && itemAfter.operator === "verify-b12", "");
  const audToggle = (await sql`
    SELECT COUNT(*)::int AS n FROM outreach_audit_log WHERE channel = 'contract' AND reason LIKE '%marked done%' AND id > ${baselineAudit}
  `)[0] as { n: number };
  ok("checklist toggle audit row written", audToggle.n === 1, `n=${audToggle.n}`);
  const toggle2 = await updateClosingChecklistItem(firstItem.id, false, "verify-b12");
  const itemAfter2 = ((await sql`
    SELECT done, completed_at FROM closing_checklist_items WHERE id = ${firstItem.id}
  `)[0]) as { done: boolean; completed_at: Date | null };
  ok("reopen clears completed_at", toggle2.success === true && itemAfter2.done === false && itemAfter2.completed_at === null, "");

  console.log("== 8. dueAttention — overdue checklist + close within 7 days ==");
  const attEmpty = await dueAttention(contractId);
  ok("no attention on a healthy contract (close in 30d, nothing overdue)", attEmpty.success === true && attEmpty.attention.length === 0, JSON.stringify(attEmpty));
  await sql`UPDATE closing_checklist_items SET due_date = CURRENT_DATE - 1 WHERE id = ${firstItem.id}`;
  await sql`UPDATE contracts SET expected_close_date = CURRENT_DATE + 3 WHERE id = ${contractId}`;
  const att = await dueAttention(contractId);
  ok("dueAttention flags overdue checklist step", att.success === true && att.attention.some((a) => a.kind === "checklist"), JSON.stringify(att));
  ok("dueAttention flags expected close within 7 days", att.success === true && att.attention.some((a) => a.kind === "close_date"), JSON.stringify(att));

  console.log("== 9. recordAssignmentPaid — B11 approval gate ==");
  const blocked = await recordAssignmentPaid(contractId, 1_500_000, "verify-b12");
  ok("BLOCKED without assignment approval", blocked.success === false && blocked.error!.includes("requires approved assignment approval"), blocked.error ?? "");
  const stAfterBlock = ((await sql`SELECT status, assignment_fee_cents FROM contracts WHERE id = ${contractId}`)[0]) as { status: string; assignment_fee_cents: number };
  ok("contract unchanged after block (status 'new', fee untouched)", stAfterBlock.status === "new" && Number(stAfterBlock.assignment_fee_cents) === 1_500_000, stAfterBlock.status);
  const reqAssign = await requestAssignmentApproval(contractId, 1_500_000, "verify-b12");
  ok("requestAssignmentApproval creates pending request (dup-guarded)", reqAssign.success === true && typeof reqAssign.id === "string", JSON.stringify(reqAssign));
  reqAssignId = reqAssign.success ? String(reqAssign.id) : "";
  const pendingBlocked = await recordAssignmentPaid(contractId, 1_500_000, "verify-b12");
  ok("PENDING request does NOT unlock the gate", pendingBlocked.success === false, pendingBlocked.error ?? "");
  const hasApprovalBefore = await hasApproval("assignment", "contract", contractId, ["approved"]);
  ok("hasApproval('assignment','contract') false while pending", hasApprovalBefore === false, "");
  const dec = await decideApproval(reqAssignId, { approved: true, note: "verify-b12 approved assignment", operator: "verify-b12" });
  ok("owner approves the assignment request", dec.success === true && dec.status === "approved", JSON.stringify(dec));
  const paid = await recordAssignmentPaid(contractId, 1_500_000, "verify-b12");
  ok("recordAssignmentPaid ALLOWED after approval", paid.success === true && paid.amountCents === 1_500_000 && paid.leadStatus === "assignment_paid", JSON.stringify(paid));
  const cAfter = ((await sql`
    SELECT status, close_date, assignment_fee_cents FROM contracts WHERE id = ${contractId}
  `)[0]) as { status: string; close_date: Date; assignment_fee_cents: number };
  ok("contract → 'closed', close_date = today, fee recorded", cAfter.status === "closed" && new Date(cAfter.close_date).toISOString().slice(0, 10) === todayIso(0) && Number(cAfter.assignment_fee_cents) === 1_500_000, `${cAfter.status} ${String(cAfter.close_date)}`);
  const leadAfter = ((await sql`SELECT outreach_status FROM leads WHERE id = ${leadId}`)[0]) as { outreach_status: string };
  ok("lead walked along the closing arc → assignment_paid", leadAfter.outreach_status === "assignment_paid", leadAfter.outreach_status);
  const walkAudits = (await sql`
    SELECT COUNT(*)::int AS n FROM outreach_audit_log WHERE channel = 'status' AND lead_id = ${leadId} AND reason LIKE '%verify-b12%' AND id > ${baselineAudit}
  `)[0] as { n: number };
  ok("closing-arc walk audit rows written (4 transitions)", walkAudits.n >= 4, `n=${walkAudits.n}`);
  const detail = await getContractDetail(contractId);
  ok("getContractDetail reflects closed + approved + no pending", detail !== null && detail.status === "closed" && detail.assignmentApproved === true && detail.assignmentPending === false, "");
  ok("getContractDetail profit matches (1500000)", detail?.profit.netCents === 1_500_000, "");
} catch (err) {
  console.error("DB exercise failed:", err instanceof Error ? err.message : err);
  fail++;
} finally {
  // ── Cleanup: remove everything this script created; restore the real lead ──
  console.log("== 11. DB left pristine ==");
  if (reqAssignId) await sql`DELETE FROM approval_requests WHERE id = ${reqAssignId}`;
  if (leadId) {
    await sql`DELETE FROM approval_requests WHERE ref_type = 'lead' AND ref_id = ${leadId} AND details LIKE 'verify-b12%'`;
  }
  await sql`DELETE FROM outreach_audit_log WHERE channel = 'contract' AND reason LIKE '%verify-b12%' AND id > ${baselineAudit}`;
  if (leadId) {
    await sql`DELETE FROM outreach_audit_log WHERE channel = 'status' AND lead_id = ${leadId} AND reason LIKE '%verify-b12%' AND id > ${baselineAudit}`;
  }
  await sql`DELETE FROM outreach_audit_log WHERE channel = 'approval' AND id > ${baselineAudit} AND reason LIKE 'Approval %'`;
  await sql`DELETE FROM contracts WHERE id IN (${contractId || "00000000-0000-0000-0000-000000000000"}, ${contractBId || "00000000-0000-0000-0000-000000000000"})`;
  if (leadId && leadRowBefore) {
    await sql`UPDATE leads SET outreach_status = ${originalStatus}, outreach_status_updated_at = ${leadRowBefore.outreach_status_updated_at}, updated_at = ${leadRowBefore.updated_at} WHERE id = ${leadId}`;
  }
  const contractCount = ((await sql`SELECT COUNT(*)::int AS n FROM contracts`)[0]) as { n: number };
  ok("contracts back to 0", contractCount.n === 0, `n=${contractCount.n}`);
  const checklistCount = ((await sql`SELECT COUNT(*)::int AS n FROM closing_checklist_items`)[0]) as { n: number };
  ok("checklist rows gone (cascade)", checklistCount.n === 0, `n=${checklistCount.n}`);
  const approvalCount = ((await sql`SELECT COUNT(*)::int AS n FROM approval_requests`)[0]) as { n: number };
  ok("approval_requests empty (0 rows)", approvalCount.n === 0, `n=${approvalCount.n}`);
  const auditLeft = ((await sql`
    SELECT COUNT(*)::int AS n FROM outreach_audit_log WHERE id > ${baselineAudit} AND channel IN ('approval', 'contract', 'status')
  `)[0]) as { n: number };
  ok("no verify-created audit rows remain", auditLeft.n === 0, `n=${auditLeft.n}`);
  if (leadId) {
    const leadRestored = ((await sql`SELECT outreach_status FROM leads WHERE id = ${leadId}`)[0]) as { outreach_status: string };
    ok("real lead restored to original outreach_status", leadRestored.outreach_status === originalStatus, `${leadRestored.outreach_status} (was ${originalStatus})`);
  }
  const leadTotal = ((await sql`SELECT COUNT(*)::int AS n FROM leads`)[0]) as { n: number };
  ok("lead count unchanged (7150 real leads intact)", leadTotal.n === 7150, `n=${leadTotal.n}`);
  const ecoAfter = await campaignEconomics({ qualifiedPlus: 0, offerPlus: 0, contractSignedPlus: 0 });
  const firstCamp = (await sql`SELECT id FROM campaigns ORDER BY created_at ASC LIMIT 1`)[0] as { id: string };
  const pilotAfter = ecoAfter.campaigns.find((c) => c.id === String(firstCamp.id));
  ok("pilot campaign revenue back to 0 after cleanup", pilotAfter?.revenueCents === 0, `rev=${pilotAfter?.revenueCents}`);
}

console.log("== 10. UI route + SSR checks (run after publish) ==");
for (const route of ["/", "/contracts", "/approvals", "/crm", "/command-center"]) {
  try {
    const res = await fetch(`http://localhost:3000${route}`, { signal: AbortSignal.timeout(8000) });
    ok(`GET ${route}`, res.status === 200, `status ${res.status}`);
  } catch {
    ok(`GET ${route}`, false, "server unreachable — run after publish");
  }
}
try {
  const html = await (await fetch("http://localhost:3000/contracts", { signal: AbortSignal.timeout(8000) })).text();
  ok("SSR /contracts renders the closing workflow shell", html.includes("Closing Workflow") && html.includes("Contract Builder") && html.includes("assignment paid"), `len=${html.length}`);
} catch {
  ok("SSR /contracts renders the closing workflow shell", false, "server unreachable — run after publish");
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
