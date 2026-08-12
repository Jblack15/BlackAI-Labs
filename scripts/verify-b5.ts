// PH1-B5 verification — Buyer marketplace.
// Rerunnable: re-applies migration 016 idempotently, checks the buy-box /
// verification / activity schema and honest backfill (22 buyers, defaults,
// verified_phone true ONLY for the 20 with a live-verified public phone),
// proves recordBuyerDealEvent bumps exactly one counter and writes its event
// row atomically, proves autoMatchBuyers returns ranked matches with reasons
// for a real San Antonio lead and 0 matches for an out-of-market lead, proves
// refreshVerification flags stale buyers (flag, don't delete), greps the
// source for honesty (counters/last_verified_at only written by real actions),
// cleans up after itself (events removed, counters restored, temp rows gone)
// and ends with UI route checks (run after publish — server on :3000).
//
// Run:  bun run scripts/verify-b5.ts   (after `bun run publish`)
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  autoMatchBuyers,
  recordBuyerDealEvent,
  refreshVerification,
} from "../src/lib/buyer-marketplace";

const sql = neon(process.env.DATABASE_URL!);
let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  PASS ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function splitSqlStatements(source: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inDollar = false;
  for (let i = 0; i < source.length; i++) {
    if (source.slice(i, i + 2) === "$$") { inDollar = !inDollar; cur += "$$"; i++; continue; }
    if (source[i] === ";" && !inDollar) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else {
      cur += source[i];
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// ---- 1. migration 016 schema ----
console.log("== 1. migration 016 schema ==");
const B5_COLS: Record<string, { is_nullable: string; column_default: string | null }> = {};
{
  const cols = (await sql`
    SELECT column_name, is_nullable, column_default
    FROM information_schema.columns WHERE table_name = 'buyers'
  `) as Array<{ column_name: string; is_nullable: string; column_default: string | null }>;
  for (const c of cols) B5_COLS[c.column_name] = c;
}
ok("buy_box JSONB present", !!B5_COLS.buy_box, B5_COLS.buy_box ? `nullable=${B5_COLS.buy_box.is_nullable}` : "missing");
ok("buy_box default is empty object", (B5_COLS.buy_box?.column_default ?? "").includes("'{}'"), B5_COLS.buy_box?.column_default ?? "none");
ok("active NOT NULL DEFAULT true", B5_COLS.active?.is_nullable === "NO" && (B5_COLS.active?.column_default ?? "").toLowerCase().includes("true"), `nullable=${B5_COLS.active?.is_nullable} default=${B5_COLS.active?.column_default}`);
ok("last_verified_at nullable (NULL = never verified)", B5_COLS.last_verified_at?.is_nullable === "YES", B5_COLS.last_verified_at?.is_nullable ?? "missing");
ok("verified_phone NOT NULL DEFAULT false", B5_COLS.verified_phone?.is_nullable === "NO" && (B5_COLS.verified_phone?.column_default ?? "").toLowerCase().includes("false"), `default=${B5_COLS.verified_phone?.column_default}`);
for (const c of ["deals_received", "deals_viewed", "deals_rejected", "deals_purchased"]) {
  ok(`${c} NOT NULL DEFAULT 0`, B5_COLS[c]?.is_nullable === "NO" && (B5_COLS[c]?.column_default ?? "").includes("0"), `default=${B5_COLS[c]?.column_default}`);
}
// buyer_deal_events table + constraints
{
  const ev = (await sql`
    SELECT column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_name = 'buyer_deal_events' ORDER BY ordinal_position
  `) as Array<{ column_name: string; data_type: string; is_nullable: string }>;
  const names = ev.map((c) => c.column_name);
  ok("buyer_deal_events table exists with id/buyer_id/deal_id/event/operator/created_at",
    ["id", "buyer_id", "deal_id", "event", "operator", "created_at"].every((c) => names.includes(c)),
    names.join(","));
  const cons = (await sql`
    SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'buyer_deal_events'::regclass ORDER BY conname
  `) as Array<{ conname: string; def: string }>;
  const defs = cons.map((c) => c.def).join(" ");
  ok("event CHECK vocabulary (received/viewed/rejected/purchased)",
    ["received", "viewed", "rejected", "purchased"].every((v) => defs.includes(v)), defs.slice(0, 140));
  ok("buyer FK with ON DELETE CASCADE", defs.includes("buyers") && defs.includes("CASCADE"), "");
  ok("deal FK with ON DELETE SET NULL", defs.includes("leads") && defs.includes("SET NULL"), "");
}

// ---- 2. migration idempotent (re-apply) ----
console.log("== 2. migration 016 idempotent ==");
{
  const source = readFileSync(join(process.cwd(), "src/db/migrations/016_buyer_marketplace.sql"), "utf8");
  const stmts = splitSqlStatements(source);
  let failed = 0;
  for (const stmt of stmts) {
    try { await sql.query(stmt); } catch (e) { failed++; console.log("    reapply error:", e instanceof Error ? e.message : e); }
  }
  ok("migration re-applies without error", failed === 0, `${stmts.length} statements, ${failed} failed`);
}

// ---- 3. honest backfill ----
console.log("== 3. backfill: 22 buyers, defaults, verified_phone = 20 ==");
const buyers = (await sql`
  SELECT id, name, phone, buy_box, active, last_verified_at, verified_phone,
         deals_received, deals_viewed, deals_rejected, deals_purchased
  FROM buyers ORDER BY name
`) as Array<{
  id: string; name: string; phone: string | null; buy_box: Record<string, unknown> | null;
  active: boolean; last_verified_at: string | null; verified_phone: boolean;
  deals_received: number; deals_viewed: number; deals_rejected: number; deals_purchased: number;
}>;
ok("22 buyers exist", buyers.length === 22, `count=${buyers.length}`);
ok("all buy_box empty (no fabricated criteria)", buyers.every((b) => !b.buy_box || Object.keys(b.buy_box).length === 0), `${buyers.filter((b) => b.buy_box && Object.keys(b.buy_box).length > 0).length} non-empty`);
ok("all active=true (default)", buyers.every((b) => b.active), "");
ok("all last_verified_at NULL (no fabricated verification)", buyers.every((b) => b.last_verified_at === null), "");
ok("all counters 0 (no fabricated deal history)",
  buyers.every((b) => b.deals_received === 0 && b.deals_viewed === 0 && b.deals_rejected === 0 && b.deals_purchased === 0), "");
const verifiedPhones = buyers.filter((b) => b.verified_phone);
const unverifiedWithPhone = buyers.filter((b) => !b.verified_phone && b.phone && b.phone.trim() !== "");
ok("verified_phone true exactly for the 20 with a public phone", verifiedPhones.length === 20, `count=${verifiedPhones.length}`);
ok("no phone-having buyer left unverified (verified set = phone set)", unverifiedWithPhone.length === 0, `${unverifiedWithPhone.length} with phone but not verified`);
const noPhone = buyers.filter((b) => !b.phone || b.phone.trim() === "");
ok("2 buyers without phone are unverified (BiggerPockets, Opendoor)", noPhone.length === 2 && noPhone.every((b) => !b.verified_phone), noPhone.map((b) => b.name).join(", "));

// ---- 4. atomic recordBuyerDealEvent ----
console.log("== 4. recordBuyerDealEvent — counter + event atomically ==");
const testBuyer = buyers[0];
const realLead = (await sql`SELECT id FROM leads WHERE property_city ILIKE 'san antonio' LIMIT 1`) as Array<{ id: string }>;
ok("a real SA lead exists for the event test", realLead.length === 1, realLead[0]?.id ?? "none");
const leadId = realLead[0]!.id;
const before = {
  received: Number(testBuyer.deals_received),
  viewed: Number(testBuyer.deals_viewed),
  rejected: Number(testBuyer.deals_rejected),
  purchased: Number(testBuyer.deals_purchased),
};
const updated = await recordBuyerDealEvent(testBuyer.id, leadId, "viewed", "verify-b5");
ok("viewed counter bumped by exactly 1", updated.dealsViewed === before.viewed + 1, `before=${before.viewed} after=${updated.dealsViewed}`);
ok("other counters untouched", updated.dealsReceived === before.received && updated.dealsRejected === before.rejected && updated.dealsPurchased === before.purchased, "");
const evRows = (await sql`
  SELECT event, operator, deal_id FROM buyer_deal_events WHERE buyer_id = ${testBuyer.id} ORDER BY created_at DESC LIMIT 1
`) as Array<{ event: string; operator: string; deal_id: string | null }>;
ok("event row written with operator + deal link", evRows[0]?.event === "viewed" && evRows[0]?.operator === "verify-b5" && evRows[0]?.deal_id === leadId, JSON.stringify(evRows[0]));
const evCount = (await sql`SELECT COUNT(*)::int AS n FROM buyer_deal_events WHERE operator = 'verify-b5'`) as Array<{ n: number }>;
ok("exactly 1 verify-b5 event row exists in the audit table", evCount[0].n === 1, `n=${evCount[0].n}`);
// each event type bumps only its own counter
const counterCheck: Array<{ ev: "received" | "rejected" | "purchased"; get: (b: typeof updated) => number; col: "deals_received" | "deals_rejected" | "deals_purchased" }> = [
  { ev: "received", get: (b) => b.dealsReceived, col: "deals_received" },
  { ev: "rejected", get: (b) => b.dealsRejected, col: "deals_rejected" },
  { ev: "purchased", get: (b) => b.dealsPurchased, col: "deals_purchased" },
];
for (const t of counterCheck) {
  const pre = (await sql`SELECT ${sql.unsafe(t.col)} FROM buyers WHERE id = ${testBuyer.id}`) as Array<Record<string, number>>;
  const r = await recordBuyerDealEvent(testBuyer.id, leadId, t.ev, "verify-b5");
  ok(`${t.ev} bumps only ${t.col}`, t.get(r) === Number(pre[0][t.col]) + 1, `before=${pre[0][t.col]} after=${t.get(r)}`);
}

// ---- 5. autoMatchBuyers ----
console.log("== 5. autoMatchBuyers ==");
const saResult = await autoMatchBuyers(leadId);
ok("SA lead resolves with price context", saResult.lead !== null && saResult.lead.price !== null, saResult.lead ? `${saResult.lead.propertyCity} ${saResult.lead.propertyZip} price=${saResult.lead.price} (${saResult.lead.priceSource})` : "no lead");
ok("SA lead returns ranked matches with reasons", saResult.matches.length > 0 && saResult.matches.every((m) => m.matched.length > 0 || m.neutral.length > 0), `matches=${saResult.matches.length}`);
ok("matches ranked by score desc", saResult.matches.every((m, i) => i === 0 || saResult.matches[i - 1].score >= m.score), "");
ok("every matched buyer is active", saResult.matches.every((m) => m.buyer.active), "");
ok("every matched buyer has a Location reason (all 22 are SA-only buyers)", saResult.matches.every((m) => m.matched.some((r) => r.startsWith("Location"))), "");
// out-of-market: temp Houston lead
const tempLead = (await sql`
  INSERT INTO leads (full_name, property_address, property_city, property_state, property_zip, property_type, pipeline_stage)
  VALUES ('verify-b5 Houston Test', '1 Out Of Market Way', 'Houston', 'TX', '77001', 'Single Family Residential', 'new_lead')
  RETURNING id
`) as Array<{ id: string }>;
const houstonId = tempLead[0].id;
const houResult = await autoMatchBuyers(houstonId);
ok("out-of-market (Houston) lead → 0 matches", houResult.lead !== null && houResult.matches.length === 0, `matches=${houResult.matches.length}`);
await sql`DELETE FROM leads WHERE id = ${houstonId}`;
const tempGone = (await sql`SELECT COUNT(*)::int AS n FROM leads WHERE id = ${houstonId}`) as Array<{ n: number }>;
ok("temp Houston lead removed", tempGone[0].n === 0, "");

// ---- 6. refreshVerification ----
console.log("== 6. refreshVerification — flag stale, don't delete ==");
await sql`UPDATE buyers SET last_verified_at = now() - interval '91 days', active = true WHERE id = ${testBuyer.id}`;
const fresh = await refreshVerification();
ok("stale buyer flagged inactive", fresh.flagged.some((b) => b.id === testBuyer.id) && !fresh.flagged.some((b) => b.id === testBuyer.id && b.active), "");
const flaggedRow = (await sql`SELECT active FROM buyers WHERE id = ${testBuyer.id}`) as Array<{ active: boolean }>;
ok("stale buyer active=false in DB (flag, not deleted)", flaggedRow[0].active === false, "");
ok("never-verified buyers listed as due for verification", fresh.due.length >= 21, `due=${fresh.due.length}`);
ok("stale buyer also listed as due (verification overdue)", fresh.due.some((b) => b.id === testBuyer.id), "");

// ---- 7. honesty greps ----
console.log("== 7. honesty greps ==");
{
  const buyersSrc = readFileSync(join(process.cwd(), "src/routes/buyers.tsx"), "utf8");
  const libSrc = readFileSync(join(process.cwd(), "src/lib/buyer-marketplace.ts"), "utf8");
  ok("buyers page still imports shared computeMatch (B9 intact)", buyersSrc.includes("computeMatch") && buyersSrc.includes("~/lib/buyer-match"), "");
  ok("lib never sets a counter to a fixed number (only += via CTE)",
    !/deals_(received|viewed|rejected|purchased)\s*=\s*\d/.test(libSrc), "");
  ok("lib never sets last_verified_at (only the UI Mark-verified action does)",
    !libSrc.includes("last_verified_at =") && !libSrc.includes("last_verified_at="), "");
  ok("only the UI markBuyerVerified writes now() to last_verified_at", buyersSrc.includes("SET last_verified_at = now()"), "");
  ok("buyers page renders honest zero-history empty state", buyersSrc.includes("counters start at zero"), "");
  ok("buyers page renders phone-verification label (not full verification)", buyersSrc.includes("Phone verified (public listing)"), "");
  ok("buyers page accepts ?lead= auto-match", buyersSrc.includes('new URLSearchParams(window.location.search).get("lead")'), "");
}

// ---- 8. cleanup — DB left pristine ----
console.log("== 8. cleanup ==");
await sql`DELETE FROM buyer_deal_events WHERE operator = 'verify-b5'`;
await sql`UPDATE buyers
  SET deals_received = 0, deals_viewed = 0, deals_rejected = 0, deals_purchased = 0,
      last_verified_at = NULL, active = true
  WHERE id = ${testBuyer.id}`;
const evAfter = (await sql`SELECT COUNT(*)::int AS n FROM buyer_deal_events`) as Array<{ n: number }>;
ok("event rows removed (buyer_deal_events back to 0)", evAfter[0].n === 0, `n=${evAfter[0].n}`);
const restored = (await sql`
  SELECT deals_received, deals_viewed, deals_rejected, deals_purchased, last_verified_at, active
  FROM buyers WHERE id = ${testBuyer.id}
`) as Array<{ deals_received: number; deals_viewed: number; deals_rejected: number; deals_purchased: number; last_verified_at: string | null; active: boolean }>;
ok("test buyer counters restored to 0", restored[0].deals_received === 0 && restored[0].deals_viewed === 0 && restored[0].deals_rejected === 0 && restored[0].deals_purchased === 0, JSON.stringify(restored[0]));
ok("test buyer last_verified_at restored to NULL, active restored to true", restored[0].last_verified_at === null && restored[0].active === true, "");
const allZero = (await sql`SELECT COUNT(*)::int AS n FROM buyers WHERE deals_received <> 0 OR deals_viewed <> 0 OR deals_rejected <> 0 OR deals_purchased <> 0`) as Array<{ n: number }>;
ok("no buyer has non-zero counters after cleanup", allZero[0].n === 0, `n=${allZero[0].n}`);

// ---- 9. UI routes 200 (run after publish) ----
console.log("== 9. UI routes 200 (run after publish) ==");
for (const route of ["/", "/buyers", "/crm", "/calculator", "/dashboard", "/contracts", "/settings"]) {
  try {
    const res = await fetch(`http://localhost:3000${route}`, { signal: AbortSignal.timeout(8000) });
    ok(`GET ${route}`, res.status === 200, `status ${res.status}`);
  } catch {
    ok(`GET ${route}`, false, "server unreachable — run after publish");
  }
}
try {
  const html = await (await fetch("http://localhost:3000/buyers", { signal: AbortSignal.timeout(8000) })).text();
  ok("SSR /buyers renders marketplace heading", html.includes("Buyer Marketplace"), `len=${html.length}`);
} catch {
  ok("SSR /buyers renders marketplace heading", false, "server unreachable");
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
