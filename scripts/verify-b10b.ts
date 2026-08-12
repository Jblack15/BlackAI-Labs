// PH1-B10b verification — Campaign economics + automatic spending control.
// Rerunnable: reapplies migration 018 idempotently, asserts the REAL backfill
// (pilot lead_count 978 / spend_cap 60000, dialer lead_count 978 / cap NULL),
// proves economics render honest "—"/0 at actual=0, inserts a TEMP kind='actual'
// cost entry to prove the numbers flip to real computed values and RED-pause
// when the cap is breached, then deletes it (DB pristine after), exercises the
// full campaignHealth matrix (RED×3 / GREEN / YELLOW×3 / NO_SPEND) with pure
// simulated inputs, greps for honesty, and ends with UI route checks (run after
// publish — server on :3000).
//
// DB is left pristine: the only test write is a temporary campaign_cost_entries
// row (kind='actual', note 'verify-b10b temp row…') that is deleted before the
// script finishes. The seeded planned entries are real and stay.
//
// Run:  bun run scripts/verify-b10b.ts
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

const { funnelMetrics } = await import("../src/lib/command-center");
const {
  campaignEconomics,
  campaignHealth,
  evaluateCampaign,
  toFunnelCounts,
  TARGETS,
} = await import("../src/lib/campaign-economics");

console.log("== 1. migration 018 schema — lead_count + spend_cap_cents ==");
const cols = await sql`
  SELECT column_name, is_nullable, column_default, data_type
  FROM information_schema.columns
  WHERE table_name = 'campaigns' AND column_name IN ('lead_count', 'spend_cap_cents')
  ORDER BY column_name
`;
const colMap = new Map((cols as Array<{ column_name: string; is_nullable: string; column_default: string | null; data_type: string }>).map((c) => [c.column_name, c]));
ok("campaigns.lead_count exists (INT, nullable)", colMap.get("lead_count")?.data_type === "integer" && colMap.get("lead_count")?.is_nullable === "YES", JSON.stringify(colMap.get("lead_count")));
ok("campaigns.spend_cap_cents exists (INT, nullable)", colMap.get("spend_cap_cents")?.data_type === "integer" && colMap.get("spend_cap_cents")?.is_nullable === "YES", JSON.stringify(colMap.get("spend_cap_cents")));
ok("lead_count has NO default (NULL = unknown, never 0-fake)", colMap.get("lead_count")?.column_default === null, `default=${colMap.get("lead_count")?.column_default}`);
ok("spend_cap_cents has NO default (NULL = no cap set)", colMap.get("spend_cap_cents")?.column_default === null, `default=${colMap.get("spend_cap_cents")?.column_default}`);

console.log("== 2. migration 018 idempotent (reapply) ==");
const migrationSource = readFileSync(join(process.cwd(), "src/db/migrations/018_campaign_economics.sql"), "utf8");
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

console.log("== 3. real backfill — attributed lead counts + pilot cap ==");
const campaigns = (await sql`
  SELECT name, lead_count, spend_cap_cents FROM campaigns ORDER BY name
`) as Array<{ name: string; lead_count: number | null; spend_cap_cents: number | null }>;
const dm = campaigns.find((c) => c.name === "Pilot Bexar Top1000 2026-08");
const dialer = campaigns.find((c) => c.name === "Dialer Pilot Bexar Top1000 2026-08");
ok("pilot lead_count = 978 (real, campaign #1063894)", dm?.lead_count === 978, `got ${dm?.lead_count}`);
ok("pilot spend_cap_cents = 60000 (its planned budget)", dm?.spend_cap_cents === 60000, `got ${dm?.spend_cap_cents}`);
ok("dialer lead_count = 978 (same top-1000 list)", dialer?.lead_count === 978, `got ${dialer?.lead_count}`);
ok("dialer spend_cap_cents NULL (no cap — 0 budget, nothing sent)", dialer?.spend_cap_cents === null, `got ${dialer?.spend_cap_cents}`);

