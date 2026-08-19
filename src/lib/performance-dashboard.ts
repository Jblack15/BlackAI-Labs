// DealFlow AI — Consolidated Performance Dashboard (D4, Step 15)
//
// ONE owner-gated screen that separates REAL RESULTS from TARGETS/FORECASTS.
// Every actual here is a live COUNT(*) / SUM over real tables — nothing is
// estimated or fabricated. A stage with no real table event is 0, plainly.
//
// We COMPOSE the existing libs rather than duplicate them:
//   * funnelMetrics()   (command-center) for the base funnel counts (leads,
//                        contactable, qualified+, offer+, contracts,
//                        closed, revenue) and the headline rates
//   * campaignCosts()   (command-center) for actual/planned spend ($0 in
//                        zero-spend mode — rendered honestly)
//   * getOperationsOverview() (owner-action-queue) for pending approvals,
//                        call-now, due follow-ups, attention items, queue
//   * TARGETS            (campaign-economics) for the rev-18 targets
//   * NEW real stages that have their own table events:
//                        traced (leads.trace_status), contact_attempts +
//                        conversations (outreach_audit_log channel='call_outcome'),
//                        interested (leads.deal_potential high/medium),
//                        pending closings (contracts in the closing arc)
//
// Section 3 renders TARGETS in a clearly labeled "Targets (not actual
// results)" block — never blended with actuals.
//
// Server-only module: import inside createServerFn handlers / API routes /
// verify scripts. `sql` imported relative like command-center.ts so plain-bun
// scripts can import this directly.
import { sql } from "../db";
import { funnelMetrics, campaignCosts, attentionItems, fmtDollars, fmtRate, type AttentionItem } from "./command-center";
import { getOperationsOverview } from "./owner-action-queue";
import { pendingApprovals } from "./approvals";
import { TARGETS } from "./campaign-economics";

export type PerfUnit = "count" | "dollars";

export interface PerfStage {
  key: string;
  label: string;
  value: number;
  unit: PerfUnit;
  /** conversion INTO this stage from the previous funnel stage (0..1); null when the denominator is 0 */
  conversion: number | null;
  /** human note on exactly which real table/column this number came from */
  source: string;
}

export interface TargetRow {
  key: string;
  label: string;
  target: string;
  actual: string;
  note: string;
}

export interface ConversionEntry {
  label: string;
  rate: number | null;
  note: string;
}

export interface PerformanceOverview {
  generatedAt: string;
  dbOk: boolean;
  funnel: PerfStage[];
  conversions: ConversionEntry[];
  targets: TargetRow[];
  tasks: {
    pendingApprovals: number;
    callNow: number;
    dueFollowUps: number;
    attention: AttentionItem[];
    attentionCritical: number;
    /** real audit-log completion counts by category over the period (internal automation + auth + approvals) */
    aiTasks: { channel: string; count: number }[];
    aiTasksTotal: number;
    aiTasksPeriodDays: number;
  };
  costs: {
    plannedCents: number;
    actualCents: number;
    revenueCents: number;
  };
}

/** Outcome codes in channel='call_outcome' audit rows that mean a real
 *  conversation happened (spoke with the owner/another party). Derived from
 *  CALL_OUTCOME_OPTIONS in call-outcome-vocab.ts — *not* no_answer /
 *  wrong_number / invalid_number, which are attempts only. */
const CONVERSATION_OUTCOMES = [
  "connected", "qualified", "call_back", "not_interested",
  "opted_out", "dnc", "do_not_mail", "deceased", "sold",
] as const;

const CLOSING_ARC = ["title_open", "title_clear", "docs_sent", "docs_signed", "funded"];

const rate = (num: number, den: number): number | null => (den > 0 ? num / den : null);

/** Pull a stage count out of the command-center funnel by key. */
function fc(stages: { key: string; value?: number }[], key: string): number {
  return stages.find((s) => s.key === key)?.value ?? 0;
}

/**
 * The source-truth performance funnel. Composes command-center counts with the
 * additional table events that have no command-center stage (traced,
 * call-outcome attempts/conversations, interested, pending closings).
 */
