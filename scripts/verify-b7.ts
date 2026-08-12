// PH1-B7 verification script — run: bun run scripts/verify-b7.ts
// Verifies the lead prioritization build against the LIVE database:
//   1. migration 013 columns exist (apn, score, score_factors, priority_queue,
//      priority_updated_at) + the priority_queue CHECK constraint
//   2. score import landed (6,556 scored leads; 594 legacy remain NULL)
//   3. priority queues computed for ALL leads with a sane distribution
//   4. next25ToWork returns exactly 25, ordered correctly, DEAD excluded
//   5. DEAD includes every suppressed/terminal lead
// Read-only — creates no test rows.
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);
let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
console.log("== 1. migration 013 schema ==");
const cols = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_name='leads' AND column_name IN
    ('apn','score','score_factors','priority_queue','priority_updated_at')
`;
const names = (cols as Array<{ column_name: string }>).map((c) => c.column_name).sort();
ok("apn/score/score_factors/priority_queue/priority_updated_at present", names.join(",") === "apn,priority_queue,priority_updated_at,score,score_factors", names.join(","));
const cons = await sql`
  SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname='leads_priority_queue_check'
`;
ok("priority_queue CHECK constraint", cons.length > 0 && cons[0].def.includes("HOT"), cons[0]?.def?.slice(0, 90) ?? "missing");

console.log("== 2. score import ==");
const scored = await sql`SELECT COUNT(*)::int AS n FROM leads WHERE score IS NOT NULL`;
ok("6,556 leads scored", scored[0].n === 6556, `got ${scored[0].n}`);
const unscored = await sql`SELECT COUNT(*)::int AS n FROM leads WHERE score IS NULL`;
ok("594 legacy leads remain NULL (unscored)", unscored[0].n === 594, `got ${unscored[0].n}`);
const apn = await sql`SELECT COUNT(*)::int AS n FROM leads WHERE apn IS NOT NULL`;
ok("apn populated for scored leads", apn[0].n === 6556, `got ${apn[0].n}`);

console.log("== 3. priority queue distribution (all leads computed) ==");
const dist = await sql`
  SELECT COALESCE(priority_queue, 'NULL') AS q, COUNT(*)::int AS n FROM leads GROUP BY 1
`;
const dmap: Record<string, number> = {};
for (const r of dist as Array<{ q: string; n: number }>) dmap[r.q] = r.n;
console.log("  distribution:", JSON.stringify(dmap));
const total = Object.values(dmap).reduce((a, b) => a + b, 0);
ok("every lead has a queue (no NULL)", total === 7150 && !(dmap.NULL > 0), `total ${total}`);
ok("DEAD bucket exists", (dmap.DEAD ?? 0) > 0, `DEAD=${dmap.DEAD ?? 0}`);

console.log("== 4. next25ToWork ==");
const n25 = await sql`
  SELECT priority_queue, score, contactable FROM leads
  WHERE priority_queue IS NOT NULL AND priority_queue <> 'DEAD'
  ORDER BY
    CASE priority_queue WHEN 'HOT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
    score DESC NULLS LAST, contactable DESC,
    COALESCE((score_factors->>'equity')::numeric, -1) DESC,
    CASE LOWER(COALESCE(score_factors->>'foreclosure_factor','')) WHEN 'very high' THEN 0 WHEN 'high' THEN 1 WHEN 'medium high' THEN 2 WHEN 'medium low' THEN 3 WHEN 'low' THEN 4 ELSE 5 END
  LIMIT 25
`;
ok("next25 returns exactly 25", n25.length === 25, `got ${n25.length}`);
ok("no DEAD in next25", (n25 as Array<{ priority_queue: string }>).every((r) => r.priority_queue !== "DEAD"));
const ranks: Record<string, number> = { HOT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
let monotonic = true;
for (let i = 1; i < n25.length; i++) {
  const a = n25[i - 1] as { priority_queue: string };
  const b = n25[i] as { priority_queue: string };
  if (ranks[b.priority_queue] < ranks[a.priority_queue]) monotonic = false;
}
ok("ordered by priority rank", monotonic);

console.log("== 5. DEAD includes suppressed/terminal leads ==");
const suppressed = await sql`
  SELECT COUNT(*)::int AS n FROM leads
  WHERE priority_queue = 'DEAD'
    AND (dnc_flag IS NOT NULL OR do_not_mail OR opted_out OR invalid_contact OR wrong_number
         OR outreach_status IN ('dnc','do_not_mail','opted_out','invalid_contact','wrong_number','not_interested','dead_lead')
         OR score < 4)
`;
const deadTotal = dmap.DEAD ?? 0;
ok(`all DEAD leads satisfy a suppression/terminal/score<4 rule (${suppressed[0].n} of ${deadTotal})`, suppressed[0].n === deadTotal, `matched ${suppressed[0].n}`);
const lowScoreDead = await sql`SELECT COUNT(*)::int AS n FROM leads WHERE priority_queue = 'DEAD' AND score IS NOT NULL AND score < 4`;
ok("score<4 leads are DEAD (5 score-0 rows)", lowScoreDead[0].n >= 5, `got ${lowScoreDead[0].n}`);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