console.log("== 4. economics at actual=0 — all '—'/0-honest ==");
const funnel = await funnelMetrics();
const counts = toFunnelCounts(funnel);
ok("funnel counts derived (qualified/offer/contract = 0 today)", counts.qualifiedPlus === 0 && counts.offerPlus === 0 && counts.contractSignedPlus === 0, JSON.stringify(counts));
const eco = await campaignEconomics(counts);
ok("revenueTrackable false today (contracts.campaign_id lands in B12)", eco.revenueTrackable === false, `got ${eco.revenueTrackable}`);
const ecoDm = eco.campaigns.find((c) => c.name === "Pilot Bexar Top1000 2026-08");
ok("pilot: 0 actual, 978 leads", ecoDm?.actualCents === 0 && ecoDm?.leadCount === 978, `actual=${ecoDm?.actualCents} leads=${ecoDm?.leadCount}`);
ok("pilot cost_per_lead = 0 (0 ÷ 978 — honest zero, not '—' and not fake)", ecoDm?.costPerLeadCents === 0, `got ${ecoDm?.costPerLeadCents}`);
ok("pilot cost_per_qualified_opp = null (0 denominator → '—')", ecoDm?.costPerQualifiedOppCents === null, `got ${ecoDm?.costPerQualifiedOppCents}`);
ok("pilot cost_per_contract = null (0 contracts → '—')", ecoDm?.costPerContractCents === null, `got ${ecoDm?.costPerContractCents}`);
ok("pilot revenue = 0 with B12 note (no attribution column yet)", ecoDm?.revenueCents === 0 && (ecoDm?.revenueNote ?? "").includes("B12"), `rev=${ecoDm?.revenueCents} note=${ecoDm?.revenueNote}`);
ok("pilot net profit = null (revenue not attributable → '—', never a fake loss)", ecoDm?.netProfitCents === null, `got ${ecoDm?.netProfitCents}`);
ok("pilot health NO_SPEND (honest, not GREEN)", ecoDm?.health.status === "NO_SPEND", `got ${ecoDm?.health.status}`);
ok("pilot recommendation null (nothing to recommend until real spend)", ecoDm?.health.recommendation === null, `got ${ecoDm?.health.recommendation}`);
ok("pilot NO_SPEND reason documented", (ecoDm?.health.reasons ?? []).join(" ").includes("No spend recorded"), "");
const ecoDialer = eco.campaigns.find((c) => c.name === "Dialer Pilot Bexar Top1000 2026-08");
ok("dialer: 0 actual, 978 leads, cap null, NO_SPEND", ecoDialer?.actualCents === 0 && ecoDialer?.leadCount === 978 && ecoDialer?.spendCapCents === null && ecoDialer?.health.status === "NO_SPEND", `cap=${ecoDialer?.spendCapCents} health=${ecoDialer?.health.status}`);
ok("totals: $0 actual, net profit null", eco.totals.actualCents === 0 && eco.totals.netProfitCents === null && eco.totals.revenueCents === 0, JSON.stringify(eco.totals));

console.log("== 5. simulated spend (temp actual row) flips numbers + RED-pauses ==");
const tempEntry = (await sql`
  INSERT INTO campaign_cost_entries (campaign_id, amount_cents, kind, operator, note)
  SELECT id, 60100, 'actual', 'verify-b10b', 'verify-b10b temp row — deleted at cleanup'
  FROM campaigns WHERE name = 'Pilot Bexar Top1000 2026-08'
  RETURNING id
`) as Array<{ id: string }>;
const tempId = tempEntry[0].id;
try {
  const ecoSim = await campaignEconomics(counts);
  const sim = ecoSim.campaigns.find((c) => c.name === "Pilot Bexar Top1000 2026-08");
  ok("actual flips to 60100 ($601 real simulation)", sim?.actualCents === 60100, `got ${sim?.actualCents}`);
  ok("cost_per_lead flips 0 → 61 ($0.61 = 60100/978, real division)", sim?.costPerLeadCents === 61, `got ${sim?.costPerLeadCents}`);
  ok("cost_per_qualified_opp stays null (0 qualified → '—')", sim?.costPerQualifiedOppCents === null, `got ${sim?.costPerQualifiedOppCents}`);
  ok("cost_per_contract stays null (0 contracts → '—')", sim?.costPerContractCents === null, `got ${sim?.costPerContractCents}`);
  ok("net profit stays null (revenue not attributable)", sim?.netProfitCents === null, `got ${sim?.netProfitCents}`);
  ok("RED when spend exceeds cap (60100 > 60000)", sim?.health.status === "RED", `got ${sim?.health.status}`);
  ok("recommendation says 'Recommend PAUSE' + cap reason", sim?.health.recommendation?.startsWith("Recommend PAUSE") === true && (sim?.health.recommendation ?? "").includes("exceeded the spend cap"), sim?.health.recommendation ?? "");
  ok("totals actual = 60100 while temp row present", ecoSim.totals.actualCents === 60100, `got ${ecoSim.totals.actualCents}`);
} finally {
  await sql`DELETE FROM campaign_cost_entries WHERE id = ${tempId}`;
}
const ecoClean = await campaignEconomics(counts);
const cleanDm = ecoClean.campaigns.find((c) => c.name === "Pilot Bexar Top1000 2026-08");
ok("temp row deleted — actual back to 0, cost_per_lead back to 0, NO_SPEND", cleanDm?.actualCents === 0 && cleanDm?.costPerLeadCents === 0 && cleanDm?.health.status === "NO_SPEND", `actual=${cleanDm?.actualCents} cpl=${cleanDm?.costPerLeadCents} h=${cleanDm?.health.status}`);

