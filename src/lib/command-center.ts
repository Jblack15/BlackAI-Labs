// DealFlow AI — Command Center + Funnel Metrics (PH1-B10a)
//
// One screen for "what needs attention right now", per owner spec (plan rev 18):
//   * funnel: leads → contactable → contacted → conversations → qualified →
//     offers → contracts → matches → closed → revenue
//   * cost per lead / cost per qualified opp / cost per contract (B10a records
//     the costs; the pause/reduce RECOMMENDATION logic ships in B10b)
//   * campaign cost tracking: kind='planned' (owner-committed, NOT spent) vs
//     kind='actual' (real money that moved) from campaign_cost_entries
//   * GREEN / YELLOW / RED status — COMPUTED from real state, never hardcoded
//
// ── GREEN / YELLOW / RED rule (documented, computed) ─────────────────────────
//   RED    — any CRITICAL attention item (e.g. stalled skip-trace job) OR
//            actual spend > $0 while zero leads have been contacted
//            (spending money into a funnel that has not moved = stop-fix).
//   YELLOW — no critical items, but the pilot is staged-but-unsent (a campaign
//            exists with planned costs and zero actual spend) OR the funnel is
//            moving (contacted > 0) but no contract is signed yet = test mode.
//   GREEN  — only when ≥1 contract is signed AND the funnel conversion rates
//            are within plan targets (offer→contract ≥ 15% and qualified rate
//            ≥ 50% of connected, per the rev-18 funnel math) AND no
//            critical/yellow conditions hold = scale.
//   Fallback (no data at all, e.g. brand-new DB) → YELLOW with a documented
//   "no funnel data yet" reason — we are never "green" on an empty funnel.
//
// ── Funnel stage definitions (explicit status sets, documented) ──────────────
//   The outreach_status vocabulary (migration 012) is a 22-state machine whose
//   forward arc is new → contactable → outreach_queued → contact_attempted →
//   connected → qualified → offer → negotiation → contract_sent →
//   contract_signed → buyer_matched → title → closed → assignment_paid, plus
//   lateral follow_up and the terminal states (dnc, do_not_mail, opted_out,
//   invalid_contact, wrong_number, not_interested, dead_lead).
//
//   Each "+" stage is the set of statuses AT or BEYOND that milestone, and every
//   set is a strict superset of the next (a lead at 'title' counts in every
//   earlier stage). Terminal states are counted in every stage they could only
//   have reached by passing (e.g. 'not_interested' counts as connected+ and
//   attempted+ but not offer+); suppression-first terminals (do_not_mail /
//   opted_out / invalid_contact) count toward attempted+ only — they can be
//   set pre-contact, so they never inflate connected+.
//
//   Every number returned here is a live COUNT(*) over real tables. Conversion
//   rates with a 0 denominator are null and the UI renders "—". There is no
//   mock data, no fabricated figures, no "estimated" funnel.
//
// Server-only module: import inside createServerFn handlers / API routes /
// verify scripts. `sql` is imported relative so plain-bun scripts can import
// this module directly (same pattern as buyer-marketplace.ts).
import { sql } from "../db";
import { refreshVerification } from "./buyer-marketplace";

// ── Funnel ───────────────────────────────────────────────────────────────────
// Explicit "+" milestone sets (documented above; each is a superset of the next)
const ATTEMPTED_PLUS = new Set([
  "contact_attempted", "connected", "qualified", "offer", "negotiation",
  "contract_sent", "contract_signed", "buyer_matched", "title", "closed",
  "assignment_paid", "follow_up",
  "dnc", "do_not_mail", "opted_out", "invalid_contact", "wrong_number",
  "not_interested", "dead_lead",
]);
const CONNECTED_PLUS = new Set([
  "connected", "qualified", "offer", "negotiation", "contract_sent",
  "contract_signed", "buyer_matched", "title", "closed", "assignment_paid",
  "follow_up", "not_interested", "dead_lead",
]);
const QUALIFIED_PLUS = new Set([
  "qualified", "offer", "negotiation", "contract_sent", "contract_signed",
  "buyer_matched", "title", "closed", "assignment_paid", "follow_up",
]);
const OFFER_PLUS = new Set([
  "offer", "negotiation", "contract_sent", "contract_signed", "buyer_matched",
  "title", "closed", "assignment_paid", "follow_up",
]);
const CONTRACT_SIGNED_PLUS = new Set([
  "contract_signed", "buyer_matched", "title", "closed", "assignment_paid",
]);

