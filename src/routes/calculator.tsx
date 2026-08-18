import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useCallback, useMemo, useEffect } from "react";
import { createServerFn } from "@tanstack/react-start";
import { requireOwnerMiddleware } from "~/lib/auth";
import { OwnerGate } from "~/components/OwnerGate";
import {
  computeMatch,
  type Buyer,
  type BuyerMatch,
  type BuyerRow,
  type DealForMatch,
} from "~/lib/buyer-match";

export const Route = createFileRoute("/calculator")({
  head: () => ({
    meta: [
      { title: "Deal Analysis Calculator — DealForge Properties" },
      {
        name: "description",
        content:
          "Calculate your maximum allowable offer, ROI, and deal profitability with our free real estate wholesaling calculator.",
      },
    ],
  }),
  component: () => (
    <OwnerGate>
      <Calculator />
    </OwnerGate>
  ),
});

// --- Deal analysis persistence (audit #10, PH1-B9) ---
// Every calculation can be saved to `deal_analyses` (migration 009 + 015) and
// reloaded from the "Recent analyses" list. No data is fabricated: the list is
// always read from the database and shows an honest empty state when nothing
// has been saved. Since PH1-B9 the saved row also carries production fields
// (confidence, current_value, distress, tax delinquency, foreclosure risk,
// equity, property type, buyer demand, offer range, assumptions) — every one
// of them starts NULL (honest "not computed / unknown") and is only filled by
// a real save. confidence and buyer_demand are NEVER auto-populated.

interface DealAnalysis {
  id: string;
  lead_id: string | null;
  arv: number;
  repairs: number;
  max_offer: number;
  assignment_fee: number;
  closing_costs: number;
  holding_costs: number;
  projected_profit: number;
  roi: number;
  margin: number;
  notes: string | null;
  // PH1-B9 production fields — all nullable, honest "not computed" by default
  confidence: number | null;
  current_value: number | null;
  desired_buyer_margin: number | null;
  distress_score: number | null;
  tax_delinquent: boolean | null;
  years_delinquent: number | null;
  foreclosure_risk: string | null;
  equity_estimate: number | null;
  property_type: string | null;
  buyer_demand: string | null;
  offer_range_low: number | null;
  offer_range_high: number | null;
  assumptions: Record<string, unknown> | null;
  analysis_status: string;
  created_at: string;
}

interface DealAnalysisRow {
  id: string;
  lead_id: string | null;
  arv: string | number;
  repairs: string | number;
  max_offer: string | number;
  assignment_fee: string | number;
  closing_costs: string | number;
  holding_costs: string | number;
  projected_profit: string | number;
  roi: string | number;
  margin: string | number;
  notes: string | null;
  confidence: string | number | null;
  current_value: string | number | null;
  desired_buyer_margin: string | number | null;
  distress_score: string | number | null;
  tax_delinquent: boolean | null;
  years_delinquent: string | number | null;
  foreclosure_risk: string | null;
  equity_estimate: string | number | null;
  property_type: string | null;
  buyer_demand: string | null;
  offer_range_low: string | number | null;
  offer_range_high: string | number | null;
  assumptions: Record<string, unknown> | string | null;
  analysis_status: string;
  created_at: Date | string;
}

