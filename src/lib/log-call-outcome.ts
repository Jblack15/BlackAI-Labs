// DealFlow AI — Seller Conversation Engine (D2): logCallOutcome
//
// The WRITE-side of the Owner Action Queue (D1 was read-only). After every
// manual owner call the owner logs what happened; this engine turns that
// record into pipeline movement:
//
//   logCallOutcome(leadId, input, opts)
//     — ONE call after ONE phone conversation. It:
//       1. Validates the outcome against the CALL_OUTCOME_OPTIONS vocabulary
//          (every option maps to an outreach_status the B6 state machine
//          already accepts — no new statuses are invented here).
//       2. Advances the lead through the EXISTING outreach-status state
//          machine (transitionOutreachStatus / OUTREACH_TRANSITIONS — never a
//          reimplementation). If the target status is not directly reachable
//          (e.g. new → qualified), the engine walks the map hop by hop.
//       3. Writes the structured seller fields via saveSellerCrmFields (the
//          B8 seller-CRM service) — asking price, desired close, occupancy,
//          condition, mortgage/lien disclosure, decision-makers, deal
//          potential, next action + due date.
//       4. For suppression outcomes (verbal opt-out / DNC / wrong number /
//          invalid / do-not-mail) engages the B2 compliance hard block:
//          terminal status + suppression flag (+ consent record for opt-out)
//          + priority reclassified DEAD. Further outreach is refused by the
//          existing compliance checks (assertOutreachAllowed) and the state
//          machine (terminal states are absorbing).
//       5. Writes the audit trail: one channel='call_outcome' row per log
//          (plus the state machine's channel='status' rows per hop and the
//          compliance channel='blocked' row on suppression).
//
// NO AI IS CLAIMED. There is no LLM provider wired in this codebase. All
// mapping is deterministic keyword/vocabulary mapping; the free-text seller
// summary is stored as-is in seller_notes. The outcome vocabulary and the
// "assisted (heuristic)" extraction live in the CLIENT-SAFE module
// src/lib/call-outcome-vocab.ts — the engine re-exports them here; this file
// itself is server-only (it imports ~/db).
//
// $0 SPEND / NO AUTONOMOUS OUTBOUND: this module never sends anything. It
// records owner input after the owner's own manual call. It cannot call,
// text, or email anyone.
import { sql } from "~/db";
import { OUTREACH_TRANSITIONS } from "~/lib/outreach-status-map";
import type { OutreachStatus } from "~/lib/outreach-status-map";
import { transitionOutreachStatus } from "~/lib/outreach-status";
import { recordSuppression, logOutreachAudit } from "~/lib/compliance";
import { saveSellerCrmFields } from "~/lib/seller-crm";
import { computePriorityQueue } from "~/lib/prioritization";
import {
  CALL_OUTCOME_VALUES,
  CALL_OUTCOME_OPTIONS,
  getCallOutcomeOption,
  extractSellerHints,
  type CallOutcomeValue,
  type CallOutcomeOption,
  type CallOutcomeSuppression,
} from "~/lib/call-outcome-vocab";

export {
  CALL_OUTCOME_VALUES,
  CALL_OUTCOME_OPTIONS,
  getCallOutcomeOption,
  extractSellerHints,
};
export type { CallOutcomeValue, CallOutcomeOption, CallOutcomeSuppression, HeuristicExtract } from "~/lib/call-outcome-vocab";

export interface LogCallOutcomeInput {
  /** Outcome code from CALL_OUTCOME_VALUES. */
  outcome: CallOutcomeValue;
  /** Free-text summary of the call (stored verbatim in seller_notes). */
  sellerSummary?: string;
  /** Structured seller fields (owner-confirmed; REAL columns only). */
  askingPrice?: number | string | null;
  desiredClose?: string | null;
  propertyCondition?: string | null;
  occupancy?: "owner" | "tenant" | "vacant" | "unknown" | null;
  motivation?: string | null;
  mortgageBalance?: number | string | null;
  mortgageLender?: string | null;
  lienInfo?: string | null;
  decisionMakers?: string | null;
  dealPotential?: "high" | "medium" | "low" | "none" | null;
  nextAction?: string | null;
  nextActionDue?: string | null;
  /** Real contact timestamp (ISO). Stamped automatically for contact outcomes. */
  contactedAt?: string | null;
}

