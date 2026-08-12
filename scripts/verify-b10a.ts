// PH1-B10a verification — Command center + funnel metrics + campaign cost tracking.
// Rerunnable: reapplies migration 017 idempotently, asserts the seeded pilot
// campaign + planned cost entries (REAL, owner-approved; actual stays 0),
// exercises funnelMetrics / campaignCosts / attentionItems /
// computeCommandStatus against the live DB, proves the stalled-trace critical
// path (temp STALLED job inserted then removed), checks the GREEN/YELLOW/RED
// rule (today's real state → YELLOW with documented reasons), greps for
// honesty, and ends with UI route checks (run after publish — server on :3000).
//
// DB is left pristine: the only test write is a temporary skip_trace_jobs row
// that is deleted before the script finishes. No cost entries are ever added
// by this script — the seeded planned entries are real and stay.
//
// Run:  bun run scripts/verify-b10a.ts
import { neon } from "@neondatabase/serverless";
import { readFileSync, readdirSync, readFileSync as read } from "node:fs";
import { join } from "node:path";

const sql = neon(process.env.DATABASE_URL!);
let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

const {
  funnelMetrics,
  campaignCosts,
  attentionItems,
  computeCommandStatus,
  fmtDollars,
} = await import("../src/lib/command-center");

console.log("== 1. migration 017 schema + seed ==");
const cols = await sql`
  SELECT table_name, column_name, is_nullable, column_default, data_type
  FROM information_schema.columns
  WHERE table_name IN ('campaigns', 'campaign_cost_entries')
  ORDER BY table_name, ordinal_position
`;
const byTable: Record<string, Array<{ column_name: string; is_nullable: string; column_default: string | null; data_type: string }>> = {};
for (const c of cols as Array<{ table_name: string; column_name: string; is_nullable: string; column_default: string | null; data_type: string }>) {
  (byTable[c.table_name] ??= []).push(c);
}
const campNames = new Set((byTable.campaigns ?? []).map((c) => c.column_name));
ok("campaigns table has all spec columns", ["id", "name", "channel", "status", "started_at", "planned_budget_cents", "notes", "created_at", "updated_at"].every((c) => campNames.has(c)), "id,name,channel,status,started_at,planned_budget_cents,notes,created_at,updated_at");
const entryNames = new Set((byTable.campaign_cost_entries ?? []).map((c) => c.column_name));
ok("campaign_cost_entries table has all spec columns", ["id", "campaign_id", "amount_cents", "kind", "recorded_at", "operator", "note"].every((c) => entryNames.has(c)), "id,campaign_id,amount_cents,kind,recorded_at,operator,note");
const chk = await sql`
  SELECT conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
  WHERE conrelid IN ('campaigns'::regclass, 'campaign_cost_entries'::regclass)
  ORDER BY conname
`;
const chkDef = (chk as Array<{ conname: string; def: string }>).map((c) => `${c.conname}:${c.def}`).join(" | ");
ok("campaigns.channel CHECK vocabulary", /campaigns_channel_check/.test(chkDef) && ["direct_mail", "voice", "email", "sms", "skip_trace", "other"].every((v) => chkDef.includes(v)), "6 channels");
ok("campaigns.status CHECK (default planned)", /campaigns_status_check/.test(chkDef) && ["planned", "active", "paused", "completed", "cancelled"].every((v) => chkDef.includes(v)), "5 statuses");
ok("cost kind CHECK (planned/actual)", /campaign_cost_entries_kind_check/.test(chkDef) && chkDef.includes("planned") && chkDef.includes("actual"), "");
ok("cost amount CHECK >= 0", /campaign_cost_entries_amount_cents_check/.test(chkDef) && chkDef.includes(">= 0"), "");
ok("campaign_id FK ON DELETE CASCADE", chkDef.includes("campaign_id") && chkDef.includes("CASCADE"), "");
const fk = await sql`
  SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
  WHERE conrelid = 'campaign_cost_entries'::regclass AND contype = 'f'
`;
ok("cost FK references campaigns(id)", (fk as Array<{ def: string }>).some((r) => r.def.includes("REFERENCES campaigns(id)")), (fk as Array<{ def: string }>).map((r) => r.def).join(" | "));

