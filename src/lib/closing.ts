// DealFlow AI — Title/closing workflow: DB service (PH1-B12)
//
// The last mile of the deal lifecycle: contract → title → closed →
// assignment paid. Builds on the B6 outreach status state machine (the lead's
// contract_signed → buyer_matched → title → closed → assignment_paid arc) and
// the B11 human approval gates (recordAssignmentPaid REQUIRES an approved
// approval_request of kind='assignment' for the contract).
//
//   createContract(input)            — writes a contracts row linked to lead +
//                                      campaign (B10b revenue attribution
//                                      auto-activates), optionally seeds the
//                                      standard 8-step closing checklist.
//   updateClosingChecklistItem(...)  — toggle one checklist step; audit-logged
//                                      (operator + completed_at).
//   getClosingChecklist(contractId)  — the checklist rows for a contract.
//   updateContractClosing(...)       — title company / escrow / close dates /
//                                      deadline edits from the detail view.
//   computeClosingProfit(contractId) — assignment_fee_cents − recorded costs.
//                                      Costs = 0 today (nothing records
//                                      platform costs yet — only what is
//                                      recorded counts). NULL fee → profit is
//                                      "—" (unknown), never $0.
//   dueAttention(contractId)         — overdue checklist steps + expected
//                                      close within 7 days (feeds the command
//                                      center later).
//   recordAssignmentPaid(...)        — GATED: requires an approved
//                                      'assignment' approval for the contract
//                                      (B11 hasApproval). Records the fee,
//                                      marks the contract 'closed', and walks
//                                      the lead's outreach_status along the
//                                      closing arc to assignment_paid via the
//                                      B6 state machine (which enforces its
//                                      own transition rules — no gate bypass).
//   listContracts() / getContractDetail(id) — reads for the /contracts UI.
//
// HONESTY (plan rev 18, owner directive 2026-08-12):
//   * The platform only TRACKS closing proceeds. Real money flows title
//     company → owner's bank; the app never moves it. 0 contracts is the
//     correct production state until a real deal is signed.
//   * assignment_fee_cents is NULL until a fee is actually recorded; profit
//     renders "—" while NULL — never a fabricated $0.
//   * assignment_fee (NUMERIC, migration 003) is kept as the dollar mirror of
//     assignment_fee_cents so B10b's revenue SUM (campaign-economics.ts reads
//     assignment_fee) attributes real numbers without a code change.
//
// Server-only module: import inside createServerFn handlers / API routes /
// verify scripts. `sql` is imported relative so plain-bun scripts can import
// this module directly (same pattern as campaign-economics.ts).
import { sql } from "../db";
import { logOutreachAudit } from "./compliance";
import { hasApproval, requestApproval } from "./approvals";
import { transitionOutreachStatus } from "./outreach-status";

// --- Vocabulary --------------------------------------------------------------

