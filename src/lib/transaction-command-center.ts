// DealFlow AI — D3 Transaction Command Center + automated buyer matching (Steps 8 & 9)
//
// Builds on the existing production pieces — NOT a reimplementation:
//   * buyer matching: reuses `autoMatchBuyers` / `scoreBuyerForLead` from
//     src/lib/buyer-marketplace.ts (B5) — location (preferred market/zip),
//     price band (min/max purchase price), property type, rehab budget,
//     funding mode + closing speed (informational neutrals), active-only,
//     deal-history counters. This module only WRAPS it into a deal-oriented
//     read and surfaces the "why" strings the matcher already produces.
//   * closing arc: reuses `transitionOutreachStatus` (B6 state machine) and
//     the B11 approval gates (`hasApproval` / `requestApproval`). The arc
//     walks legitimate forward transitions only (qualified → offer →
//     negotiation → contract_sent → contract_signed → buyer_matched → title)
//     and NEVER bypasses a gate: offer/negotiation require an approved
//     'offer' request, contract_signed requires an approved 'contract'
//     request — when one is missing the shortcut REQUESTs it and stops, the
//     owner decides on /approvals, then presses the shortcut again.
//   * due-attention: computed from the real contracts /
//     closing_checklist_items / leads tables (same vocabulary as the B12
//     closing workflow's dueAttention(), but at the LIST level so the owner
//     sees every transaction that needs attention without opening each one).
//
// NEVER-AUTOMATE (owner report): buyer outreach is a recommendation only —
// nothing here contacts a buyer, promises a deal, or commits anyone. The
// shortlist is display-and-copy only; outreach stays manual + owner-approved
// (per plan rev 27). The closing-arc shortcuts are owner-gated UI buttons,
// and the approval gates are enforced inside the state machine itself.
//
// Server-only module: import inside createServerFn handlers / API routes /
// scripts. `sql` is imported relative so plain-bun scripts (scripts/verify-*)
// can import this module directly.
import { sql } from "../db";
import { autoMatchBuyers } from "./buyer-marketplace";
import { transitionOutreachStatus } from "./outreach-status";
import { hasApproval, requestApproval } from "./approvals";
import { logOutreachAudit } from "./compliance";

// --- Due-attention (Step 9) ---------------------------------------------------
export type TransactionAttentionKind =
  | "overdue_checklist"
  | "close_date"
  | "missing_title"
  | "no_close_date"
  | "cancelled";

export interface TransactionAttention {
  kind: TransactionAttentionKind;
  label: string;
  date?: string;
}

export interface TransactionRow {
  contractId: string;
  status: string;
  contractType: string;
  address: string | null;
  fullName: string | null;
  leadId: string | null;
  leadOutreachStatus: string | null;
  expectedCloseDate: string | null;
  closeDate: string | null;
  titleCompany: string | null;
  escrowAccount: string | null;
  assignmentFeeCents: number | null;
  createdAt: string;
  checklist: { done: number; total: number; overdue: number };
  attention: TransactionAttention[];
}

export interface TransactionCommandCenterData {
  transactions: TransactionRow[];
  totals: {
    transactions: number;
    needsAttention: number;
    overdueSteps: number;
    closingWithin7d: number;
    missingTitle: number;
    cancelled: number;
  };
  dbOk: boolean;
}

