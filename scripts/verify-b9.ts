// PH1-B9 verification — Deal Analyzer production display.
// Rerunnable: applies migration 015 idempotently, exercises the calculator's
// save/reload contract at the DB level (mirroring the exact payload the
// calculator sends), proves buyer matching only surfaces matchable-stage
// leads, greps for honesty (confidence / buyer_demand never auto-populated),
// checks legacy save/list/load back-compat, cleans up after itself, and ends
// with UI route checks (run after publish — the dev/prod server on :3000).
//
// Run:  bun run scripts/verify-b9.ts
import { neon } from "@neondatabase/serverless";
import { readFileSync, readdirSync, readFileSync as read } from "node:fs";
import { join } from "node:path";
import { computeMatch, type Buyer, type DealForMatch } from "../src/lib/buyer-match";

const sql = neon(process.env.DATABASE_URL!);
let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

// --- Mirrors of the calculator's mappings (src/routes/calculator.tsx) ---
const FORECLOSURE_VOCAB: Record<string, string> = {
  "Very High": "VERY_HIGH",
  High: "HIGH",
  "Medium High": "MEDIUM_HIGH",
  "Medium Low": "MEDIUM_LOW",
  Low: "LOW",
};
function mapForeclosureRisk(value: unknown): string | null {
  if (!value) return null;
  return FORECLOSURE_VOCAB[String(value)] ?? null;
}
function taxDelinquentFromYears(years: unknown): boolean | null {
  if (years === null || years === undefined) return null;
  return Number(years) > 0;
}

const B9_COLS = [
  "confidence", "current_value", "desired_buyer_margin", "distress_score",
  "tax_delinquent", "years_delinquent", "foreclosure_risk", "equity_estimate",
  "property_type", "buyer_demand", "offer_range_low", "offer_range_high",
  "assumptions", "analysis_status",
];
const LEGACY_COLS = ["arv", "repairs", "max_offer", "assignment_fee", "closing_costs", "holding_costs", "projected_profit", "roi", "margin"];

console.log("== 1. migration 015 schema ==");
const cols = await sql`
  SELECT column_name, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_name = 'deal_analyses'
`;
const colMap = new Map((cols as Array<{ column_name: string; is_nullable: string; column_default: string | null }>).map((c) => [c.column_name, c]));
const names = [...colMap.keys()];
const missing = B9_COLS.filter((c) => !names.includes(c));
ok("all 14 new columns present", missing.length === 0, missing.length ? `missing: ${missing.join(",")}` : names.filter((c) => B9_COLS.includes(c)).join(","));
ok("all new columns nullable (NULL = honest not-computed)", B9_COLS.filter((c) => c !== "analysis_status").every((c) => colMap.get(c)!.is_nullable === "YES"), "confidence…buyer_demand nullable");
const statusCol = colMap.get("analysis_status")!;
ok("analysis_status NOT NULL DEFAULT 'ESTIMATE'", statusCol.is_nullable === "NO" && (statusCol.column_default ?? "").toLowerCase().includes("'estimate'"), `nullable=${statusCol.is_nullable} default=${statusCol.column_default}`);
ok("legacy NOT NULL DEFAULT 0 columns untouched", LEGACY_COLS.every((c) => colMap.get(c)!.is_nullable === "NO" && (colMap.get(c)!.column_default ?? "").includes("0")), "arv…margin still NOT NULL DEFAULT 0");
const cons = await sql`
  SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
  WHERE conrelid = 'deal_analyses'::regclass AND conname IN
    ('deal_analyses_confidence_check', 'deal_analyses_foreclosure_risk_check', 'deal_analyses_analysis_status_check')
  ORDER BY conname
`;
const conMap = new Map((cons as Array<{ conname: string; def: string }>).map((c) => [c.conname, c.def]));
ok("confidence CHECK (NULL allowed, 0-100)", conMap.has("deal_analyses_confidence_check") && conMap.get("deal_analyses_confidence_check")!.includes("confidence IS NULL") && conMap.get("deal_analyses_confidence_check")!.includes("100"), conMap.get("deal_analyses_confidence_check")?.slice(0, 90) ?? "missing");
ok("foreclosure_risk CHECK vocabulary", conMap.has("deal_analyses_foreclosure_risk_check") && ["LOW", "MEDIUM_LOW", "MEDIUM_HIGH", "HIGH", "VERY_HIGH"].every((v) => conMap.get("deal_analyses_foreclosure_risk_check")!.includes(v)), conMap.get("deal_analyses_foreclosure_risk_check")?.slice(0, 120) ?? "missing");
ok("analysis_status CHECK (ESTIMATE/VERIFIED)", conMap.has("deal_analyses_analysis_status_check") && conMap.get("deal_analyses_analysis_status_check")!.includes("ESTIMATE") && conMap.get("deal_analyses_analysis_status_check")!.includes("VERIFIED"), conMap.get("deal_analyses_analysis_status_check")?.slice(0, 90) ?? "missing");

