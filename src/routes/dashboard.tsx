import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";

// ── Types ─────────────────────────────────────────────────────────────────

interface StageInfo {
  name: string;
  display_order: number;
  color: string | null;
}

interface DashboardData {
  /** False when the database was unreachable — every number is then 0/empty
   *  and must NOT be read as business results. The UI shows a warning banner. */
  dbOk: boolean;
  totalLeads: number;
  /** Count of leads per canonical pipeline stage (leads.pipeline_stage). */
  stageCounts: Record<string, number>;
  /** Canonical 19 stages from pipeline_stages (labels/colors only — never counts). */
  stages: StageInfo[];
  /** Real lead_source distribution from the leads table. */
  bySource: { source: string; count: number }[];
  /** Real financial summary from the contracts table (0 rows → $0). */
  contracts: { total: number; assignmentFees: number };
}

interface AutomationMetrics {
  leadsEnriched: number;
  smsSentToday: number;
  emailsSentToday: number;
  pendingOutreach: number;
  responsesReceived: number;
}

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  is_read: boolean;
  created_at: string;
}

// ── Fallback stage list (labels/colors only) ───────────────────────────────
// Mirrors the seed in migration 008 / src/db/seed.ts. Used ONLY to render stage
// names/colors when the pipeline_stages table is unreachable. Counts always come
// from the database — never from this list.
const MOCK_STAGES: StageInfo[] = [
  { name: "new_lead", display_order: 1, color: "slate" },
  { name: "property_enrichment", display_order: 2, color: "blue" },
  { name: "ai_qualification", display_order: 3, color: "cyan" },
  { name: "seller_contacted", display_order: 4, color: "purple" },
  { name: "follow_up", display_order: 5, color: "violet" },
  { name: "deal_analysis", display_order: 6, color: "teal" },
  { name: "offer_recommendation", display_order: 7, color: "indigo" },
  { name: "human_approval", display_order: 8, color: "amber" },
  { name: "offer_sent", display_order: 9, color: "orange" },
  { name: "negotiation", display_order: 10, color: "pink" },
  { name: "contract_prepared", display_order: 11, color: "sky" },
  { name: "contract_sent", display_order: 12, color: "fuchsia" },
  { name: "contract_signed", display_order: 13, color: "emerald" },
  { name: "buyer_matching", display_order: 14, color: "lime" },
  { name: "buyer_contacted", display_order: 15, color: "green" },
  { name: "assignment", display_order: 16, color: "gold" },
  { name: "closing", display_order: 17, color: "yellow" },
  { name: "closed_won", display_order: 18, color: "gold" },
  { name: "closed_lost", display_order: 19, color: "red" },
];

// Stage groups used for the KPI cards + funnel. All are sums of real per-stage
// counts returned by getPipelineStats() — no invented numbers.
const CONTACTED_STAGES = [
  "seller_contacted", "follow_up", "deal_analysis", "offer_recommendation",
  "human_approval", "offer_sent", "negotiation", "contract_prepared",
  "contract_sent", "contract_signed", "buyer_matching", "buyer_contacted",
  "assignment", "closing",
];
const OFFER_STAGES = [
  "offer_sent", "negotiation", "contract_prepared", "contract_sent",
];
const CONTRACT_STAGES = [
  "contract_signed", "buyer_matching", "buyer_contacted", "assignment", "closing",
];

