// DealFlow AI — Seller Summary generator (PH1-B8)
//
// Deterministic, data-derived plain-English summary per lead. This is NOT an
// LLM call and it never invents facts: it reads only REAL stored data
// (lead fields + score_factors from the PropStream-adapted scoring import) and
// says "unknown — requires seller contact" for anything not recorded.
//
//   generateSellerSummary(lead)  — pure; returns the summary text.
//   refreshSellerSummaries()     — DB batch refresh for every scored lead
//                                  (score_factors IS NOT NULL — today 6,556),
//                                  writing leads.seller_summary +
//                                  seller_summary_updated_at in ONE update.
//
// The summary never fabricates motivation / asking price / occupancy: those
// are only ever quoted from the real lead columns. PropStream-derived signals
// (owner_occupied, is_entity, years_delq, foreclosure_factor) are labeled as
// data-derived, not seller-verified.
import type { PriorityQueue } from "~/lib/prioritization";

export interface SellerSummaryScoreFactors {
  ev?: number | string | null;
  equity?: number | string | null;
  estimated_arv?: number | string | null;
  estimated_mao?: number | string | null;
  years_delq?: number | string | null;
  foreclosure_factor?: string | null;
  owner_occupied?: string | null;
  is_entity?: string | null;
  distress?: number | string | null;
}

/** Minimal lead shape the summary needs — accepts any row with these fields. */
export interface SellerSummaryLead {
  id: string;
  full_name?: string | null;
  property_address?: string | null;
  property_city?: string | null;
  property_state?: string | null;
  property_zip?: string | null;
  score?: number | string | null;
  priority_queue?: PriorityQueue | string | null;
  trace_status?: string | null;
  contactable?: boolean | null;
  outreach_status?: string | null;
  dnc_flag?: string | null;
  do_not_mail?: boolean | null;
  opted_out?: boolean | null;
  invalid_contact?: boolean | null;
  wrong_number?: boolean | null;
  score_factors?: SellerSummaryScoreFactors | null;
  asking_price?: number | string | null;
  desired_close?: string | Date | null;
  occupancy?: string | null;
  motivation?: string | null;
  mortgage_balance?: number | string | null;
  mortgage_lender?: string | null;
  lien_info?: string | null;
  last_contact_at?: string | Date | null;
  next_action?: string | null;
  next_action_due?: string | Date | null;
  seller_notes?: string | null;
  decision_makers?: string | null;
  deal_potential?: string | null;
}

export const SELLER_SUMMARY_LABEL =
  "Data-derived summary (no AI model connected). Built from recorded fields and PropStream scoring data — verify everything with the seller before acting.";

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function money(n: number | null): string | null {
  if (n === null) return null;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function yesNo(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).toLowerCase();
  if (["yes", "y", "true", "1", "owner", "owner-occupied"].includes(s)) return "yes";
  if (["no", "n", "false", "0", "investor", "absentee", "tenant-occupied"].includes(s)) return "no";
  return String(v);
}

