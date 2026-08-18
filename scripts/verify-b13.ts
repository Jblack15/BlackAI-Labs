// PH1-B13 verification — Premium queue + disposition.
// Rerunnable: reapplies migration 021 idempotently, asserts the schema
// (leads premium_lead + disposition columns + CHECK vocabularies + index),
// asserts exactly 13 premium_lead=true rows (backfilled from the research),
// spot-checks 3 researched dispositions (Wells, Gabriel Trust, Grau) against
// the seed, greps that NO flipper buyer from the buyer database is referenced
// in any premium disposition (honest no-fake-buyer-link), exercises the
// disposition editor save path (saveDisposition writes an outreach_audit_log
// row with channel='disposition'), verifies the CHECK constraint rejects an
// invalid status, and checks routes 200 after publish.
//
// DB is left pristine EVEN IF a section throws: the cleanup lives in a
// finally block — the temp disposition change is restored to its original
// values and the temp audit row is removed. The REAL premium flags and
// researched dispositions stay (they are real business data, not test data).
//
// Run:  bun run scripts/verify-b13.ts
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
const { PREMIUM_13_SEED, backfillPremium13, saveDisposition } = await import("../src/lib/premium-queue.ts");

/** Audit rows created before the script started are never touched. */
const baselineAudit = ((await sql`SELECT COALESCE(MAX(id), 0)::int AS n FROM outreach_audit_log`)[0] as { n: number }).n;
/** Capture the pre-test state of the lead we exercise, to restore exactly. */
let tempLeadId: string | null = null;
let tempOriginal: Record<string, unknown> | null = null;
let tempAuditId: number | null = null;

