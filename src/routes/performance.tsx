import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { requireOwnerMiddleware } from "~/lib/auth";
import { OwnerGate } from "~/components/OwnerGate";
import { useState, useEffect } from "react";
import { fmtDollars, type PerformanceOverview } from "~/lib/performance-dashboard";

const fetchPerf = createServerFn({
  method: "GET",
  middleware: [requireOwnerMiddleware],
}).handler(async (): Promise<PerformanceOverview | null> => {
  try {
    const { performanceOverview } = await import("~/lib/performance-dashboard");
    return await performanceOverview();
  } catch {
    return null;
  }
});

const sevDot: Record<string, string> = { critical: "bg-red-500", warn: "bg-gold-500", info: "bg-gray-500" };
const sevText: Record<string, string> = { critical: "text-red-300", warn: "text-gold-300", info: "text-gray-400" };

function statCard(label: string, value: string, accent = "text-white") {
  return (
    <div className="rounded-xl border border-navy-700 bg-navy-800 p-4">
      <div className={`text-2xl font-bold ${accent}`}>{value}</div>
      <div className="mt-1 text-xs uppercase tracking-wide text-gray-500">{label}</div>
    </div>
  );
}

function PerformancePage() {
  const [data, setData] = useState<PerformanceOverview | null>(null);

  useEffect(() => {
    fetchPerf().then((d) => setData(d));
  }, []);

  if (!data) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <p className="text-sm text-gray-400">Loading performance data…</p>
      </div>
    );
  }

  const v = (k: string) => data.funnel.find((s) => s.key === k);
  const fmtRate = (r: number | null) => (r === null || r === undefined ? "—" : `${(r * 100).toFixed(1)}%`);
  const count = (k: string) => v(k)?.value ?? 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Performance Dashboard</h1>
          <p className="mt-1 text-sm text-gray-400">
            REAL results separated from TARGETS. Generated {String(data.generatedAt).slice(0, 16).replace("T", " ")} UTC.
          </p>
        </div>
        <Link to="/briefing" className="rounded-lg bg-gold-500 px-4 py-2 text-sm font-semibold text-navy-900 hover:bg-gold-400">
          Daily Briefing →
        </Link>
      </div>

      {!data.dbOk && (
        <div className="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          Database unreachable — every number below is 0/unavailable and must NOT be read as business results.
        </div>
      )}

      {/* ── 1. Funnel (REAL) ─────────────────────────────────────────────── */}
      <section className="rounded-xl border border-navy-700 bg-navy-900 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Funnel (REAL)</h2>
          <span className="rounded-full bg-navy-700 px-2 py-0.5 text-[11px] uppercase tracking-wide text-gold-400">live source truth</span>
        </div>
        <div className="mt-1 text-sm text-gray-500">
          Every number is a live count over real tables. Zero means zero — no estimates.
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-navy-700 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="py-2 pr-4">Stage</th>
                <th className="py-2 pr-4">Value</th>
                <th className="py-2 pr-4">Into this stage</th>
                <th className="py-2">Source (real table)</th>
              </tr>
            </thead>
            <tbody>
              {data.funnel.map((s) => (
                <tr key={s.key} className="border-b border-navy-800/60">
                  <td className="py-2 pr-4 font-medium text-white">{s.label}</td>
                  <td className="py-2 pr-4 text-gray-200">
                    {s.unit === "dollars" ? fmtDollars(Math.round(s.value * 100)) : s.value}
                  </td>
                  <td className="py-2 pr-4 text-gray-400">{fmtRate(s.conversion)}</td>
                  <td className="py-2 text-xs text-gray-500">{s.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 rounded-lg border border-navy-700 bg-navy-800 px-3 py-2 text-sm">
          <span className="text-gray-400">Actual assignment revenue: </span>
          <span className="font-semibold text-gray-200">{fmtDollars(Math.round(count("assignment_revenue") * 100))}</span>
          <span className="ml-1 text-xs text-gray-500">— $0 until a closing is recorded (no decoration pretending otherwise).</span>
        </div>
      </section>

      {/* ── 2. Conversion rates (REAL) ───────────────────────────────────── */}
      <section className="mt-6 rounded-xl border border-navy-700 bg-navy-900 p-5">
        <h2 className="text-lg font-semibold text-white">Conversion rates (REAL)</h2>
        <p className="mt-1 text-sm text-gray-500">Computed strictly from the funnel counts above. "—" = denominator is 0.</p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {data.conversions.map((c) => (
            <div key={c.label} className="rounded-xl border border-navy-700 bg-navy-800 p-4">
              <div className="text-2xl font-bold text-white">{fmtRate(c.rate)}</div>
              <div className="mt-1 text-xs text-gray-400">{c.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── 3. Targets (NOT actual) — never blended ──────────────────────── */}
      <section className="mt-6 rounded-xl border border-gold-500/40 bg-navy-900 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gold-400">Targets (not actual results)</h2>
          <span className="rounded-full bg-gold-500/15 px-2 py-0.5 text-[11px] uppercase tracking-wide text-gold-400">TARGETS — plan goals, not results</span>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          These are the owner's plan targets (plan rev 18). Actuals are the real numbers from the funnel above. They are shown side-by-side but are never blended.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-navy-700 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="py-2 pr-4">Metric</th>
                <th className="py-2 pr-4 text-gold-400">Target</th>
                <th className="py-2 pr-4 text-gray-300">Actual</th>
                <th className="py-2">Note</th>
              </tr>
            </thead>
            <tbody>
              {data.targets.map((t) => (
                <tr key={t.key} className="border-b border-navy-800/60">
                  <td className="py-2 pr-4 font-medium text-white">{t.label}</td>
                  <td className="py-2 pr-4 text-gold-400">{t.target}</td>
                  <td className="py-2 pr-4 text-gray-200">{t.actual}</td>
                  <td className="py-2 text-xs text-gray-500">{t.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 4. Owner tasks / blocked / AI tasks ──────────────────────────── */}
      <section className="mt-6 rounded-xl border border-navy-700 bg-navy-900 p-5">
        <h2 className="text-lg font-semibold text-white">Owner tasks · Blocked · Automated tasks</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {statCard("Pending approvals", String(data.tasks.pendingApprovals), data.tasks.pendingApprovals > 0 ? "text-gold-400" : "text-gray-500")}
          {statCard("Call now", String(data.tasks.callNow), "text-white")}
          {statCard("Follow-ups due", String(data.tasks.dueFollowUps), data.tasks.dueFollowUps > 0 ? "text-gold-400" : "text-gray-500")}
          {statCard("Blocked / attention", String(data.tasks.attention.length), data.tasks.attentionCritical > 0 ? "text-red-400" : "text-white")}
        </div>
        {data.tasks.attention.length > 0 && (
          <div className="mt-4 space-y-2">
            {data.tasks.attention.map((a, i) => (
              <div key={i} className={`flex items-start gap-3 rounded-lg border border-navy-700 bg-navy-800 px-3 py-2 text-sm`}>
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${sevDot[a.severity]}`} />
                <div>
                  <div className={`font-medium ${sevText[a.severity]}`}>{a.title}</div>
                  <div className="text-xs text-gray-500">{a.detail}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4">
          <div className="text-sm font-medium text-white">
            Automated tasks completed, last {data.tasks.aiTasksPeriodDays} days: <span className="text-gold-400">{data.tasks.aiTasksTotal}</span>
          </div>
          <p className="mt-0.5 text-xs text-gray-500">
            Real audit-log events by category (internal automation + state-machine + auth + approvals — never autonomous outbound).
          </p>
          {data.tasks.aiTasks.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {data.tasks.aiTasks.map((c) => (
                <span key={c.channel} className="rounded-full border border-navy-700 bg-navy-800 px-3 py-1 text-xs text-gray-300">
                  {c.channel}: <span className="text-white">{c.count}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Zero-actual honesty footer ───────────────────────────────────── */}
      <div className="mt-6 rounded-xl border border-navy-700 bg-navy-900 p-4 text-center">
        <div className="text-3xl font-bold text-gray-300">$0.00 actual assignment revenue</div>
        <div className="mt-1 text-sm text-gray-500">
          {fmtDollars(data.costs.plannedCents)} planned spend (paused/unsent) · {fmtDollars(data.costs.actualCents)} actual spend · pre-revenue, zero-spend mode.
          The pipeline is built but no closing has been recorded yet — these are honest real numbers.
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/performance")({
  component: () => (
    <OwnerGate>
      <PerformancePage />
    </OwnerGate>
  ),
});
