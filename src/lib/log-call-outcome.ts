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
// summary is stored as-is in seller_notes. Any "extraction" from the summary
// is a simple heuristic (see summarizeSellerNotes) and is labeled as such —
// never as AI.
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

// --- Outcome vocabulary -------------------------------------------------------
// Every outcome maps to a status the B6 state machine already supports.
// Terminal outcomes additionally engage the compliance hard block.

export const CALL_OUTCOME_VALUES = [
  "no_answer",
  "contacted",
  "connected",
  "qualified",
  "call_back",
  "not_interested",
  "wrong_number",
  "invalid_number",
  "opted_out",
  "dnc",
  "do_not_mail",
  "deceased",
  "sold",
] as const;
export type CallOutcomeValue = (typeof CALL_OUTCOME_VALUES)[number];

export type CallOutcomeSuppression =
  | "do_not_mail"
  | "opted_out"
  | "invalid_contact"
  | "wrong_number"
  | "dnc";

export interface CallOutcomeOption {
  value: CallOutcomeValue;
  label: string;
  /** The outreach status this outcome advances the lead to (state-machine vocabulary). */
  toStatus: OutreachStatus;
  /** Terminal outcomes absorb the lead; suppression engages the compliance block. */
  terminal: boolean;
  /** Suppression flag to set via recordSuppression (or 'dnc' → dnc_flag='DNC'). */
  suppression?: CallOutcomeSuppression;
  description: string;
}

export const CALL_OUTCOME_OPTIONS: CallOutcomeOption[] = [
  {
    value: "no_answer",
    label: "No answer",
    toStatus: "contact_attempted",
    terminal: false,
    description: "Call rang, nobody picked up. Attempt logged; schedule a call-back.",
  },
  {
    value: "contacted",
    label: "Contacted (voicemail / other party)",
    toStatus: "contact_attempted",
    terminal: false,
    description: "Reached a person or left a voicemail, but not the decision-maker yet.",
  },
  {
    value: "connected",
    label: "Connected with the owner",
    toStatus: "connected",
    terminal: false,
    description: "Spoke directly with the owner/seller.",
  },
  {
    value: "qualified",
    label: "Qualified — real deal candidate",
    toStatus: "qualified",
    terminal: false,
    description: "Met qualification criteria (owns property, motivated, realistic price).",
  },
  {
    value: "call_back",
    label: "Asked to call back later",
    toStatus: "follow_up",
    terminal: false,
    description: "Seller asked to be contacted again — schedule the follow-up.",
  },
  {
    value: "not_interested",
    label: "Not interested",
    toStatus: "not_interested",
    terminal: true,
    description: "Seller is not interested in selling. Absorbing status.",
  },
  {
    value: "wrong_number",
    label: "Wrong number",
    toStatus: "wrong_number",
    terminal: true,
    suppression: "wrong_number",
    description: "The traced number does not reach the owner. Hard-suppresses the number.",
  },
  {
    value: "invalid_number",
    label: "Invalid / dead number",
    toStatus: "invalid_contact",
    terminal: true,
    suppression: "invalid_contact",
    description: "Number is invalid (disconnected/bad trace). Hard-suppresses the contact.",
  },
  {
    value: "opted_out",
    label: "Verbal opt-out / DNC request",
    toStatus: "opted_out",
    terminal: true,
    suppression: "opted_out",
    description: "Seller asked NOT to be contacted again. Hard suppression + consent record.",
  },
  {
    value: "dnc",
    label: "DNC registry / do-not-call request",
    toStatus: "dnc",
    terminal: true,
    suppression: "dnc",
    description: "Do-not-call requested or registry flag. Hard-suppresses phone outreach.",
  },
  {
    value: "do_not_mail",
    label: "Do not mail",
    toStatus: "do_not_mail",
    terminal: true,
    suppression: "do_not_mail",
    description: "Seller asked not to receive mail. Hard-suppresses mail outreach.",
  },
  {
    value: "deceased",
    label: "Owner deceased",
    toStatus: "dead_lead",
    terminal: true,
    description: "Owner has passed away. Dead lead — estate path only if opened separately.",
  },
  {
    value: "sold",
    label: "Already sold",
    toStatus: "dead_lead",
    terminal: true,
    description: "The property was already sold. Dead lead (maps the pipeline's closed_lost).",
  },
];

