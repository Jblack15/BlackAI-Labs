// DealFlow AI — Premium Queue + Disposition (PH1-B13)
//
// Server-only (import inside createServerFn handlers / API routes / scripts).
//
// The 13 premium SFR leads (research/premium-13-disposition-2026-08-12.md,
// source CSV lead-scores-ps-taxdelq.csv rows 9-21 = ranks 8-20) are the
// highest-value, most-motivated leads in the CRM — but MAO ≈ EV for all of
// them (near-market ceilings, NOT distressed discounts), so they have ZERO fit
// with the 22 flipper buyers in the buyer database. They are parked in a
// premium queue with a per-lead disposition plan instead.
//
// This module owns:
//   * PREMIUM_13_SEED — the REAL researched disposition for each of the 13
//     (APN-keyed; status/strategy/target/notes transcribed from the research
//     file; lien amounts taken ONLY from the raw PropStream export where the
//     column actually has a value — labeled "lien per export").
//   * backfillPremium13() — idempotent: sets premium_lead=true + disposition
//     for exactly the 13 researched APNs; reports any APN not found in the DB
//     (never guess-matches).
//   * getPremiumQueue() — the dashboard/CRM premium queue listing.
//   * saveDisposition() — the disposition editor's save path: validates the
//     vocabulary, updates only the provided fields, stamps
//     disposition_updated_at, and writes ONE outreach_audit_log row
//     (channel='disposition', direction='internal', status='updated').
//
// Rules:
//   * Real data only — every column is backfilled from the research/CSV or
//     saved from the operator's payload. Nothing is fabricated or inferred.
//   * Never link a premium lead to a flipper buyer: the target vocabulary has
//     no buyer id, and the UI shows the honest "requires licensed-agent JV /
//     external disposition — NOT VERIFIED (no buyer in system)" state whenever
//     the target is not an in-system flipper.
import { sql } from "~/db";
import { logOutreachAudit } from "~/lib/compliance";

export const DISPOSITION_STATUS_VALUES = [
  "identified",
  "outreach_ready",
  "in_jv_discussion",
  "under_offer",
  "hold",
  "deprioritized",
] as const;
export type DispositionStatus = (typeof DISPOSITION_STATUS_VALUES)[number];

export const TARGET_BUYER_TYPE_VALUES = [
  "investor",
  "developer",
  "licensed_agent_jv",
  "land_assembler",
  "other",
] as const;
export type TargetBuyerType = (typeof TARGET_BUYER_TYPE_VALUES)[number];

export const DISPOSITION_STATUS_LABELS: Record<string, string> = {
  identified: "Identified",
  outreach_ready: "Outreach ready",
  in_jv_discussion: "In JV discussion",
  under_offer: "Under offer",
  hold: "Hold",
  deprioritized: "Deprioritized",
};

export const TARGET_BUYER_TYPE_LABELS: Record<string, string> = {
  investor: "Flipper investor",
  developer: "Developer",
  licensed_agent_jv: "Licensed agent JV",
  land_assembler: "Land assembler",
  other: "Other / undetermined",
};

/** One researched premium lead's disposition (APN-keyed — the stable key). */
export interface PremiumLeadSeed {
  apn: string;
  owner: string;
  address: string;
  zip: string;
  status: DispositionStatus;
  target: TargetBuyerType;
  strategy: string;
  notes: string;
}

/**
 * The 13 premium leads — disposition transcribed from
 * research/premium-13-disposition-2026-08-12.md (ranks 8-20). Statuses map the
 * research tiers honestly: ACT NOW → outreach_ready, HOLD → hold,
 * DEPRIORITIZE → deprioritized. Lien amounts are REAL values from the raw
 * PropStream export (propstream-taxdelq-raw-2026-08.csv "Lien Amount" column)
 * — the column is sparse (only 2 of the 13 APNs populated), so the two real
 * values are recorded labeled "lien per export" and the sparseness is noted.
 */
