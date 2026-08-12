// DealFlow AI — Outreach Status State Machine: pure transition map (PH1-B6)
//
// Pure module (no DB imports) so the client can import it statically — the CRM
// uses it to render only valid next statuses in the dropdown, exactly like
// `pipeline-transitions.ts` does for the deal pipeline. `src/lib/outreach-status.ts`
// re-exports these and adds the DB-backed transition service.
//
// THE TWO PIPELINES — CONTACT vs DEAL
//   outreach_status is the CONTACT pipeline (this module). It tracks the
//   seller-contact lifecycle: new → contactable → outreach_queued →
//   contact_attempted → connected → qualified → offer → negotiation →
//   contract_sent → contract_signed → buyer_matched → title → closed →
//   assignment_paid, plus the lateral follow_up state and the absorbing
//   terminal states.
//
//   leads.pipeline_stage is the DEAL pipeline (src/lib/pipeline.ts, migration
//   008) and is NOT touched by this module — it keeps tracking the deal
//   (enrichment → qualification → offer → contract → closing → closed_won).
//
//   Mapping (pipeline_stage → outreach_status):
//     new_lead                        → new
//     property_enrichment             → contactable          (usable contact info)
//     ai_qualification / deal_analysis → qualified
//     seller_contacted                → contact_attempted / connected
//     follow_up                       → follow_up
//     offer_recommendation / human_approval / offer_sent → offer
//     negotiation                     → negotiation
//     contract_prepared / contract_sent → contract_sent
//     contract_signed                 → contract_signed
//     buyer_matching / buyer_contacted → buyer_matched
//     assignment / closing            → title → closed
//     closed_won                      → closed → assignment_paid
//     closed_lost                     → dead_lead / not_interested
//
//   The two stay independent by design: a deal can be contract_signed in the
//   pipeline while outreach_status still shows contact_attempted if the contact
//   spine was never bumped — CRM buttons advance each pipeline separately.

export const OUTREACH_STATUSES = [
  "new",
  "contactable",
  "outreach_queued",
  "contact_attempted",
  "connected",
  "qualified",
  "offer",
  "negotiation",
  "contract_sent",
  "contract_signed",
  "buyer_matched",
  "title",
  "closed",
  "assignment_paid",
  "dnc",
  "do_not_mail",
  "opted_out",
  "invalid_contact",
  "wrong_number",
  "not_interested",
  "follow_up",
  "dead_lead",
] as const;
export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];

/** Absorbing terminal states — once entered, no outbound transition is allowed
 *  except an explicit documented override (reason + operator). */
export const TERMINAL_OUTREACH_STATUSES = [
  "dnc",
  "do_not_mail",
  "opted_out",
  "invalid_contact",
  "wrong_number",
  "not_interested",
  "dead_lead",
] as const;
export type TerminalOutreachStatus = (typeof TERMINAL_OUTREACH_STATUSES)[number];

const TERMINALS: readonly string[] = TERMINAL_OUTREACH_STATUSES;

/**
 * Valid transitions map. Forward progress follows the spec order; every active
 * state can go lateral to follow_up and can be marked terminal. Terminal states
 * are absorbing (empty lists) — leaving one requires an explicit override in
 * `transitionOutreachStatus` (lib/outreach-status.ts).
 *
 * Deliberate allowances:
 *   - new → contact_attempted: a send path bumps a brand-new lead to
 *     contact_attempted when a manual send actually goes out.
 *   - follow_up → any active state: a nurtured lead resumes the main chain
 *     from wherever it left off (never regresses to pre-contact states).
 */
export const OUTREACH_TRANSITIONS: Record<string, string[]> = {
  // Pre-contact: gather contact info, queue, attempt
  new: ["contactable", "outreach_queued", "contact_attempted", "follow_up", ...TERMINALS],
  contactable: ["outreach_queued", "contact_attempted", "follow_up", ...TERMINALS],
  outreach_queued: ["contact_attempted", "contactable", "follow_up", ...TERMINALS],
  // Active engagement
  contact_attempted: ["connected", "qualified", "outreach_queued", "follow_up", ...TERMINALS],
  connected: ["qualified", "follow_up", ...TERMINALS],
  qualified: ["offer", "contact_attempted", "follow_up", ...TERMINALS],
  // Deal arc (mirrors the pipeline's offer→closing stages)
  offer: ["negotiation", "follow_up", ...TERMINALS],
  negotiation: ["contract_sent", "follow_up", ...TERMINALS],
  contract_sent: ["contract_signed", "follow_up", ...TERMINALS],
  contract_signed: ["buyer_matched", "title", "closed", "follow_up", ...TERMINALS],
  buyer_matched: ["title", "closed", "follow_up", ...TERMINALS],
  title: ["closed", "assignment_paid", "follow_up", ...TERMINALS],
  closed: ["assignment_paid"],
  assignment_paid: [],
  // Lateral nurture state — resumes the main chain from any active stage
  follow_up: [
    "contact_attempted", "connected", "qualified", "offer", "negotiation",
    "contract_sent", "contract_signed", "buyer_matched", "title", "closed",
    ...TERMINALS,
  ],
  // Terminal states — absorbing (see module header)
  dnc: [],
  do_not_mail: [],
  opted_out: [],
  invalid_contact: [],
  wrong_number: [],
  not_interested: [],
  dead_lead: [],
};

/** True for the absorbing terminal states (dnc, do_not_mail, opted_out,
 *  invalid_contact, wrong_number, not_interested, dead_lead). */
export function isTerminalOutreachStatus(status: string | null | undefined): boolean {
  return TERMINALS.includes(status ?? "");
}

/** Valid next statuses for a lead currently in `status` (empty for terminals). */
export function validNextOutreachStatuses(status: string | null | undefined): string[] {
  const valid = OUTREACH_TRANSITIONS[status ?? ""];
  return valid ? [...valid] : [];
}

/** Human label for a status (used by the CRM badge + selector). */
export function outreachStatusLabel(status: string | null | undefined): string {
  if (!status) return "New";
  return status
    .split("_")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}
