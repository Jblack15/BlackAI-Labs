// DealFlow AI — Seller Conversation Engine: outcome vocabulary + heuristics (D2)
//
// CLIENT-SAFE pure module (no DB imports — the server engine lives in
// log-call-outcome.ts and re-exports from here). The operations screen imports
// this for the outcome picker and the "assisted prefill" button.
//
// HONESTY: no LLM is connected anywhere in this codebase. extractSellerHints
// is a deterministic keyword matcher over the owner's free-text summary; its
// output is a HINT the owner confirms before saving. It is labeled
// "assisted (heuristic)", never "AI".
import type { OutreachStatus } from "~/lib/outreach-status-map";

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

// --- Free-text seller summary heuristics -------------------------------------
// HONEST LABELING: no LLM is connected. Deterministic keyword matches over the
// owner's free-text summary, used ONLY to prefill the structured fields (the
// owner confirms before saving). Output is labeled "assisted (heuristic)".

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
  const occupancy = OCCUPANCY_RE.find((o) => o.re.test(summary))?.value ?? null;
  const condition = CONDITION_RE.find((c) => c.re.test(summary))?.value ?? null;
  const mortgage = /\b(owed|owe|mortgage|loan)\b[^$]*?\$?\s?([\d,]{4,})/i.exec(summary);
  const mortgageBalance = mortgage ? Number(mortgage[2].replace(/,/g, "")) : null;
  const motivation =
    /\b(downsizing|moving|divorce|relocat|inherited|probate|bills|medical|behind on|avoid foreclosure|retir)\b/i.exec(summary)?.[0] ?? null;
  return { askingPrice, desiredClose, occupancy, condition, mortgageBalance, motivation };
}