function numOrNull(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rowToAnalysis(row: DealAnalysisRow): DealAnalysis {
  const rawAssumptions = row.assumptions;
  let assumptions: Record<string, unknown> | null = null;
  if (typeof rawAssumptions === "string") {
    try {
      assumptions = JSON.parse(rawAssumptions) as Record<string, unknown>;
    } catch {
      assumptions = null;
    }
  } else if (rawAssumptions && typeof rawAssumptions === "object") {
    assumptions = rawAssumptions;
  }
  return {
    id: String(row.id),
    lead_id: row.lead_id ? String(row.lead_id) : null,
    arv: Number(row.arv),
    repairs: Number(row.repairs),
    max_offer: Number(row.max_offer),
    assignment_fee: Number(row.assignment_fee),
    closing_costs: Number(row.closing_costs),
    holding_costs: Number(row.holding_costs),
    projected_profit: Number(row.projected_profit),
    roi: Number(row.roi),
    margin: Number(row.margin),
    notes: row.notes,
    confidence: numOrNull(row.confidence),
    current_value: numOrNull(row.current_value),
    desired_buyer_margin: numOrNull(row.desired_buyer_margin),
    distress_score: numOrNull(row.distress_score),
    tax_delinquent: row.tax_delinquent === null || row.tax_delinquent === undefined ? null : Boolean(row.tax_delinquent),
    years_delinquent: numOrNull(row.years_delinquent),
    foreclosure_risk: row.foreclosure_risk ?? null,
    equity_estimate: numOrNull(row.equity_estimate),
    property_type: row.property_type ?? null,
    buyer_demand: row.buyer_demand ?? null,
    offer_range_low: numOrNull(row.offer_range_low),
    offer_range_high: numOrNull(row.offer_range_high),
    assumptions,
    analysis_status: row.analysis_status ?? "ESTIMATE",
    created_at: String(row.created_at),
  };
}

const ANALYSIS_COLUMNS = `
  id, lead_id, arv, repairs, max_offer, assignment_fee, closing_costs,
  holding_costs, projected_profit, roi, margin, notes,
  confidence, current_value, desired_buyer_margin, distress_score,
  tax_delinquent, years_delinquent, foreclosure_risk, equity_estimate,
  property_type, buyer_demand, offer_range_low, offer_range_high,
  assumptions, analysis_status, created_at
`;

interface SaveAnalysisInput {
  lead_id?: string | null;
  arv: number;
  repairs: number;
  max_offer: number;
  assignment_fee: number;
  closing_costs: number;
  holding_costs: number;
  projected_profit: number;
  roi: number;
  margin: number;
  notes?: string | null;
  // PH1-B9 — the calculator sends NULL for anything not computed (confidence,
  // buyer_demand, desired_buyer_margin always NULL from the UI).
  confidence?: number | null;
  current_value?: number | null;
  desired_buyer_margin?: number | null;
  distress_score?: number | null;
  tax_delinquent?: boolean | null;
  years_delinquent?: number | null;
  foreclosure_risk?: string | null;
  equity_estimate?: number | null;
  property_type?: string | null;
  buyer_demand?: string | null;
  offer_range_low?: number | null;
  offer_range_high?: number | null;
  assumptions?: Record<string, unknown> | null;
  analysis_status?: string;
}

const saveDealAnalysis = createServerFn({ method: "POST", middleware: [requireOwnerMiddleware] })
  .validator((data: unknown) => {
    const d = data as SaveAnalysisInput;
    if (!Number.isFinite(d.arv) || !Number.isFinite(d.repairs) || !Number.isFinite(d.max_offer)) {
      throw new Error("Invalid deal analysis — ARV, repairs and max offer must be numbers");
    }
    return d;
  })
  .handler(async ({ data }) => {
    const { sql } = await import("~/db");
    const rows = (await sql`
      INSERT INTO deal_analyses (
        lead_id, arv, repairs, max_offer, assignment_fee, closing_costs, holding_costs,
        projected_profit, roi, margin, notes,
        confidence, current_value, desired_buyer_margin, distress_score,
        tax_delinquent, years_delinquent, foreclosure_risk, equity_estimate,
        property_type, buyer_demand, offer_range_low, offer_range_high,
        assumptions, analysis_status
      )
      VALUES (
        ${data.lead_id ?? null}, ${data.arv}, ${data.repairs}, ${data.max_offer}, ${data.assignment_fee},
        ${data.closing_costs}, ${data.holding_costs}, ${data.projected_profit}, ${data.roi}, ${data.margin},
        ${data.notes ?? null},
        ${data.confidence ?? null}, ${data.current_value ?? null}, ${data.desired_buyer_margin ?? null},
        ${data.distress_score ?? null}, ${data.tax_delinquent ?? null}, ${data.years_delinquent ?? null},
        ${data.foreclosure_risk ?? null}, ${data.equity_estimate ?? null}, ${data.property_type ?? null},
        ${data.buyer_demand ?? null}, ${data.offer_range_low ?? null}, ${data.offer_range_high ?? null},
        ${data.assumptions ? JSON.stringify(data.assumptions) : null}, ${data.analysis_status ?? "ESTIMATE"}
      )
      RETURNING ${ANALYSIS_COLUMNS}
    `) as DealAnalysisRow[];
    return rowToAnalysis(rows[0]);
  });

const listDealAnalyses = createServerFn({ method: "GET", middleware: [requireOwnerMiddleware] }).handler(async () => {
  const { sql } = await import("~/db");
  const rows = (await sql`
    SELECT ${ANALYSIS_COLUMNS}
    FROM deal_analyses
    ORDER BY created_at DESC
    LIMIT 20
  `) as DealAnalysisRow[];
  return rows.map(rowToAnalysis);
});

const getDealAnalysis = createServerFn({ method: "POST", middleware: [requireOwnerMiddleware] })
  .validator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    const { sql } = await import("~/db");
    const rows = (await sql`
      SELECT ${ANALYSIS_COLUMNS}
      FROM deal_analyses
      WHERE id = ${data.id}
      LIMIT 1
    `) as DealAnalysisRow[];
    return rows.length ? rowToAnalysis(rows[0]) : null;
  });