// ── Server Functions ──────────────────────────────────────────────────────
// Every number below is a live database query. On failure we return dbOk:false
// with zeros — never sample/fabricated figures (the UI surfaces the warning).
const fetchDashboardData = createServerFn({ method: "GET" }).handler(async (): Promise<DashboardData> => {
  try {
    const { sql } = await import("~/db");
    const { getPipelineStats } = await import("~/lib/pipeline");

    const [totalRows, stats, sourceRows, stageRows, contractRows] = await Promise.all([
      sql`SELECT COUNT(*)::int AS count FROM leads` as { count: number }[],
      getPipelineStats(),
      sql`
        SELECT COALESCE(NULLIF(lead_source, ''), 'No Source') AS source, COUNT(*)::int AS count
        FROM leads
        GROUP BY 1
        ORDER BY count DESC
      ` as { source: string; count: number }[],
      sql`
        SELECT name, display_order, color FROM pipeline_stages
        WHERE is_active = true ORDER BY display_order ASC
      ` as StageInfo[],
      sql`
        SELECT COUNT(*)::int AS total, COALESCE(SUM(assignment_fee), 0)::numeric AS fees
        FROM contracts
      ` as { total: number; fees: string }[],
    ]);

    const totalLeads = totalRows[0]?.count ?? 0;

    const stageCounts: Record<string, number> = {};
    for (const s of stats) stageCounts[s.stage] = s.count;

    const bySource = sourceRows.map((r) => ({ source: r.source, count: r.count }));

    // Canonical stages from the DB; fall back to MOCK_STAGES for rendering only.
    const stages = stageRows.length > 0 ? stageRows : MOCK_STAGES;

    const contracts = {
      total: contractRows[0]?.total ?? 0,
      assignmentFees: Number(contractRows[0]?.fees ?? 0),
    };

    return { dbOk: true, totalLeads, stageCounts, stages, bySource, contracts };
  } catch {
    return { dbOk: false, totalLeads: 0, stageCounts: {}, stages: MOCK_STAGES, bySource: [], contracts: { total: 0, assignmentFees: 0 } };
  }
});

const fetchAutomationMetrics = createServerFn({ method: "GET" }).handler(async (): Promise<AutomationMetrics> => {
  const zeroes: AutomationMetrics = { leadsEnriched: 0, smsSentToday: 0, emailsSentToday: 0, pendingOutreach: 0, responsesReceived: 0 };
  try {
    const { sql } = await import("~/db");
    const [enriched, smsToday, emailsToday, pending, responded] = await Promise.all([
      sql`SELECT COUNT(*)::int AS count FROM leads WHERE enriched_at IS NOT NULL`,
      sql`SELECT COUNT(*)::int AS count FROM sms_logs WHERE status = 'sent' AND created_at >= date_trunc('day', now())`,
      sql`SELECT COUNT(*)::int AS count FROM email_logs WHERE status = 'sent' AND created_at >= date_trunc('day', now())`,
      sql`SELECT COUNT(*)::int AS count FROM outreach_sequences WHERE status IN ('scheduled', 'pending')`,
      sql`SELECT COUNT(*)::int AS count FROM leads WHERE response_at IS NOT NULL`,
    ]);
    const n = (rows: { count: number }[]) => rows[0]?.count ?? 0;
    return { leadsEnriched: n(enriched), smsSentToday: n(smsToday), emailsSentToday: n(emailsToday), pendingOutreach: n(pending), responsesReceived: n(responded) };
  } catch {
    return zeroes;
  }
});

const fetchNotifications = createServerFn({ method: "GET" }).handler(async (): Promise<NotificationItem[]> => {
  try {
    const { sql } = await import("~/db");
    const rows = await sql`
      SELECT id, type, title, message AS body, read AS is_read, created_at
      FROM notifications
      ORDER BY created_at DESC
      LIMIT 20
    ` as NotificationItem[];
    return rows.map((r) => ({ ...r, is_read: Boolean(r.is_read), created_at: String(r.created_at) }));
  } catch {
    return [];
  }
});

// ── Color Helpers ──────────────────────────────────────────────────────────

const KPI_COLORS: Record<string, { bg: string; border: string; text: string; glow: string }> = {
  blue: {
    bg: "from-blue-500/10 to-blue-600/5",
    border: "border-blue-500/20",
    text: "text-blue-400",
    glow: "shadow-blue-500/10",
  },
  amber: {
    bg: "from-amber-500/10 to-amber-600/5",
    border: "border-amber-500/20",
    text: "text-amber-400",
    glow: "shadow-amber-500/10",
  },
  green: {
    bg: "from-emerald-500/10 to-emerald-600/5",
    border: "border-emerald-500/20",
    text: "text-emerald-400",
    glow: "shadow-emerald-500/10",
  },
  gold: {
    bg: "from-gold-500/10 to-gold-600/5",
    border: "border-gold-500/20",
    text: "text-gold-400",
    glow: "shadow-gold-500/10",
  },
  teal: {
    bg: "from-teal-500/10 to-teal-600/5",
    border: "border-teal-500/20",
    text: "text-teal-400",
    glow: "shadow-teal-500/10",
  },
};

