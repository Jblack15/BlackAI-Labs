// DealFlow AI — Buyer marketplace (PH1-B5)
//
// Turns the buyer network into a real marketplace: richer buy-box criteria,
// verification state, deal-history counters backed by an audit table, and an
// auto-matching engine used by the Buyers page today and the closing workflow
// later.
//
// Honesty contract (owner directive 2026-08-12):
//   * Real data only. Counters start 0, last_verified_at starts NULL and only
//     the UI's "Mark verified" button (or a real operator action) writes it.
//     Nothing here fabricates deal history or buyer criteria.
//   * buy_box is the new richer criteria store; legacy buying_criteria keys
//     (preferredCities/preferredZips/maxPurchasePrice/propertyTypes/...) keep
//     being READ for back-compat (and WRITTEN alongside buy_box so the shared
//     computeMatch in src/lib/buyer-match.ts — used by /buyers and the B9
//     calculator — keeps working unchanged).
//   * verified_phone is set ONLY by migration 016 for the 20 buyers whose
//     phone came from live public listings. The UI renders it as
//     "phone verified (public listing)", never as full verification.
//   * autoMatchBuyers only returns a buyer when every evaluated dimension
//     passes AND location (when the buyer states a location preference) is
//     not missed — a buyer who only buys in San Antonio is never surfaced
//     for a Houston deal. Dimensions without buyer-side data are "neutral",
//     not matches and not misses: absence of a max purchase price does not
//     mean the buyer will pay any price.
//
// Server-only module: import inside createServerFn handlers / API routes /
// scripts. `sql` is imported relative so plain-bun scripts (scripts/verify-*)
// can import this module directly.

import { sql } from "../db";
import { normalizePropertyType } from "./buyer-match";

// --- Types ---

export type BuyerDealEventType = "received" | "viewed" | "rejected" | "purchased";

export const BUYER_DEAL_EVENTS: BuyerDealEventType[] = [
  "received",
  "viewed",
  "rejected",
  "purchased",
];

export type CashOrHardMoney = "cash" | "hard_money" | "both";

export interface BuyBox {
  preferred_markets: string[];
  preferred_zips: string[];
  property_types: string[];
  min_purchase_price: number | null;
  max_purchase_price: number | null;
  max_rehab: number | null;
  preferred_arv: number | null;
  preferred_mao: number | null;
  cash_or_hard_money: CashOrHardMoney | null;
  closing_speed_days: number | null;
  notes: string | null;
}

export interface MarketplaceBuyer {
  id: string;
  name: string;
  email: string;
  phone: string;
  buyBox: BuyBox;
  active: boolean;
  lastVerifiedAt: string | null;
  verifiedPhone: boolean;
  dealsReceived: number;
  dealsViewed: number;
  dealsRejected: number;
  dealsPurchased: number;
  createdAt: string;
}

export interface MarketplaceBuyerRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  buying_criteria: Record<string, unknown> | null;
  buy_box: Record<string, unknown> | null;
  active: boolean;
  last_verified_at: string | null;
  verified_phone: boolean;
  deals_received: number;
  deals_viewed: number;
  deals_rejected: number;
  deals_purchased: number;
  created_at: string;
}

export interface LeadForMatch {
  id: string;
  fullName: string;
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  propertyZip: string;
  propertyType: string;
  pipelineStage: string;
  price: number | null;
  priceSource: string;
  repairs: number | null;
}

export interface BuyerMatchResult {
  buyer: MarketplaceBuyer;
  /** 0-100 — share of evaluated dimensions that matched */
  score: number;
  matched: string[];
  missed: string[];
  neutral: string[];
}

export interface RefreshVerificationResult {
  flagged: MarketplaceBuyer[];
  due: MarketplaceBuyer[];
}

// --- Pure helpers (unit-testable, no DB) ---

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const toStringArray = (v: unknown): string[] => {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => String(x).trim())
    .filter((x) => x.length > 0)
    .filter((x, i, arr) => arr.indexOf(x) === i);
};

/**
 * Merge the richer buy_box with legacy buying_criteria keys. buy_box wins;
 * legacy keys fill gaps so pre-B5 buyers keep matching exactly as before.
 */