export const PREMIUM_13_SEED: PremiumLeadSeed[] = [
  {
    apn: "02882-007-0010",
    owner: "Margaret Dohrer",
    address: "705 E Guenther St",
    zip: "78210",
    status: "hold",
    target: "other",
    strategy:
      "HOLD — highest value ($1.22M); verify comps first, then licensed-agent JV (TREC no-referral-fee) retail listing or in-town developer",
    notes:
      "Research 2026-08-12 rank 8: highest value — verify comps before outreach; near-market ceiling (MAO≈EV), never dispatch to flipper buyers; lien per export: none (column blank for this APN)",
  },
  {
    apn: "05008-016-0410",
    owner: "Johnny And Rosalie Gabriel Revocable Trust",
    address: "104 Lou Jon Cir",
    zip: "78213",
    status: "outreach_ready",
    target: "licensed_agent_jv",
    strategy:
      "ACT NOW (High foreclosure factor) — licensed-agent JV (TREC no-referral-fee): 6,765sf estate retail listing (DOM 90-180d); trustee outreach; verify Bexar tax payoff before outreach",
    notes:
      "Research 2026-08-12 rank 9: 6,765sf estate, H-FF; lien per export: $723 (real value from PropStream raw export 2026-08 — column sparse, only 2/13 premium APNs populated); MAO≈EV, never dispatch to flipper buyers",
  },
  {
    apn: "00938-001-0100",
    owner: "Alice Perez",
    address: "532 E Guenther St",
    zip: "78210",
    status: "hold",
    target: "other",
    strategy:
      "HOLD — highest value ($1.06M); verify comps first, then licensed-agent JV (TREC no-referral-fee) retail listing or in-town developer",
    notes:
      "Research 2026-08-12 rank 10: highest value — verify comps before outreach; near-market ceiling (MAO≈EV), never dispatch to flipper buyers; lien per export: none (column blank for this APN)",
  },
  {
    apn: "04928-201-0470",
    owner: "Tina Grau Living Trust",
    address: "1234 Via Belcanto",
    zip: "78260",
    status: "outreach_ready",
    target: "licensed_agent_jv",
    strategy:
      "ACT NOW (High foreclosure factor) — licensed-agent JV (TREC no-referral-fee): suburban luxury retail listing (Stone Oak, DOM 45-90d); trustee outreach; verify Bexar tax payoff before outreach",
    notes:
      "Research 2026-08-12 rank 11: H-FF; lien per export: none (column blank for this APN); MAO≈EV, never dispatch to flipper buyers",
  },
  {
    apn: "04847-219-0010",
    owner: "Robert Wells",
    address: "26134 Timberline Dr",
    zip: "78260",
    status: "outreach_ready",
    target: "licensed_agent_jv",
    strategy:
      "ACT NOW (Very High foreclosure factor) — licensed-agent JV (TREC no-referral-fee): suburban luxury retail listing (Stone Oak, DOM 45-90d); verify real comps + Bexar tax payoff before outreach",
    notes:
      "Research 2026-08-12 rank 12: VH-FF (highest urgency of the 13); lien per export: none (column blank for this APN); MAO≈EV, never dispatch to flipper buyers",
  },
  {
    apn: "02914-003-0053",
    owner: "Robert Pena",
    address: "522 Adams St",
    zip: "78210",
    status: "hold",
    target: "developer",
    strategy:
      "HOLD — 78210 land-value cluster: market to in-town developers/renovators; per-parcel HDRC/overlay/historic-designation checks before teardown/redev",
    notes:
      "Research 2026-08-12 rank 13: 78210 land-value cluster, developer/renovator disposition; lien per export: none (column blank for this APN)",
  },
  {
    apn: "03007-005-0140",
    owner: "Ruth Medrano",
    address: "321 Florida St",
    zip: "78210",
    status: "hold",
    target: "developer",
    strategy:
      "HOLD — 78210 land-value cluster: market to in-town developers/renovators; per-parcel HDRC/overlay/historic-designation checks before teardown/redev",
    notes:
      "Research 2026-08-12 rank 14: 78210 land-value cluster; lien per export: $1,321.49 (real value from PropStream raw export 2026-08 — column sparse, only 2/13 premium APNs populated)",
  },
  {
    apn: "02984-004-0140",
    owner: "Lucy Camarillo",
    address: "2021 S Presa St",
    zip: "78210",
    status: "hold",
    target: "developer",
    strategy:
      "HOLD — 78210 land-value cluster: market to in-town developers/renovators; per-parcel HDRC/overlay/historic-designation checks before teardown/redev",
    notes:
      "Research 2026-08-12 rank 15: 78210 land-value cluster; lien per export: none (column blank for this APN)",
  },
  {
    apn: "02878-003-0100",
    owner: "Felix Escamilla",
    address: "518 Mission St",
    zip: "78210",
    status: "deprioritized",
    target: "other",
    strategy:
      "DEPRIORITIZE — Mission corridor overlay constraints, no flags; deprioritized until overlay/entitlement research is done",
    notes:
      "Research 2026-08-12 rank 16: Mission corridor overlay constraints, no flags; lien per export: none (column blank for this APN)",
  },
  {
    apn: "06119-000-0200",
    owner: "Conrad Hernandez",
    address: "121 Haynes Ave",
    zip: "78210",
    status: "hold",
    target: "developer",
    strategy:
      "HOLD — 78210 land-value cluster: market to in-town developers/renovators; per-parcel HDRC/overlay/historic-designation checks before teardown/redev",
    notes:
      "Research 2026-08-12 rank 17: 78210 land-value cluster; lien per export: none (column blank for this APN)",
  },
  {
    apn: "00733-005-0090",
    owner: "Vargas Irma Juanita Est Of &",
    address: "805 Labor St",
    zip: "78210",
    status: "deprioritized",
    target: "other",
    strategy:
      "DEPRIORITIZE — probate estate; deprioritized until probate status is resolved",
    notes:
      "Research 2026-08-12 rank 18: probate estate; lien per export: none (column blank for this APN)",
  },
  {
    apn: "03130-011-0420",
    owner: "Guadalupe Gomez",
    address: "215 Alamosa Ave",
    zip: "78210",
    status: "hold",
    target: "developer",
    strategy:
      "HOLD — 78210 land-value cluster: market to in-town developers/renovators; per-parcel HDRC/overlay/historic-designation checks before teardown/redev",
    notes:
      "Research 2026-08-12 rank 19: 78210 land-value cluster; lien per export: none (column blank for this APN)",
  },
  {
    apn: "02956-000-0051",
    owner: "Donna Harvey",
    address: "126 E Carolina St",
    zip: "78210",
    status: "hold",
    target: "developer",
    strategy:
      "HOLD — 78210 land-value cluster: market to in-town developers/renovators; per-parcel HDRC/overlay/historic-designation checks before teardown/redev",
    notes:
      "Research 2026-08-12 rank 20: 78210 land-value cluster; lien per export: none (column blank for this APN)",
  },
];

