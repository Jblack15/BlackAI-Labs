// DealFlow AI — Seller Pipeline CRM: save service (PH1-B8)
//
// Server-only (import inside createServerFn handlers / API routes / scripts).
// Saves operator/seller-recorded seller-CRM fields for one lead:
//
//   saveSellerCrmFields(leadId, fields, opts)
//     — UPDATEs ONLY the fields explicitly provided (undefined = untouched,
//       null/"" = cleared), regenerates the data-derived seller summary from
//       the resulting state, and writes ONE outreach_audit_log row
//       (channel='seller_crm', direction='internal', status='updated',
//       content_preview = field summary) per save.
//
// Rules:
//   * Real data only — every column starts NULL and is only set from the
//     operator's payload. Nothing is fabricated, seeded or inferred.
//   * last_contact_at is a contact-type field: it is written ONLY when the
//     payload explicitly carries a lastContactAt value (a real recorded
//     contact). We never stamp now() — the actual contact time is unknown.
//   * outreach_status, score, score_factors, priority_queue, trace_status and
//     all suppression flags are NEVER touched here (B2/B6/B7 own those).
import { sql } from "~/db";
import { logOutreachAudit } from "~/lib/compliance";
import { generateSellerSummary } from "~/lib/seller-summary";

export const OCCUPANCY_VALUES = ["owner", "tenant", "vacant", "unknown"] as const;
export type SellerOccupancy = (typeof OCCUPANCY_VALUES)[number];

export interface SellerCrmFieldInput {
  /** Seller's stated asking price (USD). null/'' clears. */
  askingPrice?: number | string | null;
  /** Desired closing date (YYYY-MM-DD). */
  desiredClose?: string | null;
  /** Property condition (free text) — legacy leads.property_condition column. */
  propertyCondition?: string | null;
  /** occupancy vocabulary (owner/tenant/vacant/unknown). */
  occupancy?: SellerOccupancy | null;
  /** Why the seller is selling (notes). */
  motivation?: string | null;
  /** Outstanding mortgage balance (USD), if disclosed. */
  mortgageBalance?: number | string | null;
  /** Lender name, if disclosed. */
  mortgageLender?: string | null;
  /** Other liens / title encumbrances. */
  lienInfo?: string | null;
  /** Last REAL contact with the seller (ISO datetime). Only written when provided. */
  lastContactAt?: string | null;
  /** The operator's planned next step. */
  nextAction?: string | null;
  /** When that next step is due (YYYY-MM-DD). */
  nextActionDue?: string | null;
  /** Free-form operator notes. */
  sellerNotes?: string | null;
  /** Who must approve the sale (names + relationship), captured from the
   *  owner's post-call summary. Free text (decisions often have >1 signer). */
  decisionMakers?: string | null;
  /** Owner's flag for whether the lead is worth chasing (high/medium/low/none). */
  dealPotential?: "high" | "medium" | "low" | "none" | null;
}

export type SaveSellerCrmResult = {
  success: boolean;
  error?: string;
  /** Field summary written to the audit row (also the UI confirmation). */
  fieldSummary?: string;
  /** Regenerated summary text (returned so the UI can show it immediately). */
  sellerSummary?: string;
  sellerSummaryUpdatedAt?: string;
};

function toNullableNum(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid number: ${v}`);
  return n;
}

function toNullableDate(v: string | null | undefined): string | null {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${v}`);
  return d.toISOString();
}