export function readBuyBox(
  buyingCriteria: Record<string, unknown> | null | undefined,
  buyBox: Record<string, unknown> | null | undefined,
): BuyBox {
  const c = buyingCriteria || {};
  const b = buyBox || {};
  return {
    preferred_markets: toStringArray(b.preferred_markets ?? c.preferredCities),
    preferred_zips: toStringArray(b.preferred_zips ?? c.preferredZips),
    property_types: toStringArray(b.property_types ?? c.propertyTypes),
    min_purchase_price: toNum(b.min_purchase_price ?? c.minPurchasePrice),
    max_purchase_price: toNum(b.max_purchase_price ?? c.maxPurchasePrice),
    max_rehab: toNum(b.max_rehab),
    preferred_arv: toNum(b.preferred_arv),
    preferred_mao: toNum(b.preferred_mao),
    cash_or_hard_money:
      b.cash_or_hard_money === "cash" ||
      b.cash_or_hard_money === "hard_money" ||
      b.cash_or_hard_money === "both"
        ? (b.cash_or_hard_money as CashOrHardMoney)
        : null,
    closing_speed_days: toNum(b.closing_speed_days),
    notes: typeof b.notes === "string" && b.notes.trim() ? b.notes : null,
  };
}

export function rowToMarketplaceBuyer(row: MarketplaceBuyerRow): MarketplaceBuyer {
  return {
    id: String(row.id),
    name: row.name,
    email: row.email || "",
    phone: row.phone || "",
    buyBox: readBuyBox(row.buying_criteria, row.buy_box),
    active: row.active,
    lastVerifiedAt: row.last_verified_at ? String(row.last_verified_at) : null,
    verifiedPhone: row.verified_phone,
    dealsReceived: Number(row.deals_received) || 0,
    dealsViewed: Number(row.deals_viewed) || 0,
    dealsRejected: Number(row.deals_rejected) || 0,
    dealsPurchased: Number(row.deals_purchased) || 0,
    createdAt: String(row.created_at),
  };
}

/** Build the legacy buying_criteria object from a BuyBox (back-compat write). */
export function buyBoxToLegacyCriteria(box: BuyBox): Record<string, unknown> {
  return {
    preferredCities: box.preferred_markets,
    preferredZips: box.preferred_zips,
    maxPurchasePrice: box.max_purchase_price,
    propertyTypes: box.property_types,
    minBedrooms: 0,
    minBaths: 0,
    desiredROI: 0,
    notes: box.notes ?? "",
  };
}

const CASH_LABEL: Record<string, string> = {
  cash: "prefers cash",
  hard_money: "prefers hard-money buyers",
  both: "cash or hard money",
};

/**
 * Score one buyer against a lead. Returns null when the buyer is a hard
 * no-match (location preference stated but not met, or inactive).
 */
export function scoreBuyerForLead(
  buyer: MarketplaceBuyer,
  lead: LeadForMatch,
): BuyerMatchResult | null {
  const box = buyer.buyBox;
  const matched: string[] = [];
  const missed: string[] = [];
  const neutral: string[] = [];

  // --- Location (hard gate) ---
  const hasLocation =
    box.preferred_markets.length > 0 || box.preferred_zips.length > 0;
  const marketHit = box.preferred_markets.some(
    (m) => m.toLowerCase() === lead.propertyCity.toLowerCase(),
  );
  const zipHit = box.preferred_zips.some((z) => z === lead.propertyZip);
  const locationMatch = marketHit || zipHit;
  if (hasLocation) {
    if (locationMatch) {
      matched.push(
        `Location: ${lead.propertyCity}, ${lead.propertyState} ${lead.propertyZip} is in preferred ${
          marketHit && zipHit
            ? "market and zip"
            : marketHit
              ? "market"
              : "zip codes"
        }`,
      );
    } else {
      // Hard gate: a buyer with stated location preferences that exclude this
      // property is never surfaced as a match (wholesale reality).
      return null;
    }
  } else {
    neutral.push("Location: no market/zip preference stated");
  }

  // --- Price band ---
  const min = box.min_purchase_price;
  const max = box.max_purchase_price;
  if (lead.price === null || lead.price <= 0) {
    neutral.push(`Price: no usable deal price (${lead.priceSource})`);
  } else if (min === null && max === null) {
    neutral.push("Price: no min/max purchase price set on buyer");
  } else {
    const inBand =
      (min === null || lead.price >= min) && (max === null || lead.price <= max);
    const band = `${min === null ? "$0" : `$${min.toLocaleString("en-US")}`} – ${
      max === null ? "unlimited" : `$${max.toLocaleString("en-US")}`
    }`;
    if (inBand) {
      matched.push(`Price: $${lead.price.toLocaleString("en-US")} is within buyer band (${band})`);
    } else {
      missed.push(`Price: $${lead.price.toLocaleString("en-US")} is outside buyer band (${band})`);
    }
  }

  // --- Property type ---
  if (box.property_types.length === 0) {
    neutral.push("Property type: no preference stated");
  } else {
    const dealType = normalizePropertyType(lead.propertyType);
    if (box.property_types.some((pt) => normalizePropertyType(pt) === dealType)) {
      matched.push(`Property type: ${dealType} is in preferred types`);
    } else {
      missed.push(`Property type: ${dealType} not in preferred types`);
    }
  }

  // --- Rehab ---
  if (box.max_rehab === null) {
    neutral.push("Rehab: no max-rehab budget set");
  } else if (lead.repairs === null) {
    neutral.push("Rehab: repairs unknown for this deal");
  } else if (lead.repairs <= box.max_rehab) {
    matched.push(`Rehab: est. repairs $${lead.repairs.toLocaleString("en-US")} ≤ $${box.max_rehab.toLocaleString("en-US")} max`);
  } else {
    missed.push(`Rehab: est. repairs $${lead.repairs.toLocaleString("en-US")} exceed $${box.max_rehab.toLocaleString("en-US")} max`);
  }

  // --- Cash / hard money (informational only — no lead-side financing data) ---
  if (box.cash_or_hard_money) {
    neutral.push(`Funding: buyer ${CASH_LABEL[box.cash_or_hard_money]} (no deal-side financing data to compare)`);
  }
  if (box.closing_speed_days !== null) {
    neutral.push(`Closing: targets ${box.closing_speed_days} days to close`);
  }

  const score = matched.length + missed.length > 0
    ? Math.round((matched.length / (matched.length + missed.length)) * 100)
    : 0;
  return { buyer, score, matched, missed, neutral };
}

