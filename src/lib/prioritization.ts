// DealFlow AI — Lead Prioritization Queues (PH1-B7)
//
// Makes the DATABASE the source of truth for lead scoring + priority:
//   - leads.score          — real PropStream-adapted score (0–10, imported from
//                            lead-scores-ps-taxdelq.csv; NULL = unscored legacy).
//   - leads.score_factors  — jsonb scoring dimensions (imported alongside).
//   - leads.priority_queue — HOT / HIGH / MEDIUM / LOW / DEAD (computed here).
//
// PRIORITY RULES (owner-tunable — edit this module, then re-run
// `bun run scripts/import-scores.ts` or a refresh to recompute the DB column).
// First match wins, evaluated in this order:
//
//   DEAD — suppressed / terminal / no realistic upside:
//     * outreach_status is a terminal/suppression state (dnc, do_not_mail,
//       opted_out, invalid_contact, wrong_number, not_interested, dead_lead)
//     * OR dnc_flag is a suppression value (DNC/DO_NOT_MAIL/OPTED_OUT/INVALID/
//       WRONG_NUMBER)
//     * OR any suppression boolean is true (do_not_mail/opted_out/
//       invalid_contact/wrong_number)
//     * OR score < 4 — documented rule: sub-4 scores carry negative or
//       near-zero equity/distress value; outreach cost exceeds expected
//       return. (Today's pull has 5 such leads, all score 0.)
//
//   HOT — best of the best, work first:
//     * score >= 9 AND contactable AND outreach_status is an ACTIVE state
//       (new, contactable, outreach_queued, contact_attempted, follow_up)
//       AND (foreclosure_factor is Very High / High / Medium High
//            OR equity >= $100K)
//
//   HIGH — strong deals:
//     * score >= 8
//     * OR (contactable AND equity >= $75K)
//
//   MEDIUM — solid volume tier:
//     * score >= 7
//     * OR contactable
//
//   LOW — everything else with any potential (scored but below thresholds,
//         or unscored legacy leads without usable contact info).
//
// Unscored leads (score NULL — the 594 legacy BCAD/Clerk leads) never get a
// fabricated score: they are queued on available factors only (suppression,
// contactability, equity when present).
//
// The DB service functions (refreshPriorities / next25ToWork /
// queueDistribution) import `~/db` dynamically so this module stays
// client-importable for the badge/filter constants.
import { TERMINAL_OUTREACH_STATUSES } from "./outreach-status-map";

export type PriorityQueue = "HOT" | "HIGH" | "MEDIUM" | "LOW" | "DEAD";
export const PRIORITY_QUEUES: readonly PriorityQueue[] = [
  "HOT",
  "HIGH",
  "MEDIUM",
  "LOW",
  "DEAD",
] as const;
/** Sort rank — lower = work first. DEAD is excluded from work queues. */
export const PRIORITY_RANK: Record<PriorityQueue, number> = {
  HOT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  DEAD: 4,
};
/** Active outreach statuses — leads we can still actively work. */
export const ACTIVE_OUTREACH_STATUSES = [
  "new",
  "contactable",
  "outreach_queued",
  "contact_attempted",
  "follow_up",
] as const;
/** dnc_flag suppression values (legacy B1 path) that force DEAD. */
export const SUPPRESSED_DNC_FLAGS = [
  "DNC",
  "DO_NOT_MAIL",
  "OPTED_OUT",
  "INVALID",
  "WRONG_NUMBER",
] as const;
/** Foreclosure factor urgency rank — lower = more urgent. */
export const FORECLOSURE_URGENCY: Record<string, number> = {
  "very high": 0,
  high: 1,
  "medium high": 2,
  "medium low": 3,
  low: 4,
};
/** Display colors (Tailwind badge classes) per queue. */
export const PRIORITY_BADGE_CLASSES: Record<string, string> = {
  HOT: "bg-red-500/20 text-red-300 border-red-500/40",
  HIGH: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  MEDIUM: "bg-gold-500/20 text-gold-300 border-gold-500/40",
  LOW: "bg-slate-500/20 text-slate-300 border-slate-500/30",
  DEAD: "bg-gray-600/20 text-gray-500 border-gray-600/30",
};
export const PRIORITY_LABELS: Record<string, string> = {
  HOT: "HOT",
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
  DEAD: "DEAD",
};

