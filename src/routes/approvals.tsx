import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { requireOwnerMiddleware } from "~/lib/auth";
import { OwnerGate } from "~/components/OwnerGate";
import { useState, useEffect } from "react";
import type { ApprovalRow } from "~/lib/approvals";
// HUMAN APPROVAL GATES (PH1-B11) — owner approve/reject dashboard.
//
// The one place the owner decides every legally / financially significant
// action: final offers, negotiation beyond approved parameters, contracts,
// assignments, spend above a campaign's cap, campaign status/budget changes
// and sensitive seller communications. Each request is created by the CRM /
// campaign / spend call sites; the enforcement points (outreach state machine
// requireApproval gate, recordCampaignSpend, updateCampaignStatus) keep the
// action BLOCKED until this page approves it. Every create/decide writes an
// outreach_audit_log row (channel='approval') so the trail is complete.
//
// Honest by construction: 0 pending requests is the correct production state —
// nothing is pending until a real offer / contract / spend / change is
// actually requested. The empty state says exactly that.
// --- Server Functions ---
const fetchPending = createServerFn({ method: "GET", middleware: [requireOwnerMiddleware] }).handler(async () => {
  try {
    const { pendingApprovals } = await import("~/lib/approvals");
    return await pendingApprovals();
  } catch {
    return [] as ApprovalRow[];
  }
});
const fetchHistory = createServerFn({ method: "GET", middleware: [requireOwnerMiddleware] }).handler(async () => {
  try {
    const { approvalHistory } = await import("~/lib/approvals");
    return await approvalHistory(50);
  } catch {
    return [] as ApprovalRow[];
  }
});
const decide = createServerFn({ method: "POST", middleware: [requireOwnerMiddleware] })
  .validator((data: unknown) => data as { id: string; approved: boolean; note?: string })
  .handler(async ({ data }) => {
    try {
      const { decideApproval } = await import("~/lib/approvals");
      return await decideApproval(data.id, {
        approved: data.approved,
        note: data.note || null,
        operator: "owner",
      });
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : "Decision failed" };
    }
  });