export const PREMIUM_13_APNS = PREMIUM_13_SEED.map((s) => s.apn);

export interface PremiumBackfillResult {
  /** Rows updated (each matched APN = 1). */
  updated: number;
  /** APNs from the research found in the DB (should be 13). */
  matched: number;
  /** Research APNs NOT found in the DB — reported, never guess-matched. */
  unmatched: string[];
  /** Full names found per APN (for verification output). */
  found: Array<{ apn: string; full_name: string | null }>;
}

/**
 * Idempotent backfill: marks exactly the 13 researched APNs premium_lead=true
 * and writes their researched disposition (status/strategy/target/notes).
 * Unmatched research APNs are reported and left untouched. Premium flags on
 * OTHER leads are never modified here (a future research batch can add its own
 * premium leads deliberately).
 */
export async function backfillPremium13(opts: { operator?: string } = {}): Promise<PremiumBackfillResult> {
  const operator = opts.operator ?? "backfill-premium-13";
  const result: PremiumBackfillResult = { updated: 0, matched: 0, unmatched: [], found: [] };
  for (const seed of PREMIUM_13_SEED) {
    const rows = (await sql`
      SELECT id, full_name FROM leads WHERE apn = ${seed.apn} LIMIT 1
    `) as Array<{ id: string; full_name: string | null }>;
    const lead = rows[0];
    if (!lead) {
      result.unmatched.push(seed.apn);
      continue;
    }
    result.matched += 1;
    result.found.push({ apn: seed.apn, full_name: lead.full_name });
    await sql`
      UPDATE leads
      SET premium_lead = true,
          disposition_status = ${seed.status},
          disposition_strategy = ${seed.strategy},
          target_buyer_type = ${seed.target},
          disposition_notes = ${seed.notes},
          disposition_updated_at = now(),
          updated_at = now()
      WHERE id = ${lead.id}
    `;
    result.updated += 1;
  }
  if (result.updated > 0) {
    await logOutreachAudit({
      leadId: null,
      channel: "disposition",
      direction: "internal",
      status: "backfilled",
      reason: `Premium-13 backfill: ${result.updated} lead(s) marked premium_lead=true with researched disposition${result.unmatched.length ? `; unmatched APNs: ${result.unmatched.join(", ")}` : ""}`,
      contentPreview: `premium backfill: ${result.updated} of ${PREMIUM_13_SEED.length}`,
      operator,
    } as never);
  }
  return result;
}

