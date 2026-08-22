// DealFlow AI — Self-Pacing Batch Email Sender (fail-closed)
//
// PURPOSE
//   Delivers the REMAINING unsent leads across ALL owner-approved
//   "Email Batch N 2026-08" campaigns (Batches 1–16), spread across several
//   days so we never trip Gmail SMTP's per-day sending cap again. A single
//   blast of all batches at once produced `454 4.7.0 ... 7126229` rate-limit
//   errors; this tool enforces a rolling 24-hour MAX_PER_DAY budget so it can
//   be run once a day (or several times a day) until the queue drains.
//
// SAFETY / FAIL-CLOSED
//   - DRY_RUN defaults to "1" (ON). A REAL send requires DRY_RUN=0 AND the
//     campaigns owner-approved AND SMTP credentials present.
//   - Only campaigns that have an owner-approved `channel_campaign` approval
//     are eligible. Any matching-but-not-approved campaign is skipped and
//     reported; nothing is ever sent from it.
//   - Re-runs are idempotent: any lead already successfully emailed
//     (email_logs status='sent') is ALWAYS skipped.
//   - Suppressed/opted-out/invalid leads and leads with no email are filtered
//     out up front (and sendSellerEmail re-enforces the compliance gate).
//   - Every send goes through the real audited path (sendSellerEmail), so each
//     attempt is logged to email_logs + outreach_audit_log exactly like the
//     working batches. The audit trail is never bypassed.
//   - Rate-limit (454 / 4xx "limit"/"try again") failures are NON-FATAL: the
//     lead is left unsent (it stays in the queue) and the run stops, so a
//     re-run tomorrow retries it. Only true hard errors (DB / unexpected)
//     produce a non-zero exit.
//
// DAILY CAP
//   MAX_PER_DAY (default 200) is compared against the number of email_logs
//   rows (any status: sent + failed attempts, i.e. every transmission) whose
//   created_at falls within the last 24 hours — the schema's closest analogue
//   to "sent this day" (email_logs has created_at, no separate sent_at).
//   Counting ALL rows is deliberately conservative (fail-closed): a rejected
//   454 attempt is still logged and is counted so we never overshoot the
//   sender's window again.
//
// Run (from /home/team/shared/site):
//   DRY_RUN=1                          bun scripts/send-email-paced.ts   (preview; default, sends nothing)
//   MAX_PER_DAY=200 DELAY_MS=1500      bun scripts/send-email-paced.ts   (preview with custom cap/delay)
//   DRY_RUN=0                          bun scripts/send-email-paced.ts   (REAL send — owner-approved + SMTP configured)
//
// Requires DATABASE_URL (+ SMTP_HOST/SMTP_USER/SMTP_PASS/EMAIL_FROM for a real send) in env.
import { sendSellerEmail, loadSellerLead } from "../src/lib/email-send";
import { hasApproval } from "../src/lib/approvals";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);
const TEMPLATE = "initial";

const CAMPAIGN_PATTERN = (process.env.CAMPAIGN_PATTERN || "%Email Batch%2026-08%").trim();
const MAX_PER_DAY = Math.max(1, Number(process.env.MAX_PER_DAY || "200"));
const DELAY_MS = Math.max(0, Number(process.env.DELAY_MS || "1500"));

// Rate-limit markers we must treat as non-fatal (Gmail's per-day window quota).
const RATE_LIMIT_RE = /454|4\.7\.0|7126229|too many|rate.limit|try again|temporarily/i;

