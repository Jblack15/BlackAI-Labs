// DealFlow AI — Campaign economics + automatic spending control (PH1-B10b)
//
// Per-campaign economics computed from REAL money records (campaign_cost_entries
// kind='actual' = money that actually moved; kind='planned' = owner-committed,
// NOT spent) and REAL funnel counts (command-center funnelMetrics). No fake
// spend, no fake revenue, no invented attribution.
//
// ── TARGETS (owner's plan rev 18 — single place to tune) ─────────────────────
//   $15,000 / contract   — rev-18 average assignment-fee target; cost per
//                          contract ABOVE this is RED (unprofitable spend)
//   $2.00 / lead         — rev-18 lead-cost guide; at/under this with no
//                          contracts yet = YELLOW (keep testing)
//   $2,000 trial spend   — rev-18 pilot threshold; if offers are out
//                          (contracts expected) and nothing has signed after
//                          spending more than this → RED (stop & fix)
//
// ── Health rules (computed, never hardcoded; order matters) ──────────────────
//   NO_SPEND — actual spend = 0 → "no spend recorded — economics unavailable"
//              (honest, never GREEN on an empty spend record).
//   RED (Recommend PAUSE) — actual spend > 0 AND any of:
//       1. cost per contract > $15,000 target (contract signed+ > 0)
//       2. actual spend > spend_cap_cents (when a cap is set)
//       3. offers out (offer+ > 0) but 0 contracts signed after actual spend
//          exceeds the $2,000 trial threshold
//   GREEN (Scale) — actual spend > 0, no RED condition, net profit > 0
//              (net profit = revenue − actual spend; NULL → never GREEN).
//   YELLOW (Monitor) — actual spend > 0, no RED, no GREEN, and either no
//       contracts yet with cost per lead ≤ $2 guide (or lead_count unknown/0),
//       OR the documented fallback: no contracts yet and cost per lead above
//       the $2 guide — review list/offer before scaling.
//
// ── NULL-safe math (honest "—", never 0-fake) ────────────────────────────────
//   cost_per_lead          = actual / lead_count — NULL when lead_count is
//                            NULL or 0; 0 (real zero dollars) only when
//                            lead_count > 0 and nothing has been spent.
//   cost_per_qualified_opp = actual / qualified+ — NULL when qualified+ = 0.
//   cost_per_contract      = actual / contract_signed+ — NULL when none.
//   revenue                = SUM(assignment_fee) of contracts attributed to the
//                            campaign — requires contracts.campaign_id (lands
//                            in B12). Until then revenue = 0 with a note
//                            ("contract fee tracking lands in B12"), never
//                            presented as tracked revenue.
//   net_profit             = revenue − actual — NULL whenever revenue is not
//                            attributable (revenueNote set): a loss we cannot
//                            actually compute must never render as one.
//
// Server-only module: import inside createServerFn handlers / API routes /
// verify scripts. `sql` is imported relative so plain-bun scripts can import
// this module directly (same pattern as command-center.ts).
import { sql } from "../db";
import { fmtDollars } from "./command-center";

/** Owner's plan targets (plan rev 18, 2026-08-12) — single place to tune. */
export const TARGETS = {
  /** rev-18: $15K average assignment-fee target — cost per contract above this is RED */
  costPerContractCents: 1_500_000,
  /** rev-18: $2/lead guide — at/under with no contracts yet = YELLOW keep-testing */
  costPerLeadCents: 200,
  /** rev-18: $2,000 trial threshold — offers out but zero contracts after this = RED */
  trialSpendCents: 200_000,
} as const;

export type HealthStatus = "GREEN" | "YELLOW" | "RED" | "NO_SPEND";

export interface CampaignHealth {
  status: HealthStatus;
  /** verbatim pause/monitor/scale recommendation — null when nothing to say */
  recommendation: string | null;
  /** human reasons backing the status, rendered on the command center */
  reasons: string[];
}

/** Funnel counts the economics need (from command-center funnelMetrics stages). */
export interface FunnelCounts {
  qualifiedPlus: number;
  offerPlus: number;
  contractSignedPlus: number;
}

/** Per-campaign economics, every number computed from real data (NULL-safe). */
export interface CampaignEconomics {
  id: string;
  name: string;
  channel: string;
  status: string;
  /** attributed leads — NULL = unknown (never 0-fake) */
  leadCount: number | null;
  plannedBudgetCents: number;
  /** owner-approved spend ceiling — NULL = no cap set */
  spendCapCents: number | null;
  plannedCents: number;
  actualCents: number;
  costPerLeadCents: number | null;
  costPerQualifiedOppCents: number | null;
  costPerContractCents: number | null;
  /** attributed contract revenue — null when not trackable (see revenueNote) */
  revenueCents: number | null;
  revenueNote: string | null;
  netProfitCents: number | null;
  health: CampaignHealth;
}

