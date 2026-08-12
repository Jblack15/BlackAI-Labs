// PH1-B8 verification script — run: bun run scripts/verify-b8.ts
// Verifies the seller-pipeline CRM build against the LIVE database:
//   1. migration 014 columns exist + the occupancy CHECK constraint
//   2. all 13 seller fields start NULL for every lead (nothing fabricated)
//   3. seller summaries exist for the 6,556 scored leads (after
//      refreshSellerSummaries) and are honest (no invented asking/occupancy)
//   4. generateSellerSummary returns honest text for a scored lead (includes
//      score / MAO / queue; says "unknown — requires seller contact" for the
//      unrecorded seller fields)
//   5. a save via saveSellerCrmFields writes an outreach_audit_log row
//      (channel='seller_crm', direction='internal', status='updated'),
//      persists the fields, sets last_contact_at when explicitly provided,
//      and regenerates the summary — then cleans up every test artifact
//      (fields reset to NULL, audit rows deleted) so the DB is left untouched
//   6. UI routes 200 (run after publish; / /crm /dashboard /settings)
import { neon } from "@neondatabase/serverless";
import { generateSellerSummary } from "../src/lib/seller-summary";
import { saveSellerCrmFields } from "../src/lib/seller-crm";

const sql = neon(process.env.DATABASE_URL!);
let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

const B8_COLS = [
  "asking_price", "desired_close", "occupancy", "motivation",
  "mortgage_balance", "mortgage_lender", "lien_info", "last_contact_at",
  "next_action", "next_action_due", "seller_notes", "seller_summary",
  "seller_summary_updated_at",
];

console.log("== 1. migration 014 schema ==");
const cols = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_name='leads' AND column_name = ANY(${B8_COLS})
`;
const names = (cols as Array<{ column_name: string }>).map((c) => c.column_name).sort();
const missing = B8_COLS.filter((c) => !names.includes(c));
ok("all 13 seller-CRM columns present", missing.length === 0, missing.length ? `missing: ${missing.join(",")}` : names.join(","));
const cons = await sql`
  SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname='leads_occupancy_check'
`;
ok("occupancy CHECK constraint", cons.length > 0 && cons[0].def.includes("owner") && cons[0].def.includes("tenant"), cons[0]?.def?.slice(0, 100) ?? "missing");

console.log("== 2. all new fields start NULL (no fabrication) ==");
const nulls = await sql`
  SELECT COUNT(*)::int AS n,
    COUNT(asking_price)::int AS a, COUNT(desired_close)::int AS d,
    COUNT(occupancy)::int AS o, COUNT(motivation)::int AS m,
    COUNT(mortgage_balance)::int AS mb, COUNT(mortgage_lender)::int AS ml,
    COUNT(lien_info)::int AS li, COUNT(last_contact_at)::int AS lc,
    COUNT(next_action)::int AS na, COUNT(next_action_due)::int AS nd,
    COUNT(seller_notes)::int AS sn
  FROM leads
`;
const n0 = nulls[0] as Record<string, number>;
ok("7,150 leads, seller fields NULL except seller_summary", n0.n === 7150 && n0.a + n0.d + n0.o + n0.m + n0.mb + n0.ml + n0.li + n0.lc + n0.na + n0.nd + n0.sn === 0, JSON.stringify(n0));

console.log("== 3. seller summaries populated + honest ==");
const sum = await sql`
  SELECT COUNT(*)::int AS n, COUNT(seller_summary)::int AS s, COUNT(seller_summary_updated_at)::int AS u
  FROM leads WHERE score_factors IS NOT NULL
`;
ok("6,556 scored leads all have a generated summary", sum[0].s === 6556 && sum[0].u === 6556, `summaries=${sum[0].s} timestamps=${sum[0].u}`);
const bad = await sql`
  SELECT COUNT(*)::int AS n FROM leads
  WHERE seller_summary IS NOT NULL AND seller_summary NOT LIKE '%unknown — requires seller contact%'
`;
ok("every summary honestly flags unrecorded seller fields", bad[0].n === 0, `non-honest=${bad[0].n}`);

console.log("== 4. generateSellerSummary (pure) on a scored lead ==");
const scored = await sql`
  SELECT id, full_name, property_address, property_city, property_state, property_zip,
         score, priority_queue, trace_status, contactable, outreach_status,
         dnc_flag, do_not_mail, opted_out, invalid_contact, wrong_number,
         score_factors, asking_price, desired_close, occupancy, motivation,
         mortgage_balance, mortgage_lender, lien_info, last_contact_at,
         next_action, next_action_due, seller_notes
  FROM leads
  WHERE score IS NOT NULL AND priority_queue = 'HIGH'
  ORDER BY score DESC LIMIT 1
`;
const lead = scored[0] as Record<string, unknown>;
const summary = generateSellerSummary(lead as never);
console.log("  sample summary:\n" + summary.split("\n").map((l) => "    " + l).join("\n"));
ok("summary mentions score", /Score: \d+\/10/.test(summary), "");
ok("summary mentions queue", /Queue: (HOT|HIGH|MEDIUM|LOW|DEAD)/.test(summary), "");
ok("summary mentions est. MAO", /est\. MAO \$[\d,]+/.test(summary), "");
ok("no invented asking price", summary.includes("asking price unknown — requires seller contact"), "");
ok("no invented occupancy", summary.includes("occupancy unknown — requires seller contact"), "");
ok("no invented motivation", summary.includes("motivation unknown — requires seller contact"), "");
ok("honesty label present", summary.includes("no AI model connected"), "");

console.log("== 5. save via saveSellerCrmFields writes an audit row ==");
const testLeadRows = await sql`
  SELECT id FROM leads WHERE priority_queue = 'DEAD' ORDER BY created_at ASC LIMIT 1
