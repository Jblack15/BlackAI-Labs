import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { requireOwnerMiddleware } from "~/lib/auth";
import { OwnerGate } from "~/components/OwnerGate";
import { useEffect, useState } from "react";
import type { FunnelMetrics, CampaignCosts, AttentionItem, CommandStatus } from "~/lib/command-center";
import type { CampaignEconomicsSummary, HealthStatus } from "~/lib/campaign-economics";

// ─────────────────────────────────────────────────────────────────────────────
// Command Center (PH1-B10a + B10b) — "what needs attention right now", one screen.
//   • GREEN / YELLOW / RED banner — computed from real state, never hardcoded
//     (rule documented in src/lib/command-center.ts)
//   • Attention list — every item derived from real tables, with action links
//   • Funnel table — real counts per stage; conversions render "—" when the
//     denominator is 0 (no invented rates)
//   • Campaign cost panel — planned (owner-committed, not spent) vs actual
//     (real money moved); $0 actual shows an honest "no real spend recorded"
//   • Campaign economics panel (B10b) — cost per lead / qualified opp /
//     contract, revenue, net profit and the health badge + PAUSE/Monitor/Scale
//     recommendation, computed from real kind='actual' spend (rules documented
//     in src/lib/campaign-economics.ts). All "—" until real money moves.
// ─────────────────────────────────────────────────────────────────────────────

type CommandCenterData = {
  dbOk: boolean;
  funnel: FunnelMetrics;
  costs: CampaignCosts;
  items: AttentionItem[];
  status: CommandStatus;
  economics: CampaignEconomicsSummary;
  loadedAt: string;
};

// DB-backed lib is imported dynamically inside the handler so the client bundle
// never includes the server-only db module (team convention — see dashboard.tsx).
const fetchCommandCenter = createServerFn({ method: "GET", middleware: [requireOwnerMiddleware] }).handler(async (): Promise<CommandCenterData> => {
  const { funnelMetrics, campaignCosts, attentionItems, computeCommandStatus } = await import("~/lib/command-center");
  const { campaignEconomics, toFunnelCounts } = await import("~/lib/campaign-economics");
  const [funnel, costs, items] = await Promise.all([funnelMetrics(), campaignCosts(), attentionItems()]);
  const status = computeCommandStatus(items, funnel, costs);
  const economics = await campaignEconomics(toFunnelCounts(funnel));
  return {
    dbOk: funnel.dbOk,
    funnel,
    costs,
    items,
    status,
    economics,
    loadedAt: new Date().toISOString(),
  };
});

export const Route = createFileRoute("/command-center")({
  component: () => (
    <OwnerGate>
      <CommandCenterPage />
    </OwnerGate>
  ),
});

