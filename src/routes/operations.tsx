// DealFlow AI — Owner Action Queue (D1): the one owner-gated operating screen.
// "What needs the owner today", composed at read time from existing libs:
//   Today tab   → pending approvals + CALL NOW manual-call queue + attention
//                 items + trace gaps + queue/count summary.
//   Call List   → the Smart Top-25 manual-call list (same md the owner gets
//                 today from /home/team/shared/call-package), rendered in-app
//                 with a "Regenerate" button that re-runs priorities first.
//
// Owner-gated: every server fn runs behind requireOwnerMiddleware; the UI is
// wrapped in OwnerGate. Public routes are untouched.
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useEffect, useCallback } from "react";
import { requireOwnerMiddleware } from "~/lib/auth";
import { OwnerGate } from "~/components/OwnerGate";
import { LogCallOutcomeModal, type LogCallLead, type LogCallSubmit } from "~/components/LogCallOutcomeModal";
import type { OperationsOverview } from "~/lib/owner-action-queue";
import type { Top25CallList } from "~/lib/top25-call-list";

const GET_SERVER_FN = { method: "GET", middleware: [requireOwnerMiddleware] } as const;

const fetchOverview = createServerFn(GET_SERVER_FN).handler(async () => {
  try {
    const { getOperationsOverview } = await import("~/lib/owner-action-queue");
    return await getOperationsOverview();
  } catch {
    return null;
  }
});

const fetchTop25 = createServerFn(GET_SERVER_FN).handler(async () => {
  try {
    const { generateTop25CallList } = await import("~/lib/top25-call-list");
    return await generateTop25CallList();
  } catch {
    return null;
  }
});

// Regenerate = refresh priorities (the external generator always did) then
// rebuild the list, so a fresh trace import is reflected without restarting.
const regenerateTop25 = createServerFn({ method: "POST", middleware: [requireOwnerMiddleware] }).handler(async () => {
  try {
    const { generateTop25CallList } = await import("~/lib/top25-call-list");
    return await generateTop25CallList({ refreshPriorities: true });
  } catch {
    return null;
  }
});

// D2 Seller Conversation Engine: record what happened on a manual owner call.
// Owner-gated like every other write here. Never sends anything — it advances
// the lead through the outreach-status state machine, persists seller fields,
// schedules a follow-up, and (on opt-out/suppression) hard-suppresses + audits.
const logCallOutcomeFn = createServerFn({ method: "POST", middleware: [requireOwnerMiddleware] })
  .validator((data: unknown) => data as { leadId: string; input: Record<string, unknown> })
  .handler(async ({ data }) => {
    try {
      const { logCallOutcome } = await import("~/lib/log-call-outcome");
      return await logCallOutcome(data.leadId, data.input as never, { operator: "owner" });
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : "Failed to log call outcome" };
    }
  });

// --- shared UI helpers ------------------------------------------------------
const sevStyles: Record<string, string> = {
  critical: "border-red-500/40 bg-red-500/10 text-red-300",
  warn: "border-gold-500/40 bg-gold-500/10 text-gold-300",
  info: "border-navy-600 bg-navy-800 text-gray-300",
};
const sevDot: Record<string, string> = { critical: "bg-red-500", warn: "bg-gold-500", info: "bg-gray-500" };
const queueStyles: Record<string, string> = {
  HOT: "bg-red-500/15 text-red-400",
  HIGH: "bg-orange-500/15 text-orange-400",
  MEDIUM: "bg-gold-500/15 text-gold-400",
  LOW: "bg-navy-700 text-gray-400",
  DEAD: "bg-navy-700 text-gray-500",
};
const fmtPhone = (p: string | null): string => {
  if (!p) return "—";
  let d = p.replace(/\D/g, "");
  if (d.length === 11 && d[0] === "1") d = d.slice(1);
  if (d.length !== 10) return p;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
};
const money = (v: number | null | undefined): string =>
  v === null || v === undefined ? "—" : "$" + v.toLocaleString("en-US");
const badge = (q: string | null | undefined): string => q === "HOT" ? "🔥 HOT" : (q ?? "—");

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="rounded-xl border border-navy-700 bg-navy-800 p-4">
      <div className={`text-2xl font-bold ${accent ?? "text-white"}`}>{value}</div>
      <div className="mt-1 text-xs uppercase tracking-wide text-gray-500">{label}</div>
    </div>
  );
}

