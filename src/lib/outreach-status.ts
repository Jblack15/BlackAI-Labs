// DealFlow AI — Outreach Status State Machine: DB service (PH1-B6)
//
// The CONTACT pipeline spine. Server-only: use inside createServerFn handlers
// or API routes. The pure transition map lives in `outreach-status-map.ts`
// (client-importable); this module adds the DB-backed service:
//
//   transitionOutreachStatus(leadId, to, {reason, operator, override})
//     — validates against OUTREACH_TRANSITIONS, updates leads.outreach_status +
//       outreach_status_updated_at, and writes one outreach_audit_log row
//       (channel='status', direction='internal', status='sent', reason) per
//       state change. Terminal states are absorbing: any transition OUT of a
//       terminal state is rejected unless override=true with a reason + operator.
//
//   noteOutreachAttempt(leadId, channel, outcome)
//     — called by the send paths (sms.ts, email-outreach.ts, click2mail.ts;
//       outreach.ts + outreach-dispatcher.ts route through those) after a real
//       transmission. Advances pre-contact leads to contact_attempted and
//       writes the status-change audit row. Never regresses a lead that is
//       already past contact_attempted.
//
//   markOutreachQueued(leadId)
//     — new/contactable → outreach_queued when outreach is queued (B1 contactable
//       flag + a queued campaign). Same audit discipline.
//
//   getOutreachStatusHistory(leadId)
//     — the status-change audit rows for one lead (newest first), for the CRM
//       modal timeline.
//
// The deal pipeline (src/lib/pipeline.ts, pipeline_stage) is NOT touched —
// see the mapping comment in outreach-status-map.ts.
import { sql } from "~/db";
import { logOutreachAudit } from "~/lib/compliance";
import {
  OUTREACH_TRANSITIONS,
  TERMINAL_OUTREACH_STATUSES,
  type OutreachStatus,
} from "~/lib/outreach-status-map";

export { OUTREACH_STATUSES, TERMINAL_OUTREACH_STATUSES, OUTREACH_TRANSITIONS, validNextOutreachStatuses, isTerminalOutreachStatus, outreachStatusLabel } from "~/lib/outreach-status-map";
export type { OutreachStatus, TerminalOutreachStatus } from "~/lib/outreach-status-map";

export type OutreachTransitionOptions = {
  /** Human-readable reason for the change (required for overrides). */
  reason?: string;
  /** Who triggered it: 'crm-user', 'auto', an agent name, etc. */
  operator?: string;
  /** Explicit manual override — the ONLY way out of a terminal state. Must be
   *  paired with a reason + operator (enforced). */
  override?: boolean;
};

export type OutreachTransitionResult = {
  success: boolean;
  from?: string;
  to?: string;
  error?: string;
};

const isOutreachStatus = (s: string): s is OutreachStatus =>
  (OUTREACH_TRANSITIONS as Record<string, unknown>)[s] !== undefined;

async function getCurrentStatus(leadId: string): Promise<string | null> {
  const rows = await sql`
    SELECT COALESCE(NULLIF(outreach_status, ''), 'new') AS status
    FROM leads WHERE id = ${leadId}
  ` as { status: string }[];
  return rows.length ? rows[0].status : null;
}

/**
 * Validate + apply one outreach status transition. Rejects:
 *   - unknown statuses / invalid jumps (new → contract_signed directly, etc.)
 *   - any transition OUT of a terminal state without an explicit override
 *     (reason + operator both required)
 * Writes an outreach_audit_log row (channel='status', direction='internal',
 * status='sent' as the state-change record) on every applied transition.
 */
