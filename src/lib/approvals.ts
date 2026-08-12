// DealFlow AI — Human approval gates: request store + enforcement helper (PH1-B11)
//
// The single source of truth for owner approvals. Every legally / financially
// significant action (final offers, negotiation beyond approved parameters,
// contracts, assignments, spending above a campaign's cap, campaign status /
// budget changes, sensitive seller communications) is gated behind an
// approval_request row that the owner approves or rejects from /approvals.
//
//   requestApproval({kind, refType, refId, amountCents, details, operator})
//     — creates a pending request. Dup guard: no two PENDING requests may
//       exist for the same (kind, refType, refId) — a second request returns
//       {duplicate: true, id} instead of inserting. Every create writes one
//       outreach_audit_log row (channel='approval', status='requested').
//
//   decideApproval(id, {approved, note, operator})
//     — owner decision. Only 'pending' rows can be decided (idempotent
//       reject). Writes the audit row (status='approved'|'rejected') + sets
//       decided_at/decided_by/decision_note.
//
//   pendingApprovals() / approvalHistory(limit) / pendingApprovalCount()
//     — dashboard reads. Everything real; no fabricated rows.
//
//   hasApproval(kind, refType, refId, statuses=['approved'])
//     — the ENFORCEMENT check. Gate callers (the outreach state machine's
//       requireApproval gate, recordCampaignSpend, updateCampaignStatus) call
//       this before allowing a transition / spend / change. Returns true only
//       when an approved request exists for that exact (kind, refType, refId).
//       For refType='lead' the refId is the lead UUID; for 'campaign' it is
//       the campaign UUID; 'none' ignores refId (global requests).
//
// Enforcement wiring (B11):
//   * Outreach state machine (lib/outreach-status.ts): transitionOutreachStatus
//     accepts opts.requireApproval = {kind, refId} — when set, the transition
//     is REJECTED with "requires approved approval_request" unless an approved
//     request exists for (kind, ref_type='lead', ref_id=refId). The CRM layer
//     passes it for offer / negotiation / contract_signed transitions. The
//     terminal-state override path (documented reason + operator) is preserved
//     and does NOT bypass the approval gate — the gate is a hard legal control.
//   * Campaign spend (lib/campaign-economics.ts recordCampaignSpend): blocked
//     unless an approved 'spend' request exists for the campaign, or the new
//     total actual stays within the campaign's spend cap (then no request
//     needed). Above the cap → the caller must request approval first.
//   * Campaign changes (lib/campaign-economics.ts updateCampaignStatus):
//     status changes (active/paused/cancelled/…) and budget/cap edits require
//     an approved 'campaign_change' request for that campaign.
//
// Human approval gates are non-negotiable (plan rev 18): these checks are the
// enforcement, and 0 pending requests is the correct production state until a
// real offer / contract / spend / campaign change is actually requested.
import { sql } from "~/db";
import { logOutreachAudit } from "~/lib/compliance";

export const APPROVAL_KINDS = [
  "offer",
  "contract",
  "assignment",
  "spend",
  "campaign_change",
  "sensitive_communication",
] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];
export const APPROVAL_REF_TYPES = ["lead", "contract", "campaign", "none"] as const;
export type ApprovalRefType = (typeof APPROVAL_REF_TYPES)[number];
export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export type ApprovalRow = {
  id: string;
  kind: ApprovalKind;
  status: ApprovalStatus;
  refType: ApprovalRefType;
  refId: string | null;
  amountCents: number | null;
  details: string | null;
  requestedBy: string | null;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  /** Resolved display label for the ref (lead name / address, campaign name). */
  refLabel: string | null;
};