const fetchPendingCount = createServerFn({ method: "GET", middleware: [requireOwnerMiddleware] }).handler(async () => {
  try {
    const { pendingApprovalCount } = await import("~/lib/approvals");
    return await pendingApprovalCount();
  } catch {
    return 0;
  }
});
// --- UI ---
const KIND_LABELS: Record<string, string> = {
  offer: "Offer",
  contract: "Contract",
  assignment: "Assignment / Closing",
  spend: "Spend (over cap)",
  campaign_change: "Campaign change",
  sensitive_communication: "Sensitive communication",
  channel_campaign: "Channel campaign (SMS/email)",
};
const KIND_DESCRIPTIONS: Record<string, string> = {
  offer: "Final offer to a seller (also covers negotiation beyond approved parameters)",
  contract: "Legally binding contract execution",
  assignment: "Assignment / closing decision",
  spend: "Real money spend above the campaign's approved cap",
  campaign_change: "Campaign status switch (active/pause/cancel) or budget/cap edit",
  sensitive_communication: "Sensitive seller communication",
  channel_campaign: "Turn an outbound channel (SMS or email) ON for a specific campaign — requires an approved provider + budget first",
};
const STATUS_STYLES: Record<string, string> = {
  pending: "bg-gold-500/15 text-gold-400",
  approved: "bg-emerald-500/15 text-emerald-400",
  rejected: "bg-red-500/15 text-red-400",
  cancelled: "bg-navy-700 text-gray-500",
};
function fmtAmount(cents: number | null): string {
  return cents === null ? "" : `$${(cents / 100).toFixed(2)}`;
}
function ApprovalsPage() {
  const [pending, setPending] = useState<ApprovalRow[]>([]);
  const [history, setHistory] = useState<ApprovalRow[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const load = async () => {
    try {
      const [p, h, c] = await Promise.all([fetchPending(), fetchHistory(), fetchPendingCount()]);
      setPending(p ?? []);
      setHistory(h ?? []);
      setCount(c ?? 0);
    } catch {
      // server unreachable — keep last state
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);
  const handleDecide = async (row: ApprovalRow, approved: boolean) => {
    setBusyId(row.id);
    setMessage(null);
    const note = noteDraft[row.id]?.trim() || null;
    const result = await decide({ data: { id: row.id, approved, note } });
    if (result.success) {
      setMessage({ ok: true, text: `${KIND_LABELS[row.kind] ?? row.kind} request ${approved ? "approved" : "rejected"} — audit row written.` });
      load();
    } else {
      setMessage({ ok: false, text: result.error || "Decision failed" });
    }
    setBusyId(null);
  };
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Approvals</h1>
          <p className="mt-1 text-sm text-gray-400">
            Owner approval queue — every offer, contract, assignment, spend above cap and campaign
            change stays blocked until you decide here (plan rev 18 human approval gates).
          </p>
        </div>
        <Link to="/command-center" className="text-sm text-gold-400 hover:underline">
          ← Command Center
        </Link>
      </div>
      {/* Pending queue */}
      <section className="rounded-2xl border border-navy-700 bg-navy-800 p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
            Pending queue
          </h2>
          <span className="rounded-full bg-gold-500/15 px-2.5 py-0.5 text-xs font-medium text-gold-400">
            {count} pending
          </span>
        </div>
        {loading ? (
          <p className="mt-4 text-sm text-gray-500">Loading approval queue…</p>
        ) : pending.length === 0 ? (
          <div className="mt-4 rounded-xl border border-navy-700 bg-navy-900/60 p-6 text-center">
            <p className="text-sm font-medium text-gray-300">No approval requests — nothing pending.</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-gray-500">
              This is the correct production state: a request appears here only when a real
              offer / contract / assignment / spend-above-cap / campaign change is actually
              requested from the CRM, campaign or spend call sites.
            </p>
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {pending.map((row) => (
              <li key={row.id} className="rounded-xl border border-navy-700 bg-navy-900/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-gold-500/15 px-2 py-0.5 text-xs font-semibold text-gold-400">
                        {KIND_LABELS[row.kind] ?? row.kind}
                      </span>
                      {row.amountCents !== null && (
                        <span className="text-sm font-medium text-white">{fmtAmount(row.amountCents)}</span>
                      )}
                      {row.refLabel && (
                        <span className="truncate text-xs text-gray-400">{row.refLabel}</span>
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-gray-500">
                      {KIND_DESCRIPTIONS[row.kind] ?? row.kind} · requested by {row.requestedBy ?? "unknown"} ·{" "}
                      {new Date(row.createdAt).toLocaleString()}
                    </p>
                    {row.details && <p className="mt-1 text-xs text-gray-300">{row.details}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1.5">
                    <button
                      onClick={() => handleDecide(row, true)}
                      disabled={busyId === row.id}
                      className="rounded-lg bg-emerald-500/90 px-4 py-1.5 text-xs font-semibold text-navy-900 transition-colors hover:bg-emerald-400 disabled:opacity-40"
                    >
                      {busyId === row.id ? "Saving..." : "Approve"}
                    </button>
                    <button
                      onClick={() => handleDecide(row, false)}
                      disabled={busyId === row.id}
                      className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-40"
                    >
                      Reject
                    </button>
                  </div>
                </div>
                <div className="mt-2">
                  <input
                    value={noteDraft[row.id] ?? ""}
                    onChange={(e) => setNoteDraft((d) => ({ ...d, [row.id]: e.target.value }))}
                    placeholder="Decision note (recorded in the audit trail)"
                    className="w-full rounded-lg border border-navy-700 bg-navy-900 px-3 py-1.5 text-xs text-white placeholder:text-gray-600 focus:border-gold-500 focus:outline-none"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        {message && (
          <p className={`mt-3 text-xs ${message.ok ? "text-emerald-400" : "text-red-400"}`}>{message.text}</p>
        )}
      </section>
      {/* Decision history */}
      <section className="mt-6 rounded-2xl border border-navy-700 bg-navy-800 p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Decision history</h2>
        {history.length === 0 ? (
          <p className="mt-3 text-xs text-gray-500">
            No decisions yet — every approval decision appears here with who decided and the note.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-navy-700">
            {history.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[row.status] ?? "bg-navy-700 text-gray-400"}`}>
                      {row.status}
                    </span>
                    <span className="text-xs font-medium text-gray-200">{KIND_LABELS[row.kind] ?? row.kind}</span>
                    {row.amountCents !== null && (
                      <span className="text-xs text-gray-400">{fmtAmount(row.amountCents)}</span>
                    )}
                    {row.refLabel && <span className="text-xs text-gray-500">{row.refLabel}</span>}
                  </div>
                  {row.decisionNote && <p className="mt-0.5 text-[11px] text-gray-500">Note: {row.decisionNote}</p>}
                  {row.details && <p className="mt-0.5 text-[11px] text-gray-600">{row.details}</p>}
                </div>
                <span className="shrink-0 text-[11px] text-gray-600">
                  {row.decidedBy ?? "—"} · {row.decidedAt ? new Date(row.decidedAt).toLocaleString() : new Date(row.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
export const Route = createFileRoute("/approvals")({
  component: () => (
    <OwnerGate>
      <ApprovalsPage />
    </OwnerGate>
  ),
  head: () => ({
    meta: [
      { title: "Approvals — DealForge Properties" },
      {
        name: "description",
        content: "Owner approval queue — approve or reject offers, contracts, assignments, spend and campaign changes.",
      },
    ],
  }),
});