export type FunnelStageKey =
  | "total_leads"
  | "contactable"
  | "contact_attempted"
  | "connected"
  | "qualified"
  | "offer"
  | "contract_signed"
  | "deals_analyzed"
  | "buyer_matches"
  | "contracts"
  | "closed"
  | "revenue";

/** One funnel row: count + the conversion INTO this stage from the previous
 *  stage (null when the denominator is 0 — UI renders "—"). */
export interface FunnelStage {
  key: FunnelStageKey;
  label: string;
  count: number;
  /** rate is 0..1, null when previous-stage count is 0 */
  conversionFromPrevious: number | null;
  /** human note on what this number means / where it comes from */
  note: string;
}

export interface FunnelMetrics {
  stages: FunnelStage[];
  /** contract_signed+ / offer+ — the headline offer→contract rate */
  contractRate: number | null;
  /** qualified+ / connected+ */
  qualifiedRate: number | null;
  /** true when any DB-backed count failed — UI must render the warning */
  dbOk: boolean;
}

/** Single query set returning real counts per funnel stage. */
export async function funnelMetrics(): Promise<FunnelMetrics> {
  const statusFilter = (set: Set<string>) =>
    set.size === 0
      ? "1 = 0"
      : [...set].map((s) => `'${s.replace(/'/g, "''")}'`).join(", ");
  const attemptedList = statusFilter(ATTEMPTED_PLUS);
  const connectedList = statusFilter(CONNECTED_PLUS);
  const qualifiedList = statusFilter(QUALIFIED_PLUS);
  const offerList = statusFilter(OFFER_PLUS);
  const contractList = statusFilter(CONTRACT_SIGNED_PLUS);

  try {
    const [totalRows, contactableRows, attemptedRows, connectedRows, qualifiedRows, offerRows, contractRows, analyzedRows, buyerMatchRows, contractCountRows, closedRows, revenueRows] =
      await Promise.all([
        sql`SELECT COUNT(*)::int AS n FROM leads`,
        sql`SELECT COUNT(*)::int AS n FROM leads WHERE contactable = true`,
        sql`SELECT COUNT(*)::int AS n FROM leads WHERE outreach_status IN (${sql.unsafe(attemptedList)})`,
        sql`SELECT COUNT(*)::int AS n FROM leads WHERE outreach_status IN (${sql.unsafe(connectedList)})`,
        sql`SELECT COUNT(*)::int AS n FROM leads WHERE outreach_status IN (${sql.unsafe(qualifiedList)})`,
        sql`SELECT COUNT(*)::int AS n FROM leads WHERE outreach_status IN (${sql.unsafe(offerList)})`,
        sql`SELECT COUNT(*)::int AS n FROM leads WHERE outreach_status IN (${sql.unsafe(contractList)})`,
        sql`SELECT COUNT(*)::int AS n FROM deal_analyses`,
        sql`SELECT COUNT(DISTINCT deal_id)::int AS n FROM buyer_deal_events WHERE deal_id IS NOT NULL`,
        sql`SELECT COUNT(*)::int AS n FROM contracts`,
        sql`SELECT COUNT(*)::int AS n FROM contracts WHERE LOWER(COALESCE(status, '')) IN ('closed', 'closed_won', 'assignment_paid')`,
        sql`SELECT COALESCE(SUM(assignment_fee), 0)::numeric AS total FROM contracts`,
      ]);
    const n = (rows: { n: number }[] | { total: string }[], field: "n" | "total" = "n"): number => {
      const v = (rows[0] as Record<string, unknown>)?.[field];
      return typeof v === "number" ? v : Number(v ?? 0) || 0;
    };
    const total = n(totalRows);
    const contactable = n(contactableRows);
    const attempted = n(attemptedRows);
    const connected = n(connectedRows);
    const qualified = n(qualifiedRows);
    const offer = n(offerRows);
    const contractSigned = n(contractRows);
    const analyzed = n(analyzedRows);
    const buyerMatches = n(buyerMatchRows);
    const contracts = n(contractCountRows);
    const closed = n(closedRows);
    const revenue = n(revenueRows, "total");

    const rate = (num: number, den: number): number | null => (den > 0 ? num / den : null);

    const stages: FunnelStage[] = [
      { key: "total_leads", label: "Total leads", count: total, conversionFromPrevious: null, note: "leads table (live)" },
      { key: "contactable", label: "Contactable", count: contactable, conversionFromPrevious: rate(contactable, total), note: "leads with usable contact info & no suppression flag" },
      { key: "contact_attempted", label: "Contact attempted +", count: attempted, conversionFromPrevious: rate(attempted, contactable), note: "outreach_status at/beyond first attempt" },
      { key: "connected", label: "Connected +", count: connected, conversionFromPrevious: rate(connected, attempted), note: "a conversation actually happened" },
      { key: "qualified", label: "Qualified +", count: qualified, conversionFromPrevious: rate(qualified, connected), note: "motivated seller conversation" },
      { key: "offer", label: "Offer +", count: offer, conversionFromPrevious: rate(offer, qualified), note: "offer made / negotiating" },
      { key: "contract_signed", label: "Contract signed +", count: contractSigned, conversionFromPrevious: rate(contractSigned, offer), note: "signed contract in hand" },
      { key: "deals_analyzed", label: "Deals analyzed", count: analyzed, conversionFromPrevious: null, note: "deal_analyses rows (B9)" },
      { key: "buyer_matches", label: "Buyer matches (deals sent)", count: buyerMatches, conversionFromPrevious: null, note: "distinct deals with buyer activity (buyer_deal_events)" },
      { key: "contracts", label: "Contracts (table)", count: contracts, conversionFromPrevious: null, note: "contracts table rows" },
      { key: "closed", label: "Closed", count: closed, conversionFromPrevious: rate(closed, contractSigned), note: "contracts with closed/closed_won/assignment_paid status" },
      { key: "revenue", label: "Revenue (assignment fees)", count: revenue, conversionFromPrevious: rate(revenue, closed), note: "SUM(assignment_fee) from contracts — $0 until closings are recorded (B12 refines)" },
    ];
    return {
      stages,
      contractRate: rate(contractSigned, offer),
      qualifiedRate: rate(qualified, connected),
      dbOk: true,
    };
  } catch (err) {
    return {
      stages: [],
      contractRate: null,
      qualifiedRate: null,
      dbOk: false,
    };
  }
}

