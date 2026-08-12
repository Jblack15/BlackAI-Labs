// DealFlow AI — Skip-Trace Monitor + Contactability Workflow (PH1-B1)
//
// Replaces the old fire-and-forget BatchSkipTracing call. The trace itself now
// runs OUTSIDE the app (PropStream Connect), so this module owns what the app
// must track: job state (RUNNING → COMPLETED / STALLED / FAILED), stall
// detection + operator alerts, duplicate-job prevention, per-lead trace status,
// the contactable/non-contactable split, a backup/manual trace entry point, and
// the hard block that stops every send path from reaching a lead with no
// contact info or a suppression flag.
//
// Job lifecycle:
//   registerSkipTraceJob(list, group, total)  -> RUNNING
//   updateTraceProgress(jobId, n)             -> bumps traced_count
//   updateTraceProgress(jobId, n, err)        -> FAILED + error_message
//   detectStalledJobs()                       -> RUNNING + stale -> STALLED + alert
//   markTraceResult(leadIds, {...})           -> per-lead TRACED + contactable
import { sql } from "~/db";

// --- Types (exported for routes) -------------------------------------------
export type SkipTraceLead = {
  id: string;
  full_name: string;
  property_address: string;
  property_city: string;
  property_state: string;
  property_zip: string;
};
export type SkipTraceResult = { success: boolean; updated: number; error?: string; jobId?: number; jobRegistered?: boolean; message?: string };

export type SkipTraceJob = {
  id: number;
  list_name: string;
  propstream_group_id: string | null;
  status: "RUNNING" | "STALLED" | "FAILED" | "COMPLETED" | "CANCELLED";
  total_leads: number | null;
  traced_count: number;
  started_at: string;
  last_progress_at: string;
  error_message: string | null;
  created_at: string;
};

export const TRACE_STATUSES = ["NOT_TRACED", "IN_PROGRESS", "TRACED", "STALLED", "FAILED", "MANUAL"] as const;
export type TraceStatus = (typeof TRACE_STATUSES)[number];

// --- Job registry ----------------------------------------------------------
export type RegisterJobResult = {
  job: SkipTraceJob;
  /** True when the call refused to create a new row because an identical job
   *  (same list + group) is already RUNNING or STALLED. */
  duplicate: boolean;
};

/**
 * Register a skip-trace batch. Duplicate guard: an identical list+groupId job
 * that is still RUNNING or STALLED refuses a second row and returns the
 * existing job with `duplicate: true` — the operator sees "duplicate job
 * refused" instead of the system firing two traces at the same list.
 */
export async function registerSkipTraceJob(
  listName: string,
  groupId: string,
  totalLeads: number,
): Promise<RegisterJobResult> {
  const existing = (await sql`
    SELECT id, list_name, propstream_group_id, status, total_leads, traced_count,
           started_at, last_progress_at, error_message, created_at
    FROM skip_trace_jobs
    WHERE list_name = ${listName}
      AND propstream_group_id = ${groupId}
      AND status IN ('RUNNING', 'STALLED')
    ORDER BY id DESC
    LIMIT 1
  `) as SkipTraceJob[];
  if (existing.length) {
    return { job: coerceJob(existing[0]), duplicate: true };
  }
  const rows = (await sql`
    INSERT INTO skip_trace_jobs (list_name, propstream_group_id, status, total_leads, traced_count, started_at, last_progress_at)
    VALUES (${listName}, ${groupId}, 'RUNNING', ${totalLeads}, 0, now(), now())
    RETURNING id, list_name, propstream_group_id, status, total_leads, traced_count,
              started_at, last_progress_at, error_message, created_at
  `) as SkipTraceJob[];
  return { job: coerceJob(rows[0]), duplicate: false };
}