function day(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

/**
 * List-level due-attention for every transaction, computed from the real
 * contracts / closing_checklist_items / leads tables:
 *   - overdue checklist steps (done=false, due < today) — the "overdue" tag
 *   - expected close within the next 7 days          — the "closing" tag
 *   - missing title company on an active contract    — the "title" tag
 *   - no expected close date set                     — the "schedule" tag
 *   - cancelled contracts                            — the "cancelled" tag
 * Closed contracts are exempt from all of the above except cancelled.
 * With zero contracts the result is zeros — never fabricated rows.
 */
export async function transactionCommandCenter(): Promise<TransactionCommandCenterData> {
  try {
    const rows = (await sql`
      SELECT c.id, c.status, c.contract_type, c.lead_id, c.title_company, c.escrow_account,
             c.expected_close_date, c.close_date, c.assignment_fee_cents, c.created_at,
             l.property_address, l.property_city, l.property_state, l.full_name, l.outreach_status
      FROM contracts c
      LEFT JOIN leads l ON l.id = c.lead_id
      ORDER BY c.created_at DESC
      LIMIT 200
    `) as Array<{
      id: string; status: string; contract_type: string; lead_id: string | null;
      title_company: string | null; escrow_account: string | null;
      expected_close_date: Date | string | null; close_date: Date | string | null;
      assignment_fee_cents: number | null; created_at: Date;
      property_address: string | null; property_city: string | null; property_state: string | null;
      full_name: string | null; outreach_status: string | null;
    }>;

    const checklist = (await sql`
      SELECT contract_id, count(*)::int AS total,
             count(*) FILTER (WHERE done)::int AS done,
             count(*) FILTER (WHERE done = false AND due_date IS NOT NULL AND due_date < CURRENT_DATE)::int AS overdue
      FROM closing_checklist_items
      GROUP BY contract_id
    `) as Array<{ contract_id: string; total: number; done: number; overdue: number }>;
    const checklistByContract = new Map(checklist.map((r) => [String(r.contract_id), r]));

    const isoToday = new Date().toISOString().slice(0, 10);
    const in7 = new Date();
    in7.setDate(in7.getDate() + 7);
    const isoIn7 = in7.toISOString().slice(0, 10);

    const transactions: TransactionRow[] = rows.map((r) => {
      const status = r.status;
      const active = status !== "closed" && status !== "cancelled";
      const cl = checklistByContract.get(String(r.id)) ?? { total: 0, done: 0, overdue: 0 };
      const attention: TransactionAttention[] = [];
      const expected = day(r.expected_close_date);

      if (status === "cancelled") {
        attention.push({ kind: "cancelled", label: "Transaction cancelled — no closing in progress" });
      } else if (active) {
        if (cl.overdue > 0) {
          attention.push({
            kind: "overdue_checklist",
            label: `${cl.overdue} overdue closing checklist step${cl.overdue === 1 ? "" : "s"}`,
          });
        }
        if (expected !== null && expected >= isoToday && expected <= isoIn7) {
          attention.push({ kind: "close_date", label: "Expected close within 7 days", date: expected });
        }
        if (!r.title_company || !String(r.title_company).trim()) {
          attention.push({ kind: "missing_title", label: "No title company set" });
        }
        if (expected === null) {
          attention.push({ kind: "no_close_date", label: "No expected close date set" });
        }
      }
      return {
        contractId: String(r.id),
        status,
        contractType: r.contract_type,
        address:
          r.property_address === null
            ? null
            : `${r.property_address}, ${r.property_city ?? ""}, ${r.property_state ?? ""}`.replace(/,\s*$/, ""),
        fullName: r.full_name,
        leadId: r.lead_id === null ? null : String(r.lead_id),
        leadOutreachStatus: r.outreach_status,
        expectedCloseDate: expected,
        closeDate: day(r.close_date),
        titleCompany: r.title_company,
        escrowAccount: r.escrow_account,
        assignmentFeeCents: r.assignment_fee_cents === null ? null : Number(r.assignment_fee_cents),
        createdAt: String(r.created_at),
        checklist: { done: cl.done, total: cl.total, overdue: cl.overdue },
        attention,
      };
    });

    const totals = {
      transactions: transactions.length,
      needsAttention: transactions.filter((t) => t.attention.length > 0).length,
      overdueSteps: transactions.reduce((n, t) => n + t.checklist.overdue, 0),
      closingWithin7d: transactions.filter((t) => t.attention.some((a) => a.kind === "close_date")).length,
      missingTitle: transactions.filter((t) => t.attention.some((a) => a.kind === "missing_title")).length,
      cancelled: transactions.filter((t) => t.attention.some((a) => a.kind === "cancelled")).length,
    };
    return { transactions, totals, dbOk: true };
  } catch {
    return { transactions: [], totals: { transactions: 0, needsAttention: 0, overdueSteps: 0, closingWithin7d: 0, missingTitle: 0, cancelled: 0 }, dbOk: false };
  }
}

// --- Buyer shortlist (Step 8) --------------------------------------------------
export interface DealPickerLead {
  id: string;
  fullName: string | null;
  address: string | null;
  propertyCity: string | null;
  propertyState: string | null;
  pipelineStage: string | null;
  outreachStatus: string | null;
  score: number | null;
  priceHintCents: number | null;
}

/**
 * Deals the owner can run a shortlist for: leads that reached a
 * qualified/analysis deal state (pipeline deal arc or outreach deal arc), any
 * lead with a saved deal_analyses row, plus the top-scored HOT/HIGH leads so
 * shortlisting is usable before qualification (the zero-pilot's callable set).
 */
export async function listDealsForShortlist(): Promise<DealPickerLead[]> {
  try {
    const rows = (await sql`
      SELECT l.id, l.full_name, l.property_address, l.property_city, l.property_state,
             l.pipeline_stage, l.outreach_status, l.score, l.score_factors,
             EXISTS (SELECT 1 FROM deal_analyses da WHERE da.lead_id = l.id) AS has_analysis
      FROM leads l
      WHERE l.pipeline_stage IN (
              'deal_analysis','offer_recommendation','human_approval','offer_sent','negotiation',
              'contract_prepared','contract_sent','contract_signed','buyer_matching',
              'buyer_contacted','assignment','closing','closed_won','ai_qualification')
         OR l.outreach_status IN (
              'qualified','offer','negotiation','contract_sent','contract_signed',
              'buyer_matched','title','closed','assignment_paid')
         OR EXISTS (SELECT 1 FROM deal_analyses da WHERE da.lead_id = l.id)
         OR l.score >= 8
      ORDER BY (l.outreach_status IN ('qualified','offer','negotiation','contract_sent','contract_signed','buyer_matched','title')) DESC,
               l.score DESC NULLS LAST, l.updated_at DESC
      LIMIT 60
    `) as Array<{
      id: string; full_name: string | null; property_address: string | null;
      property_city: string | null; property_state: string | null;
      pipeline_stage: string | null; outreach_status: string | null;
      score: number | null; score_factors: Record<string, unknown> | null; has_analysis: boolean;
    }>;
    return rows.map((r) => {
      const sf = r.score_factors || {};
      const mao = typeof sf.estimated_mao === "number" ? sf.estimated_mao : Number(sf.estimated_mao ?? 0) || null;
      return {
        id: String(r.id),
        fullName: r.full_name,
        address:
          r.property_address === null
            ? null
            : `${r.property_address}, ${r.property_city ?? ""}, ${r.property_state ?? ""}`.replace(/,\s*$/, ""),
        propertyCity: r.property_city,
        propertyState: r.property_state,
        pipelineStage: r.pipeline_stage,
        outreachStatus: r.outreach_status,
        score: r.score === null ? null : Number(r.score),
        priceHintCents: mao === null ? null : Math.round(mao * 100),
      };
    });
  } catch {
    return [];
  }
}

/**
 * Buyer shortlist for a deal — pure reuse of the B5 production matcher
 * (autoMatchBuyers → scoreBuyerForLead). Returns the lead context + ranked
 * matches with the matcher's own "why" strings (matched / neutral / missed).
 * Empty matches = honest "no buyer matches on the stored criteria".
 */
export async function buyerShortlistForDeal(leadId: string): Promise<ReturnType<typeof autoMatchBuyers>> {
  return autoMatchBuyers(leadId);
}

// --- Closing-arc shortcuts (Step 9, owner-gated) -------------------------------
export type ArcTarget = "contract_signed" | "buyer_matched" | "title";

export type ArcAdvanceResult =
  | { success: true; reached: ArcTarget; steps: string[] }
  | { success: true; approvalRequested: true; kinds: string[]; duplicate?: boolean }
  | { success: false; error: string };

/** Forward arc (outreach_status vocabulary, state-machine order). */
const ARC_CHAIN = [
  "qualified",
  "offer",
  "negotiation",
  "contract_sent",
  "contract_signed",
  "buyer_matched",
  "title",
] as const;

/** B11 gate per arc step: which approved approval kind a transition INTO the
 *  target requires (mirrors the CRM's setOutreachStatus gate map). */
function gateForStatus(to: string): "offer" | "contract" | null {
  if (to === "offer" || to === "negotiation") return "offer";
  if (to === "contract_signed") return "contract";
  return null;
}

/**
 * Owner-gated closing-arc shortcut. Walks the lead's outreach_status forward
 * to `to` through the B6 state machine only (no jumps, no overrides):
 *   offer → negotiation → contract_sent → contract_signed → buyer_matched →
 *   title. Offer/negotiation transitions require an approved 'offer'
 *   approval, contract_signed requires an approved 'contract' approval —
 *   enforced by the state machine itself (opts.requireApproval). When a gate
 *   is missing the shortcut REQUESTs the approval (dedupe-aware, shows up on
 *   /approvals) and stops; the owner decides, then presses the shortcut again.
 * Reaching `title` also flips the contract status to 'title_open' (audited).
 */
export async function advanceClosingArc(
  contractId: string,
  to: ArcTarget,
  operator: string,
): Promise<ArcAdvanceResult> {
  try {
    const rows = (await sql`
      SELECT c.id, c.lead_id, c.status
      FROM contracts c WHERE c.id = ${contractId}
    `) as Array<{ id: string; lead_id: string | null; status: string }>;
    if (!rows.length) return { success: false, error: "Contract not found" };
    const leadId = rows[0].lead_id;
    if (!leadId) return { success: false, error: "Contract has no linked lead — cannot advance" };

    const leads = (await sql`
      SELECT COALESCE(NULLIF(outreach_status, ''), 'new') AS status FROM leads WHERE id = ${leadId}
    `) as Array<{ status: string }>;
    if (!leads.length) return { success: false, error: "Linked lead not found" };
    const current = leads[0].status;

    const i = ARC_CHAIN.indexOf(current as (typeof ARC_CHAIN)[number]);
    const j = ARC_CHAIN.indexOf(to);
    if (j === -1) return { success: false, error: `Unknown arc target: ${to}` };
    if (i === -1) {
      return {
        success: false,
        error:
          `Lead outreach status "${current}" is not on the closing arc — reach it via the CRM ` +
          `(qualified → offer → negotiation → contract_sent → contract_signed) before using this shortcut.`,
      };
    }
    if (i >= j) {
      return { success: true, reached: to, steps: [] }; // already there (honest no-op)
    }

    const steps = ARC_CHAIN.slice(i + 1, j + 1) as string[];

    // --- Gate check: request ANY missing approval BEFORE moving (never move
    //     then discover a gate; never bypass). requestApproval dedupes. ---
    const neededKinds = [...new Set(steps.map((s) => gateForStatus(s)).filter((g): g is "offer" | "contract" => g !== null))];
    const missing = [] as string[];
    for (const kind of neededKinds) {
      const ok = await hasApproval(kind, "lead", leadId, ["approved"]);
      if (!ok) missing.push(kind);
    }
    if (missing.length > 0) {
      let duplicate = false;
      for (const kind of missing) {
        const req = await requestApproval({
          kind,
          refType: "lead",
          refId: leadId,
          details: `Closing-arc shortcut "${to}" (Transaction Command Center) — approve for the arc to advance.`,
          operator,
        });
        if (!req.success) return { success: false, error: req.error };
        if (req.duplicate) duplicate = true;
      }
      return { success: true, approvalRequested: true, kinds: missing, ...(duplicate ? { duplicate: true } : {}) };
    }

    // --- Execute the walk (every gated step passes through the state machine) ---
    const applied: string[] = [];
    for (const step of steps) {
      const gate = gateForStatus(step);
      const res = await transitionOutreachStatus(leadId, step, {
        reason: `Closing-arc shortcut → ${to} (Transaction Command Center)`,
        operator,
        ...(gate ? { requireApproval: { kind: gate, refId: leadId } } : {}),
      });
      if (!res.success) return { success: false, error: `Arc step to ${step} failed: ${res.error}` };
      applied.push(`${res.from}→${res.to}`);
    }

    if (to === "title" && rows[0].status !== "closed" && rows[0].status !== "cancelled") {
      await sql`UPDATE contracts SET status = 'title_open', updated_at = now() WHERE id = ${contractId}`;
      await logOutreachAudit({
        leadId,
        channel: "contract",
        direction: "internal",
        status: "sent",
        reason: `Closing arc reached ${to} — contract status → title_open${operator ? ` (${operator})` : ""}`,
        operator,
        contentPreview: "closing:title-opened",
      });
    }

    return { success: true, reached: to, steps: applied };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : "advanceClosingArc failed" };
  }
}