export type LogCallOutcomeResult = {
  success: boolean;
  error?: string;
  outcome?: CallOutcomeValue;
  /** The state-machine hops executed (from→to). */
  transitions?: Array<{ from: string; to: string }>;
  /** Final outreach status after the log. */
  status?: string;
  /** True when a hard suppression flag was engaged. */
  suppressionApplied?: boolean;
  /** True when the lead was already suppressed/terminal (log refused). */
  blockedTerminal?: boolean;
  /** Regenerated data-derived seller summary (from seller-crm). */
  sellerSummary?: string;
  /** What was persisted. */
  persisted?: string[];
  nextAction?: string | null;
  nextActionDue?: string | null;
};

const TERMINAL_SET = new Set([
  "dnc", "do_not_mail", "opted_out", "invalid_contact", "wrong_number",
  "not_interested", "dead_lead",
]);

/** Outcomes where the owner actually reached a human (last_contact_at stamps). */
const NO_CONTACT_SET = new Set(["no_answer", "wrong_number", "invalid_number"]);

function defaultFollowUp(): { action: string; due: string } {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return { action: "Call back (follow-up)", due: d.toISOString().slice(0, 10) };
}

/**
 * Record what happened on one manual owner call and advance the lead. See the
 * module header for the full contract. Never sends anything.
 */