export interface PriorityLeadInput {
  score: number | null;
  contactable: boolean;
  outreach_status: string | null;
  dnc_flag: string | null;
  do_not_mail?: boolean | null;
  opted_out?: boolean | null;
  invalid_contact?: boolean | null;
  wrong_number?: boolean | null;
  score_factors?: {
    foreclosure_factor?: string | null;
    equity?: number | string | null;
  } | null;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Compute the priority queue for one lead from its stored fields/factors.
 * Pure — no DB access. See the rules in the module header.
 */
export function computePriorityQueue(lead: PriorityLeadInput): PriorityQueue {
  const f = lead.score_factors ?? {};
  const ff = String(f.foreclosure_factor ?? "").toLowerCase();
  const equity = toNum(f.equity);
  const outreachStatus = lead.outreach_status || "new";
  const dnc = String(lead.dnc_flag ?? "").toUpperCase();

  // DEAD — suppressed / terminal / below the floor
  const suppressed =
    (TERMINAL_OUTREACH_STATUSES as readonly string[]).includes(outreachStatus) ||
    (SUPPRESSED_DNC_FLAGS as readonly string[]).includes(dnc) ||
    Boolean(lead.do_not_mail) ||
    Boolean(lead.opted_out) ||
    Boolean(lead.invalid_contact) ||
    Boolean(lead.wrong_number);
  if (suppressed) return "DEAD";
  if (lead.score !== null && lead.score < 4) return "DEAD";

  // HOT — best of the best
  const foreclosureUrgent =
    ff === "very high" || ff === "high" || ff === "medium high";
  if (
    lead.score !== null &&
    lead.score >= 9 &&
    lead.contactable &&
    (ACTIVE_OUTREACH_STATUSES as readonly string[]).includes(outreachStatus) &&
    (foreclosureUrgent || (equity !== null && equity >= 100000))
  ) {
    return "HOT";
  }

  // HIGH
  if (lead.score !== null && lead.score >= 8) return "HIGH";
  if (lead.contactable && equity !== null && equity >= 75000) return "HIGH";

  // MEDIUM
  if (lead.score !== null && lead.score >= 7) return "MEDIUM";
  if (lead.contactable) return "MEDIUM";

  // LOW — everything else with any potential
  return "LOW";
}

export interface Next25Lead {
  id: string;
  full_name: string;
  property_address: string;
  property_city: string;
  property_state: string;
  property_zip: string;
  phone: string | null;
  email: string | null;
  score: number | null;
  priority_queue: PriorityQueue;
  contactable: boolean;
  outreach_status: string;
  apn: string | null;
  asking_price: number | null;
  desired_close: string | null;
  next_action: string | null;
  score_factors: {
    estimated_mao?: number | null;
    equity?: number | null;
    foreclosure_factor?: string | null;
  } | null;
}

/**
 * Recompute priority_queue for EVERY lead (idempotent, batched in one UPDATE).
 * Reads all leads, computes each queue with computePriorityQueue, writes back
 * via jsonb_to_recordset. Returns counts per queue.
 */
export async function refreshPriorities(): Promise<{
  updated: number;
  byQueue: Record<string, number>;
}> {
  const { sql } = await import("~/db");
  const rows = (await sql`
    SELECT id, score, contactable, outreach_status, dnc_flag,
           do_not_mail, opted_out, invalid_contact, wrong_number, score_factors
    FROM leads
  `) as Array<{
    id: string;
    score: string | number | null;
    contactable: boolean;
    outreach_status: string | null;
    dnc_flag: string | null;
    do_not_mail: boolean | null;
    opted_out: boolean | null;
    invalid_contact: boolean | null;
    wrong_number: boolean | null;
    score_factors: Record<string, unknown> | null;
  }>;
  const payload = rows.map((r) => ({
    id: r.id,
    q: computePriorityQueue({
      score: toNum(r.score),
      contactable: r.contactable,
      outreach_status: r.outreach_status,
      dnc_flag: r.dnc_flag,
      do_not_mail: r.do_not_mail,
      opted_out: r.opted_out,
      invalid_contact: r.invalid_contact,
      wrong_number: r.wrong_number,
      score_factors: r.score_factors ?? null,
    }),
  }));
  if (payload.length > 0) {
    await sql`
      UPDATE leads AS l
      SET priority_queue = v.q, priority_updated_at = now(), updated_at = now()
      FROM jsonb_to_recordset(${JSON.stringify(payload)}) AS v(id uuid, q text)
      WHERE l.id = v.id
    `;
  }
  const byQueue: Record<string, number> = {};
  for (const p of payload) byQueue[p.q] = (byQueue[p.q] || 0) + 1;
  return { updated: payload.length, byQueue };
}

/**
 * The operator's "next 25 to work": top 25 leads excluding DEAD, ordered by
 * (priority rank, score DESC, contactable DESC, equity DESC, foreclosure
 * urgency DESC). Used by the dashboard panel.
 */
export async function next25ToWork(): Promise<Next25Lead[]> {
  const { sql } = await import("~/db");
  const rows = (await sql`
    SELECT id, full_name, property_address, property_city, property_state,
           property_zip, phone, email, score, priority_queue, contactable, outreach_status,
           apn, asking_price, desired_close, next_action, score_factors
    FROM leads
    WHERE priority_queue IS NOT NULL AND priority_queue <> 'DEAD'
    ORDER BY
      CASE priority_queue WHEN 'HOT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
      score DESC NULLS LAST,
      contactable DESC,
      COALESCE((score_factors->>'equity')::numeric, -1) DESC,
      CASE LOWER(COALESCE(score_factors->>'foreclosure_factor', ''))
        WHEN 'very high' THEN 0 WHEN 'high' THEN 1 WHEN 'medium high' THEN 2
        WHEN 'medium low' THEN 3 WHEN 'low' THEN 4 ELSE 5 END
    LIMIT 25
  `) as Array<{
    id: string;
    full_name: string;
    property_address: string;
    property_city: string;
    property_state: string;
    property_zip: string;
    phone: string | null;
    email: string | null;
    score: string | number | null;
    priority_queue: string | null;
    contactable: boolean;
    outreach_status: string | null;
    apn: string | null;
    asking_price: string | number | null;
    desired_close: Date | string | null;
    next_action: string | null;
    score_factors: Record<string, unknown> | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    full_name: r.full_name,
    property_address: r.property_address,
    property_city: r.property_city,
    property_state: r.property_state,
    property_zip: r.property_zip,
    phone: r.phone || null,
    email: r.email || null,
    score: toNum(r.score),
    priority_queue: (r.priority_queue ?? "LOW") as PriorityQueue,
    contactable: r.contactable,
    outreach_status: r.outreach_status || "new",
    apn: r.apn,
    asking_price: toNum(r.asking_price),
    desired_close: r.desired_close ? String(r.desired_close).slice(0, 10) : null,
    next_action: r.next_action,
    score_factors: {
      estimated_mao: toNum(r.score_factors?.estimated_mao),
      equity: toNum(r.score_factors?.equity),
      foreclosure_factor:
        typeof r.score_factors?.foreclosure_factor === "string"
          ? (r.score_factors.foreclosure_factor as string)
          : null,
    },
  }));
}

/** Per-queue lead counts (NULL/unknown buckets as UNSCORED) for the dashboard. */
export async function queueDistribution(): Promise<{ queue: string; count: number }[]> {
  const { sql } = await import("~/db");
  const rows = (await sql`
    SELECT COALESCE(priority_queue, 'UNSCORED') AS queue, COUNT(*)::int AS count
    FROM leads
    GROUP BY 1
    ORDER BY
      CASE COALESCE(priority_queue, 'UNSCORED')
        WHEN 'HOT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2
        WHEN 'LOW' THEN 3 WHEN 'DEAD' THEN 4 ELSE 5 END
  `) as Array<{ queue: string; count: number }>;
  return rows;
}