// --- DB-backed functions ---

export const MARKETPLACE_SELECT = `
  id, name, email, phone, buying_criteria, buy_box, active, last_verified_at,
  verified_phone, deals_received, deals_viewed, deals_rejected, deals_purchased,
  created_at
` as const;

export async function fetchMarketplaceBuyers(
  opts: { activeOnly?: boolean } = {},
): Promise<MarketplaceBuyer[]> {
  const rows = (await sql`
    SELECT ${sql.unsafe(MARKETPLACE_SELECT)}
    FROM buyers
    ${opts.activeOnly ? sql.unsafe(`WHERE active = true`) : sql.unsafe(``)}
    ORDER BY active DESC, name ASC
  `) as MarketplaceBuyerRow[];
  return rows.map(rowToMarketplaceBuyer);
}

/**
 * Record a buyer↔deal event and bump the matching counter in ONE statement
 * (CTE insert + update = atomic; counters can never drift from the event log).
 * Counter columns are derived from the event type via the boolean→int cast.
 */
export async function recordBuyerDealEvent(
  buyerId: string,
  dealId: string | null,
  event: BuyerDealEventType,
  operator: string,
): Promise<MarketplaceBuyer> {
  const rows = (await sql`
    WITH ev AS (
      INSERT INTO buyer_deal_events (buyer_id, deal_id, event, operator)
      VALUES (${buyerId}, ${dealId}, ${event}, ${operator})
      RETURNING buyer_id, event
    )
    UPDATE buyers b
    SET deals_received  = b.deals_received  + (ev.event = 'received')::int,
        deals_viewed    = b.deals_viewed    + (ev.event = 'viewed')::int,
        deals_rejected  = b.deals_rejected  + (ev.event = 'rejected')::int,
        deals_purchased = b.deals_purchased + (ev.event = 'purchased')::int
    FROM ev
    WHERE b.id = ev.buyer_id
    RETURNING b.id, b.name, b.email, b.phone, b.buying_criteria, b.buy_box,
              b.active, b.last_verified_at, b.verified_phone,
              b.deals_received, b.deals_viewed, b.deals_rejected,
              b.deals_purchased, b.created_at
  `) as MarketplaceBuyerRow[];
  if (!rows[0]) throw new Error(`Buyer not found: ${buyerId}`);
  return rowToMarketplaceBuyer(rows[0]);
}

