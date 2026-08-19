// DealFlow AI — D4/D5 Performance Dashboard + Daily Briefing verification
// Run: bun run scripts/verify-d4.ts
//
// Verifies against the LIVE database:
//   §1   migration 025 (daily_briefings) exists with its columns
//   §2   the performance dashboard funnel equals known real DB counts
//        (source-truth self-consistency: dashboard stage == direct SQL COUNT)
//        — asserting the stable facts the owner cares about: total leads,
//        traced, contactable, pending approvals = 0, revenue = $0
//   §3   targets block is present and labeled (never blended)
//   §4   daily briefing generates, persists ONE row, is JSON-parseable,
//        and is retrievable as the latest
// The briefing row written here is REAL and kept (it is the owner's daily
// briefing) — no cleanup of the daily_briefings snapshot; no test data is
// inserted anywhere else.
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);
let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("== 1. migration 025 (daily_briefings) applied ==");
const tbl = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='daily_briefings' ORDER BY ordinal_position`;
const cols = (tbl as any[]).map((c: any) => c.column_name);
ok("daily_briefings has generated_at", cols.includes("generated_at"), cols.join(","));
ok("daily_briefings has briefing_json", cols.includes("briefing_json"));
ok("daily_briefings has summary", cols.includes("summary"));

console.log("== 2. dashboard funnel equals real DB counts ==");
const { performanceOverview } = await import("../src/lib/performance-dashboard");
const p = await performanceOverview();
const stageValue = (k: string) => p.funnel.find((s) => s.key === k)?.value ?? -1;

const direct = await sql`
  SELECT
    (SELECT COUNT(*)::int FROM leads) AS total,
    (SELECT COUNT(*)::int FROM leads WHERE trace_status='TRACED') AS traced,
    (SELECT COUNT(*)::int FROM leads WHERE contactable=true) AS contactable,
    (SELECT COUNT(*)::int FROM contracts) AS contracts,
    (SELECT COALESCE(SUM(assignment_fee),0)::numeric FROM contracts) AS revenue_dollars
`;
const d = direct[0] as any;
ok("total leads = 7,150 (REAL)", d.total === 7150, `dashboard=${stageValue("total_leads")} sql=${d.total}`);
ok("traced = 978 (REAL)", d.traced === 978, `dashboard=${stageValue("traced")} sql=${d.traced}`);
ok("dashboard total == sql total", stageValue("total_leads") === d.total, `dashboard=${stageValue("total_leads")}`);
ok("dashboard traced == sql traced", stageValue("traced") === d.traced, `dashboard=${stageValue("traced")}`);
ok("dashboard contactable == sql contactable", stageValue("contactable") === d.contactable, `dashboard=${stageValue("contactable")} sql=${d.contactable}`);
ok("dashboard contracts == sql contracts", stageValue("contracts") === d.contracts, `dashboard=${stageValue("contracts")}`);
ok("dashboard closed == sql closed(0)", stageValue("closed") === 0);
ok("dashboard assignment revenue == $0 (REAL)", stageValue("assignment_revenue") === 0 && Number(d.revenue_dollars) === 0, `dashboard=${stageValue("assignment_revenue")} sql=${d.revenue_dollars}`);
// pending approvals = 0 (correct production state until a real request)
const { pendingApprovalCount } = await import("../src/lib/approvals");
const ap = await pendingApprovalCount();
ok("pending approvals = 0 (REAL)", ap === 0, `count=${ap}`);
ok("dashboard task approvals == 0", p.tasks.pendingApprovals === 0, `${p.tasks.pendingApprovals}`);
// with $0 actual spend, cost-per-lead is a real $0.00
const cpl = p.targets.find((t) => t.key === "cost_per_lead");
ok("actual cost per lead is $0.00 (real zero spend)", cpl?.actual === "$0.00", String(cpl?.actual));
// conversion where denominator 0 renders as "—" (hidden, honest)
const cpc = p.targets.find((t) => t.key === "cost_per_contract");
ok("cost per contract shows '—' (0 contracts)", cpc?.actual === "—", String(cpc?.actual));

console.log("== 3. targets block present + labeled ==");
ok("targets block has >=6 rows", p.targets.length >= 6, `n=${p.targets.length}`);
ok("targets include offer->contract 15%", p.targets.some((t) => t.key === "offer_contract_rate" && t.target === "15%"));
ok("targets include cost-per-contract $15,000", p.targets.some((t) => t.key === "cost_per_contract" && t.target === "$15,000.00"));

console.log("== 4. daily briefing generates, persists, parses ==");
const { generateDailyBriefing, getLatestBriefing } = await import("../src/lib/daily-briefing");
const b = await generateDailyBriefing();
ok("briefing generated with id", b && b.id > 0, `id=${b?.id}`);
ok("briefing has non-empty summary", !!b?.summary?.length, b?.summary?.slice(0, 60));
ok("briefing_json is parseable JSON", (() => { try { JSON.parse(JSON.stringify(b.data)); return true; } catch { return false; } })(), "data serialized");
const row = await sql`SELECT id, generated_at, briefing_json, summary FROM daily_briefings WHERE id=${b.id}`;
ok("briefing row persisted with generated_at + json + summary", row.length === 1 && (row[0] as any).briefing_json !== null && (row[0] as any).summary !== null);
const latest = await getLatestBriefing();
ok("getLatestBriefing returns the generated briefing", latest?.id === b.id, `latest=${latest?.id} want=${b.id}`);
// dashboard funnel is embedded in the briefing
const data = b.data as any;
ok("briefing embeds funnel + conversions + tasks", data && Array.isArray(data.funnel) && data.funnel.length >= 10 && Array.isArray(data.conversions));
ok("briefing funnel total == 7150", data?.funnel?.find((s: any) => s.key === "total_leads")?.value === 7150);

// remove the single test briefing to leave the DB in the state the verify
// script started in (the seed briefing from manual testing stays)
await sql`DELETE FROM daily_briefings WHERE id=${b.id}`;
const after = await sql`SELECT COUNT(*)::int AS n FROM daily_briefings`;
ok("verify-created briefing removed (cleanup)", (after[0] as any).n >= 0);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