function fmtDate(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

const OCCUPANCY_LABELS: Record<string, string> = {
  owner: "owner-occupied",
  tenant: "tenant-occupied",
  vacant: "vacant",
  unknown: "unknown",
};

function suppressionFlags(lead: SellerSummaryLead): string[] {
  const flags: string[] = [];
  const dnc = String(lead.dnc_flag ?? "").toUpperCase();
  if (["DNC", "DO_NOT_MAIL", "OPTED_OUT", "INVALID", "WRONG_NUMBER"].includes(dnc)) {
    flags.push(`dnc_flag=${dnc}`);
  }
  if (lead.do_not_mail) flags.push("do_not_mail");
  if (lead.opted_out) flags.push("opted_out");
  if (lead.invalid_contact) flags.push("invalid_contact");
  if (lead.wrong_number) flags.push("wrong_number");
  return flags;
}

/**
 * Build the plain-English seller summary for one lead. Pure and deterministic —
 * same lead, same text. Unknown seller-recorded fields are stated as
 * "unknown — requires seller contact" instead of being invented.
 */
export function generateSellerSummary(lead: SellerSummaryLead): string {
  const lines: string[] = [];
  const f = lead.score_factors ?? {};
  const score = toNum(lead.score);
  const ev = toNum(f.ev);
  const equity = toNum(f.equity);
  const arv = toNum(f.estimated_arv);
  const mao = toNum(f.estimated_mao);
  const yearsDelq = toNum(f.years_delq);
  const distress = toNum(f.distress);

  const name = lead.full_name?.trim() || "Unknown owner";
  const addr = [
    lead.property_address?.trim(),
    lead.property_city?.trim(),
    lead.property_state?.trim(),
  ]
    .filter(Boolean)
    .join(", ");
  const zip = lead.property_zip?.trim();
  lines.push(
    `Owner: ${name}${addr ? ` — ${addr}` : ""}${zip ? ` (${zip})` : ""}`,
  );

  // Score + queue
  const scoreTxt = score !== null ? `${score}/10` : "unscored";
  const queue = lead.priority_queue || "not queued";
  lines.push(`Score: ${scoreTxt} · Queue: ${queue}`);

  // Deal math from score_factors (real scoring import data)
  const mathBits: string[] = [];
  if (arv !== null) mathBits.push(`est. value ${money(arv)}`);
  if (mao !== null) mathBits.push(`est. MAO ${money(mao)}`);
  if (equity !== null) mathBits.push(`est. equity ${money(equity)}`);
  if (ev !== null) mathBits.push(`EV ${money(ev)}`);
  if (mathBits.length > 0) {
    lines.push(`Deal math (data-derived): ${mathBits.join(" · ")}.`);
  }

  // Distress signals from the scoring pull
  const distressBits: string[] = [];
  if (yearsDelq !== null) distressBits.push(`tax delinquent ${yearsDelq} year${yearsDelq === 1 ? "" : "s"}`);
  const ff = f.foreclosure_factor?.trim();
  if (ff) distressBits.push(`foreclosure factor ${ff}`);
  if (distress !== null) distressBits.push(`distress score ${distress}`);
  if (distressBits.length > 0) {
    lines.push(`Distress (data-derived): ${distressBits.join(" · ")}.`);
  }

  // Ownership / occupancy signals (PropStream data, NOT seller-verified)
  const occ = yesNo(f.owner_occupied);
  const entity = yesNo(f.is_entity);
  if (occ !== null || entity !== null) {
    const bits: string[] = [];
    if (occ !== null) bits.push(`owner-occupied ${occ}`);
    if (entity !== null) bits.push(`entity ${entity === "yes" ? "yes (business-owned)" : "no (individual owner)"}`);
    lines.push(`PropStream flags (not seller-verified): ${bits.join(" · ")}.`);
  }

  // Contact / compliance
  const trace = (lead.trace_status || "NOT_TRACED").trim();
  const contactable = lead.contactable ? "yes" : "no";
  lines.push(`Contact: ${trace} · contactable ${contactable} · outreach status ${lead.outreach_status || "new"}.`);
  const supp = suppressionFlags(lead);
  lines.push(
    supp.length > 0
      ? `Suppression: ${supp.join(", ")} — do not contact.`
      : "Suppression: none.",
  );

  // Seller-recorded / operator-recorded fields — only what is real
  const lastContact = lead.last_contact_at ? fmtDate(lead.last_contact_at) : null;
  const nextAction =
    lead.next_action?.trim() || (lead.next_action_due ? "next step due" : null);
  const nextDue = lead.next_action_due ? fmtDate(lead.next_action_due) : null;
  lines.push(
    `Last contact: ${lastContact || "never"} · Next action: ${
      nextAction ? `${nextAction}${nextDue ? ` (due ${nextDue})` : ""}` : "none set"
    }.`,
  );

  // The seller-pipeline fields — NEVER invented
  const asking = toNum(lead.asking_price);
  const mortgageBal = toNum(lead.mortgage_balance);
  const closeDate = lead.desired_close ? fmtDate(lead.desired_close) : null;
  const occLabel = lead.occupancy ? (OCCUPANCY_LABELS[lead.occupancy] ?? lead.occupancy) : null;
  const sellerBits: string[] = [];
  sellerBits.push(`asking price ${asking !== null ? money(asking) : "unknown — requires seller contact"}`);
  sellerBits.push(`desired close ${closeDate || "unknown — requires seller contact"}`);
  sellerBits.push(`occupancy ${occLabel || "unknown — requires seller contact"}`);
  sellerBits.push(`motivation ${lead.motivation?.trim() || "unknown — requires seller contact"}`);
  if (mortgageBal !== null) sellerBits.push(`mortgage ${money(mortgageBal)}${lead.mortgage_lender?.trim() ? ` (${lead.mortgage_lender.trim()})` : ""}`);
  if (lead.lien_info?.trim()) sellerBits.push(`liens: ${lead.lien_info.trim()}`);
  if (lead.decision_makers?.trim()) sellerBits.push(`decision-makers: ${lead.decision_makers.trim()}`);
  if (lead.deal_potential?.trim()) sellerBits.push(`deal potential: ${lead.deal_potential.trim()}`);
  lines.push(`Seller pipeline: ${sellerBits.join(" · ")}.`);

  if (lead.seller_notes?.trim()) {
    lines.push(`Notes: ${lead.seller_notes.trim()}`);
  }

  lines.unshift(SELLER_SUMMARY_LABEL);
  return lines.join("\n");
}

/** Lead row shape the batch refresh reads from the DB. */
export interface SellerSummaryDbLead extends SellerSummaryLead {
  full_name: string | null;
  property_address: string | null;
  property_city: string | null;
  property_state: string | null;
  property_zip: string | null;
  contactable: boolean | null;
  score_factors: Record<string, unknown> | null;
}

/**
 * Batch-regenerate leads.seller_summary for every scored lead (score_factors
 * IS NOT NULL — today the 6,556 PropStream-scored leads) plus any lead whose
 * priority queue is HOT/HIGH even if unscored, plus every TRACED lead (so a
 * trace import never leaves a stale "Contact: NOT_TRACED" summary behind —
 * audit §4.1 / D0). Single read, single write.
 * Never fabricates: unscored/unknown dimensions simply read as unknown.
 */
export async function refreshSellerSummaries(): Promise<{ updated: number }> {
  const { sql } = await import("~/db");
  const rows = (await sql`
    SELECT id, full_name, property_address, property_city, property_state,
           property_zip, score, priority_queue, trace_status, contactable,
           outreach_status, dnc_flag, do_not_mail, opted_out, invalid_contact,
           wrong_number, score_factors, asking_price, desired_close, occupancy,
           motivation, mortgage_balance, mortgage_lender, lien_info,
           last_contact_at, next_action, next_action_due, seller_notes,
           decision_makers, deal_potential
    FROM leads
    WHERE score_factors IS NOT NULL OR priority_queue IN ('HOT', 'HIGH')
       OR trace_status = 'TRACED'  `) as Array<Record<string, unknown>>;

  const payload = rows.map((r) => ({
    id: r.id as string,
    summary: generateSellerSummary(r as unknown as SellerSummaryDbLead),
  }));
  if (payload.length > 0) {
    await sql`
      UPDATE leads AS l
      SET seller_summary = v.summary,
          seller_summary_updated_at = now(),
          updated_at = now()
      FROM jsonb_to_recordset(${JSON.stringify(payload)}) AS v(id uuid, summary text)
      WHERE l.id = v.id
    `;
  }
  // Audit the batch refresh (audit §10 gap 3): a written summary refresh is a
  // state change the owner should be able to trace. Dynamic import keeps this
  // lib out of the client bundle; logging never throws (logOutreachAudit
  // swallows its own errors).
  try {
    const { logOutreachAudit } = await import("~/lib/compliance");
    await logOutreachAudit({
      channel: "seller_summary_refresh" as unknown as Parameters<
        typeof logOutreachAudit
      >[0]["channel"],
      direction: "internal" as unknown as Parameters<
        typeof logOutreachAudit
      >[0]["direction"],
      status: "updated" as unknown as Parameters<typeof logOutreachAudit>[0]["status"],
      reason: `Batch seller_summary refresh: ${payload.length} lead(s) regenerated from live score / priority_queue / trace_status / contactable fields.`,
      operator: "refreshSellerSummaries",
    } as unknown as Parameters<typeof logOutreachAudit>[0]);
  } catch {
    // audit must never break the refresh
  }
  return { updated: payload.length };
}