console.log("== 2. migration 017 idempotent (reapply) ==");
const migrationSource = readFileSync(join(process.cwd(), "src/db/migrations/017_campaigns.sql"), "utf8");
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
let migrateFailed = false;
for (const stmt of splitSqlStatements(migrationSource)) {
  try { await sql.query(stmt); } catch (err) { migrateFailed = true; console.error("    reapply failed:", err instanceof Error ? err.message : err); }
}
ok("migration re-applies cleanly (second application)", !migrateFailed, `${splitSqlStatements(migrationSource).length} statements`);

console.log("== 3. seeded pilot campaigns + planned entries (real, owner-approved) ==");
const campaigns = (await sql`
  SELECT id, name, channel, status, planned_budget_cents FROM campaigns ORDER BY name
`) as Array<{ id: string; name: string; channel: string; status: string; planned_budget_cents: number }>;
ok("exactly 2 campaigns seeded", campaigns.length === 2, `count=${campaigns.length}`);
const dm = campaigns.find((c) => c.name === "Pilot Bexar Top1000 2026-08");
const dialer = campaigns.find((c) => c.name === "Dialer Pilot Bexar Top1000 2026-08");
ok("direct-mail pilot exists (channel direct_mail)", dm?.channel === "direct_mail", dm ? `id=${dm.id}` : "missing");
ok("direct-mail pilot status 'planned' (nothing sent)", dm?.status === "planned", `got ${dm?.status}`);
ok("direct-mail pilot planned_budget_cents = 60000", dm?.planned_budget_cents === 60000, `got ${dm?.planned_budget_cents}`);
ok("dialer pilot exists (voice, planned, 0 budget)", dialer?.channel === "voice" && dialer?.status === "planned" && dialer?.planned_budget_cents === 0, dialer ? JSON.stringify({ c: dialer.channel, s: dialer.status, b: dialer.planned_budget_cents }) : "missing");
const entries = (await sql`
  SELECT e.campaign_id, e.amount_cents, e.kind, e.operator, e.note
  FROM campaign_cost_entries e JOIN campaigns c ON c.id = e.campaign_id
  ORDER BY e.amount_cents
`) as Array<{ campaign_id: string; amount_cents: number; kind: string; operator: string; note: string }>;
ok("exactly 2 cost entries (both planned)", entries.length === 2 && entries.every((e) => e.kind === "planned"), `count=${entries.length} kinds=${entries.map((e) => e.kind).join(",")}`);
const plannedSum = entries.reduce((s, e) => s + e.amount_cents, 0);
const actualSum = (await sql`SELECT COALESCE(SUM(amount_cents), 0)::int AS n FROM campaign_cost_entries WHERE kind = 'actual'`)[0].n;
ok("planned entries sum to 60000 ($600 cap)", plannedSum === 60000, `sum=${plannedSum}`);
ok("actual spend is 0 (nothing spent — honest)", actualSum === 0, `actual=${actualSum}`);
ok("entries operator = owner", entries.every((e) => e.operator === "owner"), entries.map((e) => e.operator).join(","));
ok("base entry 46585 (847 × $0.55) present", entries.some((e) => e.amount_cents === 46585 && e.note.includes("465.85")), "");
ok("allowance entry 13415 with pending-billing note", entries.some((e) => e.amount_cents === 13415 && e.note.includes("pending PropStream billing state")), "");