export async function performanceFunnel(): Promise<{ stages: PerfStage[]; dbOk: boolean; revenueDollars: number }> {
  const base = await funnelMetrics();
  const baseCount = (key: string): number => {
    const s = base.stages.find((x) => x.key === key);
    return s ? s.count : 0;
  };

  const rows = await Promise.all([
    // traced — contact data landed from the trace
    sql`SELECT COUNT(*)::int AS n FROM leads WHERE trace_status = 'TRACED'`,
    // contact attempts — real call-outcome audit rows (distinct leads)
    sql`SELECT COUNT(DISTINCT lead_id)::int AS n FROM outreach_audit_log WHERE channel = 'call_outcome' AND lead_id IS NOT NULL`,
    // conversations — call-outcome rows whose outcome was a real conversation
    sql`SELECT COUNT(DISTINCT lead_id)::int AS n FROM outreach_audit_log
        WHERE channel = 'call_outcome' AND lead_id IS NOT NULL
          AND (${sql.unsafe(CONVERSATION_OUTCOMES.map((o) => `content_preview LIKE '%outcome:${o}%'`).join(" OR "))})`,
    // interested — owner-recorded deal_potential high/medium after a call
    sql`SELECT COUNT(*)::int AS n FROM leads WHERE deal_potential IN ('high', 'medium')`,
    // pending closings — contracts in the closing arc (not yet closed)
    sql`SELECT COUNT(*)::int AS n FROM contracts WHERE LOWER(COALESCE(status, '')) IN (${sql.unsafe(CLOSING_ARC.map((s) => `'${s}'`).join(","))})`,
  ]);
  const n = (r: { n: number }[]): number => r[0]?.n ?? 0;
  const traced = n(rows[0] as { n: number }[]);
  const contactAttempts = n(rows[1] as { n: number }[]);
  const conversations = n(rows[2] as { n: number }[]);
  const interested = n(rows[3] as { n: number }[]);
  const pendingClosings = n(rows[4] as { n: number }[]);

  const totalLeads = baseCount("total_leads");
  const contactable = baseCount("contactable");
  const qualified = baseCount("qualified");
  const offers = baseCount("offer");
  const contractsCount = baseCount("contracts");
  const buyerMatches = baseCount("buyer_matches");
  const closed = baseCount("closed");
  const revenue = baseCount("revenue"); // SUM(assignment_fee) dollars

  // Ordered funnel exactly as Step 15 specifies; every count is a real event.
  const stages: PerfStage[] = [
    { key: "total_leads", label: "Total leads", value: totalLeads, unit: "count", conversion: null, source: "COUNT(leads)" },
    { key: "traced", label: "Traced (contact data)", value: traced, unit: "count", conversion: rate(traced, totalLeads), source: "leads.trace_status = 'TRACED'" },
    { key: "contactable", label: "Contactable", value: contactable, unit: "count", conversion: rate(contactable, traced), source: "leads.contactable = true" },
    { key: "contact_attempts", label: "Contact attempts", value: contactAttempts, unit: "count", conversion: rate(contactAttempts, contactable), source: "audit channel='call_outcome' (distinct leads)" },
    { key: "conversations", label: "Conversations", value: conversations, unit: "count", conversion: rate(conversations, contactAttempts), source: "call_outcome rows with a conversation outcome" },
    { key: "interested", label: "Interested", value: interested, unit: "count", conversion: rate(interested, conversations), source: "leads.deal_potential IN (high, medium) (owner-recorded)" },
    { key: "qualified", label: "Qualified", value: qualified, unit: "count", conversion: rate(qualified, interested), source: "outreach_status qualified+ (state machine)" },
    { key: "offers", label: "Offers", value: offers, unit: "count", conversion: rate(offers, qualified), source: "outreach_status offer+ (state machine)" },
    { key: "contracts", label: "Contracts", value: contractsCount, unit: "count", conversion: rate(contractsCount, offers), source: "COUNT(contracts) rows" },
    { key: "buyer_matches", label: "Buyer matches", value: buyerMatches, unit: "count", conversion: rate(buyerMatches, contractsCount), source: "distinct deals with buyer activity (buyer_deal_events)" },
    { key: "pending_closings", label: "Pending closings", value: pendingClosings, unit: "count", conversion: rate(pendingClosings, contractsCount), source: "contracts in title_open..funded arc" },
    { key: "closed", label: "Closed deals", value: closed, unit: "count", conversion: rate(closed, pendingClosings), source: "contracts status closed/closed_won/assignment_paid" },
    { key: "assignment_revenue", label: "Assignment revenue", value: revenue, unit: "dollars", conversion: null, source: "SUM(contracts.assignment_fee) — $0 until closings are recorded" },
  ];

  return { stages, dbOk: base.dbOk, revenueDollars: revenue };
}

/** Conversion quick-stats computed strictly from the funnel actuals above. */
export function conversionsFromFunnel(stages: PerfStage[]): ConversionEntry[] {
  const v = (k: string) => stages.find((s) => s.key === k)?.value ?? 0;
  const r = (num: number, den: number) => (den > 0 ? num / den : null);
  return [
    { label: "Contactable of leads", rate: r(v("contactable"), v("total_leads")), note: "contactable / total leads" },
    { label: "Attempted of contactable", rate: r(v("contact_attempts"), v("contactable")), note: "call attempts / contactable" },
    { label: "Conversations of attempts", rate: r(v("conversations"), v("contact_attempts")), note: "conversations / contact attempts" },
    { label: "Qualified of conversations", rate: r(v("qualified"), v("conversations")), note: "qualified / conversations" },
    { label: "Offers of qualified", rate: r(v("offers"), v("qualified")), note: "offers / qualified" },
    { label: "Contracts of offers", rate: r(v("contracts"), v("offers")), note: "contracts / offers (headline)" },
    { label: "Closed of pending", rate: r(v("closed"), v("pending_closings")), note: "closed / pending closings" },
  ];
}