// Color token -> Tailwind badge classes (same mapping as the CRM; tokens come
// from the pipeline_stages.color column).
const STAGE_COLOR_CLASSES: Record<string, string> = {
  slate: "bg-slate-500/20 text-slate-300 border-slate-500/30",
  blue: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  cyan: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  purple: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  violet: "bg-violet-500/20 text-violet-300 border-violet-500/30",
  teal: "bg-teal-500/20 text-teal-300 border-teal-500/30",
  indigo: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
  amber: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  orange: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  pink: "bg-pink-500/20 text-pink-300 border-pink-500/30",
  sky: "bg-sky-500/20 text-sky-300 border-sky-500/30",
  fuchsia: "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30",
  emerald: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  lime: "bg-lime-500/20 text-lime-300 border-lime-500/30",
  green: "bg-green-500/20 text-green-300 border-green-500/30",
  gold: "bg-gold-500/20 text-gold-300 border-gold-500/30",
  yellow: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  red: "bg-red-500/20 text-red-300 border-red-500/30",
};

function stageLabel(name: string | null | undefined): string {
  if (!name) return "New Lead";
  return name
    .split("_")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function stageBadge(color: string | null | undefined): string {
  return (color && STAGE_COLOR_CLASSES[color]) || STAGE_COLOR_CLASSES.slate;
}

const ACTIVITY_ICONS: Record<string, string> = {
  contract: "📝",
  lead: "🆕",
  offer: "💰",
  appointment: "📅",
  closed: "🏆",
};

const ACTIVITY_BORDERS: Record<string, string> = {
  contract: "border-l-green-500",
  lead: "border-l-blue-500",
  offer: "border-l-amber-500",
  appointment: "border-l-purple-500",
  closed: "border-l-gold-500",
};

// ── Chart sub-components ───────────────────────────────────────────────────

function EmptyState({ icon = "📭", message }: { icon?: string; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-navy-700 bg-navy-900/30 px-6 py-12 text-center">
      <div className="mb-3 text-3xl">{icon}</div>
      <p className="max-w-md text-sm text-gray-400">{message}</p>
    </div>
  );
}

function LeadSourceBars({ sources }: { sources: { source: string; count: number; pct: number }[] }) {
  const maxCount = Math.max(1, ...sources.map((s) => s.count));
  return (
    <div className="space-y-3">
      {sources.map((src) => (
        <div key={src.source} className="flex items-center gap-3">
          <span className="w-44 shrink-0 truncate text-sm text-gray-300" title={src.source}>
            {src.source}
          </span>
          <div className="flex flex-1 items-center gap-2">
            <div className="h-5 flex-1 overflow-hidden rounded bg-navy-700">
              <div
                className="h-full rounded bg-gradient-to-r from-gold-500 to-gold-400 transition-all"
                style={{ width: `${(src.count / maxCount) * 100}%` }}
              />
            </div>
            <span className="w-10 text-right text-sm font-semibold text-gray-300">
              {src.count}
            </span>
            <span className="w-10 text-right text-xs text-gray-500">{src.pct}%</span>
          </div>
        </div>
      ))}
    </div>
  );
}

interface FunnelStage {
  stage: string;
  count: number;
  rate: string | null;
  width: number;
}

function PipelineFunnel({ stages }: { stages: FunnelStage[] }) {
  return (
    <div className="space-y-3">
      {stages.map((stage, i) => {
        const isLast = i === stages.length - 1;
        return (
          <div key={stage.stage} className="flex flex-col items-center">
            <div
              className="flex items-center justify-between rounded bg-navy-700 px-4 py-3"
              style={{
                width: `${stage.width}%`,
                minWidth: "140px",
                margin: "0 auto",
                background:
                  i === 0
                    ? "linear-gradient(90deg, rgba(59,130,246,0.2), rgba(59,130,246,0.05))"
                    : isLast
                      ? "linear-gradient(90deg, rgba(245,158,11,0.25), rgba(245,158,11,0.08))"
                      : undefined,
              }}
            >
              <span className="text-sm font-medium text-gray-200">{stage.stage}</span>
              <span className="text-lg font-bold text-white">{stage.count.toLocaleString()}</span>
            </div>
            {!isLast && (
              <div className="my-1 flex items-center gap-1">
                <svg className="h-3 w-3 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
                <span className="text-xs text-gray-500">
                  {stage.rate ? `${stage.rate} conversion` : "no leads yet to convert"}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ActivityFeed({ notifications }: { notifications: NotificationItem[] }) {
  if (notifications.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-gray-500">
        No activity recorded yet. New lead submissions, stage changes and automation events will appear here.
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {notifications.map((item, i) => {
        const timeAgo = formatTimeAgo(item.created_at);
        return (
          <div
            key={item.id}
            className={`border-l-2 bg-navy-800/50 px-4 py-3 transition-colors hover:bg-navy-800 ${
              ACTIVITY_BORDERS[item.type] || "border-l-blue-500"
            } ${i < notifications.length - 1 ? "border-b border-navy-700/50" : ""}`}
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 text-sm">{ACTIVITY_ICONS[item.type] || "📌"}</span>
              <div className="flex-1">
                <p className="text-sm text-gray-300">{item.title}</p>
                {item.body && <p className="text-xs text-gray-500 mt-0.5">{item.body}</p>}
                <span className="text-xs text-gray-600">{timeAgo}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

// ── Main Dashboard Page ────────────────────────────────────────────────────

function DashboardPage() {
  const [data, setData] = useState<DashboardData>({
    dbOk: true,
    totalLeads: 0,
    stageCounts: {},
    stages: MOCK_STAGES,
    bySource: [],
    contracts: { total: 0, assignmentFees: 0 },
  });
  const [automation, setAutomation] = useState<AutomationMetrics>({
    leadsEnriched: 0,
    smsSentToday: 0,
    emailsSentToday: 0,
    pendingOutreach: 0,
    responsesReceived: 0,
  });
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  useEffect(() => {
    fetchDashboardData()
      .then((d) => {
        if (d) setData(d);
      })
      .catch(() => {});
    fetchAutomationMetrics()
      .then((d) => {
        if (d) setAutomation(d);
      })
      .catch(() => {});
    fetchNotifications()
      .then((d) => {
        if (d) setNotifications(d);
      })
      .catch(() => {});
  }, []);

  // ---- Derive every KPI from real counts ----
  const countOf = (names: string[]) =>
    names.reduce((sum, n) => sum + (data.stageCounts[n] || 0), 0);

  const contacted = countOf(CONTACTED_STAGES);
  const offersOut = countOf(OFFER_STAGES);
  const underContract = countOf(CONTRACT_STAGES);
  const closedWon = data.stageCounts["closed_won"] || 0;
  const totalLeads = data.totalLeads;

  const fmtUsd = (n: number) => `$${n.toLocaleString("en-US")}`;

  const kpis = [
    {
      key: "leads",
      label: "Total Leads",
      value: totalLeads.toLocaleString("en-US"),
      note: "Live count from the leads table",
      color: "blue",
    },
    {
      key: "contacted",
      label: "Leads Contacted",
      value: contacted.toLocaleString("en-US"),
      note: contacted === 0 ? "No outreach sent yet — start from the CRM" : "Sellers reached so far",
      color: "amber",
    },
    {
      key: "offers",
      label: "Offers Sent",
      value: offersOut.toLocaleString("en-US"),
      note: offersOut === 0 ? "No offers presented yet" : "Offers currently in play",
      color: "green",
    },
    {
      key: "contracts",
      label: "Under Contract",
      value: underContract.toLocaleString("en-US"),
      note: underContract === 0 ? "No signed contracts yet" : "Signed contracts in the pipeline",
      color: "gold",
    },
    {
      key: "deals",
      label: "Deals Closed",
      value: closedWon.toLocaleString("en-US"),
      note: closedWon === 0 ? "Pre-revenue — no closings yet" : "Closed and profitable deals",
      color: "teal",
    },
    {
      key: "fees",
      label: "Total Assignment Fees",
      value: fmtUsd(data.contracts.assignmentFees),
      note:
        data.contracts.total === 0
          ? "No contracts on record — fees appear as deals close"
          : `Across ${data.contracts.total} contract${data.contracts.total === 1 ? "" : "s"}`,
      color: "green",
    },
  ];

  // Lead sources from real lead_source values
  const leadSources = data.bySource.map((s) => ({
    source: s.source,
    count: s.count,
    pct: totalLeads > 0 ? Math.round((s.count / totalLeads) * 100) : 0,
  }));

  // Pipeline funnel from real stage counts (conversion = count / previous count)
  const funnelStages: FunnelStage[] = [
    { stage: "New Leads", count: totalLeads, rate: null, width: 100 },
    {
      stage: "Contacted",
      count: contacted,
      rate: totalLeads > 0 ? `${((contacted / totalLeads) * 100).toFixed(1)}%` : null,
      width: totalLeads > 0 ? Math.max(20, (contacted / totalLeads) * 100) : 20,
    },
    {
      stage: "Offers Sent",
      count: offersOut,
      rate: contacted > 0 ? `${((offersOut / contacted) * 100).toFixed(1)}%` : null,
      width: contacted > 0 ? Math.max(15, (offersOut / contacted) * 100) : 15,
    },
    {
      stage: "Under Contract",
      count: underContract,
      rate: offersOut > 0 ? `${((underContract / offersOut) * 100).toFixed(1)}%` : null,
      width: offersOut > 0 ? Math.max(10, (underContract / offersOut) * 100) : 10,
    },
    {
      stage: "Closed Won",
      count: closedWon,
      rate: underContract > 0 ? `${((closedWon / underContract) * 100).toFixed(1)}%` : null,
      width: underContract > 0 ? Math.max(10, (closedWon / underContract) * 100) : 10,
    },
  ];

  const automationAllZero =
    automation.leadsEnriched === 0 &&
    automation.smsSentToday === 0 &&
    automation.emailsSentToday === 0 &&
    automation.pendingOutreach === 0 &&
    automation.responsesReceived === 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Dashboard</h1>
        <p className="mt-1 text-gray-400">
          Real-time business intelligence for your wholesaling operation. Every figure is live from the database.
        </p>
      </div>

      {/* Database unreachable warning — zeros must not be read as results */}
      {!data.dbOk && (
        <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          ⚠️ Live database unreachable — counts below show 0 and are not actual figures. The dashboard will
          populate once the database connection is restored.
        </div>
      )}

      {/* ── 1. KPI Cards ─────────────────────────────────────────────── */}
      <div className="mb-10 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map((kpi) => {
          const c = KPI_COLORS[kpi.color];
          return (
            <div
              key={kpi.key}
              className={`rounded-xl border ${c.border} bg-gradient-to-br ${c.bg} p-4 shadow-lg ${c.glow} transition-transform hover:scale-[1.02]`}
            >
              <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
                {kpi.label}
              </p>
              <p className="mt-2 text-2xl font-bold text-white sm:text-3xl">{kpi.value}</p>
              <p className="mt-2 text-[11px] leading-snug text-gray-500">{kpi.note}</p>
            </div>
          );
        })}
      </div>

      {/* ── 2. Automation ─────────────────────────────────────────────── */}
      <div className="mb-10 rounded-xl border border-navy-700 bg-navy-800/60 p-6">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Automation</h2>
          <span className="rounded-full border border-navy-600 bg-navy-900/60 px-3 py-1 text-xs text-gray-400">
            Live pipeline health
          </span>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {[
            { key: "enriched", label: "Leads Enriched", value: automation.leadsEnriched, color: "teal" },
            { key: "sms", label: "SMS Sent Today", value: automation.smsSentToday, color: "blue" },
            { key: "emails", label: "Emails Sent Today", value: automation.emailsSentToday, color: "amber" },
            { key: "pending", label: "Pending Outreach Steps", value: automation.pendingOutreach, color: "gold" },
            { key: "responses", label: "Responses Received", value: automation.responsesReceived, color: "green" },
          ].map((card) => {
            const c = KPI_COLORS[card.color];
            return (
              <div
                key={card.key}
                className={`rounded-xl border ${c.border} bg-gradient-to-br ${c.bg} p-4 shadow-lg ${c.glow}`}
              >
                <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{card.label}</p>
                <p className="mt-2 text-3xl font-bold text-white">{card.value}</p>
              </div>
            );
          })}
        </div>
        {automationAllZero && (
          <p className="mt-4 text-xs text-gray-500">
            Nothing has run yet — these counters fill in as skip tracing, SMS/email outreach and automations fire.
          </p>
        )}
      </div>

      {/* ── 3. Pipeline Stages (live counts, canonical 19-stage vocabulary) ── */}
      <div className="mb-10 rounded-xl border border-navy-700 bg-navy-800/60 p-6">
        <h2 className="mb-5 text-lg font-semibold text-white">Pipeline Stages</h2>
        <div className="flex flex-wrap gap-2">
          {data.stages.map((stage) => {
            const count = data.stageCounts[stage.name] || 0;
            const max = Math.max(1, ...data.stages.map((s) => data.stageCounts[s.name] || 0));
            return (
              <div key={stage.name} className="min-w-[130px] flex-1">
                <div
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${stageBadge(stage.color)}`}
                >
                  <span className="font-medium">{stageLabel(stage.name)}</span>
                  <span className="text-base font-bold">{count}</span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded bg-navy-700">
                  <div
                    className="h-full rounded bg-gradient-to-r from-gold-500 to-gold-400"
                    style={{ width: `${(count / max) * 100}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-xs text-gray-500">
          Same 19-stage pipeline as the CRM — counts are leads in each canonical stage.
        </p>
      </div>

      {/* ── 4. Lead Source Breakdown ─────────────────────────────────── */}
      <div className="mb-10 rounded-xl border border-navy-700 bg-navy-800/60 p-6">
        <h2 className="mb-5 text-lg font-semibold text-white">Lead Source Breakdown</h2>
        {leadSources.length > 0 ? (
          <LeadSourceBars sources={leadSources} />
        ) : (
          <EmptyState message="No lead sources on record yet. Sources fill in as leads are imported." />
        )}
      </div>

      {/* ── 5. Pipeline Funnel ───────────────────────────────────────── */}
      <div className="mb-10 rounded-xl border border-navy-700 bg-navy-800/60 p-6">
        <h2 className="mb-5 text-lg font-semibold text-white">Pipeline Funnel</h2>
        <PipelineFunnel stages={funnelStages} />
        <p className="mt-4 text-xs text-gray-500">
          Conversion rates are real ratios of live stage counts — they show “no leads yet to convert” when a stage is empty.
        </p>
      </div>

      {/* ── 6. Monthly Revenue & Profit ──────────────────────────────── */}
      <div className="mb-10 rounded-xl border border-navy-700 bg-navy-800/60 p-6">
        <h2 className="mb-5 text-lg font-semibold text-white">Monthly Revenue &amp; Profit</h2>
        <EmptyState
          icon="💵"
          message="No revenue or expenses have been recorded yet — this business is pre-revenue. This chart will populate when contracts and closings create fee transactions."
        />
      </div>

      {/* ── 7. Marketing ROI Table ───────────────────────────────────── */}
      <div className="mb-10 rounded-xl border border-navy-700 bg-navy-800/60 p-6">
        <h2 className="mb-5 text-lg font-semibold text-white">Marketing ROI by Channel</h2>
        <EmptyState
          icon="📊"
          message="Marketing spend by channel isn't tracked yet. This table will populate once campaigns and channel costs are recorded (direct mail, SMS, email)."
        />
      </div>

      {/* ── 8. Recent Activity ───────────────────────────────────────── */}
      <div className="mb-10 rounded-xl border border-navy-700 bg-navy-800/60">
        <div className="border-b border-navy-700 px-6 py-4">
          <h2 className="text-lg font-semibold text-white">Recent Activity</h2>
        </div>
        <ActivityFeed notifications={notifications} />
      </div>
    </div>
  );
}

export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
  head: () => ({
    meta: [
      { title: "Dashboard — DealFlow AI" },
      {
        name: "description",
        content: "KPI dashboards and business intelligence for your real estate wholesaling operation.",
      },
    ],
  }),
});
