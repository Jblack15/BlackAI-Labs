// DealFlow AI — Channel Activation (Step 11): the owner-gated OPTION for
// SMS / email outreach. NOT a sender.
//
// The owner asked for "text and email all leads in the queue — as an option".
// This page shows that option in its honest current state: BOTH channels are
// OFF / NOT CONFIGURED and every Activate control is visibly disabled until:
//   1. the owner approves a compliant provider + budget (zero-spend mode today
//      means no provider, no budget, no sends — ever),
//   2. provider credentials are actually configured (env: SMS_PROVIDER for
//      SMS, SMTP_HOST/USER/PASS for email),
//   3. the owner approves a per-campaign channel approval from /approvals
//      (kind = 'channel_campaign' — the SAME approval store as offers/contracts).
// Only then does the fail-closed gate lib (src/lib/channel-gates.ts,
// assertChannelSendAllowed) permit a future send path for compliant leads.
// No SMS/SMTP provider integration exists in this build — that is a later,
// budget-approved step. This is the GATE + honest UI.
//
// Owner-gated exactly like /operations: every server fn carries
// requireOwnerMiddleware; the UI is wrapped in OwnerGate.
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { requireOwnerMiddleware } from "~/lib/auth";
import { OwnerGate } from "~/components/OwnerGate";
import type { ChannelsOverview, ChannelStatus } from "~/lib/channel-gates";

const fetchOverview = createServerFn({ method: "GET", middleware: [requireOwnerMiddleware] }).handler(async () => {
  try {
    const { getChannelsOverview } = await import("~/lib/channel-gates");
    return await getChannelsOverview();
  } catch {
    return null;
  }
});

// --- card -------------------------------------------------------------------
function ChannelCard({ ch }: { ch: ChannelStatus }) {
  const off = !ch.configured;
  return (
    <section className="flex flex-col rounded-xl border border-navy-700 bg-navy-900 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-white">{ch.label}</h2>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${
            off ? "bg-red-500/15 text-red-400" : "bg-gold-500/15 text-gold-400"
          }`}
        >
          {off ? "● OFF" : "NOT CONFIGURED"}
        </span>
      </div>
      <p className="mt-2 text-sm text-gray-400">
        {ch.provider === null ? (
          <>
            No provider connected — missing{" "}
            <code className="rounded bg-navy-800 px-1.5 py-0.5 text-xs text-gold-300">{ch.missing.join(", ")}</code>{" "}
            (zero-spend mode; no approved provider).
          </>
        ) : (
          <>Provider configured ({ch.provider}) — see owner approval gate below.</>
        )}
      </p>
      {/* Step-11 block: COST → EXPECTED BENEFIT → REQUIRED BUDGET → OWNER APPROVAL */}
      <div className="mt-4 grid gap-2 rounded-lg border border-navy-700 bg-navy-800 p-4 text-sm">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gold-400">Cost</div>
          <div className="mt-0.5 text-gray-300">{ch.step11.cost}</div>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gold-400">Expected benefit</div>
          <div className="mt-0.5 text-gray-300">{ch.step11.benefit}</div>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gold-400">Required budget</div>
          <div className="mt-0.5 text-gray-300">{ch.step11.requiredBudget}</div>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gold-400">Owner approval</div>
          <div className="mt-0.5 text-gray-300">{ch.step11.approval}</div>
        </div>
      </div>
      {/* Activate control — visibly disabled with the honest reason */}
      <div className="mt-4">
        <button
          disabled
          title={ch.activateReason}
          className="w-full cursor-not-allowed rounded-lg border border-navy-700 bg-navy-800 px-4 py-2.5 text-sm font-semibold text-gray-600"
        >
          Activate {ch.label} … (disabled)
        </button>
        <p className="mt-2 text-xs leading-relaxed text-gray-500">{ch.activateReason}</p>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
        <span>
          Owner-approved campaigns: <span className="font-semibold text-white">{ch.approvedCampaigns}</span>
        </span>
        <span>
          Gate: <code className="text-gold-300">assertChannelSendAllowed("{ch.channel}", lead)</code>
        </span>
      </div>
    </section>
  );
}

const UNLOCK_STEPS = [
  ["1", "Approve a compliant provider + budget", "Owner decision (outside the app). Zero-spend mode means no provider and no budget today — nothing is approved."],
  ["2", "Configure the credentials", 'Ops sets env: SMS_PROVIDER for SMS, or SMTP_HOST + SMTP_USER + SMTP_PASS for email. Today: absent.'],
  ["3", "Approve the campaign channel in /approvals", "Request a channel_campaign approval for the campaign (or reuse one); the owner approves it. That approval IS the per-campaign ON toggle."],
  ["4", "Future send path calls the gate", "A later, budget-approved build may wire a provider; every send must first pass assertChannelSendAllowed, which also hard-checks each lead's DNC / opt-out / suppression."],
];

// --- page -------------------------------------------------------------------
function ChannelsPage() {
  const [overview, setOverview] = useState<ChannelsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetchOverview().then((o) => {
      setOverview(o);
      setLoading(false);
    });
  }, []);
  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12 text-center text-gray-400">
        <p className="text-xl">Loading channel status…</p>
      </div>
    );
  }
  if (!overview) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12 text-center text-gray-400">
        <p className="text-xl">Could not load channel status.</p>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Channels — the gated option</h1>
        <p className="mt-1 text-sm text-gray-500">
          "Text and email all leads in the queue" — as an owner-approved option. Nothing here can send. Each channel
          stays dark until a provider, budget, and per-campaign owner approval all exist.
        </p>
      </div>
      {/* honest current-state dashboard summary */}
      <div className="mb-6 rounded-xl border border-navy-700 bg-navy-800 p-4 text-sm">
        <span className="font-semibold text-gold-400">Current state · </span>
        <span className="text-gray-300">{overview.summary}</span>
        <div className="mt-2 text-xs text-gray-500">
          Verified live: {overview.sms.provider === null ? "SMS_PROVIDER absent" : "SMS provider set"} ·{" "}
          {overview.email.provider === null ? "SMTP absent" : "SMTP set"} · approved channel campaigns:{" "}
          {overview.sms.approvedCampaigns + overview.email.approvedCampaigns} · gate = {overview.gateFunction}()
        </div>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <ChannelCard ch={overview.sms} />
        <ChannelCard ch={overview.email} />
      </div>
      {/* how the owner unlocks a channel later */}
      <section className="mt-6 rounded-xl border border-navy-700 bg-navy-900 p-5">
        <h2 className="text-lg font-semibold text-white">How a channel is unlocked (exact steps)</h2>
        <ol className="mt-3 space-y-3">
          {UNLOCK_STEPS.map(([n, title, body]) => (
            <li key={n} className="flex gap-3 text-sm">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gold-500/15 text-xs font-bold text-gold-400">
                {n}
              </span>
              <div>
                <div className="font-semibold text-gray-200">{title}</div>
                <div className="mt-0.5 text-gray-500">{body}</div>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-4 border-t border-navy-700 pt-3 text-xs text-gray-500">
          Compliance is never optional: even with all gates open, <code className="text-gold-300">assertChannelSendAllowed</code>{" "}
          refuses any lead with a DNC flag / opt-out / invalid contact / wrong number before a send can happen. No
          autonomous outbound exists today — voice stays manual owner calls (9a–6p CT).
        </p>
      </section>
    </div>
  );
}

function RouteComponent() {
  return (
    <OwnerGate>
      <ChannelsPage />
    </OwnerGate>
  );
}

export const Route = createFileRoute("/channels")({
  component: RouteComponent,
});