export async function logCallOutcome(
  leadId: string,
  input: LogCallOutcomeInput,
  opts: { operator?: string } = {},
): Promise<LogCallOutcomeResult> {
  const operator = opts.operator ?? "owner";
  try {
    const option = getCallOutcomeOption(input.outcome);
    if (!option) return { success: false, error: `Invalid call outcome: ${input.outcome}` };

    // Load the lead's current state.
    const rows = (await sql`
      SELECT id, outreach_status, dnc_flag, do_not_mail, opted_out,
             invalid_contact, wrong_number, contactable, score, priority_queue,
             score_factors
      FROM leads WHERE id = ${leadId}
    `) as Array<Record<string, unknown>>;
    if (!rows.length) return { success: false, error: "Lead not found" };
    const lead = rows[0];
    const current = (lead.outreach_status as string) || "new";

    // Compliance: never log outcomes on an already-terminal lead (further
    // contact is not permitted — the state machine's terminals are absorbing).
    if (TERMINAL_SET.has(current)) {
      return {
        success: false,
        blockedTerminal: true,
        error: `Blocked: lead is already in terminal status ${current} — no further outreach permitted (override via the CRM only).`,
      };
    }

    // 1. Walk the state machine to the outcome's target status.
    const path = findOutreachPath(current, option.toStatus);
    if (path === null) {
      return {
        success: false,
        error: `No valid path from ${current} to ${option.toStatus} in the outreach status map.`,
      };
    }
    const transitions: Array<{ from: string; to: string }> = [];
    let cursor = current;
    for (const hop of path) {
      const res = await transitionOutreachStatus(leadId, hop, {
        reason: `Call outcome logged: ${option.label} (${input.outcome})`,
        operator,
      });
      if (!res.success) {
        return { success: false, error: `Transition ${cursor} → ${hop} failed: ${res.error}` };
      }
      transitions.push({ from: res.from!, to: res.to! });
      cursor = hop;
    }

    // 2. Hard suppression for suppression outcomes (engages the B2 block).
    let suppressionApplied = false;
    if (option.suppression === "dnc") {
      await sql`UPDATE leads SET dnc_flag = 'DNC' WHERE id = ${leadId}`;
      suppressionApplied = true;
    } else if (option.suppression) {
      const res = await recordSuppression(leadId, option.suppression, {
        operator,
        channel: "voice",
        detail: `Verbal ${option.label.toLowerCase()} recorded after manual owner call`,
      });
      if (!res.success) return { success: false, error: `Suppression failed: ${res.error}` };
      suppressionApplied = true;
    }

    // 3. Seller fields (only when something real was captured).
    const persisted: string[] = [];
    const fields: Record<string, unknown> = {};
    const has = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== "";
    if (input.sellerSummary !== undefined) fields.sellerNotes = input.sellerSummary ?? null;
    if (has(input.askingPrice)) fields.askingPrice = input.askingPrice;
    if (has(input.desiredClose)) fields.desiredClose = input.desiredClose;
    if (has(input.propertyCondition)) fields.propertyCondition = input.propertyCondition;
    if (has(input.occupancy)) fields.occupancy = input.occupancy;
    if (has(input.motivation)) fields.motivation = input.motivation;
    if (has(input.mortgageBalance)) fields.mortgageBalance = input.mortgageBalance;
    if (has(input.mortgageLender)) fields.mortgageLender = input.mortgageLender;
    if (has(input.lienInfo)) fields.lienInfo = input.lienInfo;
    if (has(input.decisionMakers)) fields.decisionMakers = input.decisionMakers;
    if (has(input.dealPotential)) fields.dealPotential = input.dealPotential;
    if (has(input.nextAction)) fields.nextAction = input.nextAction;
    if (has(input.nextActionDue)) fields.nextActionDue = input.nextActionDue;
    if (!NO_CONTACT_SET.has(input.outcome)) {
      fields.lastContactAt = input.contactedAt || new Date().toISOString();
    }

    let sellerSummary: string | undefined;
    if (Object.keys(fields).length > 0) {
      const saved = await saveSellerCrmFields(leadId, fields as never, { operator });
      if (!saved.success) {
        return { success: false, error: `Seller fields failed to save: ${saved.error}` };
      }
      sellerSummary = saved.sellerSummary;
      persisted.push(saved.fieldSummary!);
    }

    // 4. Deterministic follow-up scheduling (no_answer / call_back without an
    //    explicit due date → call back in 7 days).
    let nextAction = has(input.nextAction) ? String(input.nextAction) : null;
    let nextActionDue = has(input.nextActionDue) ? String(input.nextActionDue) : null;
    if ((input.outcome === "no_answer" || input.outcome === "call_back") && !nextActionDue) {
      const fb = defaultFollowUp();
      nextAction = nextAction ?? fb.action;
      nextActionDue = fb.due;
      await sql`
        UPDATE leads SET next_action = ${nextAction}, next_action_due = ${nextActionDue}
        WHERE id = ${leadId}
      `;
      persisted.push("next_action + next_action_due (auto follow-up)");
    }

    // 5. Recompute this lead's priority so suppression reads DEAD immediately
    //    (drops out of the call-now queue) and active outcomes re-rank.
    const q = computePriorityQueue({
      score: lead.score == null ? null : Number(lead.score),
      contactable: !!lead.contactable,
      outreach_status: option.toStatus,
      dnc_flag: option.suppression === "dnc" ? "DNC" : (lead.dnc_flag as string | null),
      do_not_mail: option.suppression === "do_not_mail" ? true : !!lead.do_not_mail,
      opted_out: option.suppression === "opted_out" ? true : !!lead.opted_out,
      invalid_contact: option.suppression === "invalid_contact" ? true : !!lead.invalid_contact,
      wrong_number: option.suppression === "wrong_number" ? true : !!lead.wrong_number,
      score_factors: (lead.score_factors as Record<string, unknown> | null) ?? null,
    });
    await sql`
      UPDATE leads SET priority_queue = ${q}, priority_updated_at = now(), updated_at = now()
      WHERE id = ${leadId}
    `;

    // 6. The call-outcome audit row (channel='call_outcome').
    await logOutreachAudit({
      leadId,
      channel: "call_outcome",
      direction: "internal",
      status: "received",
      reason: `Call outcome logged: ${option.label} (${input.outcome})`,
      contentPreview: [
        `outcome:${input.outcome}`,
        persisted.length ? `fields: ${persisted.join(", ")}` : "",
        nextActionDue ? `next_due: ${nextActionDue}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      operator,
    });

    return {
      success: true,
      outcome: input.outcome,
      transitions,
      status: option.toStatus,
      suppressionApplied,
      sellerSummary,
      persisted,
      nextAction,
      nextActionDue,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to log call outcome",
    };
  }
}
