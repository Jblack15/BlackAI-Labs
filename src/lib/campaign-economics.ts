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

// ═══════════════════════════════════════════════════════════════════════════
// HUMAN APPROVAL GATES (PH1-B11) — campaign spend + status changes
// Enforcement points for the owner-approval spec (plan rev 18): spending above
// a campaign's spend cap and major campaign changes (status switches,
// budget/cap edits) require an approved approval_request of the matching kind
// for that campaign before the write happens. These are the enforcement points
// B10b's PAUSE recommendations drive: a RED campaign suggests pausing, but the
// actual status change goes through updateCampaignStatus() which refuses to
// apply it until the owner approves the 'campaign_change' request.
//   recordCampaignSpend(campaignId, amountCents, operator, {note})
//     - writes a REAL kind='actual' cost entry.
//     - allowed WITHOUT approval when the campaign has a spend cap and the new
//       total actual stays at or under it (cap = the owner's pre-approved
//       budget; spending inside it needs no per-spend sign-off).
//     - BLOCKED (error contains "requires approved approval_request") when the
//       spend would push total actual above the cap (or there is no cap — an
//       uncapped campaign has no pre-approved ceiling, so real money above $0
//       needs the owner's 'spend' approval).
//   updateCampaignStatus(campaignId, to, operator, {note, budgetCents,
//   spendCapCents})
//     - status changes (planned/active/paused/cancelled/completed) AND
//       budget/cap edits require an approved 'campaign_change' request for the
//       campaign. BLOCKED otherwise.
// Both write nothing on block — a rejected spend never creates a cost entry.
// ═══════════════════════════════════════════════════════════════════════════

export type CampaignSpendResult = { success: true; id: string } | { success: false; error: string };
export type CampaignChangeResult = { success: true } | { success: false; error: string };

/** Total kind='actual' spend recorded for a campaign (real money moved). */
async function campaignActualCents(campaignId: string): Promise<number> {
  const rows = (await sql`
    SELECT COALESCE(SUM(amount_cents), 0)::int AS n
    FROM campaign_cost_entries
    WHERE campaign_id = ${campaignId} AND kind = 'actual'
  `) as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

/**
 * Record a REAL actual cost entry for a campaign. Spend at or under the
 * campaign's spend cap needs no approval (the cap is the owner's pre-approved
 * budget); anything that would push total actual ABOVE the cap — or any spend
 * on a campaign with no cap set — requires an approved 'spend'
 * approval_request for that campaign first. Never writes on block.
 */
export async function recordCampaignSpend(
  campaignId: string,
  amountCents: number,
  operator: string,
  opts: { note?: string } = {},
): Promise<CampaignSpendResult> {
  try {
    if (!Number.isFinite(amountCents) || amountCents < 0) {
      return { success: false, error: "amountCents must be a non-negative number" };
    }
    const rows = (await sql`
      SELECT id, spend_cap_cents FROM campaigns WHERE id = ${campaignId}
    `) as Array<{ id: string; spend_cap_cents: number | null }>;
    if (!rows.length) return { success: false, error: "Campaign not found" };
    const spendCapCents = rows[0].spend_cap_cents === null ? null : Number(rows[0].spend_cap_cents);
    const projected = (await campaignActualCents(campaignId)) + amountCents;
    const withinCap = spendCapCents !== null && projected <= spendCapCents;
    if (!withinCap) {
      const { hasApproval } = await import("./approvals");
      const approved = await hasApproval("spend", "campaign", campaignId, ["approved"]);
      if (!approved) {
        return {
          success: false,
          error:
            `Blocked: requires approved approval_request (kind=spend, ref=campaign) — spend of $${(amountCents / 100).toFixed(2)} ` +
            `would put total actual at $${(projected / 100).toFixed(2)}${spendCapCents !== null ? ` over the cap $${(spendCapCents / 100).toFixed(2)}` : " on an uncapped campaign"}. Request owner approval before spending.`,
        };
      }
    }
    const inserted = (await sql`
      INSERT INTO campaign_cost_entries (campaign_id, amount_cents, kind, operator, note)
      VALUES (${campaignId}, ${amountCents}, 'actual', ${operator}, ${opts.note ?? null})
      RETURNING id
    `) as Array<{ id: string }>;
    return { success: true, id: String(inserted[0].id) };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : "recordCampaignSpend failed" };
  }
}

const CAMPAIGN_STATUSES = ["planned", "active", "paused", "completed", "cancelled"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/**
 * Apply a campaign status change and/or budget/cap edit. REQUIRES an approved
 * 'campaign_change' approval_request for the campaign — status switches
 * (active/paused/cancelled) and budget/cap edits are the major campaign
 * parameter changes the owner must approve (plan rev 18). This is the gate
 * B10b's pause recommendations drive: the recommendation never flips status
 * itself; it routes through here and the owner signs off in /approvals.
 */
export async function updateCampaignStatus(
  campaignId: string,
  to: string,
  operator: string,
  opts: { note?: string; budgetCents?: number | null; spendCapCents?: number | null } = {},
): Promise<CampaignChangeResult> {
  try {
    if (!CAMPAIGN_STATUSES.includes(to as CampaignStatus)) {
      return { success: false, error: `Invalid campaign status: ${to}` };
    }
    const rows = (await sql`SELECT id FROM campaigns WHERE id = ${campaignId}`) as Array<{ id: string }>;
    if (!rows.length) return { success: false, error: "Campaign not found" };
    const { hasApproval } = await import("./approvals");
    const approved = await hasApproval("campaign_change", "campaign", campaignId, ["approved"]);
    if (!approved) {
      return {
        success: false,
        error:
          `Blocked: requires approved approval_request (kind=campaign_change, ref=campaign) — ` +
          `status change to '${to}'${opts.budgetCents !== undefined ? " and/or budget/cap edit" : ""} needs owner approval before it is applied.`,
      };
    }
    // Budget/cap edits accompany the status change when passed. Explicit
    // NULL clears the cap (NULL = no cap); planned_budget_cents is NOT NULL
    // so an explicit null budget means 0. Each branch passes only concrete
    // values — neon treats interpolated undefined as an error, so the columns
    // are simply omitted from the SET list when untouched.
    if (opts.budgetCents !== undefined && opts.spendCapCents !== undefined) {
      await sql`
        UPDATE campaigns
        SET status = ${to}, planned_budget_cents = ${opts.budgetCents ?? 0},
            spend_cap_cents = ${opts.spendCapCents}, updated_at = now()
        WHERE id = ${campaignId}
      `;
    } else if (opts.budgetCents !== undefined) {
      await sql`
        UPDATE campaigns
        SET status = ${to}, planned_budget_cents = ${opts.budgetCents ?? 0}, updated_at = now()
        WHERE id = ${campaignId}
      `;
    } else if (opts.spendCapCents !== undefined) {
      await sql`
        UPDATE campaigns
        SET status = ${to}, spend_cap_cents = ${opts.spendCapCents}, updated_at = now()
        WHERE id = ${campaignId}
      `;
    } else {
      await sql`
        UPDATE campaigns
        SET status = ${to}, updated_at = now()
        WHERE id = ${campaignId}
      `;
    }
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : "updateCampaignStatus failed" };
  }
}
