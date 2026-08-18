// PH1-B13 — Backfill the premium-13 leads (premium_lead=true + researched
// disposition) from the research (premium-13-disposition-2026-08-12.md).
//
// Idempotent: safe to re-run. Matches by APN (the stable key); any researched
// APN NOT found in the DB is reported, never guess-matched.
//
// Run:  bun run scripts/backfill-premium-13.ts
const { backfillPremium13 } = await import("../src/lib/premium-queue.ts");

const result = await backfillPremium13({ operator: "backfill-premium-13" });
console.log(`Backfill complete: ${result.updated} updated, ${result.matched} matched, ${result.unmatched.length} unmatched`);
for (const f of result.found) console.log(`  ${f.apn} → ${f.full_name}`);
for (const apn of result.unmatched) console.log(`  UNMATCHED (NOT in DB, reported not guessed): ${apn}`);
process.exit(result.unmatched.length === 0 && result.matched === 13 ? 0 : 1);