`;
const testLeadId = (testLeadRows[0] as { id: string }).id;
const preStatus = (await sql`SELECT outreach_status FROM leads WHERE id = ${testLeadId}`)[0].outreach_status;
const saveRes = await saveSellerCrmFields(
  testLeadId,
  {
    askingPrice: 1,
    occupancy: "unknown",
    nextAction: "verify-b8 test",
    lastContactAt: "2026-08-12T12:00:00Z",
  },
  { operator: "verify-b8" },
);
ok("save succeeds", saveRes.success, saveRes.error ?? `fieldSummary=${saveRes.fieldSummary}`);
const saved = await sql`
  SELECT asking_price, occupancy, next_action, last_contact_at, seller_summary
  FROM leads WHERE id = ${testLeadId}
`;
const sv = saved[0] as Record<string, unknown>;
ok("asking_price persisted", Number(sv.asking_price) === 1, `got ${sv.asking_price}`);
ok("occupancy persisted", sv.occupancy === "unknown", `got ${sv.occupancy}`);
ok("next_action persisted", sv.next_action === "verify-b8 test", `got ${sv.next_action}`);
ok("last_contact_at written (explicit contact-type field)", sv.last_contact_at !== null, `got ${String(sv.last_contact_at)}`);
ok("summary regenerated after save", typeof sv.seller_summary === "string" && sv.seller_summary.includes("asking price $1"), "summary reflects recorded asking price");
const audit = await sql`
  SELECT channel, direction, status, content_preview, operator
  FROM outreach_audit_log
  WHERE lead_id = ${testLeadId} AND operator = 'verify-b8' AND channel = 'seller_crm'
`;
ok("audit row written (seller_crm/internal/updated)", audit.length >= 1 && audit[0].channel === "seller_crm" && audit[0].direction === "internal" && audit[0].status === "updated", `rows=${audit.length} preview=${audit[0]?.content_preview}`);
ok("audit preview is the field summary", String(audit[0]?.content_preview ?? "").includes("asking_price") && String(audit[0]?.content_preview ?? "").includes("next_action"), `got ${audit[0]?.content_preview}`);
const postStatus = (await sql`SELECT outreach_status FROM leads WHERE id = ${testLeadId}`)[0].outreach_status;
ok("outreach_status untouched by save", postStatus === preStatus, `before=${preStatus} after=${postStatus}`);

// --- Cleanup: restore the test lead to pristine NULL and drop test audit rows ---
await sql`
  UPDATE leads SET asking_price = NULL, desired_close = NULL, occupancy = NULL,
    motivation = NULL, mortgage_balance = NULL, mortgage_lender = NULL,
    lien_info = NULL, last_contact_at = NULL, next_action = NULL,
    next_action_due = NULL, seller_notes = NULL, seller_summary = NULL,
    seller_summary_updated_at = NULL
  WHERE id = ${testLeadId}
`;
await sql`DELETE FROM outreach_audit_log WHERE operator = 'verify-b8' AND channel = 'seller_crm'`;
const after = await sql`
  SELECT COUNT(*)::int AS n FROM outreach_audit_log WHERE operator = 'verify-b8' AND channel = 'seller_crm'
`;
const cleanLead = await sql`SELECT asking_price, last_contact_at FROM leads WHERE id = ${testLeadId}`;
ok("cleanup complete (audit rows removed, fields NULL)", after[0].n === 0 && cleanLead[0].asking_price === null && cleanLead[0].last_contact_at === null, "DB left pristine");
// The test lead may be scored — restore its own data-derived summary (from its
// now-pristine state) so the scored-summary count stays 6,556.
const restoredLead = await sql`
  SELECT id, full_name, property_address, property_city, property_state, property_zip,
         score, priority_queue, trace_status, contactable, outreach_status,
         dnc_flag, do_not_mail, opted_out, invalid_contact, wrong_number,
         score_factors, asking_price, desired_close, occupancy, motivation,
         mortgage_balance, mortgage_lender, lien_info, last_contact_at,
         next_action, next_action_due, seller_notes
  FROM leads WHERE id = ${testLeadId}
`;
const restoredSummary = generateSellerSummary(restoredLead[0] as never);
await sql`
  UPDATE leads SET seller_summary = ${restoredSummary}, seller_summary_updated_at = now()
  WHERE id = ${testLeadId} AND score_factors IS NOT NULL
`;

console.log("== 6. UI routes 200 (run after publish) ==");
for (const route of ["/", "/crm", "/dashboard", "/settings"]) {
  try {
    const res = await fetch(`http://localhost:3000${route}`, { signal: AbortSignal.timeout(8000) });
    ok(`GET ${route}`, res.status === 200, `status ${res.status}`);
  } catch {
    ok(`GET ${route}`, false, "server unreachable — run after publish");
  }
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