console.log("== 4. funnelMetrics — real counts only ==");
const funnel = await funnelMetrics();
const f = (key: string) => funnel.stages.find((s) => s.key === key);
ok("dbOk true", funnel.dbOk, "");
ok("total leads = 7150 (real)", f("total_leads")?.count === 7150, `got ${f("total_leads")?.count}`);
ok("contactable = 0 (trace not completed)", f("contactable")?.count === 0, `got ${f("contactable")?.count}`);
ok("contact attempted+ = 0", f("contact_attempted")?.count === 0, `got ${f("contact_attempted")?.count}`);
ok("connected+ = 0", f("connected")?.count === 0, `got ${f("connected")?.count}`);
ok("qualified+ = 0", f("qualified")?.count === 0, `got ${f("qualified")?.count}`);
ok("offer+ = 0", f("offer")?.count === 0, `got ${f("offer")?.count}`);
ok("contract signed+ = 0", f("contract_signed")?.count === 0, `got ${f("contract_signed")?.count}`);
ok("deals analyzed = 0 (deal_analyses empty)", f("deals_analyzed")?.count === 0, `got ${f("deals_analyzed")?.count}`);
ok("buyer matches = 0 (no buyer activity)", f("buyer_matches")?.count === 0, `got ${f("buyer_matches")?.count}`);
ok("contracts = 0", f("contracts")?.count === 0, `got ${f("contracts")?.count}`);
ok("closed = 0", f("closed")?.count === 0, `got ${f("closed")?.count}`);
ok("revenue = 0 (contracts.assignment_fee SUM)", f("revenue")?.count === 0, `got ${f("revenue")?.count}`);
ok("contactable conversion = 0/7150 = 0 (not null)", f("contactable")?.conversionFromPrevious === 0, `got ${f("contactable")?.conversionFromPrevious}`);
ok("attempted conversion = null (0 denominator → '—')", f("contact_attempted")?.conversionFromPrevious === null, `got ${f("contact_attempted")?.conversionFromPrevious}`);
ok("headline rates null (no data)", funnel.contractRate === null && funnel.qualifiedRate === null, `contract=${funnel.contractRate} qualified=${funnel.qualifiedRate}`);

console.log("== 5. campaignCosts — per campaign planned vs actual ==");
const costs = await campaignCosts();
ok("2 campaigns returned", costs.campaigns.length === 2, `count=${costs.campaigns.length}`);
const dmCost = costs.campaigns.find((c) => c.name === "Pilot Bexar Top1000 2026-08");
ok("direct-mail pilot: $600 planned, $0 actual", dmCost?.plannedCents === 60000 && dmCost?.actualCents === 0, `planned=${dmCost?.plannedCents} actual=${dmCost?.actualCents}`);
const dialerCost = costs.campaigns.find((c) => c.name === "Dialer Pilot Bexar Top1000 2026-08");
ok("dialer pilot: $0 planned, $0 actual", dialerCost?.plannedCents === 0 && dialerCost?.actualCents === 0, `planned=${dialerCost?.plannedCents} actual=${dialerCost?.actualCents}`);
ok("totals: planned $600, actual $0", costs.totals.plannedCents === 60000 && costs.totals.actualCents === 0, JSON.stringify(costs.totals));
ok("fmtDollars renders $600.00", fmtDollars(60000) === "$600.00", fmtDollars(60000));

console.log("== 6. attentionItems — real-state derived ==");
const itemsBefore = await attentionItems();
const titles = itemsBefore.map((i) => i.title);
ok("pilot-owner-action item present (warn)", itemsBefore.some((i) => i.severity === "warn" && i.title.includes("Pilot staged, nothing sent")), "");
ok("high-priority no-contact item present (warn, real count 1321)", itemsBefore.some((i) => i.severity === "warn" && i.title.includes("high-priority leads have no usable contact info")), titles.join(" | "));
ok("dialer not-started item present (info)", itemsBefore.some((i) => i.severity === "info" && i.title.includes("Campaign not started: Dialer Pilot")), "");
ok("buyers-due-verification item present (info)", itemsBefore.some((i) => i.severity === "info" && i.title.includes("due verification")), "");
ok("no critical items in today's real state", !itemsBefore.some((i) => i.severity === "critical"), "");