export async function transitionOutreachStatus(
  leadId: string,
  to: string,
  opts: OutreachTransitionOptions = {},
): Promise<OutreachTransitionResult> {
  try {
    if (!isOutreachStatus(to)) {
      return { success: false, error: `Invalid outreach status: ${to}` };
    }
    const current = await getCurrentStatus(leadId);
    if (current === null) return { success: false, error: "Lead not found" };
    if (current === to) {
      return { success: false, error: `Lead is already in outreach status ${to}` };
    }

    const fromIsTerminal = (TERMINAL_OUTREACH_STATUSES as readonly string[]).includes(current);
    if (fromIsTerminal && !opts.override) {
      return {
        success: false,
        error:
          `Blocked: ${current} is a terminal (absorbing) outreach status — leaving it requires an explicit override with a reason and operator.`,
      };
    }
    if (fromIsTerminal && opts.override && !(opts.reason?.trim() && opts.operator?.trim())) {
      return {
        success: false,
        error: "Blocked: override out of a terminal status requires both a reason and an operator.",
      };
    }
    // A documented override (reason + operator) IS the explicit authorization
    // to leave a terminal state — the empty transition list does not apply.
    const allowed = fromIsTerminal ? undefined : OUTREACH_TRANSITIONS[current];
    if (!fromIsTerminal && (!allowed || !allowed.includes(to))) {
      return {
        success: false,
        error: `Invalid transition from ${current} to ${to} (not in the outreach status map)`,
      };
    }

    await sql`
      UPDATE leads
      SET outreach_status = ${to}, outreach_status_updated_at = now(), updated_at = now()
      WHERE id = ${leadId}
    `;
    await logOutreachAudit({
      leadId,
      channel: "status",
      direction: "internal",
      status: "sent",
      reason: opts.reason || `Outreach status: ${current} → ${to}`,
      operator: opts.operator || null,
      contentPreview: `status:${current}→${to}`,
    });
    return { success: true, from: current, to };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : "Status transition failed" };
  }
}

/**
 * Send-path helper. Call AFTER a real transmission (outcome 'sent' or
 * 'attempted') for a known lead — never for blocked/failed attempts (those are
 * not contact attempts; the send path already audits the block/failure).
 *
 * Advances pre-contact leads (new / contactable / outreach_queued / follow_up)
 * to contact_attempted. Leads already connected or further along are left in
 * place (no regression) — a later manual "mark connected / qualified" via the
 * CRM advances them. Never throws.
 */
export async function noteOutreachAttempt(
  leadId: string,
  channel: "sms" | "email" | "mail" | "voice" | "manual",
  outcome: "sent" | "attempted",
): Promise<OutreachTransitionResult> {
  try {
    const current = await getCurrentStatus(leadId);
    if (current === null) return { success: false, error: "Lead not found" };
    const ADVANCE_FROM = new Set(["new", "contactable", "outreach_queued", "follow_up"]);
    if (!ADVANCE_FROM.has(current)) {
      // Already past contact_attempted — no status change (audit nothing;
      // the send path already wrote its own outbound audit row).
      return { success: true, from: current, to: current };
    }
    return await transitionOutreachStatus(leadId, "contact_attempted", {
      reason: `Outreach ${outcome} via ${channel}`,
      operator: "auto",
    });
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : "noteOutreachAttempt failed" };
  }
}

/**
 * Mark a lead as queued for outreach (new/contactable → outreach_queued) once
 * a campaign row exists for it. Idempotent in effect: leads already past
 * outreach_queued are left untouched.
 */
export async function markOutreachQueued(leadId: string): Promise<OutreachTransitionResult> {
  try {
    const current = await getCurrentStatus(leadId);
    if (current === null) return { success: false, error: "Lead not found" };
    if (current !== "new" && current !== "contactable") {
      return { success: true, from: current, to: current };
    }
    return await transitionOutreachStatus(leadId, "outreach_queued", {
      reason: "Outreach queued (campaign scheduled)",
      operator: "auto",
    });
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : "markOutreachQueued failed" };
  }
}

export type OutreachStatusHistoryRow = {
  id: number;
  from: string;
  to: string;
  reason: string | null;
  operator: string | null;
  created_at: string;
};

/**
 * Status-change audit trail for one lead (channel='status' rows), newest first.
 * The reason column stores "Outreach status: from → to" so from/to are
 * recoverable; content_preview mirrors them as `status:from→to`.
 */
export async function getOutreachStatusHistory(leadId: string): Promise<OutreachStatusHistoryRow[]> {
  try {
    const rows = await sql`
      SELECT id, reason, operator, content_preview, created_at
      FROM outreach_audit_log
      WHERE lead_id = ${leadId} AND channel = 'status'
      ORDER BY id DESC
      LIMIT 50
    ` as Array<{ id: number; reason: string | null; operator: string | null; content_preview: string | null; created_at: Date }>;
    return rows.map((r) => {
      // content_preview is `status:from→to` (set at write time); fall back to
      // parsing the reason text.
      const m = /^status:(\S+?)→(\S+)$/.exec(r.content_preview ?? "");
      const rm = /Outreach status:\s*(\S+)\s*→\s*(\S+)/.exec(r.reason ?? "");
      return {
        id: r.id,
        from: m?.[1] ?? rm?.[1] ?? "—",
        to: m?.[2] ?? rm?.[2] ?? "—",
        reason: r.reason,
        operator: r.operator,
        created_at: String(r.created_at),
      };
    });
  } catch {
    return [];
  }
}