// --- Lead context (PH1-B9) ---
// /calculator?lead=<id> attaches a CRM lead so the analysis echoes its
// score_factors (current value, distress, years delinquent, foreclosure,
// equity — all ESTIMATEs from the PropStream-adapted score import). Without a
// lead the calculator is honest: "No lead attached — manual estimates only."
interface LeadContext {
  id: string;
  full_name: string | null;
  property_address: string | null;
  property_city: string | null;
  property_state: string | null;
  property_zip: string | null;
  property_type: string | null;
  pipeline_stage: string | null;
  score_factors: {
    ev?: number | null;
    distress?: number | null;
    years_delq?: number | null;
    foreclosure_factor?: string | null;
    equity?: number | null;
    estimated_arv?: number | null;
    estimated_mao?: number | null;
    property_type?: string | null;
  } | null;
}

const getLeadForAnalysis = createServerFn({ method: "POST", middleware: [requireOwnerMiddleware] })
  .validator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    try {
      const { sql } = await import("~/db");
      const rows = (await sql`
        SELECT id, full_name, property_address, property_city, property_state,
               property_zip, property_type, pipeline_stage, score_factors
        FROM leads
        WHERE id = ${data.id}
        LIMIT 1
      `) as LeadContext[];
      if (!rows.length) return null;
      return rows[0];
    } catch {
      return null; // honest — DB unreachable is "no context", never invented data
    }
  });

const fetchBuyersForMatch = createServerFn({ method: "GET", middleware: [requireOwnerMiddleware] }).handler(async () => {
  try {
    const { sql } = await import("~/db");
    const { rowToBuyer } = await import("~/lib/buyer-match");
    const rows = (await sql`
      SELECT id, name, email, phone, buying_criteria, created_at
      FROM buyers
      ORDER BY created_at DESC
    `) as BuyerRow[];
    return rows.map(rowToBuyer);
  } catch {
    return [] as Buyer[]; // honest empty list — never fabricate buyers (audit #11)
  }
});

// --- Foreclosure vocabulary mapping ---
// score_factors.foreclosure_factor uses title-case values ("Very High", "High",
// "Medium High", "Medium Low", "Low", "Very Low"). deal_analyses.foreclosure_risk
// is CHECK-constrained to ('LOW','MEDIUM_LOW','MEDIUM_HIGH','HIGH','VERY_HIGH').
// Only values in that vocabulary are mapped — "Very Low" is not in the vocab so
// it stays NULL (not stored) rather than being mislabeled.
const FORECLOSURE_VOCAB: Record<string, string> = {
  "Very High": "VERY_HIGH",
  High: "HIGH",
  "Medium High": "MEDIUM_HIGH",
  "Medium Low": "MEDIUM_LOW",
  Low: "LOW",
};

function mapForeclosureRisk(value: string | null | undefined): string | null {
  if (!value) return null;
  return FORECLOSURE_VOCAB[value] ?? null;
}

// tax_delinquent is BOOLEAN NULL = unknown (never default false). We only
// assert true when years_delq > 0 and false when it is explicitly 0.
function taxDelinquentFromYears(years: number | null | undefined): boolean | null {
  if (years === null || years === undefined) return null;
  return years > 0;
}

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