/** Render-ready TARGETS vs ACTUAL block. Section is labeled "Targets (not
 *  actual results)" in the UI — never blended. */
export function buildTargetRows(
  stages: PerfStage[],
  costs: { actualCents: number },
): TargetRow[] {
  const v = (k: string) => stages.find((s) => s.key === k)?.value ?? 0;
  const totalLeads = v("total_leads");
  const actualSpent = costs.actualCents;
  const costPerLead =
    totalLeads > 0 ? (actualSpent / totalLeads) : null; // $0 spend → real $0.00
  const contractsCount = v("contracts");
  const offers = v("offers");
  const conversations = v("conversations");
  const qualified = v("qualified");
  const closed = v("closed");
  const revenue = v("assignment_revenue");
  const dash = "—"; // honest unknown
  const money = (d: number | null) => (d === null ? dash : fmtDollars(Math.round(d * 100)));

  return [
    {
      key: "cost_per_lead",
      label: "Cost per lead",
      target: money(TARGETS.costPerLeadCents / 100),
      actual: money(costPerLead),
      note: "rev-18 guide; actual = actual spend / leads ($0.00 until money moves)",
    },
    {
      key: "cost_per_contract",
      label: "Cost per contract",
      target: money(TARGETS.costPerContractCents / 100),
      actual: contractsCount > 0 ? money(actualSpent / contractsCount) : dash,
      note: "actual = actual spend / contracts — '—' until a contract exists",
    },
    {
      key: "offer_contract_rate",
      label: "Offer → contract rate",
      target: "15%",
      actual: offers > 0 && contractsCount > 0 ? fmtRate(contractsCount / offers) : dash,
      note: "rev-18 target; requires ≥1 offer",
    },
    {
      key: "qualified_rate",
      label: "Qualified rate",
      target: "50%",
      actual: conversations > 0 && qualified > 0 ? fmtRate(qualified / conversations) : dash,
      note: "rev-18 target (qualified of conversations)",
    },
    {
      key: "deals_month",
      label: "Closed deals (this view)",
      target: "10 / month",
      actual: String(closed),
      note: "rev-18 north-star volume; actual = closed deals recorded",
    },
    {
      key: "avg_fee",
      label: "Avg assignment fee",
      target: money(15000),
      actual: contractsCount > 0 ? money(revenue / contractsCount) : dash,
      note: "rev-18 target; '—' while no contracts record a fee",
    },
    {
      key: "trial_spend",
      label: "Trial spend threshold",
      target: money(TARGETS.trialSpendCents / 100),
      actual: fmtDollars(actualSpent),
      note: "rev-18: offers out but $0 signed after this = RED (stop & fix)",
    },
  ];
}

/** Real automation/ops completion counts by category over a rolling window. */
export async function aiTaskCounts(days = 14): Promise<{ channel: string; count: number }[]> {
  const rows = (await sql`
    SELECT channel, COUNT(*)::int AS n
    FROM outreach_audit_log
    WHERE created_at > now() - (${days} || ' days')::interval
    GROUP BY channel
    ORDER BY n DESC
  `) as Array<{ channel: string; n: number }>;
  return rows.map((r) => ({ channel: r.channel, count: r.n }));
}

/** The full consolidated performance overview for the owner screen. */
export async function performanceOverview(): Promise<PerformanceOverview> {
  const generatedAt = new Date().toISOString();
  const { stages, dbOk, revenueDollars } = await performanceFunnel();
  const conversions = conversionsFromFunnel(stages);
  const costsAll = await campaignCosts();
  const costs = {
    plannedCents: costsAll.totals.plannedCents,
    actualCents: costsAll.totals.actualCents,
    revenueCents: Math.round(revenueDollars * 100),
  };
  const targets = buildTargetRows(stages, costs);

  let tasks: PerformanceOverview["tasks"] = {
    pendingApprovals: 0, callNow: 0, dueFollowUps: 0,
    attention: [], attentionCritical: 0, aiTasks: [], aiTasksTotal: 0, aiTasksPeriodDays: 14,
  };
  try {
    const ops = await getOperationsOverview();
    tasks.pendingApprovals = ops.needsApprovalCount;
    tasks.callNow = ops.callNowCount;
    tasks.dueFollowUps = ops.dueFollowUps.length;
    tasks.attention = ops.attention;
    tasks.attentionCritical = ops.attention.filter((a) => a.severity === "critical").length;
  } catch {
    // tasks stay empty/zero — honest
  }
  try {
    const ai = await aiTaskCounts(14);
    tasks.aiTasks = ai;
    tasks.aiTasksTotal = ai.reduce((s, x) => s + x.count, 0);
  } catch {
    tasks.aiTasks = [];
    tasks.aiTasksTotal = 0;
  }

  return { generatedAt, dbOk, funnel: stages, conversions, targets, tasks, costs };
}

export { fmtDollars, fmtRate };