const rowMapper = (r: {
  id: string; kind: string; status: string; ref_type: string; ref_id: string | null;
  amount_cents: number | null; details: string | null; requested_by: string | null;
  created_at: Date; decided_at: Date | null; decided_by: string | null; decision_note: string | null;
  ref_label: string | null;
}): ApprovalRow => ({
  id: String(r.id),
  kind: r.kind as ApprovalKind,
  status: r.status as ApprovalStatus,
  refType: r.ref_type as ApprovalRefType,
  refId: r.ref_id === null ? null : String(r.ref_id),
  amountCents: r.amount_cents === null ? null : Number(r.amount_cents),
  details: r.details,
  requestedBy: r.requested_by,
  createdAt: String(r.created_at),
  decidedAt: r.decided_at === null ? null : String(r.decided_at),
  decidedBy: r.decided_by,
  decisionNote: r.decision_note,
  refLabel: r.ref_label,
});

/** Resolve a human label for the referenced object (lead address or campaign name). */
async function resolveRefLabel(refType: ApprovalRefType, refId: string | null): Promise<string | null> {
  if (!refId) return null;
  if (refType === "lead") {
    const rows = (await sql`
      SELECT property_address, property_city, property_state, full_name
      FROM leads WHERE id = ${refId}
    `) as Array<{ property_address: string; property_city: string; property_state: string; full_name: string }>;
    if (!rows.length) return null;
    const r = rows[0];
    return `${r.property_address}, ${r.property_city}, ${r.property_state}`.trim();
  }
  if (refType === "campaign") {
    const rows = (await sql`SELECT name FROM campaigns WHERE id = ${refId}`) as Array<{ name: string }>;
    return rows.length ? rows[0].name : null;
  }
  return null;
}

// NOTE: never interpolate SQL fragments into tagged templates — neon treats
// interpolated values as bound parameters (a fragment becomes "$1" and breaks
// the query). The approval SELECT (with ref labels) is therefore inlined in
// each read function below.

export type RequestApprovalInput = {
  kind: ApprovalKind;
  refType: ApprovalRefType;
  refId?: string | null;
  amountCents?: number | null;
  details?: string | null;
  operator: string;
};

export type RequestApprovalResult =
  | { success: true; id: string; duplicate?: boolean }
  | { success: false; error: string };

/**
 * Create a pending approval request. Dup guard: no two PENDING requests for the
 * same (kind, refType, refId) — returns {duplicate: true, id} when one exists
 * (refId is compared with IS NOT DISTINCT FROM so refType='none' + NULL dedups
 * on kind alone). Writes the 'requested' audit row on create.
 */
export async function requestApproval(input: RequestApprovalInput): Promise<RequestApprovalResult> {
  try {
    if (!APPROVAL_KINDS.includes(input.kind)) return { success: false, error: `Unknown approval kind: ${input.kind}` };
    if (!APPROVAL_REF_TYPES.includes(input.refType)) return { success: false, error: `Unknown ref type: ${input.refType}` };
    const refId = input.refId ?? null;
    const dup = (await sql`
      SELECT id FROM approval_requests
      WHERE kind = ${input.kind}
        AND ref_type = ${input.refType}
        AND ref_id IS NOT DISTINCT FROM ${refId}
        AND status = 'pending'
      LIMIT 1
    `) as Array<{ id: string }>;
    if (dup.length) return { success: true, id: String(dup[0].id), duplicate: true };

    const inserted = (await sql`
      INSERT INTO approval_requests (kind, status, ref_type, ref_id, amount_cents, details, requested_by)
      VALUES (${input.kind}, 'pending', ${input.refType}, ${refId}, ${input.amountCents ?? null}, ${input.details ?? null}, ${input.operator})
      RETURNING id
    `) as Array<{ id: string }>;
    const id = String(inserted[0].id);
    await logOutreachAudit({
      leadId: input.refType === "lead" ? refId : null,
      channel: "approval",
      direction: "internal",
      status: "requested",
      reason: `Approval requested: ${input.kind}${input.amountCents ? ` for ${(input.amountCents / 100).toFixed(2)}` : ""}${input.details ? ` — ${input.details}` : ""}`,
      operator: input.operator,
      contentPreview: `approval:${input.kind} requested`,
    });
    return { success: true, id };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : "Request approval failed" };
  }
}