/** Lead price for matching: latest saved analysis MAO → score_factors.estimated_mao → ev. */
export async function fetchLeadForMatch(leadId: string): Promise<LeadForMatch | null> {
  const leads = (await sql`
    SELECT l.id, l.full_name, l.property_address, l.property_city, l.property_state,
           l.property_zip, l.property_type, l.pipeline_stage, l.score_factors,
           l.estimated_repairs,
           da.max_offer AS analysis_mao,
           da.repairs AS analysis_repairs
    FROM leads l
    LEFT JOIN LATERAL (
      SELECT max_offer, repairs
      FROM deal_analyses
      WHERE lead_id = l.id
      ORDER BY created_at DESC
      LIMIT 1
    ) da ON true
    WHERE l.id = ${leadId}
  `) as Array<{
    id: string;
    full_name: string;
    property_address: string;
    property_city: string;
    property_state: string;
    property_zip: string;
    property_type: string | null;
    pipeline_stage: string | null;
    score_factors: Record<string, unknown> | null;
    estimated_repairs: string | null;
    analysis_mao: string | number | null;
    analysis_repairs: string | number | null;
  }>;
  const r = leads[0];
  if (!r) return null;
  const sf = r.score_factors || {};
  const analysisMao = toNum(r.analysis_mao);
  const sfMao = toNum(sf.estimated_mao);
  const sfEv = toNum(sf.ev);
  let price: number | null = null;
  let priceSource = "no price data";
  if (analysisMao !== null) {
    price = analysisMao;
    priceSource = "saved deal analysis MAO";
  } else if (sfMao !== null) {
    price = sfMao;
    priceSource = "score_factors.estimated_mao";
  } else if (sfEv !== null) {
    price = sfEv;
    priceSource = "score_factors.ev";
  }
  const repairs = toNum(r.analysis_repairs) ?? toNum(r.estimated_repairs);
  return {
    id: String(r.id),
    fullName: r.full_name,
    propertyAddress: r.property_address,
    propertyCity: r.property_city,
    propertyState: r.property_state,
    propertyZip: r.property_zip,
    propertyType: r.property_type || "",
    pipelineStage: r.pipeline_stage || "new_lead",
    price,
    priceSource,
    repairs,
  };
}

/**
 * Rank active buyers against a lead. Hard exclusions: inactive buyers and
 * buyers whose stated location excludes the property. Returns the lead
 * context plus the ranked list (empty = no buyer matches, honest).
 */
export async function autoMatchBuyers(
  leadId: string,
): Promise<{ lead: LeadForMatch | null; matches: BuyerMatchResult[] }> {
  const lead = await fetchLeadForMatch(leadId);
  if (!lead) return { lead: null, matches: [] };
  const buyers = await fetchMarketplaceBuyers({ activeOnly: true });
  const results: BuyerMatchResult[] = [];
  for (const buyer of buyers) {
    const res = scoreBuyerForLead(buyer, lead);
    if (res && res.score > 0) results.push(res);
  }
  results.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.buyer.verifiedPhone) - Number(a.buyer.verifiedPhone) ||
      a.buyer.name.localeCompare(b.buyer.name),
  );
  return { lead, matches: results };
}

/**
 * Verification hygiene (flag, never delete):
 *   flagged — buyers whose last_verified_at is older than 90 days; their
 *             active flag is set to false so they stop receiving matches
 *   due     — buyers who need verification right now (never verified OR
 *             verification older than 90 days), including the ones just
 *             flagged — re-verification is what reactivates them
 */
export async function refreshVerification(): Promise<RefreshVerificationResult> {
  await sql`
    UPDATE buyers
    SET active = false
    WHERE active = true
      AND last_verified_at IS NOT NULL
      AND last_verified_at < now() - interval '90 days'
  `;
  const flaggedRows = (await sql`
    SELECT ${sql.unsafe(MARKETPLACE_SELECT)}
    FROM buyers
    WHERE last_verified_at IS NOT NULL
      AND last_verified_at < now() - interval '90 days'
    ORDER BY name ASC
  `) as MarketplaceBuyerRow[];
  const dueRows = (await sql`
    SELECT ${sql.unsafe(MARKETPLACE_SELECT)}
    FROM buyers
    WHERE last_verified_at IS NULL OR last_verified_at < now() - interval '90 days'
    ORDER BY name ASC
  `) as MarketplaceBuyerRow[];
  return {
    flagged: flaggedRows.map(rowToMarketplaceBuyer),
    due: dueRows.map(rowToMarketplaceBuyer),
  };
}

/** Audit trail behind the counters — read-only helper for the UI. */
export async function fetchBuyerDealEvents(
  buyerId: string,
): Promise<Array<{ id: string; deal_id: string | null; event: string; operator: string; created_at: string }>> {
  const rows = (await sql`
    SELECT id, deal_id, event, operator, created_at
    FROM buyer_deal_events
    WHERE buyer_id = ${buyerId}
    ORDER BY created_at DESC
    LIMIT 50
  `) as Array<{ id: string; deal_id: string | null; event: string; operator: string; created_at: string }>;
  return rows.map((r) => ({ ...r, id: String(r.id), created_at: String(r.created_at) }));
}