// ── Pure formatting helpers (duplicated locally — the lib is server-only) ──
function fmtDollars(cents: number): string {
  const abs = Math.abs(cents);
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(abs / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtRate(rate: number | null): string {
  if (rate === null) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

const STATUS_STYLES: Record<CommandStatus["status"], { banner: string; badge: string; ring: string; label: string }> = {
  GREEN: {
    banner: "border-emerald-500/40 bg-emerald-950/60",
    badge: "bg-emerald-500 text-navy-900",
    ring: "text-emerald-400",
    label: "GREEN — scale",
  },
  YELLOW: {
    banner: "border-gold-500/40 bg-gold-950/40",
    badge: "bg-gold-500 text-navy-900",
    ring: "text-gold-400",
    label: "YELLOW — test",
  },
  RED: {
    banner: "border-red-500/40 bg-red-950/50",
    badge: "bg-red-500 text-white",
    ring: "text-red-400",
    label: "RED — stop & fix",
  },
};

const SEVERITY_STYLES: Record<AttentionItem["severity"], string> = {
  critical: "border-red-500/40 bg-red-950/40",
  warn: "border-gold-500/40 bg-gold-950/30",
  info: "border-navy-600 bg-navy-800",
};

const HEALTH_STYLES: Record<HealthStatus, { badge: string; text: string }> = {
  GREEN: { badge: "bg-emerald-500 text-navy-900", text: "text-emerald-300" },
  YELLOW: { badge: "bg-gold-500 text-navy-900", text: "text-gold-300" },
  RED: { badge: "bg-red-500 text-white", text: "text-red-300" },
  NO_SPEND: { badge: "bg-navy-600 text-gray-300", text: "text-gray-400" },
};

const HEALTH_LABEL: Record<HealthStatus, string> = {
  GREEN: "GREEN — scale",
  YELLOW: "YELLOW — monitor",
  RED: "RED — pause",
  NO_SPEND: "NO SPEND RECORDED",
};

function CommandCenterPage() {
  const [data, setData] = useState<CommandCenterData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchCommandCenter()
      .then((d) => alive && setData(d))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-red-500/40 bg-red-950/40 p-6 text-red-200">
          <h1 className="text-xl font-bold text-white">Command Center unavailable</h1>
          <p className="mt-2 text-sm">
            The live data could not be loaded. Nothing on this screen is ever invented — refresh to retry.
          </p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <p className="text-sm text-gray-400">Loading command center…</p>
      </div>
    );
  }

  const styles = STATUS_STYLES[data.status.status];
  const anyActualSpend = data.costs.totals.actualCents > 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-white">Command Center</h1>
          <p className="mt-1 text-sm text-gray-400">
            What needs attention right now — every number below is a live count from real tables. Loaded{" "}
            {new Date(data.loadedAt).toLocaleString()}.
          </p>
        </div>
        <span className="text-xs text-gray-500">B10b · spending control active</span>
      </div>

      {/* ── Status banner ─────────────────────────────────────────────────── */}
      <div className={`mb-8 rounded-lg border p-5 ${styles.banner}`}>
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-bold ${styles.badge}`}>
            {styles.label}
          </span>
          <span className="text-sm text-gray-300">System status, computed from real funnel + cost data</span>
        </div>
        {data.status.reasons.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {data.status.reasons.map((r, i) => (
              <li key={i} className={`text-sm ${styles.ring}`}>
                • {r}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-gray-300">No conditions currently apply.</p>
        )}
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* ── Attention list ─────────────────────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-lg font-semibold text-white">Attention</h2>
          {data.items.length === 0 ? (
            <div className="rounded-lg border border-navy-600 bg-navy-800 p-5 text-sm text-gray-400">
              Nothing needs attention right now. (This is rare — the command center is designed to surface work.)
            </div>
          ) : (
            <ul className="space-y-3">
              {data.items.map((item, i) => (
                <li key={i} className={`rounded-lg border p-4 ${SEVERITY_STYLES[item.severity]}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                      {item.severity}
                    </span>
                    <h3 className="text-sm font-semibold text-white">{item.title}</h3>
                  </div>
                  <p className="mt-1 text-sm text-gray-300">{item.detail}</p>
                  {item.action && (
                    <a
                      href={item.action.href}
                      className="mt-2 inline-block text-sm font-medium text-gold-400 hover:text-gold-300 hover:underline"
                    >
                      {item.action.label} →
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Campaign costs ─────────────────────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-lg font-semibold text-white">Campaign costs</h2>
          <div className="overflow-hidden rounded-lg border border-navy-600">
            <table className="w-full text-left text-sm">
              <thead className="bg-navy-800 text-xs uppercase tracking-wider text-gray-400">
                <tr>
                  <th className="px-4 py-3">Campaign</th>
                  <th className="px-4 py-3">Channel</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Planned</th>
                  <th className="px-4 py-3 text-right">Actual</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-700 bg-navy-900/60">
                {data.costs.campaigns.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-3 text-gray-200">
                      <div className="font-medium">{c.name}</div>
                      <div className="mt-0.5 text-xs text-gray-500">
                        budget {fmtDollars(c.plannedBudgetCents)}
                        {c.notes ? ` — ${c.notes}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-300">{c.channel}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-navy-700 px-2 py-0.5 text-xs text-gray-300">{c.status}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-200">{fmtDollars(c.plannedCents)}</td>
                    <td className="px-4 py-3 text-right text-gray-200">{fmtDollars(c.actualCents)}</td>
                  </tr>
                ))}
                <tr className="bg-navy-800 font-semibold text-white">
                  <td className="px-4 py-3" colSpan={3}>
                    Totals
                  </td>
                  <td className="px-4 py-3 text-right">{fmtDollars(data.costs.totals.plannedCents)}</td>
                  <td className="px-4 py-3 text-right">{fmtDollars(data.costs.totals.actualCents)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {!anyActualSpend ? (
            <p className="mt-2 text-xs text-gray-500">
              No real spend recorded yet — planned amounts are the owner-committed caps (kind=planned); actual
              entries (kind=actual) only appear once money actually moves.
            </p>
          ) : (
            <p className="mt-2 text-xs text-gray-500">
              Actual spend is real money that has moved. Economics (cost per lead / contract, net profit) and the
              pause recommendation are computed below from kind='actual' entries.
            </p>
          )}
        </section>
      </div>

      {/* ── Campaign economics & spending control (B10b) ──────────────────── */}
      <section className="mt-10">
        <h2 className="mb-3 text-lg font-semibold text-white">Campaign economics &amp; spending control</h2>
        {!data.economics.revenueTrackable && (
          <p className="mb-3 text-xs text-gray-500">
            Revenue attribution lands in B12 (contracts.campaign_id) — until then revenue shows $0.00 (real: no
            contracts exist) with net profit "—" because per-campaign net profit cannot be computed yet.
          </p>
        )}
        <div className="overflow-x-auto rounded-lg border border-navy-600">
          <table className="w-full text-left text-sm">
            <thead className="bg-navy-800 text-xs uppercase tracking-wider text-gray-400">
              <tr>
                <th className="px-4 py-3">Campaign</th>
                <th className="px-4 py-3 text-right">Leads</th>
                <th className="px-4 py-3 text-right">Cost/lead</th>
                <th className="px-4 py-3 text-right">Cost/qual.</th>
                <th className="px-4 py-3 text-right">Cost/contract</th>
                <th className="px-4 py-3 text-right">Revenue</th>
                <th className="px-4 py-3 text-right">Net profit</th>
                <th className="px-4 py-3">Health</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-700 bg-navy-900/60">
              {data.economics.campaigns.map((c) => {
                const hs = HEALTH_STYLES[c.health.status];
                const noSpend = c.actualCents === 0;
                return (
                  <tr key={c.id}>
                    <td className="px-4 py-3 text-gray-200">
                      <div className="font-medium">{c.name}</div>
                      <div className="mt-0.5 text-xs text-gray-500">
                        {c.channel} · {c.status}
                        {c.spendCapCents !== null ? ` · cap ${fmtDollars(c.spendCapCents)}` : " · no cap set"}
                        {c.leadCount === null ? " · leads unknown" : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-200">{c.leadCount ?? "—"}</td>
                    <td className="px-4 py-3 text-right text-gray-200">
                      {noSpend || c.costPerLeadCents === null ? "—" : fmtDollars(c.costPerLeadCents)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-200">
                      {noSpend || c.costPerQualifiedOppCents === null ? "—" : fmtDollars(c.costPerQualifiedOppCents)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-200">
                      {noSpend || c.costPerContractCents === null ? "—" : fmtDollars(c.costPerContractCents)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-200">
                      {c.revenueCents === null ? "—" : fmtDollars(c.revenueCents)}
                      {c.revenueNote ? <div className="text-[10px] text-gray-500">not attributable yet (B12)</div> : null}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-200">
                      {c.netProfitCents === null ? "—" : fmtDollars(c.netProfitCents)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${hs.badge}`}>
                          {HEALTH_LABEL[c.health.status]}
                        </span>
                        {c.health.recommendation ? (
                          <span className={`text-xs ${hs.text}`}>{c.health.recommendation}</span>
                        ) : (
                          <span className={`text-xs ${hs.text}`}>economics unavailable until real spend exists</span>
                        )}
                      </div>
                      {c.health.reasons.length > 0 && c.health.status !== "NO_SPEND" ? (
                        <ul className="mt-1 list-disc pl-4 text-xs text-gray-400">
                          {c.health.reasons.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-navy-800 font-semibold text-white">
                <td className="px-4 py-3" colSpan={2}>
                  Totals
                </td>
                <td className="px-4 py-3 text-right text-gray-500" colSpan={3}>
                  {fmtDollars(data.economics.totals.actualCents)} actual spend
                </td>
                <td className="px-4 py-3 text-right text-gray-300">
                  {data.economics.totals.revenueCents === null ? "—" : fmtDollars(data.economics.totals.revenueCents)}
                </td>
                <td className="px-4 py-3 text-right text-gray-300">
                  {data.economics.totals.netProfitCents === null ? "—" : fmtDollars(data.economics.totals.netProfitCents)}
                </td>
                <td className="px-4 py-3 text-xs font-normal text-gray-500">
                  {data.economics.totals.actualCents === 0
                    ? "No spend recorded — economics unavailable"
                    : "Computed from kind='actual' spend only"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Cost per lead / qualified opp / contract and net profit render "—" until real money moves (kind='actual').
          Health rules: RED → Recommend PAUSE (cost per contract &gt; $15,000, spend over cap, or offers out with zero
          contracts after $2,000); GREEN → net profit &gt; 0; YELLOW → monitoring. Targets from plan rev 18, tuned in
          TARGETS in src/lib/campaign-economics.ts.
        </p>
      </section>

      {/* ── Funnel ───────────────────────────────────────────────────────── */}
      <section className="mt-10">
        <h2 className="mb-3 text-lg font-semibold text-white">Funnel</h2>
        {!data.dbOk && (
          <div className="mb-3 rounded-lg border border-red-500/40 bg-red-950/40 p-4 text-sm text-red-200">
            Some funnel queries failed — counts below may be incomplete. Nothing here is ever estimated.
          </div>
        )}
        <div className="overflow-hidden rounded-lg border border-navy-600">
          <table className="w-full text-left text-sm">
            <thead className="bg-navy-800 text-xs uppercase tracking-wider text-gray-400">
              <tr>
                <th className="px-4 py-3">Stage</th>
                <th className="px-4 py-3 text-right">Count</th>
                <th className="px-4 py-3 text-right">Conversion</th>
                <th className="px-4 py-3">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-700 bg-navy-900/60">
              {data.funnel.stages.map((s) => (
                <tr key={s.key}>
                  <td className="px-4 py-3 font-medium text-gray-200">{s.label}</td>
                  <td className="px-4 py-3 text-right text-white">{s.count.toLocaleString("en-US")}</td>
                  <td className="px-4 py-3 text-right text-gray-300">
                    {s.conversionFromPrevious === null ? "—" : fmtRate(s.conversionFromPrevious)}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{s.note}</td>
                </tr>
              ))}
              <tr className="bg-navy-800 text-gray-300">
                <td className="px-4 py-3 font-semibold text-white" colSpan={4}>
                  Headline rates — offer→contract: {fmtRate(data.funnel.contractRate)} · qualified rate:{" "}
                  {fmtRate(data.funnel.qualifiedRate)} (plan targets: ≥15% and ≥50% to go GREEN)
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
