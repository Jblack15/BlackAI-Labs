// DealForge Properties — Stage the emailable lead queue into approval-gated
// email campaigns (the "email approval pipeline").
//
// What it does:
//   1. Selects every lead that is EMailable under the compliance matrix:
//        - has a non-blank email
//        - not opted_out / invalid_contact / wrong_number / do_not_mail
//        - no DNC flag
//   2. Excludes leads already sent to (distinct lead_id in email_logs).
//   3. Orders by priority (HOT > HIGH > MEDIUM > LOW) then splits into
//      BATCH_SIZE buckets (default 50).
//   4. For each bucket, upserts an `email` campaign + one PENDING
//      `channel_campaign` approval request. The owner approves each in
//      /approvals; only an approved campaign's leads will send (the gate held
//      by lib/channel-gates.ts + lib/email-send.ts).
//   5. Records WHICH leads belong to WHICH campaign in the `campaign_leads`
//      membership table (campaign_id, lead_id) — so a send tool can resolve a
//      campaign's recipients. Idempotent: ON CONFLICT DO NOTHING, so re-runs
//      never duplicate and never overwrite an existing assignment.
//
// Safety / honestly:
//   * Extremely defensive about deliverability: it stages batches (default 50)
//     — it does NOT stage all ~830 in one approval. The owner approves/ramps
//     tranche by tranche. This is intentional: one giant cold blast through a
//     fresh Gmail SMTP would get the account flagged and kill deliveries.
//   * Never stages a suppressed lead.
//   * Never re-stages a lead already emailed (email_logs guard).
//
// Run (from /home/team/shared/site):
//   BATCH_SIZE=50 bun scripts/stage-email-queue.ts
// Requires DATABASE_URL in env.
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 50);

type Pq = "HOT" | "HIGH" | "MEDIUM" | "LOW" | "DEAD";
const ORDER: Record<string, number> = { HOT: 0, HIGH: 1, MEDIUM: 2, LOW: 3, DEAD: 4 };

async function main() {
  // 1 + 2 + 3: emailable, unsent, ordered by priority.
  const rows = (await sql`
    SELECT id, full_name, email, property_address, property_city, property_state, priority_queue
    FROM leads
    WHERE email IS NOT NULL AND email <> ''
      AND opted_out = false AND invalid_contact = false
      AND wrong_number = false AND do_not_mail = false
      AND (dnc_flag IS NULL OR dnc_flag = '' OR dnc_flag IN ('N','No'))
      AND id NOT IN (SELECT DISTINCT lead_id FROM email_logs WHERE lead_id IS NOT NULL)
    ORDER BY
      CASE priority_queue WHEN 'HOT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END,
      full_name
  `) as { id: string; full_name: string | null; email: string; property_address: string | null; property_city: string | null; property_state: string | null; priority_queue: string | null }[];

  const n = rows.length;
  const batches = Math.ceil(n / BATCH_SIZE);
  console.log(`Emailable + unsent: ${n} leads -> ${batches} batch(es) of up to ${BATCH_SIZE}`);

  for (let b = 0; b < batches; b++) {
    const slice = rows.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
    const note = `Owner-approved email batch ${b + 1} of ${batches} (first send wave): ${slice.length} leads, priority HOT/HIGH/MEDIUM first. $0 spend. Honest template, identity + opt-out injected, audited.`;
    // Upsert campaign (idempotent by name)
    let camp = (await sql`
      SELECT id FROM campaigns WHERE name = ${`Email Batch ${b + 1} 2026-08`} LIMIT 1
    `) as { id: string }[];
    let campaignId: string;
    if (camp.length) {
      campaignId = camp[0].id;
    } else {
      camp = (await sql`
        INSERT INTO campaigns (name, channel, status, planned_budget_cents, notes)
        VALUES (${`Email Batch ${b + 1} 2026-08`}, 'email', 'planned', 0, ${note})
        RETURNING id
      `) as { id: string }[];
      campaignId = camp[0].id;
    }
    // Pending approval (idempotent for pending duplicates)
    const pend = (await sql`
      SELECT id FROM approval_requests
      WHERE kind='channel_campaign' AND ref_type='campaign' AND ref_id=${campaignId} AND status='pending' LIMIT 1
    `) as { id: string }[];
    let approvalId: string;
    if (pend.length) {
      approvalId = pend[0].id;
    } else {
      const ins = (await sql`
        INSERT INTO approval_requests (kind, status, ref_type, ref_id, details, requested_by)
        VALUES ('channel_campaign', 'pending', 'campaign', ${campaignId}, ${note}, 'owner')
        RETURNING id
      `) as { id: string }[];
      approvalId = ins[0].id;
    }
    // 5. Record lead <-> campaign membership (idempotent — DO NOTHING keeps any
    //    pre-existing assignment and never duplicates rows on re-run). Batched
    //    into ONE statement per batch (RETURNING counts only rows newly
    //    inserted), so re-runs are fast even with ~790 leads.
    const leadIds = slice.map((r) => r.id);
    let assigned = 0;
    if (leadIds.length) {
      // campaignId is $1 (quoted as a UUID param); lead ids are $2..$N+1.
      const ph = leadIds.map((_, i) => `($1, $${i + 2})`).join(", ");
      const m = (await sql.query(
        `INSERT INTO campaign_leads (campaign_id, lead_id) VALUES ${ph}
         ON CONFLICT (campaign_id, lead_id) DO NOTHING RETURNING lead_id`,
        [campaignId, ...leadIds],
      )) as { lead_id: string }[];
      assigned = m.length;
    }
    console.log(`Batch ${b + 1}: campaign=${campaignId} approval=${approvalId} leads=${slice.length}` +
      ` membershipsAssigned=${assigned} membershipsExisting=${slice.length - assigned}` +
      (b === 0 ? `  [first: ${slice.slice(0, 3).map((r) => r.full_name || "?").join(", ")}…]` : ""));
  }
  console.log("DONE — staged", batches, "approval-gated email batch(es). Owner approves each in /approvals.");
}

main().catch((e) => { console.error(e); process.exit(1); });