// ── Campaign costs ───────────────────────────────────────────────────────────
export interface CampaignCostRow {
  id: string;
  name: string;
  channel: string;
  status: string;
  plannedBudgetCents: number;
  plannedCents: number;
  actualCents: number;
  startedAt: string | null;
  notes: string | null;
}

export interface CampaignCosts {
  campaigns: CampaignCostRow[];
  totals: { plannedCents: number; actualCents: number };
}

/** Per-campaign planned vs actual totals from campaign_cost_entries (real
 *  money records only — planned = owner-committed, actual = money moved). */
export async function campaignCosts(): Promise<CampaignCosts> {
  const rows = (await sql`
    SELECT c.id, c.name, c.channel, c.status, c.planned_budget_cents,
           c.started_at, c.notes,
           COALESCE(SUM(e.amount_cents) FILTER (WHERE e.kind = 'planned'), 0)::int AS planned_cents,
           COALESCE(SUM(e.amount_cents) FILTER (WHERE e.kind = 'actual'), 0)::int AS actual_cents
    FROM campaigns c
    LEFT JOIN campaign_cost_entries e ON e.campaign_id = c.id
    GROUP BY c.id
    ORDER BY c.created_at ASC, c.name ASC
  `) as Array<{
    id: string; name: string; channel: string; status: string;
    planned_budget_cents: number; started_at: string | null; notes: string | null;
    planned_cents: number; actual_cents: number;
  }>;
  const campaigns: CampaignCostRow[] = rows.map((r) => ({
    id: String(r.id),
    name: r.name,
    channel: r.channel,
    status: r.status,
    plannedBudgetCents: Number(r.planned_budget_cents) || 0,
    plannedCents: Number(r.planned_cents) || 0,
    actualCents: Number(r.actual_cents) || 0,
    startedAt: r.started_at ? String(r.started_at) : null,
    notes: r.notes,
  }));
  return {
    campaigns,
    totals: {
      plannedCents: campaigns.reduce((s, c) => s + c.plannedCents, 0),
      actualCents: campaigns.reduce((s, c) => s + c.actualCents, 0),
    },
  };
}