console.log("== 6. campaignHealth matrix (pure, simulated) ==");
const base = {
  id: "x", name: "Sim", channel: "direct_mail", status: "active",
  plannedBudgetCents: 0, plannedCents: 0, revenueNote: null,
};
// RED 1 — spend over cap
const redCap = evaluateCampaign({ ...base, leadCount: 978, spendCapCents: 60000, actualCents: 60100, revenueCents: null }, { qualifiedPlus: 0, offerPlus: 0, contractSignedPlus: 0 });
ok("RED: actual 60100 > cap 60000", redCap.health.status === "RED" && redCap.health.recommendation?.includes("Recommend PAUSE") && redCap.health.recommendation.includes("spend cap"), redCap.health.recommendation ?? "");
// RED 2 — offers out, zero contracts, past $2,000 trial threshold
const redTrial = evaluateCampaign({ ...base, leadCount: 978, spendCapCents: null, actualCents: 200100, revenueCents: null }, { qualifiedPlus: 5, offerPlus: 3, contractSignedPlus: 0 });
ok("RED: $2,001 spent with 3 offers out, 0 contracts (trial threshold)", redTrial.health.status === "RED" && (redTrial.health.recommendation ?? "").includes("zero contracts signed"), redTrial.health.recommendation ?? "");
// RED 3 — cost per contract above the $15,000 target
const redCpc = evaluateCampaign({ ...base, leadCount: 978, spendCapCents: null, actualCents: 1600000, revenueCents: null }, { qualifiedPlus: 10, offerPlus: 3, contractSignedPlus: 1 });
ok("RED: $16,000 cost per contract > $15,000 target", redCpc.health.status === "RED" && (redCpc.health.recommendation ?? "").includes("exceeded the $15,000 target"), redCpc.health.recommendation ?? "");
// GREEN — net profit positive (simulated revenue)
const green = evaluateCampaign({ ...base, leadCount: 978, spendCapCents: null, actualCents: 60000, revenueCents: 2000000, revenueNote: null }, { qualifiedPlus: 5, offerPlus: 3, contractSignedPlus: 1 });
ok("GREEN: net profit $19,400 > 0", green.health.status === "GREEN" && green.netProfitCents === 1940000 && green.health.recommendation === "Scale: profitable spend", `status=${green.health.status} np=${green.netProfitCents}`);
// YELLOW — no contracts, cost per lead at the $2 guide
const yellowCheap = evaluateCampaign({ ...base, leadCount: 978, spendCapCents: null, actualCents: 195600, revenueCents: null }, { qualifiedPlus: 0, offerPlus: 0, contractSignedPlus: 0 });
ok("YELLOW: $2.00/lead at/under guide, no contracts yet", yellowCheap.health.status === "YELLOW" && yellowCheap.costPerLeadCents === 200, `status=${yellowCheap.health.status} cpl=${yellowCheap.costPerLeadCents}`);
// YELLOW — lead_count 0 → cost per lead unknown but spending
const yellowNoLeads = evaluateCampaign({ ...base, leadCount: 0, spendCapCents: null, actualCents: 50000, revenueCents: null }, { qualifiedPlus: 0, offerPlus: 0, contractSignedPlus: 0 });
ok("YELLOW: lead_count 0 → cost per lead null → monitor", yellowNoLeads.health.status === "YELLOW" && yellowNoLeads.costPerLeadCents === null, `status=${yellowNoLeads.health.status} cpl=${yellowNoLeads.costPerLeadCents}`);
// YELLOW fallback — no contracts, above $2/lead guide, no offers (no RED)
const yellowFallback = evaluateCampaign({ ...base, leadCount: 978, spendCapCents: null, actualCents: 500000, revenueCents: null }, { qualifiedPlus: 0, offerPlus: 0, contractSignedPlus: 0 });
ok("YELLOW fallback: $511/lead above guide, no offers → monitor, not RED", yellowFallback.health.status === "YELLOW" && (yellowFallback.health.recommendation ?? "").includes("above guide"), `status=${yellowFallback.health.status} rec=${yellowFallback.health.recommendation}`);
// NO_SPEND — actual 0
const noSpend = evaluateCampaign({ ...base, leadCount: 978, spendCapCents: null, actualCents: 0, revenueCents: 0 }, { qualifiedPlus: 0, offerPlus: 0, contractSignedPlus: 0 });
ok("NO_SPEND at actual 0 (never GREEN)", noSpend.health.status === "NO_SPEND", `got ${noSpend.health.status}`);
// lead_count NULL → cost per lead null (unknown, never 0-fake)
const nullLeads = evaluateCampaign({ ...base, leadCount: null, spendCapCents: null, actualCents: 5000, revenueCents: null }, { qualifiedPlus: 0, offerPlus: 0, contractSignedPlus: 0 });
ok("lead_count NULL → cost per lead null ('—', never 0)", nullLeads.costPerLeadCents === null, `got ${nullLeads.costPerLeadCents}`);
ok("TARGETS sane (15K / 2$ / 2K, rev-18)", TARGETS.costPerContractCents === 1_500_000 && TARGETS.costPerLeadCents === 200 && TARGETS.trialSpendCents === 200_000, JSON.stringify(TARGETS));