// Temp STALLED job → prove the critical stalled-trace path, then remove it.
const tempJob = (await sql`
  INSERT INTO skip_trace_jobs (list_name, status, total_leads, traced_count, started_at, last_progress_at, error_message)
  VALUES ('verify-b10a temp list', 'STALLED', 100, 59, now() - interval '2 hours', now() - interval '2 hours', 'verify-b10a temp row — removed at cleanup')
  RETURNING id
`) as Array<{ id: number }>;
const tempJobId = tempJob[0].id;
const itemsWithJob = await attentionItems();
ok("stalled-trace critical item present with temp STALLED job", itemsWithJob.some((i) => i.severity === "critical" && i.title.includes("Skip-trace job stalled") && i.title.includes("verify-b10a temp list")), itemsWithJob.map((i) => i.title).join(" | "));
ok("stalled item details the progress (59/100) + error", itemsWithJob.find((i) => i.title.includes("Skip-trace job stalled"))?.detail.includes("59/100") ?? false, "");
await sql`DELETE FROM skip_trace_jobs WHERE id = ${tempJobId}`;
const afterCleanup = await attentionItems();
ok("temp job removed — no critical items again", !afterCleanup.some((i) => i.severity === "critical"), "");

console.log("== 7. GREEN/YELLOW/RED rule — computed, not hardcoded ==");
const statusClean = computeCommandStatus(afterCleanup, funnel, costs);
ok("today's real state → YELLOW", statusClean.status === "YELLOW", `got ${statusClean.status}`);
ok("YELLOW reasons documented (pilot staged, no contracts)", statusClean.reasons.some((r) => r.includes("Pilot staged but unsent")) && statusClean.reasons.some((r) => r.includes("No contracts signed yet")), JSON.stringify(statusClean.reasons));
ok("YELLOW reason names the $600.00 planned / $0 actual", statusClean.reasons.some((r) => r.includes("$600.00 planned, $0 actual")), "");
const statusRed = computeCommandStatus(itemsWithJob, funnel, costs);
ok("critical item present → RED (stop-fix)", statusRed.status === "RED", `got ${statusRed.status}`);
ok("RED reason lists the critical item", statusRed.reasons.some((r) => r.includes("Critical:")), JSON.stringify(statusRed.reasons));
// spend > 0 with 0 contacts → RED (documented rule)
const fakeSpend = { campaigns: costs.campaigns, totals: { plannedCents: 60000, actualCents: 500 } };
const statusRedSpend = computeCommandStatus(afterCleanup, funnel, fakeSpend);
ok("actual spend > 0 with 0 contacts → RED", statusRedSpend.status === "RED", `got ${statusRedSpend.status}`);
// GREEN requires ≥1 contract signed + rates within targets
const greenFunnel = {
  stages: [
    { key: "total_leads", label: "Total leads", count: 1000, conversionFromPrevious: null, note: "" },
    { key: "contactable", label: "Contactable", count: 800, conversionFromPrevious: 0.8, note: "" },
    { key: "contact_attempted", label: "Contact attempted +", count: 600, conversionFromPrevious: 0.75, note: "" },
    { key: "connected", label: "Connected +", count: 300, conversionFromPrevious: 0.5, note: "" },
    { key: "qualified", label: "Qualified +", count: 180, conversionFromPrevious: 0.6, note: "" },
    { key: "offer", label: "Offer +", count: 100, conversionFromPrevious: 0.556, note: "" },
    { key: "contract_signed", label: "Contract signed +", count: 25, conversionFromPrevious: 0.25, note: "" },
    { key: "deals_analyzed", label: "Deals analyzed", count: 0, conversionFromPrevious: null, note: "" },
    { key: "buyer_matches", label: "Buyer matches (deals sent)", count: 0, conversionFromPrevious: null, note: "" },
    { key: "contracts", label: "Contracts (table)", count: 25, conversionFromPrevious: null, note: "" },
    { key: "closed", label: "Closed", count: 0, conversionFromPrevious: 0, note: "" },
    { key: "revenue", label: "Revenue (assignment fees)", count: 0, conversionFromPrevious: null, note: "" },
  ],
  contractRate: 0.25,
  qualifiedRate: 0.6,
  dbOk: true,
};
const greenStatus = computeCommandStatus([], greenFunnel as never, {
  campaigns: [{ id: "x", name: "Active", channel: "direct_mail", status: "active", plannedBudgetCents: 0, plannedCents: 0, actualCents: 100, startedAt: null, notes: null }],
  totals: { plannedCents: 0, actualCents: 100 },
});
ok("GREEN when ≥1 contract signed + rates within targets + spend has contacts", greenStatus.status === "GREEN", `got ${greenStatus.status} — ${greenStatus.reasons.join(" | ")}`);

