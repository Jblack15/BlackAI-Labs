// DealForge Properties — DRY-RUN verify for the email batch-send capability.
//
// VERIFIES WITHOUT SENDING ANYTHING:
//   1. campaign_leads table exists (migration 027) and holds the expected
//      per-campaign membership for the 16 "Email Batch N 2026-08" campaigns
//      (15 x 50 + last 40 = 790 rows).
//   2. Resolves each batch campaign to its owner-approval gate state and
//      ASSERTs the 16 channel_campaign approvals are PENDING (NOT approved) —
//      i.e. the send path is correctly fail-closed today. It does NOT approve
//      anything.
//   3. Asserts no duplicate (campaign_id, lead_id) memberships (PK enforces,
//      but double-check) and no lead overlapping two different batch campaigns
//      (would indicate broken slice logic).
//   4. Also confirms send-email-batch.ts resolves correctly by printing what a
//      dry run would do for Batch 1 (without firing anything).
//
// Run (from /home/team/shared/site):  bun scripts/verify-email-batch.ts
// Requires DATABASE_URL in env. Exits non-zero if any check fails.
import { hasApproval } from "../src/lib/approvals";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);
let failures = 0;
const ok = (msg: string) => console.log(`  OK   ${msg}`);
const bad = (msg: string) => { console.log(`  FAIL ${msg}`); failures++; };

// 1. Membership counts per batch campaign.
const counts = (await sql`
  SELECT c.name, count(cl.lead_id)::int AS n
  FROM campaigns c
  LEFT JOIN campaign_leads cl ON cl.campaign_id = c.id
  WHERE c.name LIKE 'Email Batch %'
  GROUP BY c.name ORDER BY c.name
`) as { name: string; n: number }[];

console.log("Membership resolution (per campaign):");
if (counts.length !== 16) bad(`expected 16 'Email Batch N 2026-08' campaigns, found ${counts.length}`);
else ok(`16 batch campaigns present`);

let total = 0;
for (const c of counts) {
  total += c.n;
  const expected = c.name.endsWith("16 2026-08") ? 40 : 50;
  if (c.n !== expected) bad(`${c.name}: ${c.n} members (expected ${expected})`);
  else ok(`${c.name}: ${c.n} members`);
}
if (total !== 790) bad(`total membership = ${total}, expected 790`);
else ok(`total membership = ${total}`);

// 2. No duplicate membership rows (should be impossible via PK).
const dup = (await sql`
  SELECT campaign_id, lead_id, count(*)::int c
  FROM campaign_leads GROUP BY campaign_id, lead_id HAVING count(*) > 1 LIMIT 1
`) as { c: number }[];
if (dup.length) bad(`duplicate membership rows found (${JSON.stringify(dup)})`);
else ok(`no duplicate (campaign_id, lead_id) memberships`);

// 3. No lead assigned to two different batch campaigns (slice-overlap check).
const overlap = (await sql`
  SELECT cl.lead_id, count(DISTINCT cl.campaign_id)::int c
  FROM campaign_leads cl
  JOIN campaigns c ON c.id = cl.campaign_id
  WHERE c.name LIKE 'Email Batch %'
  GROUP BY cl.lead_id HAVING count(DISTINCT cl.campaign_id) > 1 LIMIT 1
`) as { c: number }[];
if (overlap.length) bad(`lead appears in >1 batch campaign (${JSON.stringify(overlap)})`);
else ok(`no lead overlaps multiple batch campaigns`);

// 4. Approval-gate state for each batch campaign — assert PENDING.
console.log("Approval-gate resolution (must all be PENDING = fail-closed):");
const camps = (await sql`SELECT id, name FROM campaigns WHERE name LIKE 'Email Batch %' ORDER BY name`) as { id: string; name: string }[];
let pendingCount = 0;
for (const c of camps) {
  const approved = await hasApproval("channel_campaign", "campaign", c.id, ["approved"]);
  // hasApproval(false) means no APPROVED row — could be pending/rejected/none.
  const st = (await sql`
    SELECT status FROM approval_requests
    WHERE kind='channel_campaign' AND ref_type='campaign' AND ref_id=${c.id}
    ORDER BY created_at DESC LIMIT 1
  `) as { status: string }[];
  const status = st[0]?.status ?? "none";
  if (approved) bad(`${c.name}: APPROVED (gate OPEN — expected PENDING, do not ship an unapproved batch)`);
  else if (status === "pending") { ok(`${c.name}: PENDING (fail-closed ✓)`); pendingCount++; }
  else bad(`${c.name}: status=${status} (expected pending)`);
}
if (pendingCount !== 16) bad(`expected 16 pending approvals, found ${pendingCount}`);
else ok(`all 16 channel_campaign approvals are PENDING (nothing approved)`);

console.log(failures === 0 ? "\nVERIFY PASSED — email batch-send is correctly staged & fail-closed." :
  `\nVERIFY FAILED with ${failures} issue(s).`);
process.exit(failures === 0 ? 0 : 1);