export interface CampaignEconomicsSummary {
  campaigns: CampaignEconomics[];
  totals: {
    plannedCents: number;
    actualCents: number;
    revenueCents: number | null;
    netProfitCents: number | null;
  };
  /** false = contracts have no campaign_id yet (B12) — revenue shown with note */
  revenueTrackable: boolean;
}

/** Pick the economics funnel counts out of a command-center FunnelMetrics. */
export function toFunnelCounts(funnel: {
  stages: Array<{ key: string; count: number }>;
}): FunnelCounts {
  const n = (key: string) => funnel.stages.find((s) => s.key === key)?.count ?? 0;
  return {
    qualifiedPlus: n("qualified"),
    offerPlus: n("offer"),
    contractSignedPlus: n("contract_signed"),
  };
}

export interface CampaignBase {
  id: string;
  name: string;
  channel: string;
  status: string;
  leadCount: number | null;
  plannedBudgetCents: number;
  spendCapCents: number | null;
  plannedCents: number;
  actualCents: number;
  revenueCents: number | null;
  revenueNote: string | null;
}

/** Pure per-campaign economics + health from a campaign row + funnel counts. */
export function evaluateCampaign(base: CampaignBase, funnel: FunnelCounts): CampaignEconomics {
  const { leadCount, actualCents } = base;
  const costPerLeadCents = leadCount !== null && leadCount > 0 ? Math.round(actualCents / leadCount) : null;
  const costPerQualifiedOppCents = funnel.qualifiedPlus > 0 ? Math.round(actualCents / funnel.qualifiedPlus) : null;
  const costPerContractCents = funnel.contractSignedPlus > 0 ? Math.round(actualCents / funnel.contractSignedPlus) : null;
  // Net profit is only real when revenue is attributable — otherwise unknown ("—").
  const netProfitCents =
    base.revenueCents !== null && base.revenueNote === null ? base.revenueCents - actualCents : null;
  const health = campaignHealth(
    { actualCents, spendCapCents: base.spendCapCents, leadCount, costPerLeadCents, costPerContractCents, netProfitCents },
    funnel,
  );
  return {
    ...base,
    costPerLeadCents,
    costPerQualifiedOppCents,
    costPerContractCents,
    netProfitCents,
    health,
  };
}

export interface HealthInputs {
  actualCents: number;
  spendCapCents: number | null;
  leadCount: number | null;
  costPerLeadCents: number | null;
  costPerContractCents: number | null;
  netProfitCents: number | null;
}

/**
 * Health + pause/monitor/scale decision (rules documented in the file header,
 * computed from real numbers — never hardcoded).
 */
export function campaignHealth(input: HealthInputs, funnel: FunnelCounts): CampaignHealth {
  const { actualCents, spendCapCents, leadCount, costPerLeadCents, costPerContractCents, netProfitCents } = input;
  const reasons: string[] = [];

  if (actualCents <= 0) {
    return {
      status: "NO_SPEND",
      recommendation: null,
      reasons: ["No spend recorded — economics unavailable until real money moves (kind='actual' entries)."],
    };
  }

  // ── RED — recommend PAUSE ─────────────────────────────────────────────────
  const costPerContractBreached =
    costPerContractCents !== null && costPerContractCents > TARGETS.costPerContractCents;
  const overCap = spendCapCents !== null && actualCents > spendCapCents;
  const contractsExpected = funnel.offerPlus > 0;
  const trialBreach = contractsExpected && funnel.contractSignedPlus === 0 && actualCents > TARGETS.trialSpendCents;

  if (costPerContractBreached) {
    reasons.push(`cost per contract ${fmtDollars(costPerContractCents!)} exceeded the $15,000 target`);
  }
  if (overCap) {
    reasons.push(`actual spend ${fmtDollars(actualCents)} exceeded the spend cap ${fmtDollars(spendCapCents!)}`);
  }
  if (trialBreach) {
    reasons.push(
      `${fmtDollars(actualCents)} spent with ${funnel.offerPlus} offer${funnel.offerPlus === 1 ? "" : "s"} out but zero contracts signed`,
    );
  }
  if (costPerContractBreached || overCap || trialBreach) {
    return { status: "RED", recommendation: `Recommend PAUSE: ${reasons.join("; ")}`, reasons };
  }

  // ── GREEN — net profit positive ───────────────────────────────────────────
  if (netProfitCents !== null && netProfitCents > 0) {
    reasons.push(`net profit ${fmtDollars(netProfitCents)} on ${fmtDollars(actualCents)} actual spend`);
    return { status: "GREEN", recommendation: "Scale: profitable spend", reasons };
  }

  // ── YELLOW — testing / monitor ────────────────────────────────────────────
  if (
    funnel.contractSignedPlus === 0 &&
    (leadCount === null || leadCount === 0 || (costPerLeadCents !== null && costPerLeadCents <= TARGETS.costPerLeadCents))
  ) {
    reasons.push("no contracts yet and cost per lead within the $2.00 guide — keep testing, do not scale");
    return { status: "YELLOW", recommendation: "Monitor: testing phase", reasons };
  }
  // Documented fallback: spending, no contracts, cost per lead above the guide.
  reasons.push("no contracts yet and cost per lead above the $2.00 guide — review list and offer before scaling");
  return { status: "YELLOW", recommendation: "Monitor: cost per lead above guide — review", reasons };
}