export function getCallOutcomeOption(value: string): CallOutcomeOption | undefined {
  return CALL_OUTCOME_OPTIONS.find((o) => o.value === value);
}

// --- Deterministic path walking ----------------------------------------------
// Uses the B6 map as the single source of truth: BFS over the forward edges
// from `from` to `to`. Returns the hop list (exclusive of `from`). Empty
// array when from === to; null when unreachable.

export function findOutreachPath(from: string, to: string): string[] | null {
  if (from === to) return [];
  const visited = new Set<string>([from]);
  const queue: Array<{ status: string; path: string[] }> = [{ status: from, path: [] }];
  while (queue.length > 0) {
    const { status, path } = queue.shift()!;
    const nexts = OUTREACH_TRANSITIONS[status];
    if (!nexts) continue;
    for (const n of nexts) {
      if (visited.has(n)) continue;
      const newPath = [...path, n];
      if (n === to) return newPath;
      visited.add(n);
      queue.push({ status: n, path: newPath });
    }
  }
  return null;
}

// --- Free-text seller summary heuristics -------------------------------------
// HONEST LABELING: no LLM is connected. These are deterministic keyword
// matches over the owner's free-text summary, used ONLY to prefill the
// structured fields (which the owner can correct before saving). The output
// is labeled "assisted (heuristic)" in the UI, never "AI".

export interface HeuristicExtract {
  askingPrice: number | null;
  desiredClose: string | null;
  occupancy: "owner" | "tenant" | "vacant" | "unknown" | null;
  condition: string | null;
  mortgageBalance: number | null;
  motivation: string | null;
}

const OCCUPANCY_RE: Array<{ re: RegExp; value: "owner" | "tenant" | "vacant" }> = [
  { re: /\b(owner-?occupied|living in it|self-?occupied)\b/i, value: "owner" },
  { re: /\b(tenant|rented|renters|lease)\b/i, value: "tenant" },
  { re: /\b(vacant|empty|abandoned|no one lives)\b/i, value: "vacant" },
];

const CONDITION_RE: Array<{ re: RegExp; value: string }> = [
  { re: /\b(great|good|excellent|move-?in ready)\b/i, value: "good" },
  { re: /\b(fair|average|dated)\b/i, value: "fair" },
  { re: /\b(poor|rough|fixer|needs work|run ?down|dilapidated)\b/i, value: "poor" },
];

/**
 * Deterministic keyword extraction over the owner's post-call notes. Purely
 * assistive: every value it returns is a HINT the owner confirms in the form.
 * Never claims to be AI — no model is connected.
 */
export function extractSellerHints(summary: string): HeuristicExtract {
  const asking = /\b(asking|wants?|looking for|price)\b[^$]*?\$?\s?([\d,]{4,})/i.exec(summary);
  const askingPrice = asking ? Number(asking[2].replace(/,/g, "")) : null;
  const close = /(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/.exec(summary);
  const desiredClose = close ? close[1] : null;
  const occupancy =
    OCCUPANCY_RE.find((o) => o.re.test(summary))?.value ?? null;
  const condition = CONDITION_RE.find((c) => c.re.test(summary))?.value ?? null;
  const mortgage = /\b(owed|owe|mortgage|loan)\b[^$]*?\$?\s?([\d,]{4,})/i.exec(summary);
  const mortgageBalance = mortgage ? Number(mortgage[2].replace(/,/g, "")) : null;
  const motivation =
    /\b(downsizing|moving|divorce|relocat|inherited|probate|bills|medical|behind on|avoid foreclosure|retir)\b/i.exec(summary)?.[0] ?? null;
  return { askingPrice, desiredClose, occupancy, condition, mortgageBalance, motivation };
}

// --- The engine ---------------------------------------------------------------

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