console.log("== 2. migration 015 idempotent ==");
const migrationSource = readFileSync(join(process.cwd(), "src/db/migrations/015_deal_analyses_production.sql"), "utf8");
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
const migrationStatements = splitSqlStatements(migrationSource);
let migrateFailed = false;
for (const stmt of migrationStatements) {
  try { await sql.query(stmt); } catch (err) { migrateFailed = true; console.error("    reapply failed:", err instanceof Error ? err.message : err); }
}
ok("migration re-applies cleanly (second application)", !migrateFailed, `${migrationStatements.length} statements`);

console.log("== 3. no fabrication — new columns start NULL ==");
const preRows = await sql`SELECT COUNT(*)::int AS n FROM deal_analyses`;
const preCount = preRows[0].n;
ok("deal_analyses starts at 0 rows (real data only)", preCount === 0, `rows=${preCount}`);

console.log("== 4. legacy save still works; new fields stay NULL / ESTIMATE ==");
const legacyRows = (await sql`
  INSERT INTO deal_analyses (lead_id, arv, repairs, max_offer, assignment_fee, closing_costs, holding_costs, projected_profit, roi, margin)
  VALUES (NULL, 200000, 30000, 140000, 15000, 4000, 0, 15000, 10.7, 7.5)
  RETURNING id, arv, repairs, max_offer, assignment_fee, closing_costs, holding_costs, projected_profit, roi, margin,
            confidence, current_value, distress_score, tax_delinquent, years_delinquent, foreclosure_risk,
            equity_estimate, property_type, buyer_demand, offer_range_low, offer_range_high, assumptions, analysis_status
`) as Array<Record<string, unknown>>;
const legacyRow = legacyRows[0];
ok("legacy-shaped INSERT succeeds (back-compat)", legacyRow !== undefined, `id=${legacyRow?.id}`);
ok("legacy row coerces via Number() (rowToAnalysis path)", Number(legacyRow.arv) === 200000 && Number(legacyRow.roi) === 10.7 && Number(legacyRow.margin) === 7.5, `arv=${legacyRow.arv} roi=${legacyRow.roi}`);
ok("new columns NULL on legacy row", ["confidence", "current_value", "distress_score", "tax_delinquent", "years_delinquent", "foreclosure_risk", "equity_estimate", "property_type", "buyer_demand", "offer_range_low", "offer_range_high", "assumptions"].every((c) => legacyRow[c] === null), "NULL = not computed");
ok("analysis_status defaults to ESTIMATE", legacyRow.analysis_status === "ESTIMATE", `got ${legacyRow.analysis_status}`);
await sql`DELETE FROM deal_analyses WHERE id = ${legacyRow.id}`;