export type DecideApprovalInput = {
  approved: boolean;
  note?: string | null;
  operator: string;
};

export type DecideApprovalResult =
  | { success: true; id: string; status: ApprovalStatus }
  | { success: false; error: string };

/**
 * Owner decision on a pending request. Only 'pending' rows can be decided;
 * deciding twice is rejected (returns the existing decided state as an error
 * so a double-click can't flip an approval). Writes the audit row
 * (status='approved'|'rejected') with the decision note.
 */
export async function decideApproval(id: string, input: DecideApprovalInput): Promise<DecideApprovalResult> {
  try {
    const rows = (await sql`
      SELECT id, status, kind, ref_type, ref_id, amount_cents, requested_by
      FROM approval_requests WHERE id = ${id}
    `) as Array<{ id: string; status: string; kind: string; ref_type: string; ref_id: string | null; amount_cents: number | null; requested_by: string }>;
    if (!rows.length) return { success: false, error: "Approval request not found" };
    const row = rows[0];
    if (row.status !== "pending") {
      return { success: false, error: `Approval request is already ${row.status} — only pending requests can be decided` };
    }
    const status: ApprovalStatus = input.approved ? "approved" : "rejected";
    await sql`
      UPDATE approval_requests
      SET status = ${status}, decided_at = now(), decided_by = ${input.operator}, decision_note = ${input.note ?? null}
      WHERE id = ${id}
    `;
    await logOutreachAudit({
      leadId: row.ref_type === "lead" ? row.ref_id : null,
      channel: "approval",
      direction: "internal",
      status,
      reason: `Approval ${status}: ${row.kind}${input.note ? ` — ${input.note}` : ""}`,
      operator: input.operator,
      contentPreview: `approval:${row.kind} ${status}`,
    });
    return { success: true, id: String(row.id), status };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : "Decide approval failed" };
  }
}

/** All pending approval requests (newest first) for the /approvals queue. */
export async function pendingApprovals(): Promise<ApprovalRow[]> {
  try {
    const rows = await sql`
      SELECT ar.id, ar.kind, ar.status, ar.ref_type, ar.ref_id, ar.amount_cents,
             ar.details, ar.requested_by, ar.created_at, ar.decided_at, ar.decided_by,
             ar.decision_note,
             CASE
               WHEN ar.ref_type = 'lead' THEN (l.property_address || ', ' || l.property_city || ', ' || l.property_state)
               WHEN ar.ref_type = 'campaign' THEN c.name
               ELSE NULL
             END AS ref_label
      FROM approval_requests ar
      LEFT JOIN leads l ON ar.ref_type = 'lead' AND l.id = ar.ref_id
      LEFT JOIN campaigns c ON ar.ref_type = 'campaign' AND c.id = ar.ref_id
      WHERE ar.status = 'pending'
      ORDER BY ar.created_at ASC
    `;
    return (rows as Parameters<typeof rowMapper>[0][]).map(rowMapper);
  } catch {
    return [];
  }
}

/** Decision history (decided rows, newest first) for the /approvals page. */
export async function approvalHistory(limit = 50): Promise<ApprovalRow[]> {
  try {
    const rows = await sql`
      SELECT ar.id, ar.kind, ar.status, ar.ref_type, ar.ref_id, ar.amount_cents,
             ar.details, ar.requested_by, ar.created_at, ar.decided_at, ar.decided_by,
             ar.decision_note,
             CASE
               WHEN ar.ref_type = 'lead' THEN (l.property_address || ', ' || l.property_city || ', ' || l.property_state)
               WHEN ar.ref_type = 'campaign' THEN c.name
               ELSE NULL
             END AS ref_label
      FROM approval_requests ar
      LEFT JOIN leads l ON ar.ref_type = 'lead' AND l.id = ar.ref_id
      LEFT JOIN campaigns c ON ar.ref_type = 'campaign' AND c.id = ar.ref_id
      WHERE ar.status <> 'pending'
      ORDER BY ar.decided_at DESC NULLS LAST, ar.created_at DESC
      LIMIT ${limit}
    `;
    return (rows as Parameters<typeof rowMapper>[0][]).map(rowMapper);
  } catch {
    return [];
  }
}

