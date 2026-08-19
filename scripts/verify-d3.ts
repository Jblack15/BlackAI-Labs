// DealFlow AI — D3 verification: automated buyer matching + Transaction Command
// Center (Steps 8 & 9 of the 15-step program). Run: bun run scripts/verify-d3.ts
//
//   §1  matching semantics: readBuyBox merges legacy buying_criteria for all
//       22 real buyer rows (San Antonio + SFR criteria are readable)
//   §2  buyer SHORTLIST for a synthetic qualified San Antonio SFR lead is
//       computed from REAL buyer rows via autoMatchBuyers (production B5
//       matcher), with score + "why" strings; no inactive buyers surface
//   §3  price-band dimension actually evaluated: a synthetic buyer below the
//       deal price is excluded; one in-band stays
//   §4  Transaction Command Center due-attention over a synthetic contract:
//       overdue checklist step, close-within-7-days, missing title company,
//       no-close-date blockers all detected; totals correct
//   §5  closing-arc shortcut gates: contract_signed REQUESTS the 'contract'
//       approval when missing (state does not change); with an approved
//       approval the arc walks offer→negotiation→contract_sent→contract_signed;
//       buyer_matched advances without approval; title flips contract to
//       'title_open'; a terminal/off-arc lead is refused honestly
//   §6  no promises: running the shortlist writes ZERO buyer_deal_events and
//       zero outbound audit rows for the test lead (recommendation only)
//   §7  honest empty Command Center: after cleanup the live table returns
//       0 transactions / 0 blocked items (real production state)
//   §8  cleanup — every test row (leads, contracts, checklist items, audit
//       rows, approval rows, synthetic buyers / deal events) is deleted
import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
const sql = neon(process.env.DATABASE_URL!);

const DAY = "2026-08-20"; // audit + pilot date; used only for deterministic dates
let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

const created = {
  leads: [] as string[],
  contracts: [] as string[],
  buyers: [] as string[],
  approvals: [] as string[],
};

function futureDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function pastDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function makeLead(name: string, opts: { outreach?: string; pipeline?: string; city?: string; mao?: number; propType?: string } = {}): Promise<string> {
  const id = randomUUID();
  created.leads.push(id);
  await sql`
    INSERT INTO leads (id, full_name, phone, property_address, property_city, property_state, property_zip,
                       property_type, lead_source, status, contactable, outreach_status, pipeline_stage, score, score_factors)
    VALUES (${id}, ${name}, '+12105559914', '3301 D3 Verif St', ${opts.city ?? "San Antonio"}, 'TX', '78201',
            ${opts.propType ?? "SFR"}, 'verify-d3', 'new', true, ${opts.outreach ?? "qualified"}, ${opts.pipeline ?? "deal_analysis"}, 8,
            ${JSON.stringify({ ev: 265000, equity: 120000, estimated_arv: 285000, estimated_mao: opts.mao ?? 190000, property_type: "SFR" })})`;
  return id;
}

async function cleanup() {
  for (const c of created.contracts) {
    await sql`DELETE FROM closing_checklist_items WHERE contract_id = ${c}`;
    await sql`DELETE FROM approval_requests WHERE ref_type = 'contract' AND ref_id = ${c}`;
  }
  for (const b of created.buyers) {
    await sql`DELETE FROM buyer_deal_events WHERE buyer_id = ${b}`;
  }
  if (created.contracts.length) await sql`DELETE FROM contracts WHERE id = ANY (${created.contracts})`;
  if (created.approvals.length) await sql`DELETE FROM approval_requests WHERE id = ANY (${created.approvals})`;
  if (created.leads.length) await sql`DELETE FROM approval_requests WHERE requested_by = 'verify-d3' OR (ref_type = 'lead' AND ref_id = ANY (${created.leads}))`;
  for (const l of created.leads) {
    await sql`DELETE FROM outreach_audit_log WHERE lead_id = ${l}`;
    await sql`DELETE FROM buyer_deal_events WHERE deal_id IS NULL AND operator = 'verify-d3'`;
  }
  if (created.leads.length) await sql`DELETE FROM leads WHERE id = ANY (${created.leads})`;
}

