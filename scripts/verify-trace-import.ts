// DealFlow AI — Verify Trace-CSV Import (rerunnable)
//
// Asserts, against the LIVE database, that the PropStream Connect trace
// import landed correctly and honestly:
//   1. leads with a phone > 0 (expect the pilot's clean-callable count)
//   2. leads.contactable=true count > 0
//   3. trace_status='TRACED' count > 0
//   4. DNC-flagged imported rows are contactable=false (never stored callable)
//   5. idempotency — re-running the importer changes nothing (phoneFilledRows=0)
//   6. the one-row audit summary exists (channel='trace_import')
//   7. skip_trace_jobs has the COMPLETED row and id=5 carries the SUPERSEDED note
//
// Run from /home/team/shared/site:
//   bun run scripts/verify-trace-import.ts
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { runTraceImport, TRACE_LIST_NAME } from "./import-trace-csv";

const sql: NeonQueryFunction<false, false> = neon(process.env.DATABASE_URL!);

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, extra?: string): void {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

async function main() {
  console.log("verify-trace-import: asserting live DB state after trace-CSV import\n");

  // ---- 1. phones + 2. contactable + 3. TRACED --------------------------
  const [phone, contactable, traced, dncBad] = await Promise.all([
    sql`SELECT count(*)::int AS n FROM leads WHERE phone IS NOT NULL AND btrim(phone) <> ''`,
    sql`SELECT count(*)::int AS n FROM leads WHERE contactable = true`,
    sql`SELECT count(*)::int AS n FROM leads WHERE trace_status = 'TRACED'`,
    // DNC-flagged rows that came from this import must NOT be contactable
    sql`SELECT count(*)::int AS n FROM leads
        WHERE trace_source = 'propstream_connect_export'
          AND dnc_flag IS NOT NULL AND btrim(dnc_flag) <> ''
          AND contactable = true`,
  ]);
  const phoneN = phone[0]?.n ?? 0;
  const contactableN = contactable[0]?.n ?? 0;
  const tracedN = traced[0]?.n ?? 0;
  const dncBadN = dncBad[0]?.n ?? 0;

  assert(`leads with a phone > 0 (got ${phoneN}, expect ≥ 600)`, phoneN >= 600, `phoneN=${phoneN}`);
  assert(`leads contactable=true > 0 (got ${contactableN})`, contactableN > 0, `contactableN=${contactableN}`);
  assert(`leads trace_status='TRACED' > 0 (got ${tracedN})`, tracedN > 0, `tracedN=${tracedN}`);
  assert(
    `DNC-flagged imported rows are NOT contactable (got ${dncBadN} violations)`,
    dncBadN === 0,
    `expected 0 DNC-flagged callable rows, got ${dncBadN}`,
  );

  // ---- 5. idempotency: re-run changes nothing --------------------------
  const before = { phone: phoneN, contactable: contactableN, traced: tracedN };
  const rerun = await runTraceImport(undefined, { audit: false, job: false });
  const [afterPhone, afterContact, afterTraced] = await Promise.all([
    sql`SELECT count(*)::int AS n FROM leads WHERE phone IS NOT NULL AND btrim(phone) <> ''`,
    sql`SELECT count(*)::int AS n FROM leads WHERE contactable = true`,
    sql`SELECT count(*)::int AS n FROM leads WHERE trace_status = 'TRACED'`,
  ]);
  assert(
    `idempotent re-run writes NO new phone rows (phoneFilledRows=${rerun.phoneFilledRows})`,
    rerun.phoneFilledRows === 0 && rerun.emailFilledRows === 0,
    `phoneFilledRows=${rerun.phoneFilledRows}, emailFilledRows=${rerun.emailFilledRows}`,
  );
  assert(
    `idempotent re-run leaves phone/contactable/TRACED counts unchanged`,
    afterPhone[0]?.n === before.phone && afterContact[0]?.n === before.contactable && afterTraced[0]?.n === before.traced,
    `before(${before.phone},${before.contactable},${before.traced}) after(${afterPhone[0]?.n},${afterContact[0]?.n},${afterTraced[0]?.n})`,
  );
  assert(`import parsed matched rows with phones (matched=${rerun.matched}, primaryChosen=${rerun.primaryChosen})`, rerun.matched > 0 && rerun.primaryChosen >= 600, JSON.stringify(rerun));

  // ---- 6. audit summary row exists --------------------------------------
  const audit = await sql`SELECT count(*)::int AS n FROM outreach_audit_log
      WHERE channel = 'trace_import' AND status = 'completed' AND operator = 'import-trace-csv'`;
  assert(`outreach_audit_log has a 'trace_import' summary row (got ${audit[0]?.n})`, (audit[0]?.n ?? 0) >= 1);

  // ---- 7. completed job + superseded STALLED note -----------------------
  const completed = await sql`SELECT count(*)::int AS n FROM skip_trace_jobs
      WHERE status = 'COMPLETED' AND list_name = ${TRACE_LIST_NAME}`;
  assert(`skip_trace_jobs has a COMPLETED row for '${TRACE_LIST_NAME}' (got ${completed[0]?.n})`, (completed[0]?.n ?? 0) >= 1);
  const stalled = await sql`SELECT error_message FROM skip_trace_jobs WHERE id = 5 AND status = 'STALLED'`;
  const errMsg = stalled[0]?.error_message ?? "";
  assert(`skip_trace_jobs id=5 (STALLED) carries the SUPERSEDED note`, errMsg.includes("SUPERSEDED"), `id=5 error_message: ${errMsg.slice(-120)}`);

  console.log(
    `\n  phoneN=${phoneN} contactableN=${contactableN} tracedN=${tracedN} dncBadN=${dncBadN}\n` +
      `  re-run summary: matched=${rerun.matched} primaryChosen=${rerun.primaryChosen} dncOnlySkipped=${rerun.dncOnlySkipped} noApnSkipped=${rerun.noApnSkipped} emailFilledRows=${rerun.emailFilledRows}\n`,
  );
  console.log(`RESULT: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error("verify ERR", e);
  process.exit(1);
});