export const CONTRACT_STATUSES = [
  "new",
  "title_open",
  "title_clear",
  "docs_sent",
  "docs_signed",
  "funded",
  "closed",
  "cancelled",
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const CLOSING_ARC = [
  "buyer_matched",
  "title",
  "closed",
  "assignment_paid",
] as const;

/** The standard closing checklist (industry-standard steps, real). Seeded by
 *  createContract with due dates offset from the expected close date. */
export const STANDARD_CLOSING_CHECKLIST: ReadonlyArray<{ label: string; dueDaysBeforeClose: number }> = [
  { label: "Order title commitment", dueDaysBeforeClose: 21 },
  { label: "Review title commitment", dueDaysBeforeClose: 14 },
  { label: "Resolve title objections", dueDaysBeforeClose: 10 },
  { label: "Coordinate repairs allowance", dueDaysBeforeClose: 7 },
  { label: "Order payoff (mortgage / liens)", dueDaysBeforeClose: 7 },
  { label: "Sign closing docs", dueDaysBeforeClose: 3 },
  { label: "Confirm funds (buyer wire / cashier's check)", dueDaysBeforeClose: 1 },
  { label: "Disburse proceeds via title", dueDaysBeforeClose: 0 },
];

/** due date = expectedCloseDate − N days (null when no expected close date). */
function dueDateFor(expectedCloseDate: string | null, daysBefore: number): string | null {
  if (!expectedCloseDate) return null;
  const d = new Date(`${expectedCloseDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() - daysBefore);
  return d.toISOString().split("T")[0];
}

/**
 * Normalise a Postgres DATE to 'YYYY-MM-DD'. Neon returns date columns as JS
 * Date objects (UTC midnight) — String(date) renders "Fri Aug 21 2026 ..."
 * which must never leak into comparisons or the UI.
 */
function sqlDate(d: Date | string | null | undefined): string | null {
  if (d === null || d === undefined) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

// --- Types -------------------------------------------------------------------

export type CreateContractInput = {
  leadId: string;
  campaignId?: string | null;
  buyerId?: string | null;
  contractType: string;
  purchasePriceCents?: number | null;
  /** Canonical assignment fee in cents ($15K target lives here). NULL = not yet
   *  recorded. Mirrored to assignment_fee (dollars) for B10b revenue reads. */
  assignmentFeeCents?: number | null;
  earnestMoneyCents?: number | null;
  expectedCloseDate?: string | null;
  closeDate?: string | null;
  titleCompany?: string | null;
  escrowAccount?: string | null;
  closingDeadlines?: Record<string, unknown> | null;
  contractData?: Record<string, unknown> | null;
  operator?: string | null;
  /** Seed the standard 8-step closing checklist (default true). */
  createChecklist?: boolean;
};

export type CreateContractResult = { success: true; id: string } | { success: false; error: string };

export type ClosingChecklistItem = {
  id: string;
  contractId: string;
  label: string;
  done: boolean;
  dueDate: string | null;
  completedAt: string | null;
  operator: string | null;
  position: number;
};

export type ClosingProfit = {
  success: true;
  /** NULL = no fee recorded yet → net is "—", never $0 */
  assignmentFeeCents: number | null;
  /** only what is actually recorded as a platform cost (0 today) */
  costsCents: number;
  /** NULL when assignmentFeeCents is NULL (profit "—") */
  netCents: number | null;
};

export type AttentionItem =
  | { kind: "checklist"; label: string; dueDate: string }
  | { kind: "close_date"; label: string; date: string };

// --- Checklist seeding --------------------------------------------------------

async function seedClosingChecklist(contractId: string, expectedCloseDate: string | null): Promise<void> {
  for (let i = 0; i < STANDARD_CLOSING_CHECKLIST.length; i++) {
    const step = STANDARD_CLOSING_CHECKLIST[i];
    await sql`
      INSERT INTO closing_checklist_items (contract_id, label, due_date, position)
      VALUES (${contractId}, ${step.label}, ${dueDateFor(expectedCloseDate, step.dueDaysBeforeClose)}, ${i})
    `;
  }
}

// --- createContract -----------------------------------------------------------

export async function createContract(input: CreateContractInput): Promise<CreateContractResult> {
  try {
    if (!input.leadId || !input.contractType) {
      return { success: false, error: "leadId and contractType are required" };
    }
    const lead = (await sql`
      SELECT id FROM leads WHERE id = ${input.leadId}
    `) as Array<{ id: string }>;
    if (!lead.length) return { success: false, error: "Lead not found" };

    const feeCents = input.assignmentFeeCents ?? null;
    const feeDollars = feeCents === null ? null : feeCents / 100;
    const expectedClose = input.expectedCloseDate ?? null;
    const purchasePrice =
      input.purchasePriceCents === null || input.purchasePriceCents === undefined
        ? null
        : input.purchasePriceCents / 100;
    const earnestMoney =
      input.earnestMoneyCents === null || input.earnestMoneyCents === undefined
        ? 1000
        : input.earnestMoneyCents / 100;

    const inserted = (await sql`
      INSERT INTO contracts (
        lead_id, campaign_id, buyer_id, contract_type, status,
        purchase_price, assignment_fee_cents, assignment_fee, earnest_money,
        closing_date, expected_close_date, close_date,
        title_company, escrow_account, closing_deadlines, contract_data
      )
      VALUES (
        ${input.leadId}, ${input.campaignId ?? null}, ${input.buyerId ?? null}, ${input.contractType}, 'new',
        ${purchasePrice}, ${feeCents}, ${feeDollars}, ${earnestMoney},
        ${expectedClose}, ${expectedClose}, ${input.closeDate ?? null},
        ${input.titleCompany ?? null}, ${input.escrowAccount ?? null},
        ${JSON.stringify(input.closingDeadlines ?? null)},
        ${JSON.stringify(input.contractData ?? {})}
      )
      RETURNING id
    `) as Array<{ id: string }>;
    const id = String(inserted[0].id);

    if (input.createChecklist !== false) {
      await seedClosingChecklist(id, expectedClose);
    }

    await logOutreachAudit({
      leadId: input.leadId,
      channel: "contract",
      direction: "internal",
      status: "sent",
      reason:
        `Contract created (${input.contractType})` +
        `${input.operator ? ` by ${input.operator}` : ""}` +
        `${feeCents !== null ? ` — assignment fee $${(feeCents / 100).toFixed(2)}` : " — no assignment fee recorded yet"}`,
      operator: input.operator ?? null,
      contentPreview: `contract:created ${input.contractType}`,
    });
    return { success: true, id };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : "createContract failed" };
  }
}

// --- Checklist ----------------------------------------------------------------

export type ChecklistUpdateResult = { success: true } | { success: false; error: string };

export async function updateClosingChecklistItem(
  id: string,
  done: boolean,
  operator?: string | null,
): Promise<ChecklistUpdateResult> {
  try {
    const rows = (await sql`
      SELECT i.id, i.label, i.contract_id, c.lead_id
      FROM closing_checklist_items i
      JOIN contracts c ON c.id = i.contract_id
      WHERE i.id = ${id}
    `) as Array<{ id: string; label: string; contract_id: string; lead_id: string | null }>;
    if (!rows.length) return { success: false, error: "Checklist item not found" };
    const row = rows[0];
    await sql`
      UPDATE closing_checklist_items
      SET done = ${done}, completed_at = ${done ? new Date() : null}, operator = ${operator ?? null}
      WHERE id = ${id}
    `;
    await logOutreachAudit({
      leadId: row.lead_id,
      channel: "contract",
      direction: "internal",
      status: "sent",
      reason: `Closing checklist: "${row.label}" marked ${done ? "done" : "not done"}${operator ? ` by ${operator}` : ""}`,
      operator: operator ?? null,
      contentPreview: `closing:checklist ${done ? "done" : "open"}`,
    });
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : "updateClosingChecklistItem failed" };
  }
}

export async function getClosingChecklist(contractId: string): Promise<ClosingChecklistItem[]> {
  try {
    const rows = (await sql`
      SELECT id, contract_id, label, done, due_date, completed_at, operator, position
      FROM closing_checklist_items
      WHERE contract_id = ${contractId}
      ORDER BY position ASC, id ASC
    `) as Array<{
      id: string; contract_id: string; label: string; done: boolean;
      due_date: Date | string | null; completed_at: Date | null; operator: string | null; position: number;
    }>;
    return rows.map((r) => ({
      id: String(r.id),
      contractId: String(r.contract_id),
      label: r.label,
      done: Boolean(r.done),
      dueDate: sqlDate(r.due_date),
      completedAt: r.completed_at === null ? null : String(r.completed_at),
      operator: r.operator,
      position: Number(r.position),
    }));
  } catch {
    return [];
  }
}

// --- Title / escrow / dates ---------------------------------------------------

export type ContractClosingPatch = {
  titleCompany?: string | null;
  escrowAccount?: string | null;
  expectedCloseDate?: string | null;
  closeDate?: string | null;
  closingDeadlines?: Record<string, unknown> | null;
};

export type ContractClosingUpdateResult = { success: true } | { success: false; error: string };

/** Save title/escrow/close-date/deadline edits from the detail view. Writes an
 *  audit row so the trail shows who changed closing details and when. */
export async function updateContractClosing(
  contractId: string,
  patch: ContractClosingPatch,
  operator?: string | null,
): Promise<ContractClosingUpdateResult> {
  try {
    const rows = (await sql`
      SELECT id, lead_id FROM contracts WHERE id = ${contractId}
    `) as Array<{ id: string; lead_id: string | null }>;
    if (!rows.length) return { success: false, error: "Contract not found" };
    const leadId = rows[0].lead_id;

    if (patch.titleCompany !== undefined) {
      await sql`UPDATE contracts SET title_company = ${patch.titleCompany}, updated_at = now() WHERE id = ${contractId}`;
    }
    if (patch.escrowAccount !== undefined) {
      await sql`UPDATE contracts SET escrow_account = ${patch.escrowAccount}, updated_at = now() WHERE id = ${contractId}`;
    }
    if (patch.expectedCloseDate !== undefined) {
      await sql`UPDATE contracts SET expected_close_date = ${patch.expectedCloseDate}, updated_at = now() WHERE id = ${contractId}`;
    }
    if (patch.closeDate !== undefined) {
      await sql`UPDATE contracts SET close_date = ${patch.closeDate}, updated_at = now() WHERE id = ${contractId}`;
    }
    if (patch.closingDeadlines !== undefined) {
      await sql`UPDATE contracts SET closing_deadlines = ${JSON.stringify(patch.closingDeadlines)}, updated_at = now() WHERE id = ${contractId}`;
    }

    await logOutreachAudit({
      leadId,
      channel: "contract",
      direction: "internal",
      status: "sent",
      reason: `Closing details updated (title/escrow/dates/deadlines)${operator ? ` by ${operator}` : ""}`,
      operator: operator ?? null,
      contentPreview: "closing:details-updated",
    });
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : "updateContractClosing failed" };
  }
}

// --- Profit -------------------------------------------------------------------

/**
 * Profit = assignment_fee_cents − platform costs. Costs are only what is
 * actually recorded (0 today — no platform cost tracking exists yet). A NULL
 * fee means profit is "—" (unknown) — never a fabricated $0.
 */
export async function computeClosingProfit(contractId: string): Promise<ClosingProfit | { success: false; error: string }> {
  try {
    const rows = (await sql`
      SELECT assignment_fee_cents FROM contracts WHERE id = ${contractId}
    `) as Array<{ assignment_fee_cents: number | null }>;
    if (!rows.length) return { success: false, error: "Contract not found" };
    const fee = rows[0].assignment_fee_cents === null ? null : Number(rows[0].assignment_fee_cents);
    const costsCents = 0; // only recorded costs count — none exist today
    return { success: true, assignmentFeeCents: fee, costsCents, netCents: fee === null ? null : fee - costsCents };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : "computeClosingProfit failed" };
  }
}

// --- Attention (feeds the command center later) --------------------------------

/** Overdue checklist steps + expected close within the next 7 days. */
export async function dueAttention(
  contractId: string,
): Promise<{ success: true; attention: AttentionItem[] } | { success: false; error: string }> {
  try {
    const rows = (await sql`
      SELECT close_date, expected_close_date, status FROM contracts WHERE id = ${contractId}
    `) as Array<{ close_date: string | Date | null; expected_close_date: string | Date | null; status: string }>;
    if (!rows.length) return { success: false, error: "Contract not found" };
    const row = rows[0];
    const attention: AttentionItem[] = [];

    if (row.status !== "closed" && row.status !== "cancelled") {
      const overdue = (await sql`
        SELECT id, label, due_date FROM closing_checklist_items
        WHERE contract_id = ${contractId} AND done = false AND due_date IS NOT NULL AND due_date < CURRENT_DATE
        ORDER BY due_date ASC
      `) as Array<{ id: string; label: string; due_date: string | Date }>;
      for (const o of overdue) {
        attention.push({ kind: "checklist", label: o.label, dueDate: sqlDate(o.due_date) ?? "" });
      }

      const today = new Date();
      const in7 = new Date(today);
      in7.setDate(in7.getDate() + 7);
      const isoToday = today.toISOString().split("T")[0];
      const isoIn7 = in7.toISOString().split("T")[0];
      const target = sqlDate(row.expected_close_date);
      if (target !== null && target >= isoToday && target <= isoIn7) {
        attention.push({ kind: "close_date", label: "Expected close within 7 days", date: target });
      }
    }
    return { success: true, attention };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : "dueAttention failed" };
  }
}

// --- recordAssignmentPaid ------------------------------------------------------

export type RecordAssignmentPaidResult =
  | { success: true; id: string; amountCents: number; leadStatus: string; contractStatus: string }
  | { success: false; error: string };

/**
 * Record that the assignment fee was actually paid. HARD GATE (B11): an
 * approved approval_request of kind='assignment' for THIS contract is required
 * — pending/rejected is not approval, so the caller must route through
 * requestApproval() and the owner's /approvals decision first.
 *
 * On success:
 *   - contract.assignment_fee_cents = amountCents (+ assignment_fee mirror so
 *     B10b revenue attribution reads the real number),
 *   - contract.status → 'closed', close_date = today when not already set,
 *   - the lead's outreach_status is walked along the closing arc
 *     (contract_signed → buyer_matched → title → closed → assignment_paid)
 *     via the B6 state machine — which enforces its own transition rules, so
 *     this never bypasses a gate (the forward arc needs no approval; the
 *     contract_signed gate was already enforced when the contract happened).
 */
export async function recordAssignmentPaid(
  contractId: string,
  amountCents: number,
  operator?: string | null,
): Promise<RecordAssignmentPaidResult> {
  try {
    if (!Number.isFinite(amountCents) || amountCents < 0) {
      return { success: false, error: "amountCents must be a non-negative number" };
    }
    const approved = await hasApproval("assignment", "contract", contractId, ["approved"]);
    if (!approved) {
      return { success: false, error: "requires approved assignment approval" };
    }
    const rows = (await sql`
      SELECT id, lead_id, status, close_date FROM contracts WHERE id = ${contractId}
    `) as Array<{ id: string; lead_id: string | null; status: string; close_date: string | Date | null }>;
    if (!rows.length) return { success: false, error: "Contract not found" };
    const row = rows[0];
    if (row.status === "cancelled") {
      return { success: false, error: "Contract is cancelled — cannot record assignment paid" };
    }

    // Walk the lead along the closing arc first (pure transitions; if any step
    // fails nothing about the payment is written).
    if (row.lead_id) {
      const leadRows = (await sql`
        SELECT outreach_status FROM leads WHERE id = ${row.lead_id}
      `) as Array<{ outreach_status: string }>;
      const cur = leadRows.length ? leadRows[0].outreach_status : null;
      if (cur !== "assignment_paid") {
        const arc: readonly string[] = CLOSING_ARC;
        const start = arc.indexOf(cur ?? "");
        if (start === -1 && cur !== "contract_signed") {
          return {
            success: false,
            error:
              `Lead is not on the closing arc (outreach_status=${cur}) — drive it to contract_signed ` +
              `(approved contract request) before recording the payment`,
          };
        }
        let to: string | null = cur === "contract_signed" ? "buyer_matched" : start >= 0 ? arc[start + 1] : null;
        while (to) {
          const res = await transitionOutreachStatus(row.lead_id, to, {
            reason: `Assignment paid — advancing closing arc${operator ? ` (${operator})` : ""}`,
            operator: operator ?? "auto",
          });
          if (!res.success) {
            return { success: false, error: `Lead transition to ${to} failed: ${res.error}` };
          }
          const idx = arc.indexOf(to);
          to = idx >= 0 && idx < arc.length - 1 ? arc[idx + 1] : null;
        }
      }
    }

    await sql`
      UPDATE contracts
      SET assignment_fee_cents = ${amountCents},
          assignment_fee = ${amountCents / 100},
          status = 'closed',
          close_date = COALESCE(close_date, CURRENT_DATE),
          updated_at = now()
      WHERE id = ${contractId}
    `;
    await logOutreachAudit({
      leadId: row.lead_id,
      channel: "contract",
      direction: "internal",
      status: "sent",
      reason: `Assignment paid: $${(amountCents / 100).toFixed(2)} — contract closed${operator ? ` (${operator})` : ""}`,
      operator: operator ?? null,
      contentPreview: "closing:assignment-paid",
    });
    return { success: true, id: String(row.id), amountCents, leadStatus: "assignment_paid", contractStatus: "closed" };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : "recordAssignmentPaid failed" };
  }
}

// --- Reads for the /contracts UI -----------------------------------------------

export type ContractListItem = {
  id: string;
  contractType: string;
  status: string;
  leadId: string | null;
  address: string | null;
  fullName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  assignmentFeeCents: number | null;
  expectedCloseDate: string | null;
  closeDate: string | null;
  titleCompany: string | null;
  escrowAccount: string | null;
  leadOutreachStatus: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function listContracts(limit = 200): Promise<ContractListItem[]> {
  try {
    const rows = (await sql`
      SELECT c.id, c.contract_type, c.status, c.lead_id, c.campaign_id, c.assignment_fee_cents,
             c.expected_close_date, c.close_date, c.title_company, c.escrow_account,
             c.created_at, c.updated_at,
             l.property_address, l.property_city, l.property_state, l.full_name, l.outreach_status,
             camp.name AS campaign_name
      FROM contracts c
      LEFT JOIN leads l ON l.id = c.lead_id
      LEFT JOIN campaigns camp ON camp.id = c.campaign_id
      ORDER BY c.created_at DESC
      LIMIT ${limit}
    `) as Array<{
      id: string; contract_type: string; status: string; lead_id: string | null; campaign_id: string | null;
      assignment_fee_cents: number | null; expected_close_date: string | Date | null; close_date: string | Date | null;
      title_company: string | null; escrow_account: string | null; created_at: Date; updated_at: Date;
      property_address: string | null; property_city: string | null; property_state: string | null;
      full_name: string | null; outreach_status: string | null; campaign_name: string | null;
    }>;
    return rows.map((r) => ({
      id: String(r.id),
      contractType: r.contract_type,
      status: r.status,
      leadId: r.lead_id === null ? null : String(r.lead_id),
      address:
        r.property_address === null
          ? null
          : `${r.property_address}, ${r.property_city ?? ""}, ${r.property_state ?? ""}`.replace(/,\s*$/, ""),
      fullName: r.full_name,
      campaignId: r.campaign_id === null ? null : String(r.campaign_id),
      campaignName: r.campaign_name,
      assignmentFeeCents: r.assignment_fee_cents === null ? null : Number(r.assignment_fee_cents),
      expectedCloseDate: sqlDate(r.expected_close_date),
      closeDate: sqlDate(r.close_date),
      titleCompany: r.title_company,
      escrowAccount: r.escrow_account,
      leadOutreachStatus: r.outreach_status,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }));
  } catch {
    return [];
  }
}

export type ContractDetail = ContractListItem & {
  purchasePriceCents: number | null;
  earnestMoneyCents: number | null;
  closingDeadlines: Record<string, unknown> | null;
  checklist: ClosingChecklistItem[];
  profit: { assignmentFeeCents: number | null; costsCents: number; netCents: number | null };
  attention: AttentionItem[];
  assignmentApproved: boolean;
  assignmentPending: boolean;
};

export async function getContractDetail(contractId: string): Promise<ContractDetail | null> {
  try {
    const list = await listContracts(1000);
    const item = list.find((c) => c.id === contractId);
    if (!item) return null;
    const rows = (await sql`
      SELECT purchase_price, earnest_money, closing_deadlines FROM contracts WHERE id = ${contractId}
    `) as Array<{ purchase_price: number | null; earnest_money: number | null; closing_deadlines: unknown }>;
    const row = rows[0];
    const [checklist, profitRes, attentionRes, approvals] = await Promise.all([
      getClosingChecklist(contractId),
      computeClosingProfit(contractId),
      dueAttention(contractId),
      (await sql`
        SELECT status FROM approval_requests
        WHERE kind = 'assignment' AND ref_type = 'contract' AND ref_id = ${contractId}
        ORDER BY created_at DESC
      `) as Array<{ status: string }>,
    ]);
    const profit = profitRes.success
      ? { assignmentFeeCents: profitRes.assignmentFeeCents, costsCents: profitRes.costsCents, netCents: profitRes.netCents }
      : null;
    const attention = attentionRes.success ? attentionRes.attention : [];
    return {
      ...item,
      purchasePriceCents:
        row.purchase_price === null || row.purchase_price === undefined ? null : Math.round(Number(row.purchase_price) * 100),
      earnestMoneyCents:
        row.earnest_money === null || row.earnest_money === undefined ? null : Math.round(Number(row.earnest_money) * 100),
      closingDeadlines: (row.closing_deadlines ?? null) as Record<string, unknown> | null,
      checklist,
      profit: profit ?? { assignmentFeeCents: null, costsCents: 0, netCents: null },
      attention,
      assignmentApproved: approvals.some((a) => a.status === "approved"),
      assignmentPending: approvals.some((a) => a.status === "pending"),
    };
  } catch {
    return null;
  }
}

/**
 * Request the B11 assignment approval for a contract (dup-guarded — a pending
 * request for the same contract is returned as duplicate). The owner decides on
 * /approvals; recordAssignmentPaid only succeeds after that decision.
 */
export async function requestAssignmentApproval(
  contractId: string,
  amountCents: number | null,
  operator: string,
): Promise<{ success: true; id: string; duplicate?: boolean } | { success: false; error: string }> {
  try {
    const rows = (await sql`
      SELECT c.contract_type, l.property_address, l.property_city, l.property_state
      FROM contracts c LEFT JOIN leads l ON l.id = c.lead_id
      WHERE c.id = ${contractId}
    `) as Array<{ contract_type: string; property_address: string | null; property_city: string | null; property_state: string | null }>;
    if (!rows.length) return { success: false, error: "Contract not found" };
    const r = rows[0];
    const address = r.property_address
      ? `${r.property_address}, ${r.property_city ?? ""}, ${r.property_state ?? ""}`.replace(/,\s*$/, "")
      : null;
    return await requestApproval({
      kind: "assignment",
      refType: "contract",
      refId: contractId,
      amountCents: amountCents ?? undefined,
      details:
        `Assignment payment${address ? ` for ${address}` : ""} (${r.contract_type})` +
        `${amountCents !== null ? ` — $${(amountCents / 100).toFixed(2)}` : ""} — approve to record it`,
      operator,
    });
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : "requestAssignmentApproval failed" };
  }
}