// --- Today tab --------------------------------------------------------------
function TodayTab({ overview, onLogCall }: { overview: OperationsOverview; onLogCall: (lead: LogCallLead) => void }) {
  const hot = overview.queue.find((q) => q.queue === "HOT")?.count ?? 0;
  return (
    <div className="space-y-6">
      {/* summary stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Needs approval" value={overview.needsApprovalCount} accent={overview.needsApprovalCount > 0 ? "text-gold-400" : "text-gray-500"} />
        <Stat label="Call now" value={overview.callNowCount} accent="text-white" />
        <Stat label="Due follow-ups" value={overview.dueFollowUps.length} accent="text-white" />
        <Stat label="Attention" value={overview.attention.length} accent={overview.attention.some((a) => a.severity === "critical") ? "text-red-400" : "text-white"} />
        <Stat label="Trace gaps" value={overview.traceGaps.count} accent="text-white" />
        <Stat label="Hot leads" value={hot} accent="text-red-400" />
      </div>

      {/* 1. Needs approval */}
      <section className="rounded-xl border border-navy-700 bg-navy-900 p-5">
        <h2 className="text-lg font-semibold text-white">Needs your approval</h2>
        <p className="mt-1 text-sm text-gray-500">
          Pending offer / contract / assignment / spend / campaign decisions. 0 = nothing awaiting you right now.
        </p>
        {overview.needsApproval.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">0 pending approvals — nothing to decide.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {overview.needsApproval.map((a) => (
              <li key={a.id} className="flex items-center justify-between rounded-lg border border-gold-500/30 bg-gold-500/5 px-3 py-2 text-sm">
                <div>
                  <span className="font-semibold text-gold-300">{a.kind}</span>
                  <span className="ml-2 text-gray-400">{a.refLabel ?? a.refId}</span>
                  {a.amountCents != null && <span className="ml-2 text-white">{(a.amountCents / 100).toFixed(2)}</span>}
                </div>
                <a href="/approvals" className="text-gold-400 hover:underline">Review →</a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 2. Call now */}
      <section className="rounded-xl border border-navy-700 bg-navy-900 p-5">
        <h2 className="text-lg font-semibold text-white">Call now — manual owner calls</h2>
        <p className="mt-1 text-sm text-gray-500">
          Top-priority leads with traceable phone numbers. Voice = your call; no dialer (closed, zero-spend). Verify on call; honor any verbal opt-out.
        </p>
        {overview.callNow.filter((c) => c.callable && !c.suppressed).length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">No callable leads in the top queue right now.</p>
        ) : (
          <ul className="mt-3 divide-y divide-navy-700">
            {overview.callNow
              .filter((c) => c.callable && !c.suppressed)
              .map((c) => (
                <li key={c.id} className="py-3">
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-white">
                      {c.rank}. {c.full_name}
                      <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] font-semibold ${queueStyles[c.priority_queue] ?? "bg-navy-700 text-gray-400"}`}>
                        {badge(c.priority_queue)}
                      </span>
                      {c.premium && <span className="ml-1 text-xs text-gold-400">premium</span>}
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm text-gold-300">📞 {fmtPhone(c.phone)}</div>
                      {c.email && <div className="text-xs text-gray-500">{c.email}</div>}
                    </div>
                  </div>
                  <div className="mt-1 text-sm text-gray-400">
                    {c.property_address}, {c.property_city} · score {c.score ?? "—"}/10 · {c.outreach_status}
                    {c.score_factors?.equity != null && <> · est. equity {money(c.score_factors.equity)}</>}
                    {c.next_action && <> · next: {c.next_action}</>}
                  </div>
                  <div className="mt-2">
                    <button
                      onClick={() => onLogCall({ id: c.id, full_name: c.full_name, phone: c.phone, property_address: c.property_address, property_city: c.property_city })}
                      className="rounded-lg border border-gold-500/50 px-3 py-1.5 text-xs font-semibold text-gold-400 transition-colors hover:bg-gold-500 hover:text-navy-900"
                    >
                      📞 Log call outcome
                    </button>
                  </div>
                </li>
              ))}
          </ul>
        )}
      </section>

      {/* 2b. Due follow-ups */}
      {overview.dueFollowUps.length > 0 && (
        <section className="rounded-xl border border-navy-700 bg-navy-900 p-5">
          <h2 className="text-lg font-semibold text-white">Follow-ups due today</h2>
          <ul className="mt-3 divide-y divide-navy-700">
            {overview.dueFollowUps.map((c) => (
              <li key={c.id} className="py-3 text-sm">
                <div className="flex items-center justify-between">
                  <div className="font-medium text-white">{c.full_name}</div>
                  <button
                    onClick={() => onLogCall({ id: c.id, full_name: c.full_name, phone: c.phone, property_address: c.property_address, property_city: c.property_city })}
                    className="rounded-lg border border-gold-500/50 px-3 py-1.5 text-xs font-semibold text-gold-400 transition-colors hover:bg-gold-500 hover:text-navy-900"
                  >
                    📞 Log call outcome
                  </button>
                </div>
                <div className="text-gray-400">
                  {c.property_address} · {fmtPhone(c.phone)} · {c.next_action ?? "follow up"}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 3. Attention items */}
      <section className="rounded-xl border border-navy-700 bg-navy-900 p-5">
        <h2 className="text-lg font-semibold text-white">Attention items</h2>
        {overview.attention.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">Nothing flagged right now.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {overview.attention.map((a, i) => (
              <li key={i} className={`rounded-lg border px-3 py-2 text-sm ${sevStyles[a.severity]}`}>
                <div className="flex items-center gap-2 font-medium">
                  <span className={`inline-block h-2 w-2 rounded-full ${sevDot[a.severity]}`} />
                  {a.title}
                </div>
                {a.detail && <p className="mt-1 text-xs opacity-90">{a.detail}</p>}
                {a.action && <a href={a.action.href} className="mt-1 inline-block text-xs underline">{a.action.label}</a>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 4. Trace gaps */}
      <section className="rounded-xl border border-navy-700 bg-navy-900 p-5">
        <h2 className="text-lg font-semibold text-white">Trace gaps — TRACED but no usable phone</h2>
        <p className="mt-1 text-sm text-gray-500">
          {overview.traceGaps.count} lead{overview.traceGaps.count === 1 ? "" : "s"} know a trace ran but are not callable (e.g. DNC-only). These are honest non-contactable rows — resolve the phone or leave as-is.
        </p>
        {overview.traceGaps.count > 0 && (
          <ul className="mt-3 space-y-1 text-sm text-gray-400">
            {overview.traceGaps.leads.slice(0, 8).map((l, i) => (
              <li key={i}>• {l.full_name} — {l.property_address}{l.dnc_flag ? ` (${l.dnc_flag})` : ""}</li>
            ))}
            {overview.traceGaps.count > 8 && <li className="text-xs text-gray-500">…and {overview.traceGaps.count - 8} more</li>}
          </ul>
        )}
      </section>
    </div>
  );
}

// --- Call list tab ----------------------------------------------------------
function CallListTab({ list, onRegenerate, busy, onLogCall }: { list: Top25CallList; onRegenerate: () => void; busy: boolean; onLogCall: (lead: LogCallLead) => void }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Smart Top-25 Manual Call List</h2>
          <p className="mt-1 text-sm text-gray-500">
            Generated {new Date(list.generatedAt).toLocaleString()}. {list.count} leads · {list.withPhone} with phone · {list.contactable} contactable · {list.complianceClean} DNC-clean.
          </p>
        </div>
        <button
          onClick={onRegenerate}
          disabled={busy}
          className="rounded-lg bg-gold-500 px-4 py-2 text-sm font-semibold text-navy-900 transition-colors hover:bg-gold-400 disabled:opacity-50"
        >
          {busy ? "Regenerating…" : "Regenerate (refresh priorities)"}
        </button>
      </div>

      {/* copy-and-paste markdown */}
      <details className="rounded-xl border border-navy-700 bg-navy-900 p-4">
        <summary className="cursor-pointer text-sm font-medium text-gold-400">Copy as Markdown (same format you already use)</summary>
        <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-navy-950 p-3 text-xs text-gray-300">{list.markdown}</pre>
      </details>

      <div className="space-y-3">
        {list.entries.map((x) => (
          <div key={x.id} className="rounded-xl border border-navy-700 bg-navy-900 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-medium text-white">
                  {x.rank}. {x.full_name}
                  <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] font-semibold ${queueStyles[x.priority_queue] ?? "bg-navy-700 text-gray-400"}`}>
                    {badge(x.priority_queue)}
                  </span>
                  {x.premium_lead && <span className="ml-1 text-xs text-gold-400">⚠️ premium</span>}
                </div>
                <div className="mt-0.5 text-sm text-gray-400">
                  {x.property_address}, {x.property_city}, {x.property_state} {x.property_zip} · APN {x.apn ?? "—"}
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-sm text-gold-300">📞 {fmtPhone(x.phone)}</div>
                {x.email && <div className="text-xs text-gray-500">{x.email}</div>}
              </div>
            </div>
            <div className="mt-2 grid gap-1 text-xs text-gray-400 sm:grid-cols-2">
              <div>Score <span className="text-white">{x.score ?? "—"}/10</span> · {x.outreach_status}· est. equity <span className="text-white">{money(x.score_factors?.equity ?? null)}</span></div>
              <div>Est. MAO <span className="text-white">{money(x.score_factors?.estimated_mao ?? null)}</span> · trace {x.trace_status ?? "—"} ({x.traced_at ? x.traced_at.slice(0, 10) : "—"})</div>
            </div>
            <div
              className={`mt-2 inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium ${
                x.compliance.clean && x.compliance.contactable ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
              }`}
            >
              {x.compliance.clean && x.compliance.contactable
                ? "✓ DNC-clean · contactable — callable"
                : "⚠ " + (x.compliance.clean ? "" : "suppressed / ") + (!x.compliance.contactable ? "not contactable" : "")}
            </div>
            {x.compliance.clean && (
              <p className="mt-2 text-xs text-gray-500">
                <span className="text-gray-400">Next action:</span> Call {fmtPhone(x.phone)}. Use the talking point (below); confirm situation + tax status; log outcome + any opt-out in the CRM.
              </p>
            )}
            <div className="mt-3">
              <button
                onClick={() => onLogCall({ id: x.id, full_name: x.full_name, phone: x.phone, property_address: x.property_address, property_city: x.property_city })}
                className="rounded-lg border border-gold-500/50 px-3 py-1.5 text-xs font-semibold text-gold-400 transition-colors hover:bg-gold-500 hover:text-navy-900"
              >
                📞 Log call outcome
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- page -------------------------------------------------------------------
function OperationsPage() {
  const [tab, setTab] = useState<"today" | "call">("today");
  const [overview, setOverview] = useState<OperationsOverview | null>(null);
  const [list, setList] = useState<Top25CallList | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [logLead, setLogLead] = useState<LogCallLead | null>(null);

  const load = useCallback(async () => {
    const [o, t] = await Promise.all([fetchOverview(), fetchTop25()]);
    setOverview(o);
    setList(t);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRegenerate = async () => {
    setBusy(true);
    try {
      const next = await regenerateTop25();
      if (next) setList(next);
    } finally {
      setBusy(false);
    }
  };

  // D2: submit a call outcome; on success close the modal + refresh the screen
  // so the lead's new status / priority / follow-up is reflected immediately.
  const handleLogCall: LogCallSubmit = async (leadId, input) => {
    const res = await logCallOutcomeFn({ data: { leadId, input } });
    if (res?.success) {
      setLogLead(null);
      load();
    }
    return res;
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12 text-center text-gray-400">
        <p className="text-xl">Loading your operating screen…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Operations — what needs you today</h1>
        <p className="mt-1 text-sm text-gray-500">Composed live from the CRM. Every number traces to a real row; empty means zero.</p>
      </div>

      <div className="mb-6 flex gap-2 border-b border-navy-700">
        {(["today", "call"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === t ? "border-gold-500 text-gold-400" : "border-transparent text-gray-400 hover:text-white"
            }`}
          >
            {t === "today" ? "Today" : "Top-25 Call List"}
          </button>
        ))}
      </div>

      {tab === "today" ? (
        overview ? (
          <TodayTab overview={overview} onLogCall={setLogLead} />
        ) : (
          <p className="text-sm text-gray-500">Could not load the operations overview.</p>
        )
      ) : list ? (
        <CallListTab list={list} onRegenerate={handleRegenerate} busy={busy} onLogCall={setLogLead} />
      ) : (
        <p className="text-sm text-gray-500">Could not load the call list.</p>
      )}

      {logLead && (
        <LogCallOutcomeModal
          lead={logLead}
          onSubmit={handleLogCall}
          onClose={() => setLogLead(null)}
        />
      )}
    </div>
  );
}

function RouteComponent() {
  return (
    <OwnerGate>
      <OperationsPage />
    </OwnerGate>
  );
}

export const Route = createFileRoute("/operations")({
  component: RouteComponent,
});