/** Bump traced_count + last_progress_at. Pass `error` to fail the job. */
export async function updateTraceProgress(
  jobId: number,
  tracedCount: number,
  error?: string,
): Promise<{ success: boolean; job?: SkipTraceJob; error?: string }> {
  try {
    const rows = error
      ? await sql`
          UPDATE skip_trace_jobs
          SET traced_count = ${tracedCount}, last_progress_at = now(),
              status = 'FAILED', error_message = ${error}
          WHERE id = ${jobId}
          RETURNING id, list_name, propstream_group_id, status, total_leads, traced_count,
                    started_at, last_progress_at, error_message, created_at
        `
      : await sql`
          UPDATE skip_trace_jobs
          SET traced_count = ${tracedCount}, last_progress_at = now()
          WHERE id = ${jobId}
          RETURNING id, list_name, propstream_group_id, status, total_leads, traced_count,
                    started_at, last_progress_at, error_message, created_at
        `;
    if (!rows.length) return { success: false, error: `Skip-trace job ${jobId} not found` };
    return { success: true, job: coerceJob(rows[0]) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

const STALL_THRESHOLD_MINUTES = 45;

/**
 * Find RUNNING jobs whose last_progress_at is older than the threshold, mark
 * them STALLED, and insert one notification per stalled job so the operator
 * sees it in-app (the command center surfaces notifications in B10).
 * Idempotent in effect: only RUNNING rows are candidates, so re-running can
 * never double-flag a job or double-notify.
 */
export async function detectStalledJobs(thresholdMinutes = STALL_THRESHOLD_MINUTES): Promise<{
  stalled: SkipTraceJob[];
  notificationsCreated: number;
}> {
  const stale = (await sql`
    SELECT id, list_name, propstream_group_id, status, total_leads, traced_count,
           started_at, last_progress_at, error_message, created_at
    FROM skip_trace_jobs
    WHERE status = 'RUNNING'
      AND last_progress_at < now() - make_interval(mins => ${thresholdMinutes})
    ORDER BY last_progress_at ASC
  `) as SkipTraceJob[];
  const stalled: SkipTraceJob[] = [];
  let notificationsCreated = 0;
  for (const job of stale) {
    const updated = await sql`
      UPDATE skip_trace_jobs
      SET status = 'STALLED'
      WHERE id = ${job.id} AND status = 'RUNNING'
      RETURNING id, list_name, propstream_group_id, status, total_leads, traced_count,
                started_at, last_progress_at, error_message, created_at
    `;
    if (!updated.length) continue; // a concurrent run already flagged it
    stalled.push(coerceJob(updated[0]));
    const total = job.total_leads ?? "?";
    await sql`
      INSERT INTO notifications (type, title, body)
      VALUES (
        'skip_trace_stalled',
        ${`Skip-trace job '${job.list_name}' stalled`},
        ${`Skip-trace job '${job.list_name}' stalled at ${job.traced_count}/${total} leads — check PropStream Jobs/Activity or trigger a backup trace.`}
      )
    `;
    notificationsCreated++;
  }
  return { stalled, notificationsCreated };
}

/** List jobs, newest first (used by the CRM panel + monitor API). */
export async function listSkipTraceJobs(limit = 25): Promise<SkipTraceJob[]> {
  const rows = (await sql`
    SELECT id, list_name, propstream_group_id, status, total_leads, traced_count,
           started_at, last_progress_at, error_message, created_at
    FROM skip_trace_jobs
    ORDER BY id DESC
    LIMIT ${limit}
  `) as SkipTraceJob[];
  return rows.map(coerceJob);
}

function coerceJob(row: SkipTraceJob): SkipTraceJob {
  return {
    ...row,
    started_at: String(row.started_at),
    last_progress_at: String(row.last_progress_at),
    created_at: String(row.created_at),
  };
}

// --- Per-lead trace status + contactability split --------------------------
export type MarkTraceResultInput = {
  /** Trace source: 'propstream' | 'manual' | 'service' */
  source: "propstream" | "manual" | "service";
  dncFlag?: string | null;
  phone?: string | null;
  email?: string | null;
};

/**
 * Record that a trace returned results for the given leads: sets
 * trace_status=TRACED, traced_at=now(), trace_source, dnc_flag, and updates
 * phone/email when provided. `contactable` is recomputed by the DB trigger
 * whenever phone/email/dnc_flag change — no manual bookkeeping.
 */
export async function markTraceResult(
  leadIds: string[],
  opts: MarkTraceResultInput,
): Promise<{ success: boolean; updated: number; error?: string }> {
  if (!leadIds.length) return { success: true, updated: 0 };
  try {
    await sql`
      UPDATE leads
      SET trace_status = 'TRACED',
          trace_source = ${opts.source},
          traced_at = now(),
          dnc_flag = COALESCE(${opts.dncFlag ?? null}, dnc_flag),
          phone = COALESCE(NULLIF(${opts.phone ?? ""}, ''), phone),
          email = COALESCE(NULLIF(${opts.email ?? ""}, ''), email)
      WHERE id = ANY(${leadIds})
    `;
    return { success: true, updated: leadIds.length };
  } catch (err) {
    return { success: false, updated: 0, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/** Mark leads as waiting on a trace (e.g. after a job is registered). */
export async function markLeadsInProgress(leadIds: string[]): Promise<number> {
  if (!leadIds.length) return 0;
  const rows = await sql`
    UPDATE leads
    SET trace_status = 'IN_PROGRESS'
    WHERE id = ANY(${leadIds}) AND trace_status = 'NOT_TRACED'
    RETURNING id
  `;
  return (rows as { id: string }[]).length;
}

/** Recompute contactable for every lead (or a subset) from current data. */
export async function recomputeContactable(leadIds?: string[]): Promise<{ success: boolean; updated: number; error?: string }> {
  try {
    const res = leadIds?.length
      ? await sql`
          UPDATE leads SET contactable = (
            (COALESCE(NULLIF(btrim(phone), ''), '') <> '' OR COALESCE(NULLIF(btrim(email), ''), '') <> '')
            AND COALESCE(dnc_flag, '') NOT IN ('DNC', 'DO_NOT_MAIL', 'OPTED_OUT', 'INVALID', 'WRONG_NUMBER')
          )
          WHERE id = ANY(${leadIds})
          RETURNING id
        `
      : await sql`
          UPDATE leads SET contactable = (
            (COALESCE(NULLIF(btrim(phone), ''), '') <> '' OR COALESCE(NULLIF(btrim(email), ''), '') <> '')
            AND COALESCE(dnc_flag, '') NOT IN ('DNC', 'DO_NOT_MAIL', 'OPTED_OUT', 'INVALID', 'WRONG_NUMBER')
          )
          WHERE contactable IS DISTINCT FROM (
            (COALESCE(NULLIF(btrim(phone), ''), '') <> '' OR COALESCE(NULLIF(btrim(email), ''), '') <> '')
            AND COALESCE(dnc_flag, '') NOT IN ('DNC', 'DO_NOT_MAIL', 'OPTED_OUT', 'INVALID', 'WRONG_NUMBER')
          )
          RETURNING id
        `;
    return { success: true, updated: (res as { id: string }[]).length };
  } catch (err) {
    return { success: false, updated: 0, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/** The contactable split — every lead with usable contact info vs the rest. */
export async function contactableLeads(limit = 50): Promise<{ count: number; leads: Array<{ id: string; full_name: string; phone: string | null; email: string | null; property_address: string | null; property_city: string | null }> }> {
  const [countRows, leadRows] = await Promise.all([
    sql`SELECT count(*)::int AS n FROM leads WHERE contactable = true`,
    sql`
      SELECT id, full_name, phone, email, property_address, property_city
      FROM leads WHERE contactable = true
      ORDER BY traced_at DESC NULLS LAST, created_at DESC
      LIMIT ${limit}
    `,
  ]);
  return { count: (countRows as { n: number }[])[0]?.n ?? 0, leads: leadRows as never };
}

export async function nonContactableLeads(limit = 50): Promise<{ count: number; leads: Array<{ id: string; full_name: string; phone: string | null; email: string | null; property_address: string | null; property_city: string | null }> }> {
  const [countRows, leadRows] = await Promise.all([
    sql`SELECT count(*)::int AS n FROM leads WHERE contactable = false`,
    sql`
      SELECT id, full_name, phone, email, property_address, property_city
      FROM leads WHERE contactable = false
      ORDER BY created_at DESC
      LIMIT ${limit}
    `,
  ]);
  return { count: (countRows as { n: number }[])[0]?.n ?? 0, leads: leadRows as never };
}

/** Summary counts for the CRM panel / dashboard (no row data). */
export async function getTraceSummary(): Promise<{
  total: number;
  contactable: number;
  nonContactable: number;
  byStatus: Record<string, number>;
}> {
  const [totalRows, contactableRows, byStatusRows] = await Promise.all([
    sql`SELECT count(*)::int AS n FROM leads`,
    sql`SELECT count(*)::int AS n FROM leads WHERE contactable = true`,
    sql`SELECT trace_status, count(*)::int AS n FROM leads GROUP BY trace_status`,
  ]);
  const byStatus: Record<string, number> = {};
  for (const r of byStatusRows as { trace_status: string; n: number }[]) byStatus[r.trace_status] = r.n;
  return {
    total: (totalRows as { n: number }[])[0]?.n ?? 0,
    contactable: (contactableRows as { n: number }[])[0]?.n ?? 0,
    nonContactable: ((totalRows as { n: number }[])[0]?.n ?? 0) - ((contactableRows as { n: number }[])[0]?.n ?? 0),
    byStatus,
  };
}

// --- Hard block: nothing sends without contact info + compliance clearance --
export type OutreachChannel = "sms" | "email" | "mail" | "voice" | "manual";
export type OutreachCheckLead = {
  phone?: string | null;
  email?: string | null;
  dnc_flag?: string | null;
  /** Suppression flags (full suppression table landed in B2). */
  do_not_mail?: string | null | boolean;
  opted_out?: string | null | boolean;
  invalid_contact?: string | null | boolean;
  wrong_number?: string | null | boolean;
  /** Mailing address fields (mail channel only). */
  property_address?: string | null;
  property_city?: string | null;
  property_state?: string | null;
  property_zip?: string | null;
};
export type OutreachCheckResult = { allowed: boolean; reason?: string };

// Suppression truthy values. Booleans (new B2 columns) arrive as `true` →
// String(true).toUpperCase() = "TRUE"; legacy text flags are uppercase already.
const SUPPRESSED_VALUES = new Set(["DNC", "DO_NOT_MAIL", "OPTED_OUT", "INVALID", "WRONG_NUMBER", "TRUE", "1"]);
const isSuppressed = (v: string | null | boolean | undefined): boolean =>
  v != null && v !== "" && SUPPRESSED_VALUES.has(String(v).toUpperCase());

/**
 * Hard block helper (extended in PH1-B2 to be channel-aware). Returns
 * { allowed: false, reason } when the lead cannot be contacted on the given
 * channel. Every send path (sms, email, outreach dispatcher, direct mail)
 * calls this before transmitting — a suppressed lead can never be reached.
 *
 * Channel matrix (per the compliance spec):
 *   - no channel (generic / manual): block on missing phone+email or ANY flag
 *     (preserves B1 behavior exactly for existing callers)
 *   - sms / voice: need a phone; blocked by dnc_flag, opted_out,
 *     invalid_contact, wrong_number (do_not_mail does NOT block phone)
 *   - email: needs an email; blocked by opted_out, invalid_contact,
 *     wrong_number (dnc_flag and do_not_mail do NOT block email)
 *   - mail: needs a mailing address; blocked by do_not_mail, opted_out
 *     (dnc_flag / wrong_number are phone-centric and do NOT block mail)
 */
export function assertOutreachAllowed(lead: OutreachCheckLead, channel?: OutreachChannel): OutreachCheckResult {
  // 1. Channel-appropriate contact info.
  switch (channel) {
    case "sms":
    case "voice": {
      if (!lead.phone?.trim()) {
        return { allowed: false, reason: "Blocked: lead has no phone number on file (skip trace or record contact info first)" };
      }
      break;
    }
    case "email": {
      if (!lead.email?.trim()) {
        return { allowed: false, reason: "Blocked: lead has no email address on file (skip trace or record contact info first)" };
      }
      break;
    }
    case "mail": {
      if (!(lead.property_address?.trim() && lead.property_city?.trim() && lead.property_state?.trim() && lead.property_zip?.trim())) {
        return { allowed: false, reason: "Blocked: lead has no mailing address on file (property address/city/state/zip missing)" };
      }
      break;
    }
    default: {
      const hasContact = !!(lead.phone?.trim() || lead.email?.trim());
      if (!hasContact) {
        return {
          allowed: false,
          reason: "Blocked: lead has no contact info on file (phone/email missing) — skip trace or record contact info first",
        };
      }
    }
  }
  // 2. Suppression flags per channel.
  if (channel === "mail") {
    if (isSuppressed(lead.do_not_mail) || isSuppressed(lead.opted_out)) {
      return {
        allowed: false,
        reason: "Blocked: contact is suppressed (do-not-mail / opted-out) — mail not permitted",
      };
    }
    return { allowed: true };
  }
  if (channel === "sms" || channel === "voice") {
    const flags = [lead.dnc_flag, lead.opted_out, lead.invalid_contact, lead.wrong_number];
    const suppressed = flags.some(isSuppressed);
    if (suppressed) {
      return {
        allowed: false,
        reason: "Blocked: contact is suppressed (DNC / opted-out / invalid / wrong-number) — phone outreach not permitted",
      };
    }
    return { allowed: true };
  }
  if (channel === "email") {
    const flags = [lead.opted_out, lead.invalid_contact];
    const suppressed = flags.some(isSuppressed);
    if (suppressed) {
      return {
        allowed: false,
        reason: "Blocked: contact is suppressed (opted-out / invalid) — email not permitted",
      };
    }
    return { allowed: true };
  }
  // Generic (no channel): preserve B1 behavior — any flag blocks.
  const flags = [lead.dnc_flag, lead.do_not_mail, lead.opted_out, lead.invalid_contact, lead.wrong_number];
  const suppressed = flags.some(isSuppressed);
  if (suppressed) {
    return {
      allowed: false,
      reason: "Blocked: contact is suppressed (DNC / do-not-mail / opted-out / invalid) — outreach not permitted",
    };
  }
  return { allowed: true };
}

/** DB-backed variant used by send paths: loads the lead and hard-blocks. */
export async function assertLeadOutreachAllowedById(leadId: string, channel?: OutreachChannel): Promise<OutreachCheckResult> {
  const rows = await sql`
    SELECT phone, email, dnc_flag, do_not_mail, opted_out, invalid_contact, wrong_number,
           property_address, property_city, property_state, property_zip
    FROM leads WHERE id = ${leadId}
  ` as OutreachCheckLead[];
  if (!rows.length) return { allowed: false, reason: "Lead not found" };
  return assertOutreachAllowed(rows[0], channel);
}

// --- Legacy button entry point (kept for routes) ---------------------------
/**
 * In-app "Skip Trace" button. The actual trace runs in PropStream Connect
 * (outside the app), so this now records the intent: it registers a job and
 * marks the leads IN_PROGRESS. Results are imported later via markTraceResult
 * once PropStream returns phones/emails. Honest by design — it never claims a
 * trace completed when it didn't.
 */
export async function skipTraceLeads(ids?: string[]): Promise<SkipTraceResult> {
  try {
    const leads = ids?.length
      ? ((await sql`SELECT id FROM leads WHERE id = ANY(${ids})`) as { id: string }[])
      : ((await sql`
          SELECT id FROM leads
          WHERE (phone IS NULL OR phone = '') AND (email IS NULL OR email = '')
            AND trace_status = 'NOT_TRACED'
          LIMIT 1000
        `) as { id: string }[]);
    if (!leads.length) {
      return { success: true, updated: 0, message: "No leads need skip tracing (all already have contact info or are in progress)" };
    }
    const leadIds = leads.map((l) => l.id);
    const groupId = `inapp-${Date.now()}`;
    const { job, duplicate } = await registerSkipTraceJob("in-app-request", groupId, leadIds.length);
    if (duplicate) {
      return {
        success: true,
        updated: 0,
        jobId: job.id,
        jobRegistered: true,
        message: `Duplicate job refused — an identical skip-trace job (#${job.id}) is already RUNNING/STALLED.`,
      };
    }
    await markLeadsInProgress(leadIds);
    return {
      success: true,
      updated: 0,
      jobId: job.id,
      jobRegistered: true,
      message: `Skip-trace requested for ${leadIds.length} lead(s) — job #${job.id} registered (RUNNING). Run the trace in PropStream Connect, then import results to mark leads TRACED.`,
    };
  } catch (err) {
    return { success: false, updated: 0, error: err instanceof Error ? err.message : "Skip trace failed" };
  }
}