/** One premium-queue row for the dashboard panel / CRM. */
export interface PremiumQueueRow {
  id: string;
  full_name: string;
  property_address: string;
  property_city: string;
  property_state: string;
  property_zip: string;
  apn: string | null;
  score: number | null;
  priority_queue: string | null;
  estimated_mao: number | null;
  ev: number | null;
  equity: number | null;
  foreclosure_factor: string | null;
  years_delq: number | null;
  premium_lead: boolean;
  disposition_status: string | null;
  disposition_strategy: string | null;
  target_buyer_type: string | null;
  disposition_notes: string | null;
  disposition_updated_at: string | null;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** The premium queue: all leads with premium_lead=true, ordered by score. */
export async function getPremiumQueue(): Promise<PremiumQueueRow[]> {
  const rows = (await sql`
    SELECT id, full_name, property_address, property_city, property_state,
           property_zip, apn, score, priority_queue,
           score_factors->>'estimated_mao' AS estimated_mao,
           score_factors->>'ev' AS ev,
           score_factors->>'equity' AS equity,
           score_factors->>'foreclosure_factor' AS foreclosure_factor,
           score_factors->>'years_delq' AS years_delq,
           premium_lead, disposition_status, disposition_strategy,
           target_buyer_type, disposition_notes, disposition_updated_at
    FROM leads
    WHERE premium_lead = true
    ORDER BY score DESC NULLS LAST, property_zip ASC
  `) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    full_name: String(r.full_name ?? ""),
    property_address: String(r.property_address ?? ""),
    property_city: String(r.property_city ?? ""),
    property_state: String(r.property_state ?? ""),
    property_zip: String(r.property_zip ?? ""),
    apn: r.apn === null || r.apn === undefined ? null : String(r.apn),
    score: r.score === null || r.score === undefined ? null : Number(r.score),
    priority_queue: r.priority_queue === null || r.priority_queue === undefined ? null : String(r.priority_queue),
    estimated_mao: numOrNull(r.estimated_mao),
    ev: numOrNull(r.ev),
    equity: numOrNull(r.equity),
    foreclosure_factor: r.foreclosure_factor === null || r.foreclosure_factor === undefined ? null : String(r.foreclosure_factor),
    years_delq: numOrNull(r.years_delq),
    premium_lead: Boolean(r.premium_lead),
    disposition_status: r.disposition_status === null || r.disposition_status === undefined ? null : String(r.disposition_status),
    disposition_strategy: r.disposition_strategy === null || r.disposition_strategy === undefined ? null : String(r.disposition_strategy),
    target_buyer_type: r.target_buyer_type === null || r.target_buyer_type === undefined ? null : String(r.target_buyer_type),
    disposition_notes: r.disposition_notes === null || r.disposition_notes === undefined ? null : String(r.disposition_notes),
    disposition_updated_at: r.disposition_updated_at === null || r.disposition_updated_at === undefined ? null : String(r.disposition_updated_at),
  }));
}