function toNullableDay(v: string | null | undefined): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`Invalid date (expected YYYY-MM-DD): ${v}`);
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${v}`);
  return v;
}

function toNullableText(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

/** Field-key labels for the audit preview (short + honest). */
const FIELD_LABELS: Record<string, string> = {
  asking_price: "asking_price",
  desired_close: "desired_close",
  property_condition: "property_condition",
  occupancy: "occupancy",
  motivation: "motivation",
  mortgage_balance: "mortgage_balance",
  mortgage_lender: "mortgage_lender",
  lien_info: "lien_info",
  last_contact_at: "last_contact_at",
  next_action: "next_action",
  next_action_due: "next_action_due",
  seller_notes: "seller_notes",
  decision_makers: "decision_makers",
  deal_potential: "deal_potential",
};

/**
 * Save seller-CRM fields for one lead. Returns the regenerated summary so the
 * CRM modal can re-render without a full refetch.
 */
export async function saveSellerCrmFields(
  leadId: string,
  fields: SellerCrmFieldInput,
  opts: { operator?: string } = {},
): Promise<SaveSellerCrmResult> {
  const operator = opts.operator ?? "crm-user";
  try {
    const sets: string[] = [];
    const values: unknown[] = [];
    const changed: string[] = [];
    const put = (col: string, value: unknown, label?: string) => {
      sets.push(`${col} = $${sets.length + 1}`);
      values.push(value);
      changed.push(label ?? col);
    };

    // Parse + validate the payload first (throws on invalid input).
    if ("askingPrice" in fields) put("asking_price", toNullableNum(fields.askingPrice), FIELD_LABELS.asking_price);
    if ("desiredClose" in fields) put("desired_close", toNullableDay(fields.desiredClose ?? null), FIELD_LABELS.desired_close);
    if ("propertyCondition" in fields) put("property_condition", toNullableText(fields.propertyCondition), FIELD_LABELS.property_condition);
    if ("occupancy" in fields) {
      const occ = fields.occupancy ?? null;
      if (occ !== null && !(OCCUPANCY_VALUES as readonly string[]).includes(occ)) {
        throw new Error(`Invalid occupancy: ${occ} (expected owner/tenant/vacant/unknown)`);
      }
      put("occupancy", occ, FIELD_LABELS.occupancy);
    }
    if ("motivation" in fields) put("motivation", toNullableText(fields.motivation), FIELD_LABELS.motivation);
    if ("mortgageBalance" in fields) put("mortgage_balance", toNullableNum(fields.mortgageBalance), FIELD_LABELS.mortgage_balance);
    if ("mortgageLender" in fields) put("mortgage_lender", toNullableText(fields.mortgageLender), FIELD_LABELS.mortgage_lender);
    if ("lienInfo" in fields) put("lien_info", toNullableText(fields.lienInfo), FIELD_LABELS.lien_info);
    // Contact-type field: written ONLY when explicitly provided with a real value.
    if ("lastContactAt" in fields) {
      const when = fields.lastContactAt ?? null;
      put("last_contact_at", when === null ? null : toNullableDate(when), FIELD_LABELS.last_contact_at);
    }
    if ("nextAction" in fields) put("next_action", toNullableText(fields.nextAction), FIELD_LABELS.next_action);
    if ("nextActionDue" in fields) put("next_action_due", toNullableDay(fields.nextActionDue ?? null), FIELD_LABELS.next_action_due);
    if ("sellerNotes" in fields) put("seller_notes", toNullableText(fields.sellerNotes), FIELD_LABELS.seller_notes);
    if ("decisionMakers" in fields) put("decision_makers", toNullableText(fields.decisionMakers), FIELD_LABELS.decision_makers);
    if ("dealPotential" in fields) {
      const dp = fields.dealPotential ?? null;
      if (dp !== null && !["high", "medium", "low", "none"].includes(dp)) {
        throw new Error(`Invalid deal_potential: ${dp} (expected high/medium/low/none)`);
      }
      put("deal_potential", dp, FIELD_LABELS.deal_potential);
    }

    if (changed.length === 0) {
      return { success: false, error: "No seller-CRM fields to save." };
    }

    const fieldSummary = changed.join(", ");

    // Apply the update (only the provided columns). The column list is built
    // ONLY from whitelisted column names (never user input); all values and
    // the lead id are passed as bound parameters via sql.unsafe(query, params)
    // — mixing unsafe placeholders with tagged-template interpolation would
    // misnumber parameters, so they are not mixed here.
    const setClause = sets.join(", ");
    await sql.query(
      `UPDATE leads SET ${setClause}, updated_at = now() WHERE id = $${sets.length + 1} RETURNING id`,
      [...values, leadId],
    );

    // Reload the lead's full state and regenerate the honest summary.
    const rows = (await sql`
      SELECT id, full_name, property_address, property_city, property_state,
             property_zip, score, priority_queue, trace_status, contactable,
             outreach_status, dnc_flag, do_not_mail, opted_out, invalid_contact,
             wrong_number, score_factors, asking_price, desired_close, occupancy,
             motivation, mortgage_balance, mortgage_lender, lien_info,
             last_contact_at, next_action, next_action_due, seller_notes
      FROM leads WHERE id = ${leadId}
    `) as Array<Record<string, unknown>>;
    const lead = rows[0];
    if (!lead) throw new Error("Lead not found after update");
    const summary = generateSellerSummary(lead as unknown as Parameters<typeof generateSellerSummary>[0]);

    await sql`
      UPDATE leads
      SET seller_summary = ${summary}, seller_summary_updated_at = now()
      WHERE id = ${leadId}
    `;

    // Audit row — one per save, channel='seller_crm', internal update.
    // The DB schema (migration 011) defines channel/direction/status as
    // free-text; B2's TS types are narrower than the schema (B6's status audit
    // rows already exceed them). The cast is intentional and documented.
    await logOutreachAudit({
      leadId,
      channel: "seller_crm",
      direction: "internal",
      status: "updated",
      reason: `Seller CRM fields updated: ${fieldSummary}`,
      contentPreview: `fields: ${fieldSummary}`,
      operator,
    } as unknown as Parameters<typeof logOutreachAudit>[0]);

    return {
      success: true,
      fieldSummary,
      sellerSummary: summary,
      sellerSummaryUpdatedAt: new Date().toISOString(),
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to save seller fields",
    };
  }
}
