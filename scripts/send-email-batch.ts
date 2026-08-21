// DealForge Properties — Generalized EMAIL BATCH SEND tool.
//
// Sends one owner-approved email campaign's leads through the REAL audited,
// fail-closed pipeline (src/lib/email-send.ts sendSellerEmail + the channel
// gates in src/lib/channel-gates.ts). Unlike send-email-pilot.ts (hardcoded
// 13 ids), this tool resolves recipients from the campaign_leads membership
// table, so it works for any staged "Email Batch N 2026-08" campaign (or any
// campaign that has a campaign_leads membership + an owner-approved
// channel_campaign approval).
//
// Fail-closed (defense in depth, owner directive 2026-08-18/19):
//   1. Resolves the campaign by NAME or ID (env CAMPAIGN). Unknown campaign ->
//      abort, nothing sent.
//   2. Verify an owner-APPROVED channel_campaign approval exists for it
//      (hasApproval). NOT approved/pending/rejected -> abort with BLOCKED and a
//      non-zero exit — NO lead is emailed. This is the same gate sendSellerEmail
//      enforces per-send; checking up-front makes a not-yet-approved batch
//      obviously fail closed before any work.
//   3. Sends each member lead through sendSellerEmail( template 'initial',
//      campaignId = the campaign's id ). sendSellerEmail re-checks the gates
//      per lead (provider configured + approved campaign + per-lead
//      compliance) and throws/returns BLOCKED on any refusal.
//   4. Skips any lead already in email_logs (distinct lead_id) so re-runs are
//      safe — nothing is emailed twice.
//
// DRY_RUN guard (default ON for safety): unless DRY_RUN=0 is explicitly set,
// this tool RESOLVES + VERIFIES everything and prints exactly what WOULD be
// sent but transmits NOTHING. To actually send you must run with DRY_RUN=0 AND
// the campaign must be owner-approved AND SMTP credentials present.
//
// Run (from /home/team/shared/site):
//   CAMPAIGN="Email Batch 1 2026-08" DRY_RUN=1 bun scripts/send-email-batch.ts
//   CAMPAIGN="<campaign-id>"          DRY_RUN=0 bun scripts/send-email-batch.ts   (owner-approved + SMTP configured)
// Requires DATABASE_URL (+ SMTP_HOST/SMTP_USER/SMTP_PASS for a real send) in env.
import { sendSellerEmail, loadSellerLead } from "../src/lib/email-send";
import { hasApproval } from "../src/lib/approvals";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);
const TEMPLATE = "initial";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CampaignRow = { id: string; name: string; channel: string; status: string };

async function resolveCampaign(input: string): Promise<CampaignRow | null> {
  const byId = UUID_RE.test(input.trim());
  if (byId) {
    const rows = (await sql`SELECT id, name, channel, status FROM campaigns WHERE id = ${input.trim()}`) as CampaignRow[];
    return rows[0] ?? null;
  }
  const rows = (await sql`SELECT id, name, channel, status FROM campaigns WHERE name = ${input.trim()}`) as CampaignRow[];
  return rows[0] ?? null;
}

async function main() {
  const input = (process.env.CAMPAIGN || "").trim();
  if (!input) {
    console.error("BLOCKED — no CAMPAIGN provided. Set CAMPAIGN=<campaign name or id> (e.g. CAMPAIGN=\"Email Batch 1 2026-08\").");
    process.exit(2);
  }
  const dryRun = (process.env.DRY_RUN ?? "1") !== "0";

  const camp = await resolveCampaign(input);
  if (!camp) {
    console.error(`BLOCKED — campaign "${input}" not found in campaigns table. Nothing sent.`);
    process.exit(2);
  }
  if (camp.channel !== "email") {
    console.error(`BLOCKED — campaign "${camp.name}" is channel=${camp.channel}, not email. Nothing sent.`);
    process.exit(2);
  }

  // Fail-closed approval check (Gate 2 equivalent, done up-front so a not-yet-
  // approved batch aborts before loading/sending anything).
  const approved = await hasApproval("channel_campaign", "campaign", camp.id, ["approved"]);
  if (!approved) {
    console.error(
      `BLOCKED — campaign "${camp.name}" (${camp.id}) has NO owner-approved channel_campaign approval. ` +
        `Email channel is OFF for this campaign until the owner approves it in /approvals. Nothing sent.`,
    );
    process.exit(1);
  }

  // Load this campaign's recipients from the membership table.
  const members = (await sql`
    SELECT cl.lead_id
    FROM campaign_leads cl
    WHERE cl.campaign_id = ${camp.id}
    ORDER BY cl.lead_id
  `) as { lead_id: string }[];
  const leadIds = members.map((m) => m.lead_id);

  // Skip leads already emailed (re-run safety).
  const sentRows = (await sql`
    SELECT DISTINCT lead_id FROM email_logs WHERE lead_id IS NOT NULL
  `) as { lead_id: string }[];
  const alreadySent = new Set(sentRows.map((r) => r.lead_id));
  const idsToSend = leadIds.filter((id) => !alreadySent.has(id));
  const skipped = leadIds.length - idsToSend.length;

  console.log(
    `Campaign "${camp.name}" (${camp.id}): ${leadIds.length} members, ` +
      `${skipped} already emailed (skipped), ${idsToSend.length} to send. ` +
      `Approved: YES. DRY_RUN=${dryRun ? "ON (nothing will be sent)" : "OFF (REAL SEND)"}`,
  );
  if (idsToSend.length === 0) return;

  let sent = 0, failed = 0;
  for (const id of idsToSend) {
    const lead = await loadSellerLead(id);
    if (!lead) { console.log(`SKIP ${id} — lead not found`); continue; }
    const who = lead.full_name || id;
    if (!lead.email) { console.log(`SKIP ${who} — no email on file`); continue; }
    if (dryRun) {
      console.log(`PREVIEW ${who} <${lead.email}> — would send via ${TEMPLATE} (gated)`);
      continue;
    }
    try {
      const res = await sendSellerEmail(lead, { campaignId: camp.id, template: TEMPLATE });
      if (res.success) { console.log(`SENT ${who} <${lead.email}> (${res.messageId})`); sent++; }
      else { console.log(`FAIL ${who} <${lead.email}> — ${res.error}`); failed++; }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`BLOCKED ${who} <${lead.email}> — ${msg}`); failed++;
    }
  }
  const mode = dryRun ? "DRY-RUN (preview only, nothing sent)" : "REAL SEND";
  console.log(`\nDONE (${mode}) — sent=${sent} failed/blocked=${failed} skipped=${skipped} of ${leadIds.length}`);
  if (!dryRun && failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