type CampaignRow = { id: string; name: string; channel: string; status: string };
type Candidate = {
  lead_id: string;
  campaign_id: string;
  campaign_name: string;
  email: string | null;
  full_name: string | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  // ── 0. Fail-closed DRY_RUN guard ─────────────────────────────────────────
  const dryRun = (process.env.DRY_RUN ?? "1") !== "0";
  if (!process.env.DATABASE_URL) {
    console.error("BLOCKED — DATABASE_URL not set. Nothing sent.");
    process.exit(2);
  }

  // ── 1. Resolve eligible campaigns: email + owner-approved ───────────────
  const matching = (await sql`
    SELECT id, name, channel, status FROM campaigns
    WHERE name ILIKE ${CAMPAIGN_PATTERN}
    ORDER BY name
  `) as CampaignRow[];

  const eligible: CampaignRow[] = [];
  const notApproved: string[] = [];
  for (const c of matching) {
    if (c.channel !== "email") continue;
    const approved = await hasApproval("channel_campaign", "campaign", c.id, ["approved"]);
    if (approved) eligible.push(c);
    else notApproved.push(c.name);
  }

  if (eligible.length === 0) {
    console.error(
      `BLOCKED — no owner-approved email campaigns match pattern "${CAMPAIGN_PATTERN}". ` +
        (notApproved.length ? `Not approved: ${notApproved.join(", ")}. ` : "") +
        "Nothing sent.",
    );
    process.exit(1);
  }

  const eligibleIds = eligible.map((c) => c.id);

  // ── 2. Daily cap — count every transmission in the rolling 24h window ───
  const todayRows = (await sql`
    SELECT count(*)::int AS n FROM email_logs
    WHERE created_at >= now() - interval '24 hours'
  `) as { n: number }[];
  const sentToday = todayRows[0]?.n ?? 0;
  const budget = Math.max(0, MAX_PER_DAY - sentToday);

  // ── 3. Candidates across all eligible campaigns ─────────────────────────
  // Only leads that: belong to an eligible campaign, are NOT already sent
  // (email_logs status='sent'), are not suppressed, and have an email.
  const candidates = (await sql`
    SELECT cl.lead_id, cl.campaign_id, c.name AS campaign_name,
           l.email, l.full_name
    FROM campaign_leads cl
    JOIN campaigns c ON c.id = cl.campaign_id
    JOIN leads l ON l.id = cl.lead_id
    WHERE cl.campaign_id = ANY(${eligibleIds})
      AND l.email IS NOT NULL AND l.email <> ''
      AND l.opted_out = false
      AND l.invalid_contact = false
      AND NOT EXISTS (
        SELECT 1 FROM email_logs el
        WHERE el.lead_id = cl.lead_id AND el.status = 'sent'
      )
    ORDER BY c.name, cl.lead_id
  `) as Candidate[];

  const totalRemaining = candidates.length;
  const wouldSend = Math.min(totalRemaining, budget);

  const mode = dryRun ? "DRY-RUN (preview only, NOTHING sent)" : "REAL SEND";
  console.log(`== Email paced sender ==`);
  console.log(`Eligible approved campaigns: ${eligible.length}  (${eligible.map((c) => c.name).join(", ")})`);
  if (notApproved.length) console.log(`Skipped (not approved): ${notApproved.join(", ")}`);
  console.log(`Rolling 24h sends on record: ${sentToday}  | MAX_PER_DAY=${MAX_PER_DAY}  | budget remaining=${budget}`);
  console.log(`Remaining unsendable-free leads across eligible batches: ${totalRemaining}`);
  console.log(`Would send THIS run (within cap): ${wouldSend}`);
  console.log(`Delay between sends: ${DELAY_MS}ms | Template: ${TEMPLATE} | MODE: ${mode}`);

  if (budget <= 0) {
    console.log(`\nSTOPPED — daily cap already reached (${sentToday} >= ${MAX_PER_DAY}). Nothing to send. Re-run later today or tomorrow.`);
    return; // not an error; just pacing
  }
  if (wouldSend === 0) {
    console.log(`\nDONE — no remaining leads. Queue is drained.`);
    return;
  }

  // ── 4. Send up to budget candidates (all audited, gated, delayed) ───────
  let sent = 0, failed = 0, rateLimited = 0, previewed = 0, skipped = 0;
  let hardError = false;
  const toAttempt = candidates.slice(0, budget);

  for (const cand of toAttempt) {
    const who = cand.full_name || cand.lead_id;

    if (dryRun) {
      console.log(`PREVIEW ${who} <${cand.email}> [${cand.campaign_name}] — would send via ${TEMPLATE} (gated)`);
      previewed++;
      continue;
    }

    // Re-load the lead through the real path so sendSellerEmail re-enforces the
    // compliance gate with fresh facts (same as send-email-batch.ts).
    const lead = await loadSellerLead(cand.lead_id);
    if (!lead) { console.log(`SKIP ${cand.lead_id} — lead not found`); skipped++; continue; }
    if (!lead.email) { console.log(`SKIP ${who} — no email on file`); skipped++; continue; }

    try {
      const res = await sendSellerEmail(lead, { campaignId: cand.campaign_id, template: TEMPLATE });
      if (res.success === true) {
        console.log(`SENT ${who} <${cand.email}> (${res.messageId})`);
        sent++;
      } else {
        // Strict comparison to the literal discriminant narrows the union.
        const err = res.error;
        if (RATE_LIMIT_RE.test(err)) {
          // Gmail hit its window cap — non-fatal, leave lead queued, stop here.
          console.log(`RATELIMIT ${who} — ${err} (lead stays queued; re-run later)`);
          rateLimited++;
          break; // further sends in the same window will also be limited
        }
        console.log(`FAIL ${who} <${cand.email}> — ${err}`);
        failed++;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (RATE_LIMIT_RE.test(msg)) {
        console.log(`RATELIMIT ${who} — ${msg} (lead stays queued)`);
        rateLimited++;
        break;
      }
      // Unexpected / hard failure (gate block, DB error, provider outage).
      console.log(`BLOCKED ${who} — ${msg}`);
      failed++;
      hardError = true;
      break;
    }

    // Gentle pacing between sends.
    if (DELAY_MS > 0) await sleep(DELAY_MS + Math.floor(Math.random() * 500));
  }

  // ── 5. Summary ──────────────────────────────────────────────────────────
  console.log(`\n=== SUMMARY (${mode}) ===`);
  console.log(`Total remaining (before this run):    ${totalRemaining}`);
  console.log(`Sent this run:                         ${sent}`);
  if (rateLimited) console.log(`Rate-limited, left queued:              ${rateLimited}`);
  if (previewed) console.log(`Previewed (DRY_RUN, would have sent):   ${previewed}`);
  if (skipped) console.log(`Skipped (not found / no email):        ${skipped}`);
  if (failed) console.log(`Failed/blocked:                         ${failed}`);
  // Failed and rate-limited leads are NOT marked sent — they stay queued, so
  // only actually-sent counts toward drainage (DRY_RUN sends nothing, so the
  // full queue remains).
  const nowRemaining = dryRun ? totalRemaining : Math.max(0, totalRemaining - sent);
  console.log(`Remaining in queue (not yet sent):      ${nowRemaining}${nowRemaining > 0 ? " — re-run once pacing allows" : " — DRAINED"}`);

  if (!dryRun && hardError) process.exitCode = 1;
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