/** Count of pending requests — the header badge + command-center attention. */
export async function pendingApprovalCount(): Promise<number> {
  try {
    const rows = (await sql`
      SELECT COUNT(*)::int AS n FROM approval_requests WHERE status = 'pending'
    `) as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  } catch {
    return 0;
  }
}

/** Pending/approved state for one lead's gated kinds (offer + contract), for the CRM modal. */
export async function leadApprovalStatus(
  leadId: string,
): Promise<Array<{ kind: ApprovalKind; pending: boolean; approved: boolean }>> {
  try {
    const rows = (await sql`
      SELECT kind, status FROM approval_requests
      WHERE ref_type = 'lead' AND ref_id = ${leadId} AND kind IN ('offer', 'contract')
      ORDER BY created_at DESC
    `) as Array<{ kind: string; status: string }>;
    const byKind = new Map<string, { pending: boolean; approved: boolean }>();
    for (const r of rows) {
      const cur = byKind.get(r.kind) ?? { pending: false, approved: false };
      if (r.status === "pending") cur.pending = true;
      if (r.status === "approved") cur.approved = true;
      byKind.set(r.kind, cur);
    }
    return (["offer", "contract"] as const)
      .map((kind) => ({ kind, ...(byKind.get(kind) ?? { pending: false, approved: false }) }))
      .filter((k) => k.pending || k.approved);
  } catch {
    return [];
  }
}

/** Latest approval requests for one lead (any status) — modal timeline. */
export async function leadApprovalHistory(leadId: string, limit = 20): Promise<ApprovalRow[]> {
  try {
    const rows = await sql`
      SELECT ar.id, ar.kind, ar.status, ar.ref_type, ar.ref_id, ar.amount_cents,
             ar.details, ar.requested_by, ar.created_at, ar.decided_at, ar.decided_by,
             ar.decision_note,
             CASE
               WHEN ar.ref_type = 'lead' THEN (l.property_address || ', ' || l.property_city || ', ' || l.property_state)
               WHEN ar.ref_type = 'campaign' THEN c.name
               ELSE NULL
             END AS ref_label
      FROM approval_requests ar
      LEFT JOIN leads l ON ar.ref_type = 'lead' AND l.id = ar.ref_id
      LEFT JOIN campaigns c ON ar.ref_type = 'campaign' AND c.id = ar.ref_id
      WHERE ar.ref_type = 'lead' AND ar.ref_id = ${leadId}
      ORDER BY ar.created_at DESC
      LIMIT ${limit}
    `;
    return (rows as Parameters<typeof rowMapper>[0][]).map(rowMapper);
  } catch {
    return [];
  }
}

/**
 * ENFORCEMENT CHECK. True when an approved request exists for exactly
 * (kind, refType, refId). Gate callers pass statuses=['approved'] (default).
 * A rejected or pending request is NOT approval — callers must block.
 */
export async function hasApproval(
  kind: ApprovalKind,
  refType: ApprovalRefType,
  refId: string | null,
  statuses: ApprovalStatus[] = ["approved"],
): Promise<boolean> {
  try {
    const rows = (await sql`
      SELECT 1 FROM approval_requests
      WHERE kind = ${kind}
        AND ref_type = ${refType}
        AND ref_id IS NOT DISTINCT FROM ${refId}
        AND status = ANY (${statuses})
      LIMIT 1
    `) as Array<{ "?column?": number }>;
    return rows.length > 0;
  } catch {
    return false;
  }
}
