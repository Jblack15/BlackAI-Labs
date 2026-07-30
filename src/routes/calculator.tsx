import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useCallback, useMemo } from "react";

export const Route = createFileRoute("/calculator")({
  head: () => ({
    meta: [
      { title: "Deal Analysis Calculator — DealFlow AI" },
      {
        name: "description",
        content:
          "Calculate your maximum allowable offer, ROI, and deal profitability with our free real estate wholesaling calculator.",
      },
    ],
  }),
  component: Calculator,
});

// Format a number as USD with commas
function fmtDollar(val: number): string {
  if (!Number.isFinite(val)) return "$0";
  const abs = Math.abs(val);
  const s = abs.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return val < 0 ? `-$${s}` : `$${s}`;
}

// Format a number as percentage
function fmtPct(val: number): string {
  if (!Number.isFinite(val)) return "0.0%";
  return val.toFixed(1) + "%";
}

function Calculator() {
  // Inputs — stored as raw numeric strings for smooth editing
  const [arvRaw, setArvRaw] = useState("250000");
  const [repairsRaw, setRepairsRaw] = useState("35000");
  const [feeRaw, setFeeRaw] = useState("15000");
  const [closingPctRaw, setClosingPctRaw] = useState("2");
  const [closingOverride, setClosingOverride] = useState(false);
  const [closingManualRaw, setClosingManualRaw] = useState("");
  const [holdingRaw, setHoldingRaw] = useState("0");

  // Parse numbers
  const arv = parseFloat(arvRaw.replace(/,/g, "")) || 0;
  const repairs = parseFloat(repairsRaw.replace(/,/g, "")) || 0;
  const fee = parseFloat(feeRaw.replace(/,/g, "")) || 0;
  const holding = parseFloat(holdingRaw.replace(/,/g, "")) || 0;
  const closingPct = parseFloat(closingPctRaw) || 0;
  const closingManual = parseFloat(closingManualRaw.replace(/,/g, "")) || 0;
  const closing = closingOverride ? closingManual : arv * (closingPct / 100);

  // Calculations
  const mao = arv - repairs - fee - closing - holding;
  const roi = mao > 0 ? (fee / mao) * 100 : 0;
  const margin = arv > 0 ? (fee / arv) * 100 : 0;
  const totalDeductions = repairs + fee + closing + holding;

  // Deal badge
  const dealBadge = useMemo(() => {
    if (mao <= 0) return { label: "Invalid", color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30" };
    if (roi > 20) return { label: "Strong Deal", color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/30" };
    if (roi >= 10) return { label: "Marginal", color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/30" };
    return { label: "Pass", color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30" };
  }, [mao, roi]);

  // Stacked bar percentages (for visualization)
  const barSegments = useMemo(() => {
    if (arv <= 0) return [];
    const repairsPct = Math.max(0, repairs / arv * 100);
    const closingPct2 = Math.max(0, closing / arv * 100);
    const feePct = Math.max(0, fee / arv * 100);
    const holdingPct = Math.max(0, holding / arv * 100);
    const maoPct = Math.max(0, mao / arv * 100);

    return [
      { label: "Repairs", pct: repairsPct, color: "bg-blue-500" },
      { label: "Closing", pct: closingPct2, color: "bg-purple-500" },
      { label: "Fee", pct: feePct, color: "bg-gold-500" },
      { label: "Holding", pct: holdingPct, color: "bg-gray-500" },
      { label: "MAO", pct: maoPct, color: "bg-green-500" },
    ].filter(s => s.pct > 0.05);
  }, [arv, repairs, closing, fee, holding, mao]);

  // Handle input changes with formatting
  const onArvChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9]/g, "");
    setArvRaw(raw);
  }, []);
  const onRepairsChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9]/g, "");
    setRepairsRaw(raw);
  }, []);
  const onFeeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9]/g, "");
    setFeeRaw(raw);
  }, []);
  const onHoldingChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9]/g, "");
    setHoldingRaw(raw);
  }, []);
  const onClosingPctChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9.]/g, "");
    setClosingPctRaw(raw);
  }, []);
  const onClosingManualChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9]/g, "");
    setClosingManualRaw(raw);
  }, []);

  const displayArv = arvRaw ? fmtDollar(arv) : "";
  const displayRepairs = repairsRaw ? fmtDollar(repairs) : "";
  const displayFee = feeRaw ? fmtDollar(fee) : "";
  const displayHolding = holdingRaw ? fmtDollar(holding) : "";
  const displayClosingManual = closingManualRaw ? fmtDollar(closingManual) : "";

  return (
    <div className="px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="text-center">
          <span className="inline-block rounded-full bg-gold-500/10 px-4 py-1 text-sm font-medium text-gold-500">
            Deal Analysis Tool
          </span>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
            Deal Calculator
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-400">
            Run the numbers on any potential wholesale deal. Enter property details below and see your Maximum Allowable
            Offer, ROI, and whether the deal is worth pursuing — all in real time.
          </p>
        </div>

        {/* Main grid: inputs + results */}
        <div className="mt-10 grid gap-8 lg:grid-cols-5">
          {/* Inputs — left side, 3 cols on desktop */}
          <div className="space-y-5 lg:col-span-3">
            <h2 className="text-lg font-semibold text-white">Property Details</h2>

            {/* ARV */}
            <InputGroup
              label="After Repair Value (ARV)"
              note="The estimated market value of the property after all repairs are completed."
            >
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={displayArv}
                  onChange={onArvChange}
                  placeholder="$0"
                  className="w-full rounded-lg border border-navy-700 bg-navy-900 py-2.5 pl-8 pr-4 text-white placeholder:text-gray-600 focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500"
                />
              </div>
            </InputGroup>

            {/* Estimated Repairs */}
            <InputGroup
              label="Estimated Repair Costs"
              note="Total cost to bring the property to market-ready condition."
            >
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={displayRepairs}
                  onChange={onRepairsChange}
                  placeholder="$0"
                  className="w-full rounded-lg border border-navy-700 bg-navy-900 py-2.5 pl-8 pr-4 text-white placeholder:text-gray-600 focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500"
                />
              </div>
            </InputGroup>

            {/* Assignment Fee */}
            <InputGroup
              label="Desired Assignment Fee"
              note="Your wholesale fee — what you earn for assigning the contract to a cash buyer."
            >
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={displayFee}
                  onChange={onFeeChange}
                  placeholder="$15,000"
                  className="w-full rounded-lg border border-navy-700 bg-navy-900 py-2.5 pl-8 pr-4 text-white placeholder:text-gray-600 focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500"
                />
              </div>
            </InputGroup>

            {/* Closing Costs */}
            <InputGroup
              label="Closing Costs"
              note="Title fees, escrow, attorney fees, and transfer taxes. Default: 2% of ARV."
            >
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="closingMode"
                      checked={!closingOverride}
                      onChange={() => setClosingOverride(false)}
                      className="h-4 w-4 text-gold-500 border-navy-700 bg-navy-900 focus:ring-gold-500"
                    />
                    <span className="text-sm text-gray-300">Auto (% of ARV)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="closingMode"
                      checked={closingOverride}
                      onChange={() => setClosingOverride(true)}
                      className="h-4 w-4 text-gold-500 border-navy-700 bg-navy-900 focus:ring-gold-500"
                    />
                    <span className="text-sm text-gray-300">Manual ($)</span>
                  </label>
                </div>
                {closingOverride ? (
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={displayClosingManual}
                      onChange={onClosingManualChange}
                      placeholder="$0"
                      className="w-full rounded-lg border border-navy-700 bg-navy-900 py-2.5 pl-8 pr-4 text-white placeholder:text-gray-600 focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500"
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={closingPctRaw}
                      onChange={onClosingPctChange}
                      className="w-20 rounded-lg border border-navy-700 bg-navy-900 py-2.5 px-3 text-center text-white focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500"
                    />
                    <span className="text-gray-400">%</span>
                    <span className="text-sm text-gray-500 ml-1">= {fmtDollar(closing)}</span>
                  </div>
                )}
              </div>
            </InputGroup>

            {/* Holding Costs */}
            <InputGroup
              label="Holding Costs (Optional)"
              note="Property taxes, insurance, utilities, and maintenance during the holding period."
            >
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={displayHolding}
                  onChange={onHoldingChange}
                  placeholder="$0"
                  className="w-full rounded-lg border border-navy-700 bg-navy-900 py-2.5 pl-8 pr-4 text-white placeholder:text-gray-600 focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500"
                />
              </div>
            </InputGroup>
          </div>

          {/* Results — right side, 2 cols on desktop */}
          <div className="space-y-6 lg:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Results</h2>
              {/* Deal Badge */}
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border ${dealBadge.border} ${dealBadge.bg} px-3 py-1 text-xs font-semibold ${dealBadge.color}`}
              >
                <span className={`h-2 w-2 rounded-full ${dealBadge.color.replace("text-", "bg-")}`} />
                {dealBadge.label}
              </span>
            </div>

            {/* MAO Card */}
            <div className="rounded-xl border border-navy-700 bg-navy-800/50 p-5">
              <p className="text-sm text-gray-400">Maximum Allowable Offer (MAO)</p>
              <p className={`mt-1 text-3xl font-bold ${mao > 0 ? "text-green-400" : "text-red-400"}`}>
                {fmtDollar(mao)}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                The most you should pay for the property to hit your profit target.
              </p>
            </div>

            {/* ROI & Margin */}
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl border border-navy-700 bg-navy-800/50 p-4">
                <p className="text-xs text-gray-400">ROI</p>
                <p className={`mt-1 text-xl font-bold ${roi > 20 ? "text-green-400" : roi >= 10 ? "text-yellow-400" : "text-red-400"}`}>
                  {fmtPct(roi)}
                </p>
                <p className="mt-0.5 text-xs text-gray-500">Fee ÷ MAO</p>
              </div>
              <div className="rounded-xl border border-navy-700 bg-navy-800/50 p-4">
                <p className="text-xs text-gray-400">Profit Margin</p>
                <p className="mt-1 text-xl font-bold text-gold-400">{fmtPct(margin)}</p>
                <p className="mt-0.5 text-xs text-gray-500">Fee ÷ ARV</p>
              </div>
            </div>

            {/* Net Profit */}
            <div className="rounded-xl border border-navy-700 bg-navy-800/50 p-5">
              <p className="text-sm text-gray-400">Potential Net Profit</p>
              <p className="mt-1 text-2xl font-bold text-green-400">{fmtDollar(fee)}</p>
              <p className="mt-1 text-xs text-gray-500">Your assignment fee at closing.</p>
            </div>

            {/* Breakdown bar */}
            <div className="rounded-xl border border-navy-700 bg-navy-800/50 p-5">
              <p className="text-sm font-medium text-white">ARV Breakdown</p>
              <p className="text-xs text-gray-500 mt-0.5">How the {fmtDollar(arv)} ARV is allocated:</p>

              {/* Stacked bar */}
              <div className="mt-3 flex h-6 w-full overflow-hidden rounded-md bg-navy-900">
                {barSegments.map((seg, i) => (
                  <div
                    key={seg.label}
                    className={`${seg.color} flex items-center justify-center text-[10px] font-bold text-white transition-all`}
                    style={{ width: `${Math.max(seg.pct, 0.5)}%` }}
                    title={`${seg.label}: ${seg.pct.toFixed(1)}%`}
                  >
                    {seg.pct > 8 ? seg.pct.toFixed(0) + "%" : ""}
                  </div>
                ))}
              </div>

              {/* Legend */}
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                {[
                  { label: "Repairs", value: repairs, color: "bg-blue-500" },
                  { label: "Closing", value: closing, color: "bg-purple-500" },
                  { label: "Fee", value: fee, color: "bg-gold-500" },
                  { label: "Holding", value: holding, color: "bg-gray-500" },
                  { label: "MAO", value: Math.max(0, mao), color: "bg-green-500" },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-1.5">
                    <span className={`h-2.5 w-2.5 rounded-sm ${item.color}`} />
                    <span className="text-xs text-gray-400">{item.label}</span>
                    <span className="text-xs font-medium text-gray-300">{fmtDollar(item.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="mt-12 rounded-2xl bg-gradient-to-br from-navy-800 to-navy-700 p-8 text-center sm:p-12">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">
            Have a Deal Worth Pursuing?
          </h2>
          <p className="mt-3 text-gray-300">
            Submit your property details and we'll provide a verified cash offer within 24 hours.
          </p>
          <Link
            to="/get-offer"
            className="mt-6 inline-block rounded-lg bg-gold-500 px-8 py-4 text-lg font-semibold text-navy-900 transition-all hover:bg-gold-400 hover:shadow-lg hover:shadow-gold-500/25"
          >
            Get Your Cash Offer Now →
          </Link>
        </div>
      </div>
    </div>
  );
}

// Reusable input wrapper
function InputGroup({
  label,
  note,
  children,
}: {
  label: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-navy-700 bg-navy-800/50 p-4">
      <label className="block text-sm font-medium text-white">{label}</label>
      <p className="mb-2 text-xs text-gray-500">{note}</p>
      {children}
    </div>
  );
}