console.log("== 5. with-lead save → reload round-trip ==");
const testLeadRows = await sql`
  SELECT id, full_name, property_address, property_city, property_state, property_zip,
         property_type, pipeline_stage, score_factors
  FROM leads
  WHERE score_factors IS NOT NULL
    AND score_factors->>'foreclosure_factor' IS NOT NULL
    AND property_city = 'San Antonio'
  ORDER BY (score_factors->>'equity')::numeric DESC NULLS LAST
  LIMIT 1
`;
ok("scored SA lead with foreclosure data exists", testLeadRows.length === 1, testLeadRows.length ? `id=${(testLeadRows[0] as { id: string }).id}` : "no lead");
const lead = testLeadRows[0] as unknown as {
  id: string;
  full_name: string | null;
  property_address: string | null;
  property_city: string | null;
  property_state: string | null;
  property_zip: string | null;
  property_type: string | null;
  pipeline_stage: string;
  score_factors: {
    ev?: number | null;
    distress?: number | null;
    years_delq?: number | null;
    foreclosure_factor?: string | null;
    equity?: number | null;
    property_type?: string | null;
  } | null;
};
const sf = lead.score_factors ?? {};
// Mirror the calculator's save payload for this lead (arv/repairs/fee inputs)
const arv = 300000;
const repairs = 40000;
const fee = 15000;
const closingPct = 2;
const closing = arv * (closingPct / 100);
const holding = 0;
const mao = arv - repairs - fee - closing - holding;
const assumptions = {
  arv_input: arv,
  repairs_input: repairs,
  fee_input: fee,
  closing_mode: "auto",
  closing_pct: closingPct,
  closing_manual: null,
  holding_input: holding,
  arv_source: "MANUAL_ENTRY",
  value_source: sf.ev != null ? "leads.score_factors.ev (PropStream-adapted score import)" : "none — manual estimates only",
  repair_basis: "UNVERIFIED_ESTIMATE",
};
const savedRows = (await sql`
  INSERT INTO deal_analyses (
    lead_id, arv, repairs, max_offer, assignment_fee, closing_costs, holding_costs,
    projected_profit, roi, margin, confidence, current_value, desired_buyer_margin,
    distress_score, tax_delinquent, years_delinquent, foreclosure_risk, equity_estimate,
    property_type, buyer_demand, offer_range_low, offer_range_high, assumptions, analysis_status
  )
  VALUES (
    ${lead.id}, ${arv}, ${repairs}, ${mao}, ${fee}, ${closing}, ${holding},
    ${fee}, ${mao > 0 ? (fee / mao) * 100 : 0}, ${(fee / arv) * 100},
    ${null}, ${sf.ev ?? null}, ${null},
    ${sf.distress ?? null}, ${taxDelinquentFromYears(sf.years_delq)}, ${sf.years_delq ?? null},
    ${mapForeclosureRisk(sf.foreclosure_factor)}, ${sf.equity ?? null}, ${lead.property_type ?? sf.property_type ?? null},
    ${null}, ${mao > 0 ? Math.max(0, mao * 0.9) : null}, ${mao > 0 ? mao : null},
    ${JSON.stringify(assumptions)}, 'ESTIMATE'
  )
  RETURNING id, lead_id, arv, repairs, max_offer, assignment_fee, closing_costs,
            holding_costs, projected_profit, roi, margin,
            confidence, current_value, desired_buyer_margin, distress_score,
            tax_delinquent, years_delinquent, foreclosure_risk, equity_estimate,
            property_type, buyer_demand, offer_range_low, offer_range_high,
            assumptions, analysis_status, created_at
`) as Array<Record<string, unknown>>;
const saved = savedRows[0];
ok("save persists lead_id from ?lead=", String(saved.lead_id) === lead.id, `lead_id=${saved.lead_id}`);
ok("current_value = score_factors.ev", Number(saved.current_value) === Number(sf.ev), `got ${saved.current_value}`);
ok("distress_score = score_factors.distress", Number(saved.distress_score) === Number(sf.distress), `got ${saved.distress_score}`);
ok("tax_delinquent derived from years_delq (true)", saved.tax_delinquent === true, `got ${saved.tax_delinquent}`);
ok("years_delinquent = score_factors.years_delq", Number(saved.years_delinquent) === Number(sf.years_delq), `got ${saved.years_delinquent}`);
const expectedFf = mapForeclosureRisk(sf.foreclosure_factor);
ok("foreclosure_risk mapped into CHECK vocab", saved.foreclosure_risk === expectedFf, `score=${sf.foreclosure_factor} stored=${saved.foreclosure_risk} expected=${expectedFf}`);
ok("equity_estimate = score_factors.equity", Number(saved.equity_estimate) === Number(sf.equity), `got ${saved.equity_estimate}`);
ok("property_type echoed", saved.property_type === (lead.property_type ?? sf.property_type ?? null), `got ${saved.property_type}`);
ok("offer range = [max(0, mao*0.9), mao]", Number(saved.offer_range_low) === Math.max(0, mao * 0.9) && Number(saved.offer_range_high) === mao, `[${saved.offer_range_low}, ${saved.offer_range_high}]`);
const storedAssumptions = saved.assumptions as Record<string, unknown>;
ok("assumptions JSONB persisted with repair_basis UNVERIFIED_ESTIMATE", storedAssumptions?.repair_basis === "UNVERIFIED_ESTIMATE" && Number(storedAssumptions?.arv_input) === arv && storedAssumptions?.value_source === assumptions.value_source, JSON.stringify(storedAssumptions).slice(0, 140));
ok("confidence stays NULL (never auto-filled)", saved.confidence === null, `got ${saved.confidence}`);
ok("buyer_demand stays NULL (never auto-filled)", saved.buyer_demand === null, `got ${saved.buyer_demand}`);
ok("desired_buyer_margin stays NULL (no input exists)", saved.desired_buyer_margin === null, `got ${saved.desired_buyer_margin}`);
ok("analysis_status = ESTIMATE", saved.analysis_status === "ESTIMATE", `got ${saved.analysis_status}`);
// reload round-trip — the same query listDealAnalyses / getDealAnalysis runs
const reloaded = (await sql`
  SELECT id, lead_id, arv, repairs, max_offer, assignment_fee, closing_costs,
         holding_costs, projected_profit, roi, margin,
         confidence, current_value, distress_score, tax_delinquent, years_delinquent,
         foreclosure_risk, equity_estimate, property_type, buyer_demand,
         offer_range_low, offer_range_high, assumptions, analysis_status, created_at
  FROM deal_analyses
  WHERE id = ${saved.id}
  LIMIT 1
`) as Array<Record<string, unknown>>;
ok("reload round-trips (getDealAnalysis query shape)", reloaded.length === 1 && String(reloaded[0].lead_id) === lead.id && Number(reloaded[0].max_offer) === mao && reloaded[0].analysis_status === "ESTIMATE" && reloaded[0].confidence === null, `id=${saved.id}`);
// handleLoad closing-% restore formula (legacy behavior preserved)
const loadPct = (Number(reloaded[0].closing_costs) / Number(reloaded[0].arv)) * 100;
ok("handleLoad restores closing % (closing_costs/arv)", Math.abs(loadPct - closingPct) < 0.001, `pct=${loadPct.toFixed(3)}`);