// ESTIMATE badge — every output of the calculator is an estimate until a
// human verifies it (analysis_status flips to VERIFIED in the DB).
function EstimateBadge({ tooltip }: { tooltip?: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400"
      title={tooltip ?? "Estimate — not a verified figure"}
    >
      Estimate
    </span>
  );
}

const MATCH_STRENGTH_COLORS: Record<string, string> = {
  strong: "bg-green-500/20 text-green-300 border-green-500/30",
  good: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  partial: "bg-gray-500/20 text-gray-300 border-gray-500/30",
};

const MATCH_STRENGTH_LABELS: Record<string, string> = {
  strong: "Strong Match",
  good: "Good Match",
  partial: "Partial Match",
};

function MatchStrengthBadge({ match }: { match: BuyerMatch }) {
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium ${
        MATCH_STRENGTH_COLORS[match.strength] || "bg-gray-500/20 text-gray-300 border-gray-500/30"
      }`}
    >
      {MATCH_STRENGTH_LABELS[match.strength] ?? match.strength}
    </span>
  );
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

  // PH1-B9 — attached lead (?lead=<id>) + live context
  const [attachedLeadId, setAttachedLeadId] = useState<string | null>(null);
  const [leadContext, setLeadContext] = useState<LeadContext | null>(null);
  const [leadState, setLeadState] = useState<
    "idle" | "loading" | "loaded" | "not_found" | "error"
  >("idle");
  const [buyersForMatch, setBuyersForMatch] = useState<Buyer[]>([]);

  useEffect(() => {
    let cancelled = false;
    const id =
      typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search).get("lead");
    setAttachedLeadId(id);
    if (!id) {
      setLeadState("idle");
      return;
    }
    setLeadState("loading");
    getLeadForAnalysis({ data: { id } })
      .then((ctx) => {
        if (cancelled) return;
        setLeadContext(ctx);
        setLeadState(ctx ? "loaded" : "not_found");
      })
      .catch(() => {
        if (!cancelled) setLeadState("error");
      });
    fetchBuyersForMatch()
      .then((buyers) => {
        if (!cancelled) setBuyersForMatch(buyers);
      })
      .catch(() => {
        if (!cancelled) setBuyersForMatch([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const scoreFactors = leadContext?.score_factors ?? null;

  // PH1-B9 — matching buyers reuses the same computeMatch as /buyers
  // (src/lib/buyer-match.ts) against the live buyers table. Only city/zip/
  // price/type keys exist today — no buyer-demand data, so the buyer_demand
  // column stays NULL and the UI says NOT VERIFIED when nothing matches.
  const buyerMatches = useMemo(() => {
    if (!leadContext) return [];
    const deal: DealForMatch = {
      id: leadContext.id,
      leadName: leadContext.full_name || "—",
      propertyAddress: leadContext.property_address || "",
      propertyCity: leadContext.property_city || "",
      propertyState: leadContext.property_state || "",
      propertyZip: leadContext.property_zip || "",
      propertyType: leadContext.property_type || "",
      status: leadContext.pipeline_stage || "unknown",
      estimatedMAO: mao > 0 ? mao : 0,
      repairs: repairs > 0 ? repairs.toLocaleString("en-US") : "—",
    };
    return buyersForMatch
      .map((b) => computeMatch(b, deal))
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }, [leadContext, buyersForMatch, mao, repairs]);

  // PH1-B9 — recommended offer range [max(0, mao*0.9), mao]; "—" when invalid
  const offerRange = mao > 0 ? { low: Math.max(0, mao * 0.9), high: mao } : null;

  // PH1-B9 — assumptions echo the exact inputs + sources (persisted as JSONB)
  const assumptions = useMemo(
    () => ({
      arv_input: arv,
      repairs_input: repairs,
      fee_input: fee,
      closing_mode: closingOverride ? "manual" : "auto",
      closing_pct: closingOverride ? null : closingPct,
      closing_manual: closingOverride ? closingManual : null,
      holding_input: holding,
      arv_source: "MANUAL_ENTRY",
      value_source:
        scoreFactors?.ev != null
          ? "leads.score_factors.ev (PropStream-adapted score import)"
          : "none — manual estimates only",
      repair_basis: "UNVERIFIED_ESTIMATE",
    }),
    [arv, repairs, fee, closingOverride, closingPct, closingManual, holding, scoreFactors?.ev],
  );

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

  // --- Persistence (audit #10) ---
  const [recent, setRecent] = useState<DealAnalysis[]>([]);
  const [recentStatus, setRecentStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [recentError, setRecentError] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState("");

  const refreshRecent = useCallback(() => {
    listDealAnalyses()
      .then((rows) => {
        setRecent(rows);
        setRecentStatus("loaded");
        setRecentError("");
      })
      .catch(() => {
        setRecentStatus("error");
        setRecentError("Couldn't load saved analyses — the database is unavailable.");
      });
  }, []);

  useEffect(() => {
    refreshRecent();
  }, [refreshRecent]);

  const handleSave = useCallback(async () => {
    if (arv <= 0) {
      setSaveState("error");
      setSaveMessage("Enter an ARV before saving this analysis.");
      return;
    }
    setSaveState("saving");
    setSaveMessage("");
    try {
      const saved = await saveDealAnalysis({
        data: {
          lead_id: attachedLeadId,
          arv,
          repairs,
          max_offer: mao,
          assignment_fee: fee,
          closing_costs: closing,
          holding_costs: holding,
          projected_profit: fee,
          roi,
          margin,
          // PH1-B9 — honest NULLs: confidence and buyer_demand are never
          // auto-filled; everything else echoes real inputs/score_factors.
          confidence: null,
          current_value: scoreFactors?.ev ?? null,
          desired_buyer_margin: null,
          distress_score: scoreFactors?.distress ?? null,
          tax_delinquent: taxDelinquentFromYears(scoreFactors?.years_delq),
          years_delinquent: scoreFactors?.years_delq ?? null,
          foreclosure_risk: mapForeclosureRisk(scoreFactors?.foreclosure_factor),
          equity_estimate: scoreFactors?.equity ?? null,
          property_type: leadContext?.property_type ?? scoreFactors?.property_type ?? null,
          buyer_demand: null,
          offer_range_low: offerRange ? offerRange.low : null,
          offer_range_high: offerRange ? offerRange.high : null,
          assumptions,
          analysis_status: "ESTIMATE",
        },
      });
      setRecent((prev) => [saved, ...prev].slice(0, 20));
      setSaveState("saved");
      setSaveMessage(
        attachedLeadId
          ? "Analysis saved for the attached lead — stored as an ESTIMATE until verified."
          : "Analysis saved (no lead attached) — stored as an ESTIMATE until verified.",
      );
    } catch (e) {
      setSaveState("error");
      setSaveMessage(
        `Couldn't save the analysis — ${e instanceof Error ? e.message : "database unavailable"}.`
      );
    }
  }, [arv, repairs, fee, closing, holding, mao, roi, margin, attachedLeadId, scoreFactors, leadContext, offerRange, assumptions]);

  // Reload a saved analysis into the form inputs.
  const handleLoad = useCallback((a: DealAnalysis) => {
    setArvRaw(String(Math.round(a.arv)));
    setRepairsRaw(String(Math.round(a.repairs)));
    setFeeRaw(String(Math.round(a.assignment_fee)));
    setHoldingRaw(String(Math.round(a.holding_costs)));
    if (a.arv > 0) {
      // Restore closing as % of ARV so the figure still matches the saved amount.
      const pct = (a.closing_costs / a.arv) * 100;
      setClosingPctRaw(pct.toFixed(2));
      setClosingOverride(false);
    } else {
      setClosingOverride(true);
      setClosingManualRaw(String(Math.round(a.closing_costs)));
    }
    setSaveState("idle");
    setSaveMessage(`Loaded analysis from ${new Date(a.created_at).toLocaleDateString()}.`);
  }, []);

  // Lead context card — honest states for every case
  const leadContextCard = (
    <div className="rounded-xl border border-navy-700 bg-navy-800/50 p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-white">Analysis Context</h2>
        {attachedLeadId && <EstimateBadge tooltip="Lead data comes from the PropStream-adapted score import — estimates, not verified figures" />}
      </div>

      {leadState === "idle" && (
        <p className="text-sm text-gray-500">
          No lead attached — manual estimates only. Open a lead from the CRM or
          dashboard (Reanalyze) to attach its property data.
        </p>
      )}

      {leadState === "loading" && (
        <p className="text-sm text-gray-500">Loading lead context…</p>
      )}

      {leadState === "not_found" && (
        <p className="text-sm text-amber-300">
          The attached lead was not found — manual estimates only.
        </p>
      )}

      {leadState === "error" && (
        <p className="text-sm text-amber-300">
          Couldn't load the attached lead — database unavailable. Manual estimates only.
        </p>
      )}

      {leadState === "loaded" && leadContext && (
        <div>
          <p className="text-sm font-medium text-white">{leadContext.full_name || "Unnamed owner"}</p>
          <p className="text-xs text-gray-500">
            {[leadContext.property_address, leadContext.property_city, leadContext.property_state, leadContext.property_zip]
              .filter(Boolean)
              .join(", ") || "No address on record"}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <ContextField label="Property Type" value={leadContext.property_type || "—"} estimate />
            <ContextField
              label="Current Value"
              value={scoreFactors?.ev != null ? fmtDollar(Number(scoreFactors.ev)) : "—"}
              estimate
            />
            <ContextField
              label="Distress"
              value={scoreFactors?.distress != null ? String(scoreFactors.distress) : "—"}
              estimate
            />
            <ContextField
              label="Years Delinquent"
              value={scoreFactors?.years_delq != null ? String(scoreFactors.years_delq) : "—"}
              estimate
            />
            <ContextField
              label="Foreclosure"
              value={scoreFactors?.foreclosure_factor ?? "—"}
              estimate
            />
            <ContextField
              label="Equity"
              value={scoreFactors?.equity != null ? fmtDollar(Number(scoreFactors.equity)) : "—"}
              estimate
            />
            <ContextField
              label="Est. ARV (score)"
              value={scoreFactors?.estimated_arv != null ? fmtDollar(Number(scoreFactors.estimated_arv)) : "—"}
              estimate
            />
            <ContextField
              label="Est. MAO (score)"
              value={scoreFactors?.estimated_mao != null ? fmtDollar(Number(scoreFactors.estimated_mao)) : "—"}
              estimate
            />
          </div>
          {!scoreFactors && (
            <p className="mt-3 text-xs text-gray-500">
              No score data for this lead — the figures below are manual estimates.
            </p>
          )}
          <p className="mt-3 text-[11px] text-gray-600">
            Source: PropStream-adapted score import (leads.score_factors). These are estimates —
            confirm with inspection and comparable sales before making an offer.
          </p>
        </div>
      )}
    </div>
  );

  // Assumptions card — echoes the exact inputs that produced this analysis
  const assumptionsCard = (
    <div className="rounded-xl border border-navy-700 bg-navy-800/50 p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-white">Assumptions</p>
        <EstimateBadge tooltip="Every input below is an operator-entered estimate — none are verified facts" />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <AssumptionRow label="ARV input" value={fmtDollar(arv)} note="arv_source: MANUAL_ENTRY" />
        <AssumptionRow label="Repairs input" value={fmtDollar(repairs)} note="repair_basis: UNVERIFIED_ESTIMATE (no inspection yet)" />
        <AssumptionRow label="Desired fee" value={fmtDollar(fee)} note="operator target" />
        <AssumptionRow
          label="Closing"
          value={closingOverride ? fmtDollar(closingManual) : `${closingPct}% = ${fmtDollar(closing)}`}
          note={closingOverride ? "closing_mode: manual" : "closing_mode: auto (% of ARV)"}
        />
        <AssumptionRow label="Holding" value={fmtDollar(holding)} note="operator input" />
        <AssumptionRow
          label="Value source"
          value={scoreFactors?.ev != null ? "score_factors.ev" : "none — manual estimates only"}
          note="PropStream-adapted score import"
        />
      </dl>
    </div>
  );

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

        {/* PH1-B9 — lead context */}
        <div className="mt-8">{leadContextCard}</div>

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
              <div className="flex items-center gap-2">
                <EstimateBadge tooltip="All results are estimates — no inspection or verified comparable sales have been run" />
                <button
                  onClick={handleSave}
                  disabled={saveState === "saving"}
                  className="rounded-lg bg-gold-500 px-3 py-1.5 text-xs font-semibold text-navy-900 transition-colors hover:bg-gold-400 disabled:opacity-60"
                >
                  {saveState === "saving" ? "Saving…" : "Save Analysis"}
                </button>
                {/* Deal Badge */}
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border ${dealBadge.border} ${dealBadge.bg} px-3 py-1 text-xs font-semibold ${dealBadge.color}`}
                >
                  <span className={`h-2 w-2 rounded-full ${dealBadge.color.replace("text-", "bg-")}`} />
                  {dealBadge.label}
                </span>
              </div>
            </div>

            {saveState !== "idle" && (
              <p
                className={`mt-2 text-xs ${
                  saveState === "saved"
                    ? "text-green-400"
                    : saveState === "error"
                      ? "text-red-400"
                      : "text-gray-400"
                }`}
              >
                {saveMessage}
              </p>
            )}

            {/* MAO Card */}
            <div className="rounded-xl border border-navy-700 bg-navy-800/50 p-5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-gray-400">Maximum Allowable Offer (MAO)</p>
                <EstimateBadge />
              </div>
              <p className={`mt-1 text-3xl font-bold ${mao > 0 ? "text-green-400" : "text-red-400"}`}>
                {fmtDollar(mao)}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                The most you should pay for the property to hit your profit target.
              </p>
            </div>

            {/* Recommended offer range (PH1-B9) */}
            <div className="rounded-xl border border-navy-700 bg-navy-800/50 p-5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-gray-400">Recommended Offer Range</p>
                <EstimateBadge tooltip="Range is 90%–100% of the breakeven MAO — an estimate, not a verified offer" />
              </div>
              <p className={`mt-1 text-2xl font-bold ${offerRange ? "text-gold-400" : "text-gray-600"}`}>
                {offerRange ? `${fmtDollar(offerRange.low)} – ${fmtDollar(offerRange.high)}` : "—"}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {offerRange
                  ? "Start low, negotiate up to your breakeven MAO."
                  : "No valid MAO — enter numbers that produce a positive offer first."}
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
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-gray-400">Potential Net Profit</p>
                <EstimateBadge />
              </div>
              <p className="mt-1 text-2xl font-bold text-green-400">{fmtDollar(fee)}</p>
              <p className="mt-1 text-xs text-gray-500">Your assignment fee at closing.</p>
            </div>

            {/* Confidence — never auto-computed (PH1-B9) */}
            <div className="rounded-xl border border-navy-700 bg-navy-800/50 p-5">
              <p className="text-sm text-gray-400">
                Confidence Score{" "}
                <span
                  className="cursor-help text-xs text-gray-600"
                  title="not computed — no inspection/comparable data"
                >
                  ⓘ
                </span>
              </p>
              <p className="mt-1 text-2xl font-bold text-gray-600">—</p>
              <p className="mt-1 text-xs text-gray-500">
                not computed — no inspection/comparable data
              </p>
            </div>

            {/* Matching buyers (PH1-B9) — real buyers, shared matcher */}
            <div className="rounded-xl border border-navy-700 bg-navy-800/50 p-5">
              <p className="text-sm font-medium text-white">Matching Buyers</p>
              {!leadContext ? (
                <p className="mt-2 text-xs text-gray-500">
                  NOT VERIFIED / no buyer demand data — attach a lead (?lead=) to match against the
                  buyer network.
                </p>
              ) : buyerMatches.length === 0 ? (
                <p className="mt-2 text-xs text-gray-500">
                  NOT VERIFIED / no buyer demand data — no buyers in the network match this deal's
                  city / zip / price / property type.
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {buyerMatches.map((m) => (
                    <li
                      key={m.buyer.id}
                      className="rounded-lg border border-navy-700 bg-navy-900/40 p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-white">{m.buyer.name}</p>
                        <MatchStrengthBadge match={m} />
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                        <span className="rounded bg-navy-700 px-1.5 py-0.5 text-gray-400">
                          Max {fmtDollar(m.buyer.maxPurchasePrice)}
                        </span>
                        <span className="rounded bg-navy-700 px-1.5 py-0.5 text-gray-400">
                          {m.buyer.desiredROI}% ROI
                        </span>
                        {m.matchedOn.map((c) => (
                          <span
                            key={c}
                            className="rounded-full bg-green-500/10 border border-green-500/20 px-1.5 py-0.5 text-green-300"
                          >
                            ✓ {c}
                          </span>
                        ))}
                        {m.missedOn.map((c) => (
                          <span
                            key={c}
                            className="rounded-full bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 text-red-300"
                          >
                            ✗ {c}
                          </span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[11px] text-gray-600">
                Buyers are real entries from the buyer network, matched on city / zip / price /
                property type — demand for this specific property is not verified.
              </p>
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

        {/* Assumptions (PH1-B9) — echoes the exact inputs that produced this run */}
        <div className="mt-10">{assumptionsCard}</div>

        {/* Recent analyses (persisted — audit #10) */}
        <div className="mt-12">
          <h2 className="text-lg font-semibold text-white">Recent Analyses</h2>
          <p className="mt-1 text-sm text-gray-500">
            Saved calculations from this database. Click one to reload its numbers into the calculator.
          </p>

          {recentStatus === "loading" && (
            <div className="mt-4 rounded-xl border border-navy-700 bg-navy-800/50 p-6 text-center text-sm text-gray-500">
              Loading saved analyses…
            </div>
          )}

          {recentStatus === "error" && (
            <div className="mt-4 rounded-xl border border-dashed border-red-500/30 bg-red-500/5 p-6 text-center">
              <p className="text-sm text-red-400">{recentError}</p>
              <p className="mt-1 text-xs text-gray-500">
                No saved analyses are shown because the database could not be reached — nothing is invented here.
              </p>
            </div>
          )}

          {recentStatus === "loaded" && recent.length === 0 && (
            <div className="mt-4 rounded-xl border border-dashed border-navy-700 bg-navy-800/30 p-6 text-center">
              <p className="text-sm text-gray-500">
                No saved analyses yet — run the calculator and hit “Save Analysis” to keep your deal numbers.
              </p>
            </div>
          )}

          {recent.length > 0 && (
            <ul className="mt-4 space-y-2">
              {recent.map((a) => (
                <li key={a.id}>
                  <button
                    onClick={() => handleLoad(a)}
                    className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-navy-700 bg-navy-800/50 px-4 py-3 text-left transition-colors hover:border-gold-500/40 hover:bg-navy-800/80"
                  >
                    <span className="text-sm font-medium text-white">
                      {new Date(a.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}{" "}
                      <span className="font-normal text-gray-500">
                        {new Date(a.created_at).toLocaleTimeString("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
                      <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400">
                        {a.analysis_status === "VERIFIED" ? "Verified" : "Estimate"}
                      </span>
                      <span>ARV {fmtDollar(a.arv)}</span>
                      <span>MAO {fmtDollar(a.max_offer)}</span>
                      <span>Fee {fmtDollar(a.assignment_fee)}</span>
                      <span className="text-gold-400">{fmtPct(a.roi)} ROI</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
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

// Small labeled field inside the analysis context card
function ContextField({ label, value, estimate }: { label: string; value: string; estimate?: boolean }) {
  return (
    <div className="rounded-lg border border-navy-700 bg-navy-900/40 p-2.5">
      <p className="text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
      <p className="mt-0.5 flex items-center gap-1.5 text-sm font-medium text-gray-200">
        {value}
        {estimate && (
          <span
            className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-400"
            title="Estimate from the PropStream-adapted score import — not a verified figure"
          >
            Est
          </span>
        )}
      </p>
    </div>
  );
}

// Assumption row inside the Assumptions card
function AssumptionRow({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-navy-700 bg-navy-900/40 p-2.5">
      <dt className="text-[10px] uppercase tracking-wider text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-gray-200">{value}</dd>
      <dd className="text-[10px] text-gray-600">{note}</dd>
    </div>
  );
}