console.log("== 7. honesty greps ==");
const SRC_DIR = join(process.cwd(), "src");
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".ts") || e.name.endsWith(".tsx") ? [join(dir, e.name)] : [],
  );
}
const libSrc = read(join(SRC_DIR, "lib/campaign-economics.ts"), "utf8");
const routeSrc = read(join(SRC_DIR, "routes/command-center.tsx"), "utf8");
ok("lib defines TARGETS with rev-18 citation (owner-tunable)", libSrc.includes("export const TARGETS") && libSrc.includes("rev 18"), "");
ok("lib documents RED/YELLOW/GREEN/NO_SPEND rules in its header", ["RED (Recommend PAUSE)", "GREEN (Scale)", "YELLOW (Monitor)", "NO_SPEND"].every((s) => libSrc.includes(s)), "");
ok("lib never hardcodes lead counts (978/7150 absent from lib)", !/978|7150|1321/.test(libSrc), "");
ok("lib never invents revenue (B12 note present)", libSrc.includes("contract fee tracking lands in B12"), "");
ok("lib math is NULL-safe (0 denominator → null)", libSrc.includes("> 0 ? Math.round(actualCents /") && libSrc.includes("null"), "");
ok("route keeps B10a honest no-real-spend message", routeSrc.includes("No real spend recorded yet"), "");
ok("route renders economics empty state (no spend recorded — economics unavailable)", routeSrc.includes("No spend recorded — economics unavailable"), "");
ok("route renders per-row '—' while actual=0", routeSrc.includes('noSpend || c.costPerLeadCents === null ? "—"'), "");
ok("route renders honest net-profit '—'", routeSrc.includes('c.netProfitCents === null ? "—"'), "");
ok("route documents the health rules + rev-18 targets", routeSrc.includes("Health rules: RED → Recommend PAUSE") && routeSrc.includes("plan rev 18"), "");
ok("route still renders funnel empty conversions as —", routeSrc.includes('s.conversionFromPrevious === null ? "—" : fmtRate'), "");
ok("B10a funnel/attention behavior preserved (funnelMetrics + attentionItems still called)", routeSrc.includes("funnelMetrics()") && routeSrc.includes("attentionItems()"), "");

console.log("== 8. DB left pristine ==");
const finalCampaigns = (await sql`SELECT COUNT(*)::int AS n FROM campaigns`)[0].n;
const finalEntries = (await sql`SELECT COUNT(*)::int AS n FROM campaign_cost_entries`)[0].n;
const finalActual = (await sql`SELECT COALESCE(SUM(amount_cents), 0)::int AS n FROM campaign_cost_entries WHERE kind = 'actual'`)[0].n;
const tempGone = (await sql`SELECT COUNT(*)::int AS n FROM campaign_cost_entries WHERE note LIKE 'verify-b10b temp row%'`)[0].n;
const leadsBack = (await sql`SELECT COUNT(*)::int AS n FROM campaigns WHERE name = 'Pilot Bexar Top1000 2026-08' AND lead_count = 978 AND spend_cap_cents = 60000`)[0].n;
ok("campaigns still 2 (no duplicates)", finalCampaigns === 2, `n=${finalCampaigns}`);
ok("cost entries still 2 (verify adds none)", finalEntries === 2, `n=${finalEntries}`);
ok("actual spend still 0 (temp row deleted)", finalActual === 0, `actual=${finalActual}`);
ok("temp rows removed", tempGone === 0, `n=${tempGone}`);
ok("pilot backfill intact after all tests (978 / 60000)", leadsBack === 1, `n=${leadsBack}`);

console.log("== 9. UI routes 200 (run after publish) ==");
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