console.log("== 6. buyer matching only for matchable-stage leads ==");
const MATCHABLE_STAGES = [
  "offer_recommendation", "human_approval", "offer_sent", "negotiation",
  "contract_prepared", "contract_sent", "contract_signed", "buyer_matching",
  "buyer_contacted", "assignment", "closing",
];
const matchableQuery = async (stage: string) => {
  const rows = await sql`
    SELECT l.id, l.property_type, l.pipeline_stage AS status, da.arv, da.max_offer, da.repairs
    FROM leads l
    JOIN LATERAL (
      SELECT arv, max_offer, repairs, assignment_fee
      FROM deal_analyses
      WHERE lead_id = l.id
      ORDER BY created_at DESC
      LIMIT 1
    ) da ON true
    WHERE l.pipeline_stage = ANY(${MATCHABLE_STAGES})
      AND l.id = ${lead.id}
  `;
  return rows as Array<Record<string, unknown>>;
};
const nonMatchable = await matchableQuery(lead.pipeline_stage);
ok("lead at non-matchable stage NOT in /buyers matcher", nonMatchable.length === 0, `stage=${lead.pipeline_stage} matches=${nonMatchable.length}`);
const originalStage = lead.pipeline_stage;
await sql`UPDATE leads SET pipeline_stage = 'offer_sent' WHERE id = ${lead.id}`;
const matchable = await matchableQuery("offer_sent");
ok("lead at matchable stage WITH analysis appears in matcher", matchable.length === 1 && Number(matchable[0].max_offer) === mao, matchable.length ? `mao=${matchable[0].max_offer}` : "none");
// calculator matcher reuse: real buyers + computeMatch (shared lib)
const buyerRows = (await sql`
  SELECT id, name, email, phone, buying_criteria, created_at FROM buyers ORDER BY created_at DESC
`) as Array<{ id: string; name: string; email: string; phone: string; buying_criteria: Record<string, unknown>; created_at: string }>;
const { rowToBuyer } = await import("../src/lib/buyer-match");
const buyers: Buyer[] = buyerRows.map(rowToBuyer);
ok("live buyers loaded for matching (22 real)", buyers.length === 22, `count=${buyers.length}`);
const deal: DealForMatch = {
  id: lead.id,
  leadName: lead.full_name || "—",
  propertyAddress: lead.property_address || "",
  propertyCity: lead.property_city || "",
  propertyState: lead.property_state || "",
  propertyZip: lead.property_zip || "",
  propertyType: lead.property_type || "",
  status: "offer_sent",
  estimatedMAO: mao,
  repairs: repairs > 0 ? repairs.toLocaleString("en-US") : "—",
};
const matches = buyers
  .map((b) => computeMatch(b, deal))
  .filter((m) => m.score > 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, 5);
ok("computeMatch (shared lib) returns ≥1 match for SA SFR deal", matches.length >= 1, `matches=${matches.length} top=${matches[0]?.buyer.name} strength=${matches[0]?.strength}`);
ok("at most 5 matches shown", matches.length <= 5, `count=${matches.length}`);
ok("strength badges present (strong/good/partial)", matches.every((m) => ["strong", "good", "partial"].includes(m.strength)), matches.map((m) => m.strength).join(","));
// restore stage + clean up the test analysis
await sql`UPDATE leads SET pipeline_stage = ${originalStage} WHERE id = ${lead.id}`;