try {
  console.log("== 1. Migration 021 idempotent re-apply ==");
  const migration = readFileSync(join(process.cwd(), "src/db/migrations/021_premium_queue.sql"), "utf8");
  // Same statement splitting as scripts/apply-migration.ts (semicolon-aware,
  // dollar-quote aware; comment-prefixed chunks are passed through as-is so the
  // DROP CONSTRAINT IF EXISTS statement stays attached to its preceding comment).
  const stmts: string[] = [];
  let current = "";
  let inDollarQuote = false;
  for (let i = 0; i < migration.length; i++) {
    if (migration.slice(i, i + 2) === "$$") { inDollarQuote = !inDollarQuote; current += "$$"; i++; continue; }
    if (migration[i] === ";" && !inDollarQuote) { if (current.trim()) stmts.push(current.trim()); current = ""; }
    else current += migration[i];
  }
  if (current.trim()) stmts.push(current.trim());
  for (const stmt of stmts) {
    try {
      await sql.query(stmt);
    } catch (e) {
      ok(`migration statement applies: ${stmt.slice(0, 60)}...`, false, e instanceof Error ? e.message : String(e));
    }
  }
  ok("migration 021 re-applied (idempotent)", true, `${stmts.length} statement(s)`);

  console.log("== 2. Schema ==");
  const cols = (await sql`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns WHERE table_name = 'leads'
  `) as Array<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>;
  const colNames = new Set(cols.map((c) => c.column_name));
  for (const col of ["premium_lead", "disposition_status", "disposition_strategy", "target_buyer_type", "disposition_notes", "disposition_updated_at"]) {
    ok(`leads.${col} exists`, colNames.has(col), colNames.has(col) ? cols.find((c) => c.column_name === col)?.data_type : "missing");
  }
  const premiumCol = cols.find((c) => c.column_name === "premium_lead");
  ok("premium_lead is BOOLEAN NOT NULL DEFAULT false", premiumCol?.data_type === "boolean" && premiumCol.is_nullable === "NO" && (premiumCol.column_default ?? "").includes("false"), JSON.stringify(premiumCol));
  const statusChk = (await sql`
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'leads_disposition_status_check'
  `) as Array<{ def: string }>;
  ok("disposition_status CHECK vocabulary", statusChk.length === 1 && statusChk[0].def.includes("outreach_ready") && statusChk[0].def.includes("deprioritized"), statusChk[0]?.def ?? "no constraint");
  const targetChk = (await sql`
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'leads_target_buyer_type_check'
  `) as Array<{ def: string }>;
  ok("target_buyer_type CHECK vocabulary", targetChk.length === 1 && targetChk[0].def.includes("licensed_agent_jv") && targetChk[0].def.includes("land_assembler"), targetChk[0]?.def ?? "no constraint");
  const idx = (await sql`
    SELECT indexname FROM pg_indexes WHERE tablename = 'leads' AND indexname = 'idx_leads_premium_lead'
  `) as Array<{ indexname: string }>;
  ok("idx_leads_premium_lead index exists", idx.length === 1);

  console.log("== 3. Exactly 13 premium leads ==");
  const premiumCount = ((await sql`SELECT COUNT(*)::int AS n FROM leads WHERE premium_lead = true`)[0]) as { n: number };
  ok("premium_lead=true count is exactly 13", premiumCount.n === 13, `n=${premiumCount.n}`);
  const total = ((await sql`SELECT COUNT(*)::int AS n FROM leads`)[0]) as { n: number };
  ok("total lead count unchanged (7150)", total.n === 7150, `n=${total.n}`);

  console.log("== 4. Disposition prefills match research (spot-check Wells, Gabriel Trust, Grau) ==");
  const seedByApn = new Map(PREMIUM_13_SEED.map((s) => [s.apn, s]));
  const premiumRows = (await sql`
    SELECT id, apn, full_name, property_address, property_zip, disposition_status, disposition_strategy, target_buyer_type, disposition_notes
    FROM leads WHERE premium_lead = true
  `) as Array<Record<string, unknown>>;
  const byApn = new Map(premiumRows.map((r) => [String(r.apn), r]));
  const checks: Array<{ label: string; apn: string; expectStatus: string; expectTarget: string; expectStrategyIn: string[] }> = [
    { label: "Wells (R12, ACT NOW → outreach_ready, licensed-agent JV)", apn: "04847-219-0010", expectStatus: "outreach_ready", expectTarget: "licensed_agent_jv", expectStrategyIn: ["ACT NOW", "licensed-agent JV", "Stone Oak"] },
    { label: "Gabriel Trust (R9, ACT NOW → outreach_ready, licensed-agent JV)", apn: "05008-016-0410", expectStatus: "outreach_ready", expectTarget: "licensed_agent_jv", expectStrategyIn: ["ACT NOW", "licensed-agent JV", "6,765sf"] },
    { label: "Grau Trust (R11, ACT NOW → outreach_ready, licensed-agent JV)", apn: "04928-201-0470", expectStatus: "outreach_ready", expectTarget: "licensed_agent_jv", expectStrategyIn: ["ACT NOW", "licensed-agent JV", "Stone Oak"] },
  ];
  for (const c of checks) {
    const row = byApn.get(c.apn);
    if (!row) {
      ok(c.label, false, "APN not premium in DB");
      continue;
    }
    const strategy = String(row.disposition_strategy ?? "");
    ok(
      c.label,
      String(row.disposition_status) === c.expectStatus &&
        String(row.target_buyer_type) === c.expectTarget &&
        c.expectStrategyIn.every((s) => strategy.includes(s)),
      `status=${row.disposition_status} target=${row.target_buyer_type} strategy="${strategy.slice(0, 70)}"`,
    );
  }
  // Lien per export — the two real CSV values must be labeled in notes
  const gabrielNotes = String(byApn.get("05008-016-0410")?.disposition_notes ?? "");
  ok("Gabriel lien per export: $723 labeled in notes", gabrielNotes.includes("lien per export: $723"), gabrielNotes.slice(0, 80));
  const medranoNotes = String(byApn.get("03007-005-0140")?.disposition_notes ?? "");
  ok("Medrano lien per export: $1,321.49 labeled in notes", medranoNotes.includes("lien per export: $1,321.49"), medranoNotes.slice(0, 80));
  // Strategy count sanity: 3 outreach_ready / 8 hold / 2 deprioritized
  const byStatus: Record<string, number> = {};
  for (const r of premiumRows) {
    const s = String(r.disposition_status ?? "");
    byStatus[s] = (byStatus[s] ?? 0) + 1;
  }
  ok("status distribution 3 outreach_ready / 8 hold / 2 deprioritized", byStatus.outreach_ready === 3 && byStatus.hold === 8 && byStatus.deprioritized === 2, JSON.stringify(byStatus));

  console.log("== 5. Honesty grep — no flipper buyer referenced in premium dispositions ==");
  const buyers = (await sql`SELECT name FROM buyers`) as Array<{ name: string }>;
  ok("buyers table readable (22 flippers untouched)", buyers.length > 0, `n=${buyers.length}`);
  let flipperMentioned: string[] = [];
  for (const r of premiumRows) {
    const text = `${String(r.disposition_strategy ?? "")} ${String(r.disposition_notes ?? "")} ${String(r.target_buyer_type ?? "")}`;
    for (const b of buyers) {
      const name = String(b.name).trim();
      if (name.length > 2 && text.toLowerCase().includes(name.toLowerCase())) flipperMentioned.push(`${r.apn} → ${name}`);
    }
  }
  ok("no flipper buyer referenced in any premium disposition", flipperMentioned.length === 0, flipperMentioned.join("; "));
  // And: no contract references a premium lead (contracts carry the buyer link —
  // premium leads have no standard buyer fit, so they must have 0 contracts)
  const premiumWithContract = (await sql`
    SELECT COUNT(*)::int AS n FROM contracts c JOIN leads l ON l.id = c.lead_id WHERE l.premium_lead = true
  `) as { n: number }[];
  ok("no premium lead is referenced by a contract (no flipper buyer linked)", premiumWithContract[0].n === 0, `n=${premiumWithContract[0].n}`);

  console.log("== 6. Disposition editor save path (audit row) ==");
  const target = premiumRows[0] as Record<string, unknown>;
  tempLeadId = String(target.id);
  tempOriginal = {
    disposition_status: target.disposition_status,
    disposition_strategy: target.disposition_strategy,
    target_buyer_type: target.target_buyer_type,
    disposition_notes: target.disposition_notes,
  };
  // Save a TEMP change (clearly marked so it is never mistaken for research data)
  const res = await saveDisposition(tempLeadId, {
    dispositionStatus: "hold",
    dispositionStrategy: "TEMP-VERIFY-ONLY — verify-b13 test edit, restored by cleanup",
    targetBuyerType: "developer",
    dispositionNotes: "TEMP-VERIFY-ONLY — verify-b13 test edit, restored by cleanup",
  }, { operator: "verify-b13" });
  ok("saveDisposition succeeds on a premium lead", res.success === true, res.error ?? "");
  const auditRows = (await sql`
    SELECT id FROM outreach_audit_log
    WHERE id > ${baselineAudit} AND channel = 'disposition' AND lead_id = ${tempLeadId} AND operator = 'verify-b13'
  `) as Array<{ id: number }>;
  ok("save writes an outreach_audit_log row (channel='disposition')", auditRows.length === 1, `rows=${auditRows.length}`);
  tempAuditId = auditRows[0]?.id ?? null;
  const updated = (await sql`SELECT disposition_status, target_buyer_type, disposition_notes FROM leads WHERE id = ${tempLeadId}`)[0] as Record<string, unknown>;
  ok("disposition fields persisted", String(updated.disposition_status) === "hold" && String(updated.target_buyer_type) === "developer", `status=${updated.disposition_status} target=${updated.target_buyer_type}`);
  // Invalid vocabulary must be rejected
  const bad = await saveDisposition(tempLeadId, { dispositionStatus: "not_a_status" as never }, { operator: "verify-b13" });
  ok("invalid disposition_status rejected (CHECK + validation)", bad.success === false && (bad.error ?? "").includes("Invalid"), bad.error ?? "no error");
  // Restore the original researched values via the editor path (this writes a
  // second audit row — both temp rows are removed in cleanup)
  const restore = await saveDisposition(tempLeadId, {
    dispositionStatus: String(tempOriginal.disposition_status ?? "") as never,
    dispositionStrategy: String(tempOriginal.disposition_strategy ?? "") as never,
    targetBuyerType: String(tempOriginal.target_buyer_type ?? "") as never,
    dispositionNotes: String(tempOriginal.disposition_notes ?? "") as never,
  }, { operator: "verify-b13-restore" });
  ok("original researched disposition restored via editor path", restore.success === true, restore.error ?? "");
  const restored = (await sql`SELECT disposition_status, target_buyer_type, disposition_notes FROM leads WHERE id = ${tempLeadId}`)[0] as Record<string, unknown>;
  ok(
    "lead back to original researched values",
    String(restored.disposition_status) === String(tempOriginal.disposition_status) &&
      String(restored.target_buyer_type) === String(tempOriginal.target_buyer_type) &&
      String(restored.disposition_notes) === String(tempOriginal.disposition_notes),
    `status=${restored.disposition_status} target=${restored.target_buyer_type}`,
  );

  console.log("== 7. Backfill idempotency (re-run leaves exactly 13) ==");
  const re = await backfillPremium13({ operator: "verify-b13-backfill" });
  ok("backfill re-run matched 13, updated 13", re.matched === 13 && re.updated === 13, `matched=${re.matched} updated=${re.updated} unmatched=${re.unmatched.join(",")}`);
  const afterBackfill = ((await sql`SELECT COUNT(*)::int AS n FROM leads WHERE premium_lead = true`)[0]) as { n: number };
  ok("still exactly 13 premium after backfill re-run", afterBackfill.n === 13, `n=${afterBackfill.n}`);
} finally {
  // Cleanup: remove TEMP audit rows created by this script (backfill audit rows
  // are real business events and stay; the pre-test backfill audit row predates
  // baselineAudit only if verify ran after backfill — it is REAL so it stays).
  if (tempAuditId !== null) {
    await sql`DELETE FROM outreach_audit_log WHERE id = ${tempAuditId}`.catch(() => {});
  }
  await sql`DELETE FROM outreach_audit_log WHERE id > ${baselineAudit} AND operator IN ('verify-b13', 'verify-b13-restore') AND channel = 'disposition'`.catch(() => {});
  if (tempLeadId && tempOriginal) {
    await sql`
      UPDATE leads SET disposition_status = ${tempOriginal.disposition_status}, disposition_strategy = ${tempOriginal.disposition_strategy},
      target_buyer_type = ${tempOriginal.target_buyer_type}, disposition_notes = ${tempOriginal.disposition_notes}
      WHERE id = ${tempLeadId}
    `.catch(() => {});
  }
}