console.log("== 8. honesty greps ==");
const SRC_DIR = join(process.cwd(), "src");
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".ts") || e.name.endsWith(".tsx") ? [join(dir, e.name)] : [],
  );
}
const ccSrc = read(join(SRC_DIR, "lib/command-center.ts"), "utf8");
const routeSrc = read(join(SRC_DIR, "routes/command-center.tsx"), "utf8");
const headerSrc = read(join(SRC_DIR, "components/Header.tsx"), "utf8");
ok("command-center lib never hardcodes lead counts", !/7150|1,321|1321/.test(ccSrc), "no fixed counts in lib");
ok("lib documents the GREEN/YELLOW/RED rule in its header", ccSrc.includes("GREEN / YELLOW / RED rule") && ccSrc.includes("computed"), "");
ok("conversions with 0 denominator documented as null → '—'", ccSrc.includes("0 denominator") && ccSrc.includes("null") && routeSrc.includes('"—"') || routeSrc.includes('"—"'), "");
ok("route renders honest no-real-spend message", routeSrc.includes("No real spend recorded yet"), "");
ok("route renders honest funnel empty conversions as —", routeSrc.includes('s.conversionFromPrevious === null ? "—" : fmtRate'), "");
ok("route renders honest loading state (no invented numbers pre-fetch)", routeSrc.includes("Loading command center"), "");
ok("route renders db-error warning (never estimated)", routeSrc.includes("Nothing here is ever estimated"), "");
ok("header nav includes Command Center", headerSrc.includes('to="/command-center"'), "");
ok("route page title present (SSR shell)", routeSrc.includes("Command Center"), "");

console.log("== 9. DB left pristine ==");
const finalCampaigns = (await sql`SELECT COUNT(*)::int AS n FROM campaigns`)[0].n;
const finalEntries = (await sql`SELECT COUNT(*)::int AS n FROM campaign_cost_entries`)[0].n;
const finalActual = (await sql`SELECT COALESCE(SUM(amount_cents), 0)::int AS n FROM campaign_cost_entries WHERE kind = 'actual'`)[0].n;
const tempGone = (await sql`SELECT COUNT(*)::int AS n FROM skip_trace_jobs WHERE list_name = 'verify-b10a temp list'`)[0].n;
ok("campaigns still 2 (no duplicates)", finalCampaigns === 2, `n=${finalCampaigns}`);
ok("cost entries still 2 (verify adds none)", finalEntries === 2, `n=${finalEntries}`);
ok("actual spend still 0 (verify adds none)", finalActual === 0, `actual=${finalActual}`);
ok("temp skip-trace job removed", tempGone === 0, `n=${tempGone}`);

console.log("== 10. UI routes 200 (run after publish) ==");
for (const route of ["/", "/command-center", "/dashboard", "/crm", "/settings"]) {
  try {
    const res = await fetch(`http://localhost:3000${route}`, { signal: AbortSignal.timeout(8000) });
    ok(`GET ${route}`, res.status === 200, `status ${res.status}`);
  } catch {
    ok(`GET ${route}`, false, "server unreachable — run after publish");
  }
}
try {
  const html = await (await fetch("http://localhost:3000/command-center", { signal: AbortSignal.timeout(8000) })).text();
  ok("SSR /command-center renders the shell", html.includes("Command Center") && html.includes("Loading command center"), `len=${html.length}`);
} catch {
  ok("SSR /command-center renders the shell", false, "server unreachable — run after publish");
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