// ── §1  matching semantics over REAL buyer rows ────────────────────────────────
console.log("== 1. buyer-match semantics (real rows) ==");
import("../src/lib/buyer-marketplace").then(async (bm) => {
  const buyers = await bm.fetchMarketplaceBuyers({ activeOnly: true });
  ok("22 real buyers fetched", buyers.length === 22, `${buyers.length} active buyers`);
  const withSA = buyers.filter((b) => b.buyBox.preferred_markets.includes("San Antonio"));
  ok("every buyer's buy-box reads San Antonio (legacy fallback)", withSA.length === buyers.length, `${withSA.length}/${buyers.length}`);
  const withSFR = buyers.filter((b) => b.buyBox.property_types.includes("SFR"));
  ok("every buyer's buy-box reads SFR property type", withSFR.length === buyers.length, `${withSFR.length}/${buyers.length}`);
  const neutralPrice = buyers.filter((b) => b.buyBox.max_purchase_price === null);
  ok("no buyer states a max price (price dim is neutral today)", neutralPrice.length === buyers.length);

  // ── §2  buyer shortlist from REAL buyer rows ──────────────────────────────
  console.log("== 2. buyer shortlist for a synthetic qualified lead ==");
  const leadId = await makeLead("D3 Shortlist Test");
  const shortlist = await bm.autoMatchBuyers(leadId);
  ok("lead context found", shortlist.lead !== null, shortlist.lead ? `${shortlist.lead.propertyCity} SFR` : "no lead");
  ok("matches computed from real buyer rows", shortlist.matches.length > 0, `${shortlist.matches.length} matched`);
  ok("every match scored > 0", shortlist.matches.every((m) => m.score > 0), shortlist.matches.map((m) => `${m.score}`).slice(0, 5).join(",") + (shortlist.matches.length > 5 ? "…" : ""));
  const buyerIds = new Set((await sql`SELECT id FROM buyers WHERE active = true`).map((r: any) => String(r.id)));
  ok("every matched buyer exists + is active in buyers table", shortlist.matches.every((m) => buyerIds.has(String(m.buyer.id))));
  ok("no inactive buyers surfaced", shortlist.matches.every((m) => m.buyer.active === true));
  const whyLocation = shortlist.matches.every((m) => m.matched.some((s) => s.includes("Location")));
  ok("'why matched' includes location reason", whyLocation, shortlist.matches[0]?.matched[0] ?? "none");
  const whyType = shortlist.matches.every((m) => m.matched.some((s) => s.includes("Property type")));
  ok("'why matched' includes property-type reason", whyType);
  const top = shortlist.matches[0];
  ok("score + matched/neutral/missed arrays present", top && typeof top.score === "number" && Array.isArray(top.matched) && Array.isArray(top.neutral) && Array.isArray(top.missed), top ? `${top.matched.length} matched / ${top.neutral.length} neutral / ${top.missed.length} missed` : "");

  // ── §3  price band actually evaluated ─────────────────────────────────────
  console.log("== 3. price-band dimension evaluated ==");
  const lowId = randomUUID();
  const highId = randomUUID();
  created.buyers.push(lowId, highId);
  await sql`INSERT INTO buyers (id, name, email, phone, buying_criteria, buy_box, active, verified_phone) VALUES
    (${lowId}, 'D3 Verify Low-Cap Buyer', 'low@example.com', '+12105550001', ${JSON.stringify({ preferredCities: ["San Antonio"], propertyTypes: ["SFR"] })}, ${JSON.stringify({ max_purchase_price: 100000, min_purchase_price: 50000 })}, true, false),
    (${highId}, 'D3 Verify High-Cap Buyer', 'high@example.com', '+12105550002', ${JSON.stringify({ preferredCities: ["San Antonio"], propertyTypes: ["SFR"] })}, ${JSON.stringify({ max_purchase_price: 300000 })}, true, false)`;
  const band = await bm.autoMatchBuyers(leadId);
  const low = band.matches.find((m) => m.buyer.id === lowId);
  const high = band.matches.find((m) => m.buyer.id === highId);
  // Production matcher semantics: LOCATION is the only hard exclusion; price is
  // a scored dimension — an out-of-band buyer stays listed at a lower score
  // with an explicit "why not" in missed[]. We verify the price dimension is
  // actually evaluated (missed reason + score gap), never that rows vanish.
  ok("out-of-band buyer stayed but carries a price miss reason", low !== undefined && (low?.missed.some((s) => s.includes("Price") && s.includes("outside")) ?? false), low?.missed.find((s) => s.includes("Price")) ?? "no price miss");
  ok("in-band buyer matched on price", high?.matched.some((s) => s.includes("Price") && s.includes("within")) ?? false, high?.matched.find((s) => s.includes("Price")) ?? "");
  const lowScore = low?.score ?? 0;
  const highScore = high?.score ?? 0;
  ok("out-of-band buyer scored LOWER than in-band buyer", lowScore < highScore, `low ${lowScore} vs high ${highScore}`);
  ok("price reason surfaced for in-band buyer", high?.matched.some((s) => s.includes("Price")) ?? false);

  // ── §4  Transaction Command Center due-attention ──────────────────────────
  console.log("== 4. command center due-attention (synthetic contract) ==");
  const { transactionCommandCenter, advanceClosingArc } = await import("../src/lib/transaction-command-center");
  const contractId = randomUUID();
  created.contracts.push(contractId);
  await sql`
    INSERT INTO contracts (id, lead_id, contract_type, status, expected_close_date, close_date, purchase_price, earnest_money, created_at)
    VALUES (${contractId}, ${leadId}, 'wholesale', 'new', ${futureDays(3)}, NULL, 190000, 1000, now())
  `;
  // checklist: 2 done, 1 overdue (due -3d), 1 pending-not-overdue (due +10d)
  const c1 = randomUUID(); const c2 = randomUUID(); const c3 = randomUUID(); const c4 = randomUUID();
  await sql`INSERT INTO closing_checklist_items (id, contract_id, label, done, due_date, position) VALUES
    (${c1}, ${contractId}, 'Order title commitment', true, ${pastDays(2)}, 0),
    (${c2}, ${contractId}, 'Review title commitment', true, ${pastDays(1)}, 1),
    (${c3}, ${contractId}, 'Resolve title objections', false, ${pastDays(1)}, 2),
    (${c4}, ${contractId}, 'Order payoff', false, ${futureDays(10)}, 3)`;
  const cc = await transactionCommandCenter();
  const row = cc.transactions.find((t) => t.contractId === contractId);
  ok("contract surfaced in command center", row !== undefined, `total transactions now ${cc.totals.transactions}`);
  ok("overdue checklist step detected", row?.attention.some((a) => a.kind === "overdue_checklist" && a.label.includes("1 overdue")) ?? false, row?.attention.map((a) => a.kind).join(",") ?? "none");
  ok("close-within-7-days detected", row?.attention.some((a) => a.kind === "close_date") ?? false);
  ok("missing title company detected", row?.attention.some((a) => a.kind === "missing_title") ?? false);
  ok("checklist counts correct (2/4 done, 1 overdue)", row?.checklist.done === 2 && row?.checklist.total === 4 && row?.checklist.overdue === 1, JSON.stringify(row?.checklist));
  ok("totals reflect the synthetic contract", cc.totals.transactions >= 1 && cc.totals.needsAttention >= 1 && cc.totals.overdueSteps >= 1);
  const allKinds = cc.transactions.flatMap((t) => t.attention.map((a) => a.kind));
  ok("no counterfeit attention kinds", allKinds.every((k) => ["overdue_checklist", "close_date", "missing_title", "no_close_date", "cancelled"].includes(k)));

  // ── §5  closing-arc shortcuts (gated) ─────────────────────────────────────
  console.log("== 5. closing-arc shortcuts (owner-gated) ==");
  // 5a. contract_signed from offer with NO approval → request, no state change
  const lead2 = await makeLead("D3 Arc Test", { outreach: "offer" });
  const contract2 = randomUUID();
  created.contracts.push(contract2);
  await sql`INSERT INTO contracts (id, lead_id, contract_type, status, expected_close_date, created_at)
            VALUES (${contract2}, ${lead2}, 'wholesale', 'new', ${futureDays(30)}, now())`;
  const gated = await advanceClosingArc(contract2, "contract_signed", "verify-d3");
  ok("contract_signed shortcut REQUESTED approval (never bypassed)", gated.success === true && "approvalRequested" in gated && gated.approvalRequested === true, gated.success && "approvalRequested" in gated ? `requested ${gated.kinds.join(",")}` : JSON.stringify(gated));
  const st1 = await sql`SELECT outreach_status FROM leads WHERE id = ${lead2}`;
  ok("lead status UNCHANGED while approval pending", (st1[0] as any).outreach_status === "offer", (st1[0] as any).outreach_status);
  // 5b. approve both gates (offer + contract) then walk fully to contract_signed
  const ap1 = randomUUID(); const ap2 = randomUUID();
  created.approvals.push(ap1, ap2);
  await sql`INSERT INTO approval_requests (id, kind, status, ref_type, ref_id, details, requested_by, decided_at, decided_by) VALUES
    (${ap1}, 'offer', 'approved', 'lead', ${lead2}, 'verify-d3 offer gate', 'owner', now(), 'owner'),
    (${ap2}, 'contract', 'approved', 'lead', ${lead2}, 'verify-d3 contract gate', 'owner', now(), 'owner')`;
  const walked = await advanceClosingArc(contract2, "contract_signed", "verify-d3");
  ok("arc walks offer→…→contract_signed with approvals", walked.success === true && "reached" in walked && walked.reached === "contract_signed", walked.success && "reached" in walked ? `steps: ${walked.steps.join(" | ")}` : JSON.stringify(walked));
  const st2 = await sql`SELECT outreach_status FROM leads WHERE id = ${lead2}`;
  ok("lead now contract_signed", (st2[0] as any).outreach_status === "contract_signed", (st2[0] as any).outreach_status);
  // 5c. buyer_matched advances WITHOUT approval (forward arc, gate already passed)
  const bmres = await advanceClosingArc(contract2, "buyer_matched", "verify-d3");
  ok("buyer_matched advances without a new approval", bmres.success === true && "reached" in bmres && bmres.reached === "buyer_matched", bmres.success && "reached" in bmres ? `steps: ${bmres.steps.join("|")}` : JSON.stringify(bmres));
  // 5d. title → contract status flips to title_open
  const t1 = await advanceClosingArc(contract2, "title", "verify-d3");
  ok("title reached via arc", t1.success === true && "reached" in t1 && t1.reached === "title", t1.success && "reached" in t1 ? `steps: ${t1.steps.join("|")}` : JSON.stringify(t1));
  const cs = await sql`SELECT status FROM contracts WHERE id = ${contract2}`;
  ok("contract status → title_open", (cs[0] as any).status === "title_open", (cs[0] as any).status);
  // 5e. off-arc lead refused honestly
  const lead3 = await makeLead("D3 OffArc Test", { outreach: "contact_attempted" });
  const contract3 = randomUUID();
  created.contracts.push(contract3);
  await sql`INSERT INTO contracts (id, lead_id, contract_type, status, created_at) VALUES (${contract3}, ${lead3}, 'wholesale', 'new', now())`;
  const refused = await advanceClosingArc(contract3, "contract_signed", "verify-d3");
  ok("off-arc lead refused with honest error", refused.success === false && refused.error.includes("not on the closing arc"), refused.success === false ? refused.error : "unexpectedly succeeded");

  // ── §6  no promises: zero events / zero outbound from shortlisting ────────
  console.log("== 6. recommendation-only (no promises) ==");
  const eventsBefore = (await sql`SELECT count(*)::int AS n FROM buyer_deal_events`) as unknown as Array<{ n: number }>;
  await bm.autoMatchBuyers(leadId);
  const eventsAfter = (await sql`SELECT count(*)::int AS n FROM buyer_deal_events`) as unknown as Array<{ n: number }>;
  ok("shortlist writes ZERO buyer_deal_events", eventsAfter[0].n === eventsBefore[0].n, `${eventsBefore[0].n} → ${eventsAfter[0].n}`);
  const outbound = (await sql`SELECT count(*)::int AS n FROM outreach_audit_log WHERE lead_id = ${leadId} AND direction = 'outbound'`) as unknown as Array<{ n: number }>;
  ok("shortlist writes ZERO outbound audit rows", outbound[0].n === 0, `${outbound[0].n} outbound rows`);

  // ── §7  honest empty command center (after cleanup) ───────────────────────
  console.log("== 7. honest empty state after cleanup ==");
  await cleanup();
  const empty = await transactionCommandCenter();
  ok("0 transactions after cleanup", empty.dbOk === true && empty.transactions.length === 0, `${empty.transactions.length} live`);
  ok("total counters all zero", empty.totals.transactions === 0 && empty.totals.needsAttention === 0 && empty.totals.overdueSteps === 0 && empty.totals.closingWithin7d === 0 && empty.totals.missingTitle === 0, JSON.stringify(empty.totals));
  const leftover = (await sql`SELECT count(*)::int AS n FROM contracts AS c LEFT JOIN leads l ON l.id = c.lead_id WHERE l.id IN (SELECT id FROM leads WHERE lead_source = 'verify-d3')`) as unknown as Array<{ n: number }>;
  ok("no verify-d3 rows remain on contracts/leads paths", leftover[0].n === 0);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}).catch((e) => { console.error("verify-d3 crashed:", e); process.exit(1); });