console.log("== 8. DB pristine ==");
const premiumFinal = ((await sql`SELECT COUNT(*)::int AS n FROM leads WHERE premium_lead = true`)[0]) as { n: number };
ok("13 premium flags remain (REAL data kept)", premiumFinal.n === 13, `n=${premiumFinal.n}`);
const tempAuditLeft = ((await sql`SELECT COUNT(*)::int AS n FROM outreach_audit_log WHERE channel = 'disposition' AND operator IN ('verify-b13', 'verify-b13-restore')`)[0]) as { n: number };
ok("no verify-created disposition audit rows remain", tempAuditLeft.n === 0, `n=${tempAuditLeft.n}`);
const leadTotal = ((await sql`SELECT COUNT(*)::int AS n FROM leads`)[0]) as { n: number };
ok("lead count unchanged (7150)", leadTotal.n === 7150, `n=${leadTotal.n}`);

console.log("== 9. UI route + SSR checks (run after publish) ==");
for (const route of ["/", "/dashboard", "/crm", "/settings"]) {
  try {
    const res = await fetch(`http://localhost:3000${route}`, { signal: AbortSignal.timeout(8000) });
    ok(`GET ${route}`, res.status === 200, `status ${res.status}`);
  } catch {
    ok(`GET ${route}`, false, "server unreachable — run after publish");
  }
}
try {
  const html = await (await fetch("http://localhost:3000/dashboard", { signal: AbortSignal.timeout(8000) })).text();
  ok("SSR /dashboard renders the Premium Queue panel", html.includes("Premium Queue"), `len=${html.length}`);
} catch {
  ok("SSR /dashboard renders the Premium Queue panel", false, "server unreachable — run after publish");
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