export interface DispositionInput {
  dispositionStatus?: DispositionStatus | null;
  dispositionStrategy?: string | null;
  targetBuyerType?: TargetBuyerType | null;
  dispositionNotes?: string | null;
}

export interface SaveDispositionResult {
  success: boolean;
  error?: string;
  fieldSummary?: string;
}

function toNullableText(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

const DISPOSITION_FIELD_LABELS: Record<string, string> = {
  disposition_status: "disposition_status",
  disposition_strategy: "disposition_strategy",
  target_buyer_type: "target_buyer_type",
  disposition_notes: "disposition_notes",
};

/**
 * Save disposition fields for one premium lead. Updates ONLY the fields
 * explicitly provided (undefined = untouched, null/"" = cleared), stamps
 * disposition_updated_at, and writes ONE outreach_audit_log row
 * (channel='disposition', direction='internal', status='updated').
 */
export async function saveDisposition(
  leadId: string,
  fields: DispositionInput,
  opts: { operator?: string } = {},
): Promise<SaveDispositionResult> {
  const operator = opts.operator ?? "crm-user";
  try {
    const sets: string[] = [];
    const values: unknown[] = [];
    const changed: string[] = [];
    const put = (col: string, value: unknown, label: string) => {
      sets.push(`${col} = $${sets.length + 1}`);
      values.push(value);
      changed.push(label);
    };

    if ("dispositionStatus" in fields) {
      const v = fields.dispositionStatus ?? null;
      if (v !== null && !(DISPOSITION_STATUS_VALUES as readonly string[]).includes(v)) {
        throw new Error(`Invalid disposition_status: ${v} (expected identified/outreach_ready/in_jv_discussion/under_offer/hold/deprioritized)`);
      }
      put("disposition_status", v, DISPOSITION_FIELD_LABELS.disposition_status);
    }
    if ("dispositionStrategy" in fields) {
      put("disposition_strategy", toNullableText(fields.dispositionStrategy), DISPOSITION_FIELD_LABELS.disposition_strategy);
    }
    if ("targetBuyerType" in fields) {
      const v = fields.targetBuyerType ?? null;
      if (v !== null && !(TARGET_BUYER_TYPE_VALUES as readonly string[]).includes(v)) {
        throw new Error(`Invalid target_buyer_type: ${v} (expected investor/developer/licensed_agent_jv/land_assembler/other)`);
      }
      put("target_buyer_type", v, DISPOSITION_FIELD_LABELS.target_buyer_type);
    }
    if ("dispositionNotes" in fields) {
      put("disposition_notes", toNullableText(fields.dispositionNotes), DISPOSITION_FIELD_LABELS.disposition_notes);
    }

    if (changed.length === 0) {
      return { success: false, error: "No disposition fields to save." };
    }

    const fieldSummary = changed.join(", ");
    sets.push("disposition_updated_at = now()");
    // The WHERE placeholder is values.length + 1, NOT sets.length + 1:
    // sets also contains the literal "disposition_updated_at = now()" above,
    // so sets.length would be one past the bound parameters and Postgres would
    // see an unused parameter ("could not determine data type of parameter $N").
    await sql.query(
      `UPDATE leads SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length + 1} RETURNING id`,
      [...values, leadId],
    );

    await logOutreachAudit({
      leadId,
      channel: "disposition",
      direction: "internal",
      status: "updated",
      reason: `Disposition updated: ${fieldSummary}`,
      contentPreview: `disposition fields: ${fieldSummary}`,
      operator,
    } as never);

    return { success: true, fieldSummary };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to save disposition",
    };
  }
}
