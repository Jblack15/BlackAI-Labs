import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useCallback } from "react";

/* ── Sample estimate text ────────────────────────────────────────── */
const SAMPLE_ESTIMATE = `R&I Front Bumper Assembly - 2.5 hrs
Replace Left Fender (OEM) - 3.0 hrs
Feather/Block & Prime Left Fender - 1.5 hrs
Blend Left Front Door - 2.0 hrs
Clear Coat Application - 1.0 hr`;

/* ── Server function (mock AI) ───────────────────────────────────── */
const explainEstimate = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (typeof data !== "object" || data === null || !("estimate" in data)) {
      throw new Error("Estimate text is required");
    }
    const { estimate } = data as { estimate: string };
    if (!estimate || !estimate.trim()) {
      throw new Error("Estimate text is required");
    }
    return { estimate: estimate.trim() };
  })
  .handler(async ({ data }) => {
    // TODO: Wire real AI API call here — replace the mock response below
    // with an actual LLM call that translates the estimate into plain English.
    // The input estimate text is available at `data.estimate`.

    // Simulate AI processing delay
    await new Promise((r) => setTimeout(r, 1200));

    // Parse total hours from the estimate text
    const hourMatches = data.estimate.matchAll(/([\d.]+)\s*(hrs?|hours?)/gi);
    let totalHours = 0;
    for (const m of hourMatches) {
      totalHours += parseFloat(m[1]);
    }

    return {
      summary:
        "Your vehicle needs front-end body work after the collision. We'll remove the damaged parts, replace what's needed, and repaint the affected areas to match your car's original finish.",
      breakdown: [
        {
          item: "Remove & inspect front bumper",
          explanation:
            "We'll take off your front bumper to check for hidden damage behind it.",
          hours: 2.5,
        },
        {
          item: "Replace left fender",
          explanation:
            "The left front fender is damaged beyond repair and will be replaced with a genuine manufacturer part.",
          hours: 3.0,
        },
        {
          item: "Prep & prime new fender",
          explanation:
            "Before painting, we smooth and prime the new fender so the paint adheres perfectly.",
          hours: 1.5,
        },
        {
          item: "Paint-match left door",
          explanation:
            "To ensure the new paint blends seamlessly, we extend the paint into the adjacent door.",
          hours: 2.0,
        },
        {
          item: "Clear coat finish",
          explanation:
            "A protective clear layer is applied for a glossy, durable finish that matches your car's original look.",
          hours: 1.0,
        },
      ],
      whyItMatters:
        "Each step in this estimate is essential for a safe, high-quality repair. Removing the bumper lets us inspect for hidden damage that could compromise safety. Using OEM (genuine manufacturer) parts ensures a perfect fit and maintains your vehicle's value. The multi-step painting process — primer, color, and clear coat — protects against rust and ensures the repair is invisible.",
      totalHours,
    };
  });

/* ── Page route ──────────────────────────────────────────────────── */
export const Route = createFileRoute("/dashboard/estimate-explainer")({
  component: EstimateExplainerPage,
});

/* ── Types ───────────────────────────────────────────────────────── */
type Status = "idle" | "loading" | "success" | "error";

interface ExplanationResult {
  summary: string;
  breakdown: {
    item: string;
    explanation: string;
    hours: number;
  }[];
  whyItMatters: string;
  totalHours: number;
}