// ── Attention items ──────────────────────────────────────────────────────────
export type AttentionSeverity = "info" | "warn" | "critical";
export interface AttentionItem {
  severity: AttentionSeverity;
  title: string;
  detail: string;
  action?: { label: string; href: string };
}

/**
 * "What needs attention right now" — every item is derived from real table
 * state, never hardcoded:
 *   1. stalled skip-trace jobs (skip_trace_jobs.status = 'STALLED') → critical
 *   2. leads stuck at contact_attempted for > 7 days → warn
 *   3. top-priority leads with no usable contact info (trace not completed)
 *      → warn
 *   4. pilot campaign staged-but-unsent (planned costs, zero actual spend,
 *      status 'planned') → warn (owner action gate)
 *   5. planned campaign with zero committed budget → info
 *   6. buyers due verification (refreshVerification) → info
 *   7. suppression / opt-out spike (> 1% of leads) → warn
 *   8. future send date within 7 days on an active campaign → info
 */
export async function attentionItems(): Promise<AttentionItem[]> {
  const items: AttentionItem[] = [];

  // 1. Stalled skip-trace jobs (B1 registry).
  const stalledJobs = (await sql`
    SELECT id, list_name, status, total_leads, traced_count, error_message
    FROM skip_trace_jobs
    WHERE status = 'STALLED'
    ORDER BY last_progress_at ASC
  `) as Array<{ id: number; list_name: string; status: string; total_leads: number | null; traced_count: number; error_message: string | null }>;
  for (const job of stalledJobs) {
    items.push({
      severity: "critical",
      title: `Skip-trace job stalled: ${job.list_name}`,
      detail: `Stalled at ${job.traced_count}/${job.total_leads ?? "?"} leads — check PropStream Jobs/Activity or trigger a backup trace.${job.error_message ? ` Error: ${job.error_message}` : ""}`,
      action: { label: "Open CRM", href: "/crm" },
    });
  }

  // 2. Leads stuck in contact_attempted > 7 days.
  const stuckRows = (await sql`
    SELECT COUNT(*)::int AS n
    FROM leads
    WHERE outreach_status = 'contact_attempted'
      AND outreach_status_updated_at < now() - interval '7 days'
  `) as { n: number }[];
  const stuck = stuckRows[0]?.n ?? 0;
  if (stuck > 0) {
    items.push({
      severity: "warn",
      title: `${stuck} lead${stuck === 1 ? "" : "s"} stuck in "contact attempted" for 7+ days`,
      detail: "No response since the attempt — schedule a follow-up or close them out so the funnel stays honest.",
      action: { label: "Review in CRM", href: "/crm" },
    });
  }

  // 3. Top-priority leads not yet contactable (trace not completed).
  const highCountRows = (await sql`
    SELECT COUNT(*)::int AS n
    FROM leads
    WHERE priority_queue IN ('HOT', 'HIGH') AND contactable = false
  `) as { n: number }[];
  const highNotContactable = highCountRows[0]?.n ?? 0;
  const top25 = (await sql`
    SELECT property_address
    FROM leads
    WHERE priority_queue IN ('HOT', 'HIGH') AND contactable = false
    ORDER BY score DESC NULLS LAST, created_at ASC
    LIMIT 25
  `) as { property_address: string | null }[];
  if (highNotContactable > 0) {
    const first = top25.map((r) => r.property_address ?? "—").filter(Boolean).slice(0, 3).join(", ");
    items.push({
      severity: "warn",
      title: `${highNotContactable} high-priority leads have no usable contact info`,
      detail: `Skip trace not completed — top-25 include${first ? ` ${first}` : " (no addresses on file)"}. Nothing can be sent until the trace lands or a backup/manual trace is done.`,
      action: { label: "Open CRM", href: "/crm" },
    });
  }

  // 4. Pilot campaigns staged-but-unsent (planned costs, zero actual spend).
  const costs = await campaignCosts();
  const staged = costs.campaigns.filter(
    (c) => c.status === "planned" && c.plannedCents > 0 && c.actualCents === 0,
  );
  for (const c of staged) {
    items.push({
      severity: "warn",
      title: `Pilot staged, nothing sent: ${c.name}`,
      detail: `${fmtDollars(c.plannedCents)} planned (owner-approved), $0 actual — requires owner action before send: sender details, dialer signup, spend approval.`,
      action: { label: "Settings / approval", href: "/settings" },
    });
  }

  // 5. Planned campaigns with zero committed budget (not started).
  const notStarted = costs.campaigns.filter(
    (c) => c.status === "planned" && c.plannedCents === 0 && c.actualCents === 0,
  );
  for (const c of notStarted) {
    items.push({
      severity: "info",
      title: `Campaign not started: ${c.name}`,
      detail: c.notes ?? "No budget committed yet — nothing has been spent or sent.",
      action: { label: "Settings", href: "/settings" },
    });
  }

  // 6. Buyers due verification (B5 hygiene — flags stale, never deletes).
  try {
    const verification = await refreshVerification();
    const due = verification.due.length;
    if (due > 0) {
      items.push({
        severity: "info",
        title: `${due} buyer${due === 1 ? "" : "s"} due verification`,
        detail: `${due} buyer${due === 1 ? "" : "s"} never verified or stale (90-day window) — re-verify before sending deals so every disposition is real.`,
        action: { label: "Buyer marketplace", href: "/buyers" },
      });
    }
  } catch {
    // verification is hygiene — never fail the command center over it
  }

  // 7. Suppression / opt-out spike (> 1% of leads in a suppression state).
  const suppressionRows = (await sql`
    SELECT COUNT(*)::int AS n
    FROM leads
    WHERE outreach_status IN ('dnc', 'do_not_mail', 'opted_out', 'invalid_contact', 'wrong_number', 'not_interested', 'dead_lead')
      OR COALESCE(dnc_flag, '') IN ('DNC', 'DO_NOT_MAIL', 'OPTED_OUT', 'INVALID', 'WRONG_NUMBER')
      OR opted_out = true OR do_not_mail = true OR invalid_contact = true OR wrong_number = true
  `) as { n: number }[];
  const suppressed = suppressionRows[0]?.n ?? 0;
  const totalRows = (await sql`SELECT COUNT(*)::int AS n FROM leads`) as { n: number }[];
  const total = totalRows[0]?.n ?? 0;
  if (suppressed > 0 && total > 0 && suppressed / total > 0.01) {
    items.push({
      severity: "warn",
      title: `Suppression spike: ${suppressed} of ${total} leads suppressed`,
      detail: "More than 1% of the CRM is DNC/opt-out/dead — review list sources before pulling another batch.",
      action: { label: "Compliance settings", href: "/settings" },
    });
  }

  // 8. Upcoming send date within 7 days (active/paused campaigns with started_at).
  const upcomingRows = (await sql`
    SELECT id, name, started_at
    FROM campaigns
    WHERE status IN ('active', 'paused')
      AND started_at IS NOT NULL
      AND started_at > now()
      AND started_at <= now() + interval '7 days'
    ORDER BY started_at ASC
  `) as Array<{ id: string; name: string; started_at: string }>;
  for (const c of upcomingRows) {
    items.push({
      severity: "info",
      title: `Send date approaching: ${c.name}`,
      detail: `Campaign send starts ${String(c.started_at).slice(0, 10)} — confirm recipient list and compliance flags before it fires.`,
      action: { label: "Settings", href: "/settings" },
    });
  }

  return items;
}

