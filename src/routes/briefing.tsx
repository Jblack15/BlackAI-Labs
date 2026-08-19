import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { requireOwnerMiddleware } from "~/lib/auth";
import { OwnerGate } from "~/components/OwnerGate";
import { useState, useEffect, useCallback } from "react";
import type { DailyBriefing } from "~/lib/daily-briefing";

const fetchBriefing = createServerFn({
  method: "GET",
  middleware: [requireOwnerMiddleware],
}).handler(async (): Promise<DailyBriefing | null> => {
  try {
    const { getLatestBriefing } = await import("~/lib/daily-briefing");
    return await getLatestBriefing();
  } catch {
    return null;
  }
});

const regenerateBriefing = createServerFn({
  method: "POST",
  middleware: [requireOwnerMiddleware],
}).handler(async (): Promise<DailyBriefing | null> => {
  try {
    const { generateDailyBriefing } = await import("~/lib/daily-briefing");
    return await generateDailyBriefing();
  } catch {
    return null;
  }
});

function BriefingPage() {
  const [briefing, setBriefing] = useState<DailyBriefing | null | "none">("none");
  const [generating, setGenerating] = useState(false);

  const load = useCallback(() => {
    fetchBriefing().then((b) => setBriefing(b ?? "none"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const regen = async () => {
    setGenerating(true);
    try {
      const b = await regenerateBriefing();
      setBriefing(b ?? "none");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Daily Autopilot Briefing</h1>
          <p className="mt-1 text-sm text-gray-400">
            The one-minute read for today. Generated from REAL data — every number traces to a live table.
          </p>
        </div>
        <Link to="/performance" className="rounded-lg bg-gold-500 px-4 py-2 text-sm font-semibold text-navy-900 hover:bg-gold-400">
          ← Performance Dashboard
        </Link>
      </div>

      <div className="rounded-xl border border-navy-700 bg-navy-900 p-5">
        {briefing === "none" ? (
          <div className="py-6 text-center">
            <p className="text-sm text-gray-400">No briefing has been generated yet.</p>
            <button
              onClick={regen}
              disabled={generating}
              className="mt-4 rounded-lg bg-gold-500 px-5 py-2.5 text-sm font-semibold text-navy-900 hover:bg-gold-400 disabled:opacity-50"
            >
              {generating ? "Generating…" : "Generate briefing now"}
            </button>
          </div>
        ) : briefing !== null ? (
          <>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">Briefing #{briefing.id}</h2>
                <p className="text-xs text-gray-500">Generated {String(briefing.generatedAt).slice(0, 16).replace("T", " ")} UTC</p>
              </div>
              <button
                onClick={regen}
                disabled={generating}
                className="rounded-lg bg-gold-500 px-4 py-2 text-sm font-semibold text-navy-900 hover:bg-gold-400 disabled:opacity-50"
              >
                {generating ? "Regenerating…" : "Regenerate briefing"}
              </button>
            </div>

            <div className="mt-4 rounded-lg border border-navy-700 bg-navy-800 p-4 font-mono text-sm leading-6 text-gray-200 whitespace-pre-wrap">
              {briefing.summary}
            </div>

            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-medium text-gold-400">Full data snapshot</summary>
              <pre className="mt-2 max-h-96 overflow-auto rounded-lg border border-navy-700 bg-navy-950 p-4 text-xs text-gray-400">
                {JSON.stringify(briefing.data, null, 2)}
              </pre>
            </details>
          </>
        ) : null}
      </div>

      <div className="mt-6 rounded-xl border border-navy-700 bg-navy-900 p-5 text-sm text-gray-500">
        <div className="font-medium text-white">About scheduling</div>
        <p className="mt-1">
          This briefing is generated and refreshed on demand — there is no scheduler wired into the platform yet, so it does not run by itself.
          When the platform plan supports scheduled tasks, the same <code className="text-gold-400">generateDailyBriefing()</code> unit runs automatically
          each morning. No autonomous heartbeat, no self-hosted timers.
        </p>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/briefing")({
  component: () => (
    <OwnerGate>
      <BriefingPage />
    </OwnerGate>
  ),
});