/* ── Page component ──────────────────────────────────────────────── */
function EstimateExplainerPage() {
  const [estimate, setEstimate] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<ExplanationResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [copied, setCopied] = useState(false);

  const handleExplain = useCallback(async () => {
    if (!estimate.trim()) return;
    setStatus("loading");
    setErrorMsg("");
    setCopied(false);

    try {
      const data = await explainEstimate({ data: { estimate } });
      setResult(data);
      setStatus("success");
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(err?.message || "Something went wrong. Please try again.");
    }
  }, [estimate]);

  const handleSample = useCallback(() => {
    setEstimate(SAMPLE_ESTIMATE);
    setStatus("idle");
    setResult(null);
    setErrorMsg("");
  }, []);

  const handleCopy = useCallback(async () => {
    if (!result) return;
    const breakdownText = result.breakdown
      .map(
        (b) =>
          `- **${b.item}:** ${b.explanation} (${b.hours} ${b.hours === 1 ? "hour" : "hours"})`,
      )
      .join("\n");

    const text = `### What we're doing
${result.summary}

### Breakdown
${breakdownText}

### Why it matters
${result.whyItMatters}

### Total labor: ${result.totalHours} ${result.totalHours === 1 ? "hour" : "hours"}`;

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [result]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/Cmd+Enter to trigger explain
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleExplain();
    }
  };

  const isEmpty = !estimate.trim();
  const isLoading = status === "loading";

  return (
    <div className="flex flex-col lg:flex-row gap-6 h-full">
      {/* ── Left column: Input ─────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-white sm:text-2xl">
            Paste an Estimate
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Paste any repair estimate below and we'll translate it into plain
            English your customers will understand.
          </p>
        </div>

        {/* Textarea */}
        <textarea
          value={estimate}
          onChange={(e) => {
            setEstimate(e.target.value);
            if (status === "success" || status === "error") setStatus("idle");
          }}
          onKeyDown={handleKeyDown}
          placeholder={SAMPLE_ESTIMATE}
          rows={12}
          className="w-full flex-1 min-h-[300px] rounded-xl border border-slate-600 bg-slate-800 px-4 py-3.5 text-sm text-white placeholder-slate-500 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 resize-y font-mono leading-relaxed"
        />

        {/* Sample link */}
        <div className="mt-2">
          <button
            type="button"
            onClick={handleSample}
            className="text-sm text-orange-400 hover:text-orange-300 transition underline underline-offset-2"
          >
            Try with a sample estimate
          </button>
        </div>

        {/* Explain button */}
        <div className="mt-4">
          <button
            type="button"
            onClick={handleExplain}
            disabled={isEmpty || isLoading}
            title={isEmpty ? "Paste an estimate first" : undefined}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-orange-500 px-6 py-3.5 text-base font-semibold text-white shadow-lg shadow-orange-500/25 transition hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
          >
            {isLoading ? (
              <>
                <Spinner />
                Translating...
              </>
            ) : (
              "Explain This Estimate"
            )}
          </button>
        </div>

        {/* Error state */}
        {status === "error" && (
          <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
            <p className="text-sm text-red-400">{errorMsg}</p>
          </div>
        )}

        {/* Keyboard shortcut hint */}
        <p className="mt-2 text-xs text-slate-600">
          Tip: Press ⌘+Enter to explain
        </p>
      </div>

      {/* ── Right column: Output ────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="mb-4">
          <h2 className="text-xl font-bold text-white sm:text-2xl">
            Plain-English Explanation
          </h2>
        </div>

        {/* Empty state */}
        {status === "idle" && !result && (
          <div className="flex-1 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-800/30 p-10 text-center">
            <div className="text-5xl mb-4 opacity-40">📄</div>
            <p className="text-slate-400 text-sm max-w-xs">
              Your plain-English explanation will appear here
            </p>
          </div>
        )}

        {/* Loading skeleton */}
        {isLoading && (
          <div className="flex-1 rounded-xl border border-slate-700/50 bg-slate-800/30 p-6 space-y-5 animate-pulse">
            <div className="h-5 bg-slate-700 rounded w-2/3" />
            <div className="space-y-3">
              <div className="h-4 bg-slate-700 rounded w-full" />
              <div className="h-4 bg-slate-700 rounded w-5/6" />
              <div className="h-4 bg-slate-700 rounded w-4/6" />
            </div>
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="h-2 w-2 mt-2 rounded-full bg-slate-700 shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-4 bg-slate-700 rounded w-1/3" />
                    <div className="h-3 bg-slate-700 rounded w-4/5" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Success: explanation result */}
        {status === "success" && result && (
          <div className="flex-1 rounded-xl border border-slate-700/50 bg-slate-800/30 p-5 sm:p-6 overflow-y-auto">
            {/* What we're doing */}
            <h3 className="text-base font-bold text-white mb-2">
              What we're doing
            </h3>
            <p className="text-sm text-slate-300 leading-relaxed">
              {result.summary}
            </p>

            {/* Breakdown */}
            <h3 className="text-base font-bold text-white mt-6 mb-3">
              Breakdown
            </h3>
            <ul className="space-y-4">
              {result.breakdown.map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-orange-400 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {item.item}{" "}
                      <span className="font-normal text-slate-400">
                        ({item.hours} {item.hours === 1 ? "hour" : "hours"})
                      </span>
                    </p>
                    <p className="mt-0.5 text-sm text-slate-400 leading-relaxed">
                      {item.explanation}
                    </p>
                  </div>
                </li>
              ))}
            </ul>

            {/* Why it matters */}
            <h3 className="text-base font-bold text-white mt-6 mb-2">
              Why it matters
            </h3>
            <p className="text-sm text-slate-300 leading-relaxed">
              {result.whyItMatters}
            </p>

            {/* Total labor */}
            <div className="mt-6 pt-4 border-t border-slate-700">
              <p className="text-sm font-bold text-white">
                Total labor: {result.totalHours}{" "}
                {result.totalHours === 1 ? "hour" : "hours"}
              </p>
            </div>

            {/* Copy button */}
            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700 hover:border-slate-500 transition"
              >
                {copied ? (
                  <>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4 text-emerald-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    Copied!
                  </>
                ) : (
                  <>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                      />
                    </svg>
                    Copy explanation
                  </>
                )}
              </button>
            </div>

            {/* Disclaimer */}
            <p className="mt-4 text-xs text-slate-600 leading-relaxed">
              This explanation is AI-generated. A technician reviews all
              estimates before they're shared with customers.
            </p>
          </div>
        )}

        {/* Error: fallback empty state (shouldn't normally show here) */}
        {status === "error" && !result && (
          <div className="flex-1 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-800/30 p-10 text-center">
            <div className="text-5xl mb-4 opacity-40">⚠️</div>
            <p className="text-slate-400 text-sm max-w-xs">
              Something went wrong generating your explanation. Please try again.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Spinner component ───────────────────────────────────────────── */
function Spinner() {
  return (
    <svg
      className="h-5 w-5 animate-spin"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