// ── GREEN / YELLOW / RED ─────────────────────────────────────────────────────
export type CommandStatusValue = "GREEN" | "YELLOW" | "RED";
export interface CommandStatus {
  status: CommandStatusValue;
  /** Human-readable reasons for the current status — always computed, never
   *  hardcoded, and rendered verbatim on the command center. */
  reasons: string[];
}

/**
 * Compute the command-center status from REAL state (rule documented in the
 * file header):
 *   RED    = any critical item OR actual spend > 0 with zero contacts
 *   YELLOW = pilot staged-but-unsent OR funnel moving with no contract yet
 *   GREEN  = ≥1 contract signed AND funnel rates within plan targets
 */
export function computeCommandStatus(
  items: AttentionItem[],
  funnel: Pick<FunnelMetrics, "stages" | "contractRate" | "qualifiedRate">,
  costs: Pick<CampaignCosts, "campaigns" | "totals">,
): CommandStatus {
  const reasons: string[] = [];
  const stageCount = (key: FunnelStageKey): number =>
    funnel.stages.find((s) => s.key === key)?.count ?? 0;
  const attempted = stageCount("contact_attempted");
  const contractSigned = stageCount("contract_signed");
  const offer = stageCount("offer");
  const connected = stageCount("connected");

  const criticalItems = items.filter((i) => i.severity === "critical");
  const spendWithNoContacts = costs.totals.actualCents > 0 && attempted === 0;
  const pilotStaged = costs.campaigns.some(
    (c) => c.status === "planned" && c.plannedCents > 0 && c.actualCents === 0,
  );
  const funnelMovingNoContracts = attempted > 0 && contractSigned === 0;
  const ratesWithinTarget =
    offer > 0 && funnel.contractRate !== null && funnel.contractRate >= 0.15 &&
    connected > 0 && funnel.qualifiedRate !== null && funnel.qualifiedRate >= 0.5;

  if (criticalItems.length > 0) {
    for (const c of criticalItems) reasons.push(`Critical: ${c.title}`);
  }
  if (spendWithNoContacts) {
    reasons.push(`Actual spend is ${fmtDollars(costs.totals.actualCents)} but 0 leads have been contacted — stop and fix before spending more`);
  }
  if (criticalItems.length > 0 || spendWithNoContacts) {
    return { status: "RED", reasons };
  }

  if (pilotStaged) {
    reasons.push(`Pilot staged but unsent — ${fmtDollars(costs.totals.plannedCents)} planned, $0 actual, waiting on owner action`);
  }
  if (funnelMovingNoContracts) {
    reasons.push(`Funnel is moving (${attempted} contacted) but no contract is signed yet — test and tune, do not scale`);
  }
  if (contractSigned === 0) {
    reasons.push("No contracts signed yet — the acquisition-to-closing workflow has not produced a contract");
  }
  if (pilotStaged || funnelMovingNoContracts || contractSigned === 0) {
    return { status: "YELLOW", reasons };
  }

  if (ratesWithinTarget) {
    reasons.push(`${contractSigned} contract(s) signed and funnel rates within plan targets (offer→contract ≥ 15%, qualified ≥ 50% of connected) — scale the channels that produced them`);
    return { status: "GREEN", reasons };
  }

  reasons.push(`Funnel rates below plan targets (offer→contract ${fmtRate(funnel.contractRate)}, qualified ${fmtRate(funnel.qualifiedRate)}) — fix conversion before scaling`);
  return { status: "YELLOW", reasons };
}

// ── Formatting helpers (shared with the UI) ─────────────────────────────────
export function fmtDollars(cents: number): string {
  const abs = Math.abs(cents);
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(abs / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtRate(rate: number | null): string {
  if (rate === null) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}