console.log("== 7. honesty greps (confidence / buyer_demand never auto-populated) ==");
const SRC_DIR = join(process.cwd(), "src");
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".ts") || e.name.endsWith(".tsx") ? [join(dir, e.name)] : [],
  );
}
const files = walk(SRC_DIR);
const calculatorSrc = read(join(SRC_DIR, "routes/calculator.tsx"), "utf8");
const buyersSrc = read(join(SRC_DIR, "routes/buyers.tsx"), "utf8");
const dashboardSrc = read(join(SRC_DIR, "routes/dashboard.tsx"), "utf8");
const srcText = files.map((f) => `${f}\n${read(f, "utf8")}`).join("\n");
// A real auto-population would be `confidence: <non-null value>` inside an
// object literal. Type declarations (`confidence: number | null;`) and honest
// null assignments are fine. The filter below only flags non-null VALUE
// assignments.
const suspiciousAssignments = (field: string, src: string): string[] =>
  src.split("\n").filter((l) => {
    if (!new RegExp(`${field}\\s*:`).test(l)) return false;
    if (l.trim().startsWith("//") || l.trim().startsWith("*")) return false;
    if (l.trim().endsWith(";")) return false; // interface / type declaration
    if (/:\s*(string|number|boolean)\s*\|/.test(l)) return false; // union type
    if (/:\s*null/.test(l) || /\?\?\s*null/.test(l)) return false; // honest null
    if (/:\s*numOrNull\(/.test(l)) return false; // honest DB-value mapper
    return true;
  });
const confidenceAssignments = suspiciousAssignments("confidence", srcText);
ok("no non-null confidence assignment anywhere in src", confidenceAssignments.length === 0, confidenceAssignments.slice(0, 3).join(" | "));
const buyerDemandAssignments = suspiciousAssignments("buyer_demand", srcText);
ok("no non-null buyer_demand assignment anywhere in src", buyerDemandAssignments.length === 0, buyerDemandAssignments.slice(0, 3).join(" | "));
ok("calculator renders confidence as not-computed", calculatorSrc.includes("not computed — no inspection/comparable data"), "");
ok("calculator renders honest no-match buyer demand", calculatorSrc.includes("NOT VERIFIED / no buyer demand data"), "");
ok("calculator renders honest no-lead message", calculatorSrc.includes("No lead attached — manual estimates only"), "");
ok("calculator never autofills inputs from score data", !calculatorSrc.includes("setArvRaw(scoreFactors"), "");
ok("calculator accepts ?lead= search param", calculatorSrc.includes('new URLSearchParams(window.location.search).get("lead")'), "");
ok("dashboard Analyzed Deals Reanalyze → /calculator?lead=ID", dashboardSrc.includes('search={{ lead: d.lead_id }}'), "");
ok("buyers page still imports shared computeMatch", buyersSrc.includes('computeMatch') && buyersSrc.includes('~/lib/buyer-match'), "");

console.log("== 8. cleanup — DB left pristine ==");
await sql`DELETE FROM deal_analyses WHERE id = ${saved.id}`;
await sql`DELETE FROM deal_analyses WHERE id = ${legacyRow.id}`;
const after = await sql`SELECT COUNT(*)::int AS n FROM deal_analyses`;
ok("test rows removed (deal_analyses back to 0)", after[0].n === 0, `rows=${after[0].n}`);
const stageCheck = await sql`SELECT pipeline_stage FROM leads WHERE id = ${lead.id}`;
ok("test lead stage restored", stageCheck[0].pipeline_stage === originalStage, `got ${stageCheck[0].pipeline_stage}`);

console.log("== 9. UI routes 200 (run after publish) ==");
for (const route of ["/", "/calculator", "/crm", "/dashboard", "/buyers", "/settings"]) {
  try {
    const res = await fetch(`http://localhost:3000${route}`, { signal: AbortSignal.timeout(8000) });
    ok(`GET ${route}`, res.status === 200, `status ${res.status}`);
  } catch {
    ok(`GET ${route}`, false, "server unreachable — run after publish");
  }
}
// SSR honesty: the no-lead calculator page must render the honest message
try {
  const html = await (await fetch("http://localhost:3000/calculator", { signal: AbortSignal.timeout(8000) })).text();
  ok("SSR /calculator renders 'No lead attached — manual estimates only'", html.includes("No lead attached — manual estimates only"), `len=${html.length}`);
} catch {
  ok("SSR /calculator renders 'No lead attached — manual estimates only'", false, "server unreachable — run after publish");
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
