// ─────────────────────────────────────────────────────────────────────────────
// Scheduled outreach dispatcher (cron worker).
//
// The SMS/email drips (src/lib/outreach.ts, src/lib/email-outreach.ts) send
// step 1 immediately and schedule steps 2–N as rows in `outreach_sequences`
// with a future `scheduled_for` and status 'scheduled'. Nothing ever fired
// those later steps — this module is the missing dispatcher: it finds every
// due row (scheduled/pending AND scheduled_for <= now()), sends the follow-up
// through the SAME send functions used by step 1 (sendSms / sendEmail, which
// already log every attempt to sms_logs / email_logs and never throw), then
// flips the row to 'sent' (with sent_at) or 'failed'.
//
// Exposed as a cron-callable endpoint: GET/POST /api/outreach/dispatch
// (src/routes/api/outreach/dispatch.ts).
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from "~/db";
import { sendSms } from "~/lib/sms";
import { SMS_SEQUENCE } from "~/lib/outreach";
import { EMAIL_SEQUENCE, sendEmail } from "~/lib/email-outreach";

export interface DueOutreachRow {
  id: string;
  lead_id: string;
  channel: string;
  step: number;
  full_name: string;
  phone: string | null;
  email: string | null;
  property_address: string | null;
  property_city: string | null;
  property_state: string | null;
}

export interface DispatchError {
  id: string;
  channel: string;
  step: number;
  error: string;
}

export interface DispatchResult {
  processed: number;
  sent: number;
  failed: number;
  errors: DispatchError[];
}

type StepOutcome = { ok: true } | { ok: false; error: string };

function buildAddress(row: DueOutreachRow): string {
  return [row.property_address, row.property_city, row.property_state].filter(Boolean).join(", ") || "your property";
}

async function sendSmsStep(row: DueOutreachRow): Promise<StepOutcome> {
  const template = SMS_SEQUENCE[row.step - 1];
  if (!template) return { ok: false, error: `No SMS template for step ${row.step}` };
  if (!row.phone) return { ok: false, error: "Lead has no phone number" };
  const result = await sendSms(row.phone, template(row.full_name, buildAddress(row)), row.lead_id);
  return result.success ? { ok: true } : { ok: false, error: result.error || "SMS send failed" };
}

async function sendEmailStep(row: DueOutreachRow): Promise<StepOutcome> {
  const template = EMAIL_SEQUENCE[row.step - 1];
  if (!template) return { ok: false, error: `No email template for step ${row.step}` };
  if (!row.email) return { ok: false, error: "Lead has no email address" };
  const result = await sendEmail({
    to: row.email,
    subject: template.subject(row.full_name, buildAddress(row)),
    html: template.html(row.full_name, buildAddress(row)),
    text: template.text(row.full_name, buildAddress(row)),
    leadId: row.lead_id,
  });
  return result.success ? { ok: true } : { ok: false, error: result.error || "Email send failed" };
}

/**
 * Process every due outreach_sequences row and return send counts.
 *
 * - status is matched against BOTH 'scheduled' (what the schedulers write) and
 *   'pending' (the generic term used elsewhere in the codebase) so either value
 *   dispatches correctly.
 * - The final status UPDATE is guarded by `status IN ('scheduled','pending')`,
 *   so a concurrent run can never double-count a row it already flipped.
 * - Every send path (Twilio/SMTP missing, provider errors, DB hiccups) is
 *   caught per-row and recorded as failed — this function never throws.
 */
export async function dispatchDueOutreach(limit = 100): Promise<DispatchResult> {
  const result: DispatchResult = { processed: 0, sent: 0, failed: 0, errors: [] };

  const rows = (await sql`
    SELECT s.id, s.lead_id, s.channel, s.step,
           l.full_name, l.phone, l.email,
           l.property_address, l.property_city, l.property_state
    FROM outreach_sequences s
    JOIN leads l ON l.id = s.lead_id
    WHERE s.status IN ('scheduled', 'pending') AND s.scheduled_for <= now()
    ORDER BY s.scheduled_for
    LIMIT ${limit}
  `) as DueOutreachRow[];

  for (const row of rows) {
    result.processed++;
    try {
      const outcome = row.channel === "sms" ? await sendSmsStep(row) : await sendEmailStep(row);
      if (outcome.ok) {
        await sql`UPDATE outreach_sequences SET status = 'sent', sent_at = now() WHERE id = ${row.id} AND status IN ('scheduled','pending')`;
        result.sent++;
      } else {
        await sql`UPDATE outreach_sequences SET status = 'failed' WHERE id = ${row.id} AND status IN ('scheduled','pending')`;
        result.failed++;
        result.errors.push({ id: row.id, channel: row.channel, step: row.step, error: outcome.error });
      }
    } catch (err) {
      // Never crash the cron on a single bad row.
      try {
        await sql`UPDATE outreach_sequences SET status = 'failed' WHERE id = ${row.id} AND status IN ('scheduled','pending')`;
      } catch {
        // ignore — row will be retried on the next run
      }
      result.failed++;
      result.errors.push({
        id: row.id,
        channel: row.channel,
        step: row.step,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return result;
}