/**
 * Live per-campaign economics over real tables. Revenue attribution requires
 * contracts.campaign_id (B12); until it exists every campaign reports revenue
 * $0.00 with a note and net profit "—" (unknown) — never a fabricated loss.
 */
export async function campaignEconomics(funnel: FunnelCounts): Promise<CampaignEconomicsSummary> {
  const rows = (await sql`
    SELECT c.id, c.name, c.channel, c.status, c.lead_count, c.planned_budget_cents,
           c.spend_cap_cents, c.started_at, c.notes,
           COALESCE(SUM(e.amount_cents) FILTER (WHERE e.kind = 'planned'), 0)::int AS planned_cents,
           COALESCE(SUM(e.amount_cents) FILTER (WHERE e.kind = 'actual'), 0)::int AS actual_cents
    FROM campaigns c
    LEFT JOIN campaign_cost_entries e ON e.campaign_id = c.id
    GROUP BY c.id
    ORDER BY c.created_at ASC, c.name ASC
  `) as Array<{
    id: string; name: string; channel: string; status: string;
    lead_count: number | null; planned_budget_cents: number; spend_cap_cents: number | null;
    planned_cents: number; actual_cents: number;
  }>;

  // Revenue attribution: only when contracts.campaign_id exists (B12 adds it).
  const attribution = (await sql`
    SELECT COUNT(*)::int AS n FROM information_schema.columns
    WHERE table_name = 'contracts' AND column_name = 'campaign_id'
  `) as { n: number }[];
  const revenueTrackable = (attribution[0]?.n ?? 0) > 0;
  let revenueByCampaign = new Map<string, number>();
  if (revenueTrackable) {
    const revRows = (await sql`
      SELECT ct.campaign_id, COALESCE(SUM(ct.assignment_fee), 0)::numeric AS rev
      FROM contracts ct
      WHERE ct.campaign_id IS NOT NULL
      GROUP BY ct.campaign_id
    `) as Array<{ campaign_id: string; rev: string }>;
    revenueByCampaign = new Map(revRows.map((r) => [String(r.campaign_id), Math.round(Number(r.rev) * 100)]));
  }

  const campaigns = rows.map((r) => {
    const revenueCents = revenueTrackable ? revenueByCampaign.get(String(r.id)) ?? 0 : 0;
    const revenueNote = revenueTrackable
      ? null
      : "Contract fee tracking lands in B12 — contracts have no campaign_id yet, so no per-campaign revenue attribution.";
    return evaluateCampaign(
      {
        id: String(r.id),
        name: r.name,
        channel: r.channel,
        status: r.status,
        leadCount: r.lead_count === null ? null : Number(r.lead_count),
        plannedBudgetCents: Number(r.planned_budget_cents) || 0,
        spendCapCents: r.spend_cap_cents === null ? null : Number(r.spend_cap_cents),
        plannedCents: Number(r.planned_cents) || 0,
        actualCents: Number(r.actual_cents) || 0,
        revenueCents,
        revenueNote,
      },
      funnel,
    );
  });

  const revenueSum = campaigns.every((c) => c.revenueCents !== null)
    ? campaigns.reduce((s, c) => s + (c.revenueCents ?? 0), 0)
    : null;
  const profitRows = campaigns.filter((c) => c.netProfitCents !== null);
  const netProfitSum = campaigns.length > 0 && profitRows.length === campaigns.length
    ? profitRows.reduce((s, c) => s + (c.netProfitCents ?? 0), 0)
    : null;

  return {
    campaigns,
    totals: {
      plannedCents: campaigns.reduce((s, c) => s + c.plannedCents, 0),
      actualCents: campaigns.reduce((s, c) => s + c.actualCents, 0),
      revenueCents: revenueSum,
      netProfitCents: netProfitSum,
    },
    revenueTrackable,
  };
}
