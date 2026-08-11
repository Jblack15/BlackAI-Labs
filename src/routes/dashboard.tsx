import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";

// ── Mock Data ──────────────────────────────────────────────────────────────

const KPIS = [
  {
    key: "leads",
    label: "Total Leads",
    value: 247,
    trend: "+12.3%",
    direction: "up",
    color: "blue",
  },
  {
    key: "appointments",
    label: "Appointments Set",
    value: 48,
    trend: "+8.7%",
    direction: "up",
    color: "amber",
  },
  {
    key: "contracts",
    label: "Contracts Signed",
    value: 15,
    trend: "+5.2%",
    direction: "up",
    color: "green",
  },
  {
    key: "deals",
    label: "Deals Closed",
    value: 7,
    trend: "+2.1%",
    direction: "up",
    color: "gold",
  },
  {
    key: "fees",
    label: "Total Assignment Fees",
    value: "$105,000",
    trend: "+18.4%",
    direction: "up",
    color: "teal",
  },
  {
    key: "profit",
    label: "Net Profit",
    value: "$78,500",
    trend: "+22.1%",
    direction: "up",
    color: "green",
  },
];

const LEAD_SOURCES = [
  { source: "Tax Delinquent", count: 86, pct: 35 },
  { source: "Probate", count: 44, pct: 18 },
  { source: "Pre-Foreclosure", count: 37, pct: 15 },
  { source: "Absentee Owners", count: 30, pct: 12 },
  { source: "Tired Landlords", count: 20, pct: 8 },
  { source: "Code Violations", count: 12, pct: 5 },
  { source: "Other", count: 18, pct: 7 },
];

const PIPELINE_FUNNEL = [
  { stage: "Marketing Contacts", count: 2500, rate: null, width: 100 },
  { stage: "Leads", count: 247, rate: "9.9%", width: 78 },
  { stage: "Appointments", count: 48, rate: "19.4%", width: 52 },
  { stage: "Contracts", count: 15, rate: "31.3%", width: 30 },
  { stage: "Closed", count: 7, rate: "46.7%", width: 14 },
];

const MONTHLY_DATA = [
  { month: "Jan", revenue: 0, expenses: 1200, profit: -1200 },
  { month: "Feb", revenue: 4500, expenses: 2800, profit: 1700 },
  { month: "Mar", revenue: 12000, expenses: 5200, profit: 6800 },
  { month: "Apr", revenue: 18500, expenses: 7100, profit: 11400 },
  { month: "May", revenue: 26000, expenses: 8900, profit: 17100 },
  { month: "Jun", revenue: 35000, expenses: 10500, profit: 24500 },
];

const MARKETING_ROI = [
  {
    channel: "Direct Mail",
    spend: "$2,400",
    leads: 35,
    costPerLead: "$69",
    deals: 2,
    revenue: "$28,000",
    roi: "11.7x",
  },
  {
    channel: "Facebook Ads",
    spend: "$3,000",
    leads: 48,
    costPerLead: "$63",
    deals: 1,
    revenue: "$15,000",
    roi: "5.0x",
  },
  {
    channel: "Google Ads",
    spend: "$2,500",
    leads: 28,
    costPerLead: "$89",
    deals: 1,
    revenue: "$12,000",
    roi: "4.8x",
  },
  {
    channel: "SMS / Phone",
    spend: "$1,200",
    leads: 42,
    costPerLead: "$29",
    deals: 2,
    revenue: "$32,000",
    roi: "26.7x",
  },
  {
    channel: "Referral / Organic",
    spend: "$0",
    leads: 18,
    costPerLead: "$0",
    deals: 1,
    revenue: "$18,000",
    roi: "∞",
  },
];

// --- Server Functions ---
interface DashboardMetrics {
  totalLeads: number;
  byStatus: Record<string, number>;
  bySource: { source: string; count: number }[];
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

const fetchDashboardMetrics = createServerFn({ method: "GET" }).handler(async (): Promise<DashboardMetrics> => {
  try {
    const { sql } = await import("~/db");

    const totalRows = await sql`SELECT COUNT(*)::int as count FROM leads` as { count: number }[];
    const totalLeads = totalRows[0]?.count ?? 0;

    const statusRows = await sql`
      SELECT status, COUNT(*)::int as count FROM leads GROUP BY status
    ` as { status: string; count: number }[];
    const byStatus: Record<string, number> = {};
    for (const r of statusRows) byStatus[r.status] = r.count;

    const sourceRows = await sql`
      SELECT lead_source as source, COUNT(*)::int as count
      FROM leads WHERE lead_source IS NOT NULL AND lead_source != ''
      GROUP BY lead_source ORDER BY count DESC
    ` as { source: string; count: number }[];
    const bySource = sourceRows.map((r) => ({ source: r.source, count: r.count }));

    return { totalLeads, byStatus, bySource };
  } catch {
    return {
      totalLeads: 247,
      byStatus: {},
      bySource: [],
    };
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

function LeadSourceBars({ sources }: { sources: { source: string; count: number; pct: number }[] }) {
  const maxCount = sources[0]?.count || 1;
  return (
    <div className="space-y-3">
      {sources.map((src) => (
        <div key={src.source} className="flex items-center gap-3">
          <span className="w-36 shrink-0 text-sm text-gray-300">{src.source}</span>
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

function PipelineFunnel({ stages }: { stages: { stage: string; count: number; rate: string | null; width: number }[] }) {
  return (
    <div className="space-y-3">
      {stages.map((stage, i) => {
        const isFirst = i === 0;
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
                    : i === PIPELINE_FUNNEL.length - 1
                      ? "linear-gradient(90deg, rgba(245,158,11,0.25), rgba(245,158,11,0.08))"
                      : undefined,
              }}
            >
              <span className="text-sm font-medium text-gray-200">{stage.stage}</span>
              <span className="text-lg font-bold text-white">{stage.count.toLocaleString()}</span>
            </div>
            {!isLast && stage.rate && (
              <div className="my-1 flex items-center gap-1">
                <svg className="h-3 w-3 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
                <span className="text-xs text-gray-500">{stage.rate} conversion</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MonthlyChart() {
  const maxRevenue = Math.max(...MONTHLY_DATA.map((d) => d.revenue));
  const maxExpense = Math.max(...MONTHLY_DATA.map((d) => d.expenses));
  const chartMax = Math.max(maxRevenue, maxExpense) * 1.2;

  return (
    <div>
      {/* Legend */}
      <div className="mb-4 flex items-center gap-6">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-sm bg-gold-500" />
          <span className="text-xs text-gray-400">Revenue</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-sm bg-red-500/50" />
          <span className="text-xs text-gray-400">Expenses</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-0.5 w-6 bg-teal-400" />
          <span className="text-xs text-gray-400">Net Profit</span>
        </div>
      </div>

      {/* Bars */}
      <div className="flex items-end gap-3" style={{ height: "200px" }}>
        {MONTHLY_DATA.map((d) => (
          <div key={d.month} className="flex flex-1 flex-col items-center gap-1">
            {/* Profit dot */}
            <div className="flex w-full flex-col items-center">
              <span
                className="mb-1 text-[10px] font-semibold text-teal-400"
                style={{
                  marginBottom: `${d.profit > 0 ? (d.profit / chartMax) * 200 + 4 : 4}px`,
                }}
              >
                {d.profit >= 0 ? `$${(d.profit / 1000).toFixed(1)}k` : ""}
              </span>
            </div>
            <div className="flex w-full items-end justify-center gap-1">
              {/* Revenue bar */}
              <div
                className="w-4 rounded-t bg-gold-500 transition-all sm:w-6"
                style={{ height: `${(d.revenue / chartMax) * 200}px` }}
              />
              {/* Expense bar */}
              <div
                className="w-4 rounded-t bg-red-500/50 transition-all sm:w-6"
                style={{ height: `${(d.expenses / chartMax) * 200}px` }}
              />
            </div>
            <span className="mt-2 text-xs text-gray-500">{d.month}</span>
          </div>
        ))}
      </div>

      {/* Profit line (overlay simulation via absolute positioning is messy, so we show profit below) */}
      <div className="mt-4 grid grid-cols-6 gap-3">
        {MONTHLY_DATA.map((d) => (
          <div key={d.month} className="text-center">
            <div
              className={`text-xs font-semibold ${d.profit >= 0 ? "text-teal-400" : "text-red-400"}`}
            >
              {d.profit >= 0 ? `+$${(d.profit / 1000).toFixed(1)}k` : `-$${(Math.abs(d.profit) / 1000).toFixed(1)}k`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MarketingRoiTable() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-navy-600 text-xs uppercase text-gray-500">
            <th className="pb-3 pr-4 font-medium">Channel</th>
            <th className="pb-3 pr-4 font-medium">Spend</th>
            <th className="pb-3 pr-4 font-medium">Leads</th>
            <th className="pb-3 pr-4 font-medium">Cost/Lead</th>
            <th className="pb-3 pr-4 font-medium">Deals</th>
            <th className="pb-3 pr-4 font-medium">Revenue</th>
            <th className="pb-3 font-medium text-right">ROI</th>
          </tr>
        </thead>
        <tbody>
          {MARKETING_ROI.map((row) => (
            <tr key={row.channel} className="border-b border-navy-700/50 hover:bg-navy-800/50">
              <td className="py-3 pr-4 font-medium text-gray-200">{row.channel}</td>
              <td className="py-3 pr-4 text-gray-400">{row.spend}</td>
              <td className="py-3 pr-4 text-gray-300">{row.leads}</td>
              <td className="py-3 pr-4 text-gray-400">{row.costPerLead}</td>
              <td className="py-3 pr-4 text-gray-300">{row.deals}</td>
              <td className="py-3 pr-4 font-medium text-gold-400">{row.revenue}</td>
              <td className="py-3 text-right">
                <span
                  className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    row.roi === "∞"
                      ? "bg-gold-500/20 text-gold-400"
                      : parseFloat(row.roi) > 10
                        ? "bg-emerald-500/20 text-emerald-400"
                        : parseFloat(row.roi) > 4
                          ? "bg-blue-500/20 text-blue-400"
                          : "bg-amber-500/20 text-amber-400"
                  }`}
                >
                  {row.roi}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActivityFeed({ notifications }: { notifications: NotificationItem[] }) {
  if (notifications.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-gray-500">
        No recent activity. New lead submissions will appear here.
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
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    totalLeads: 247,
    byStatus: {},
    bySource: [],
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
    fetchDashboardMetrics()
      .then((data) => {
        if (data) setMetrics(data);
      })
      .catch(() => {});
    fetchAutomationMetrics()
      .then((data) => {
        if (data) setAutomation(data);
      })
      .catch(() => {});
    fetchNotifications()
      .then((data) => {
        if (data) setNotifications(data);
      })
      .catch(() => {});
  }, []);

  // Derive KPI values from real data
  const kpis = [
    {
      key: "leads",
      label: "Total Leads",
      value: metrics.totalLeads,
      trend: "+12.3%",
      direction: "up" as const,
      color: "blue",
    },
    {
      key: "appointments",
      label: "Appointments Set",
      value: metrics.byStatus["appointment"] || 0,
      trend: "+8.7%",
      direction: "up" as const,
      color: "amber",
    },
    {
      key: "contracts",
      label: "Contracts Signed",
      value: metrics.byStatus["contract"] || 0,
      trend: "+5.2%",
      direction: "up" as const,
      color: "green",
    },
    {
      key: "deals",
      label: "Deals Closed",
      value: metrics.byStatus["closed"] || 0,
      trend: "+2.1%",
      direction: "up" as const,
      color: "gold",
    },
    {
      key: "fees",
      label: "Total Assignment Fees",
      value: "$105,000",
      trend: "+18.4%",
      direction: "up" as const,
      color: "teal",
    },
    {
      key: "profit",
      label: "Net Profit",
      value: "$78,500",
      trend: "+22.1%",
      direction: "up" as const,
      color: "green",
    },
  ];

  // Derive lead sources from real data
  const sourceLabels: Record<string, string> = {
    "tax-delinquent": "Tax Delinquent",
    probate: "Probate",
    "pre-foreclosure": "Pre-Foreclosure",
    absentee: "Absentee Owners",
    "tired-landlord": "Tired Landlords",
    "code-violations": "Code Violations",
    vacant: "Vacant",
    "high-equity": "High Equity",
    divorce: "Divorce",
    "expired-listing": "Expired Listing",
  };

  // Pipeline stage labels (matches CRM pipeline)
  const STAGE_LABELS: { key: string; label: string; chip: string }[] = [
    { key: "new", label: "New Lead", chip: "bg-blue-500/20 text-blue-300 border-blue-500/30" },
    { key: "contacted", label: "Contacted", chip: "bg-purple-500/20 text-purple-300 border-purple-500/30" },
    { key: "qualified", label: "Qualified", chip: "bg-teal-500/20 text-teal-300 border-teal-500/30" },
    { key: "appointment", label: "Appt. Set", chip: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
    { key: "offer", label: "Offer Made", chip: "bg-orange-500/20 text-orange-300 border-orange-500/30" },
    { key: "contract", label: "Contract Signed", chip: "bg-green-500/20 text-green-300 border-green-500/30" },
    { key: "closed", label: "Closed Won", chip: "bg-gold-500/20 text-gold-300 border-gold-500/30" },
    { key: "dead", label: "Dead", chip: "bg-red-500/20 text-red-300 border-red-500/30" },
  ];

  const leadSources = metrics.bySource.length > 0
    ? metrics.bySource.map((s) => ({
        source: sourceLabels[s.source] || s.source,
        count: s.count,
        pct: Math.round((s.count / metrics.totalLeads) * 100),
      }))
    : LEAD_SOURCES;

  // Pipeline funnel from status counts
  const pipelineFunnel = metrics.byStatus
    ? [
        { stage: "Marketing Contacts", count: 2500, rate: null as string | null, width: 100 },
        { stage: "Leads", count: metrics.totalLeads, rate: `${((metrics.totalLeads / 2500) * 100).toFixed(1)}%`, width: 78 },
        { stage: "Appointments", count: metrics.byStatus["appointment"] || 0, rate: metrics.totalLeads > 0 ? `${(((metrics.byStatus["appointment"] || 0) / metrics.totalLeads) * 100).toFixed(1)}%` : "0%", width: 52 },
        { stage: "Contracts", count: metrics.byStatus["contract"] || 0, rate: metrics.totalLeads > 0 ? `${(((metrics.byStatus["contract"] || 0) / metrics.totalLeads) * 100).toFixed(1)}%` : "0%", width: 30 },
        { stage: "Closed", count: metrics.byStatus["closed"] || 0, rate: metrics.totalLeads > 0 ? `${(((metrics.byStatus["closed"] || 0) / metrics.totalLeads) * 100).toFixed(1)}%` : "0%", width: 14 },
      ]
    : PIPELINE_FUNNEL;
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Dashboard</h1>
        <p className="mt-1 text-gray-400">Real-time business intelligence for your wholesaling operation.</p>
      </div>

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
              <div className="mt-2 flex items-center gap-1">
                <span
                  className={`text-xs font-semibold ${
                    kpi.direction === "up" ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {kpi.direction === "up" ? "↑" : "↓"} {kpi.trend}
                </span>
                <span className="text-xs text-gray-600">vs last period</span>
              </div>
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
      </div>

      {/* ── 3. Pipeline Stages (live counts) ──────────────────────────── */}
      <div className="mb-10 rounded-xl border border-navy-700 bg-navy-800/60 p-6">
        <h2 className="mb-5 text-lg font-semibold text-white">Pipeline Stages</h2>
        <div className="flex flex-wrap gap-2">
          {STAGE_LABELS.map((stage) => {
            const count = metrics.byStatus[stage.key] || 0;
            const max = Math.max(1, ...STAGE_LABELS.map((s) => metrics.byStatus[s.key] || 0));
            return (
              <div key={stage.key} className="flex-1 min-w-[130px]">
                <div className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${stage.chip}`}>
                  <span className="font-medium">{stage.label}</span>
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
      </div>

      {/* ── 4. Lead Source Breakdown ─────────────────────────────────── */}
      <div className="mb-10 rounded-xl border border-navy-700 bg-navy-800/60 p-6">
        <h2 className="mb-5 text-lg font-semibold text-white">Lead Source Breakdown</h2>
        <LeadSourceBars sources={leadSources} />
      </div>

      {/* ── 5. Pipeline Funnel ───────────────────────────────────────── */}
      <div className="mb-10 rounded-xl border border-navy-700 bg-navy-800/60 p-6">
        <h2 className="mb-5 text-lg font-semibold text-white">Pipeline Funnel</h2>
        <PipelineFunnel stages={pipelineFunnel} />
      </div>

      {/* ── 6. Monthly Revenue & Profit ──────────────────────────────── */}
      <div className="mb-10 rounded-xl border border-navy-700 bg-navy-800/60 p-6">
        <h2 className="mb-5 text-lg font-semibold text-white">Monthly Revenue & Profit</h2>
        <MonthlyChart />
      </div>

      {/* ── 7. Marketing ROI Table ───────────────────────────────────── */}
      <div className="mb-10 rounded-xl border border-navy-700 bg-navy-800/60 p-6">
        <h2 className="mb-5 text-lg font-semibold text-white">Marketing ROI by Channel</h2>
        <MarketingRoiTable />
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
