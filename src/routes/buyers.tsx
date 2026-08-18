import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { requireOwnerMiddleware } from "~/lib/auth";
import { OwnerGate } from "~/components/OwnerGate";
import { useState, useMemo, useEffect } from "react";
import {
  ALL_PROPERTY_TYPES,
  computeMatch,
  type Buyer,
  type DealForMatch,
  type MatchStrength,
  type PropertyType,
} from "~/lib/buyer-match";
import {
  rowToMarketplaceBuyer,
  autoMatchBuyers,
  type BuyBox,
  type CashOrHardMoney,
  type BuyerMatchResult,
  type LeadForMatch,
  type MarketplaceBuyer,
  type MarketplaceBuyerRow,
} from "~/lib/buyer-marketplace";

// --- Types ---
// Buyer / DealForMatch / MatchStrength / BuyerMatch / computeMatch live in
// src/lib/buyer-match.ts (PH1-B9) and are unchanged — the shared matcher keeps
// working for the Calculator and the Match Deals tab. PH1-B5 adds the
// marketplace layer on top: buy-box criteria, verification state and
// deal-history counters via src/lib/buyer-marketplace.ts.

type ViewTab = "list" | "match" | "automatch";

/** Form payload — full buy-box + legacy fields (all optional except name). */
interface BuyerFormData {
  name: string;
  email: string;
  phone: string;
  preferredMarkets: string[];
  preferredZips: string[];
  minPurchasePrice: number | null;
  maxPurchasePrice: number | null;
  maxRehab: number | null;
  preferredArv: number | null;
  preferredMao: number | null;
  propertyTypes: PropertyType[];
  cashOrHardMoney: CashOrHardMoney | null;
  closingSpeedDays: number | null;
  minBedrooms: number;
  minBaths: number;
  desiredROI: number;
  notes: string;
  active: boolean;
}

// --- Server Functions ---

const fetchBuyers = createServerFn({ method: "GET", middleware: [requireOwnerMiddleware] }).handler(async () => {
  try {
    const { sql } = await import("~/db");
    const rows = (await sql`
      SELECT id, name, email, phone, buying_criteria, buy_box, active,
             last_verified_at, verified_phone, deals_received, deals_viewed,
             deals_rejected, deals_purchased, created_at
      FROM buyers
      ORDER BY active DESC, name ASC
    `) as MarketplaceBuyerRow[];
    return rows.map(rowToMarketplaceBuyer);
  } catch {
    // Honest empty list — never fabricate buyers (audit #11).
    return [] as MarketplaceBuyer[];
  }
});

// Lightweight lead list for the auto-match picker (real leads only).
const fetchLeadsForMatch = createServerFn({ method: "GET", middleware: [requireOwnerMiddleware] }).handler(async () => {
  try {
    const { sql } = await import("~/db");
    const rows = (await sql`
      SELECT id, full_name, property_address, property_city, property_state,
             property_zip, property_type
      FROM leads
      ORDER BY created_at DESC
      LIMIT 300
    `) as Array<{
      id: string;
      full_name: string;
      property_address: string;
      property_city: string;
      property_state: string;
      property_zip: string;
      property_type: string | null;
    }>;
    return rows.map((r) => ({
      id: String(r.id),
      fullName: r.full_name,
      propertyAddress: r.property_address,
      propertyCity: r.property_city,
      propertyState: r.property_state,
      propertyZip: r.property_zip,
      propertyType: r.property_type || "",
    }));
  } catch {
    return [] as LeadForMatch[];
  }
});

const runAutoMatch = createServerFn({ method: "POST", middleware: [requireOwnerMiddleware] })
  .validator((data: unknown) => data as { leadId: string })
  .handler(async ({ data }) => {
    try {
      return await autoMatchBuyers(data.leadId);
    } catch {
      return { lead: null as LeadForMatch | null, matches: [] as BuyerMatchResult[] };
    }
  });

// Pipeline stages at which a deal is ready (or close to ready) to be matched
// to cash buyers. Canonical 19-stage vocabulary from pipeline_stages (migration 008).
const MATCHABLE_STAGES = [
  "offer_recommendation",
  "human_approval",
  "offer_sent",
  "negotiation",
  "contract_prepared",
  "contract_sent",
  "contract_signed",
  "buyer_matching",
  "buyer_contacted",
  "assignment",
  "closing",
];

interface MatchableDealRow {
  id: string;
  lead_name: string | null;
  property_address: string | null;
  property_city: string | null;
  property_state: string | null;
  property_zip: string | null;
  property_type: string | null;
  status: string | null;
  arv: string | number | null;
  max_offer: string | number | null;
  repairs: string | number | null;
  assignment_fee: string | number | null;
}

// Real deals for the matcher: leads at buyer-matching-eligible pipeline stages
// that have a saved deal analysis (migration 009). A deal without analyzed
// numbers (ARV / MAO / repairs) has no price to match on, so it is not shown —
// and when nothing qualifies the UI renders an honest empty state. Every field
// traces to a real database row (audit #11).
const fetchMatchableDeals = createServerFn({ method: "GET", middleware: [requireOwnerMiddleware] }).handler(async () => {
  try {
    const { sql } = await import("~/db");
    const rows = (await sql`
      SELECT l.id,
             l.full_name AS lead_name,
             l.property_address,
             l.property_city,
             l.property_state,
             l.property_zip,
             l.property_type,
             l.pipeline_stage AS status,
             da.arv,
             da.max_offer,
             da.repairs,
             da.assignment_fee
      FROM leads l
      JOIN LATERAL (
        SELECT arv, max_offer, repairs, assignment_fee
        FROM deal_analyses
        WHERE lead_id = l.id
        ORDER BY created_at DESC
        LIMIT 1
      ) da ON true
      WHERE l.pipeline_stage = ANY(${MATCHABLE_STAGES})
      ORDER BY l.updated_at DESC NULLS LAST
    `) as MatchableDealRow[];
    return rows.map((r): DealForMatch => {
      const repairsNum = Number(r.repairs);
      return {
        id: String(r.id),
        leadName: r.lead_name || "—",
        propertyAddress: r.property_address || "",
        propertyCity: r.property_city || "",
        propertyState: r.property_state || "",
        propertyZip: r.property_zip || "",
        propertyType: r.property_type || "",
        status: r.status || "unknown",
        estimatedMAO: Number(r.max_offer) || 0,
        repairs: Number.isFinite(repairsNum) && repairsNum > 0 ? `${repairsNum.toLocaleString("en-US")}` : "—",
      };
    });
  } catch {
    return [] as DealForMatch[];
  }
});

const addBuyerDb = createServerFn({ method: "POST", middleware: [requireOwnerMiddleware] })
  .validator((data: unknown) => {
    const d = data as BuyerFormData;
    if (!d.name) throw new Error("Name is required");
    return d;
  })
  .handler(async ({ data }) => {
    const { sql } = await import("~/db");
    const buyBox = formToBuyBox(data);
    const legacy = formToLegacyCriteria(data);
    const rows = (await sql`
      INSERT INTO buyers (name, email, phone, buying_criteria, buy_box, active)
      VALUES (${data.name}, ${data.email || null}, ${data.phone || null},
              ${JSON.stringify(legacy)}, ${JSON.stringify(buyBox)}, ${data.active})
      RETURNING id, name, email, phone, buying_criteria, buy_box, active,
                last_verified_at, verified_phone, deals_received, deals_viewed,
                deals_rejected, deals_purchased, created_at
    `) as MarketplaceBuyerRow[];
    return rowToMarketplaceBuyer(rows[0]);
  });

const updateBuyerDb = createServerFn({ method: "POST", middleware: [requireOwnerMiddleware] })
  .validator((data: unknown) => {
    const d = data as BuyerFormData & { id: string };
    if (!d.id || !d.name) throw new Error("id and name are required");
    return d;
  })
  .handler(async ({ data }) => {
    const { sql } = await import("~/db");
    const buyBox = formToBuyBox(data);
    const legacy = formToLegacyCriteria(data);
    const rows = (await sql`
      UPDATE buyers
      SET name = ${data.name}, email = ${data.email || null}, phone = ${data.phone || null},
          buying_criteria = ${JSON.stringify(legacy)},
          buy_box = ${JSON.stringify(buyBox)},
          active = ${data.active}
      WHERE id = ${data.id}
      RETURNING id, name, email, phone, buying_criteria, buy_box, active,
                last_verified_at, verified_phone, deals_received, deals_viewed,
                deals_rejected, deals_purchased, created_at
    `) as MarketplaceBuyerRow[];
    return rowToMarketplaceBuyer(rows[0]);
  });

// "Mark verified" — records a real human verification timestamp and who did it
// (the operator is stamped into the audit trail via outreach_audit_log-style
// operator convention; no auth yet so the source is the buyers UI).
const markBuyerVerified = createServerFn({ method: "POST", middleware: [requireOwnerMiddleware] })
  .validator((data: unknown) => data as { id: string; operator?: string })
  .handler(async ({ data }) => {
    const { sql } = await import("~/db");
    const rows = (await sql`
      UPDATE buyers
      SET last_verified_at = now()
      WHERE id = ${data.id}
      RETURNING id, name, email, phone, buying_criteria, buy_box, active,
                last_verified_at, verified_phone, deals_received, deals_viewed,
                deals_rejected, deals_purchased, created_at
    `) as MarketplaceBuyerRow[];
    if (!rows[0]) throw new Error("Buyer not found");
    const updated = rowToMarketplaceBuyer(rows[0]);
    // Audit the action (honest trail — who marked what when). channel/status
    // use the compliance-core vocabulary (manual/inbound = internal action).
    try {
      const { logOutreachAudit } = await import("~/lib/compliance");
      await logOutreachAudit({
        leadId: null,
        channel: "manual",
        direction: "inbound",
        status: "received",
        reason: `Buyer ${updated.name} marked verified (last_verified_at set) by ${data.operator || "buyers-ui"}`,
        operator: data.operator || "buyers-ui",
      });
    } catch {
      // audit is best-effort; the timestamp itself is the source of truth
    }
    return updated;
  });

const deleteBuyerDb = createServerFn({ method: "POST", middleware: [requireOwnerMiddleware] })
  .validator((data: unknown) => {
    const d = data as { id: string };
    if (!d.id) throw new Error("id is required");
    return d;
  })
  .handler(async ({ data }) => {
    const { sql } = await import("~/db");
    await sql`DELETE FROM buyers WHERE id = ${data.id}`;
    return { success: true as const };
  });

// --- Form ↔ buy-box / legacy-criteria mappers ---

function formToBuyBox(f: BuyerFormData): BuyBox {
  return {
    preferred_markets: f.preferredMarkets,
    preferred_zips: f.preferredZips,
    property_types: f.propertyTypes,
    min_purchase_price: f.minPurchasePrice,
    max_purchase_price: f.maxPurchasePrice,
    max_rehab: f.maxRehab,
    preferred_arv: f.preferredArv,
    preferred_mao: f.preferredMao,
    cash_or_hard_money: f.cashOrHardMoney,
    closing_speed_days: f.closingSpeedDays,
    notes: f.notes.trim() ? f.notes.trim() : null,
  };
}

// Legacy buying_criteria keeps the shared computeMatch (B9) working unchanged.
function formToLegacyCriteria(f: BuyerFormData): Record<string, unknown> {
  return {
    preferredCities: f.preferredMarkets,
    preferredZips: f.preferredZips,
    maxPurchasePrice: f.maxPurchasePrice,
    propertyTypes: f.propertyTypes,
    minBedrooms: f.minBedrooms,
    minBaths: f.minBaths,
    desiredROI: f.desiredROI,
    notes: f.notes.trim(),
  };
}

function buyerToForm(b: MarketplaceBuyer): BuyerFormData {
  const box = b.buyBox;
  return {
    name: b.name,
    email: b.email,
    phone: b.phone,
    preferredMarkets: box.preferred_markets,
    preferredZips: box.preferred_zips,
    minPurchasePrice: box.min_purchase_price,
    maxPurchasePrice: box.max_purchase_price,
    maxRehab: box.max_rehab,
    preferredArv: box.preferred_arv,
    preferredMao: box.preferred_mao,
    propertyTypes: box.property_types as PropertyType[],
    cashOrHardMoney: box.cash_or_hard_money,
    closingSpeedDays: box.closing_speed_days,
    minBedrooms: 0,
    minBaths: 0,
    desiredROI: 0,
    notes: box.notes ?? "",
    active: b.active,
  };
}

// MarketplaceBuyer → legacy Buyer for the shared computeMatch (Match tab).
function toLegacyBuyer(b: MarketplaceBuyer): Buyer {
  return {
    id: b.id,
    name: b.name,
    email: b.email,
    phone: b.phone,
    preferredCities: b.buyBox.preferred_markets,
    preferredZips: b.buyBox.preferred_zips,
    maxPurchasePrice: b.buyBox.max_purchase_price ?? 0,
    propertyTypes: b.buyBox.property_types as PropertyType[],
    minBedrooms: 0,
    minBaths: 0,
    desiredROI: 0,
    notes: b.buyBox.notes ?? "",
    createdAt: b.createdAt,
  };
}

// --- Helpers ---
// ALL_PROPERTY_TYPES, normalizePropertyType, locationMatch, priceMatch,
// propertyTypeMatch and computeMatch are shared via src/lib/buyer-match.ts.

function formatCurrency(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// --- Color Helpers ---

const MATCH_COLORS: Record<MatchStrength, string> = {
  strong: "bg-green-500/20 text-green-300 border-green-500/30",
  good: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  partial: "bg-gray-500/20 text-gray-300 border-gray-500/30",
  none: "bg-red-500/20 text-red-300 border-red-500/30",
};

const MATCH_LABELS: Record<MatchStrength, string> = {
  strong: "Strong Match",
  good: "Good Match",
  partial: "Partial Match",
  none: "No Match",
};

// --- Components ---

function MatchBadge({ strength }: { strength: MatchStrength }) {
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${MATCH_COLORS[strength]}`}
    >
      {MATCH_LABELS[strength]}
    </span>
  );
}

function Badge({ children, color = "gray" }: { children: React.ReactNode; color?: "gray" | "blue" | "green" | "amber" | "gold" | "red" }) {
  const colors: Record<string, string> = {
    gray: "bg-gray-500/20 text-gray-300 border-gray-500/30",
    blue: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    green: "bg-green-500/20 text-green-300 border-green-500/30",
    amber: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    gold: "bg-gold-500/20 text-gold-300 border-gold-500/30",
    red: "bg-red-500/20 text-red-300 border-red-500/30",
  };
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${colors[color]}`}
    >
      {children}
    </span>
  );
}

// --- Form Component (full buy-box) ---

function BuyerForm({
  buyer,
  onSave,
  onCancel,
}: {
  buyer: MarketplaceBuyer | null;
  onSave: (data: BuyerFormData) => void;
  onCancel: () => void;
}) {
  const isEditing = buyer !== null;
  const initial = buyer ? buyerToForm(buyer) : null;
  const [name, setName] = useState(initial?.name ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [marketsInput, setMarketsInput] = useState(initial?.preferredMarkets.join(", ") ?? "");
  const [zipsInput, setZipsInput] = useState(initial?.preferredZips.join(", ") ?? "");
  const [minPrice, setMinPrice] = useState(initial?.minPurchasePrice?.toString() ?? "");
  const [maxPrice, setMaxPrice] = useState(initial?.maxPurchasePrice?.toString() ?? "");
  const [maxRehab, setMaxRehab] = useState(initial?.maxRehab?.toString() ?? "");
  const [prefArv, setPrefArv] = useState(initial?.preferredArv?.toString() ?? "");
  const [prefMao, setPrefMao] = useState(initial?.preferredMao?.toString() ?? "");
  const [propertyTypes, setPropertyTypes] = useState<PropertyType[]>(initial?.propertyTypes ?? []);
  const [cashOrHardMoney, setCashOrHardMoney] = useState<CashOrHardMoney | null>(initial?.cashOrHardMoney ?? null);
  const [closingSpeed, setClosingSpeed] = useState(initial?.closingSpeedDays?.toString() ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [active, setActive] = useState(initial?.active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function togglePropertyType(pt: PropertyType) {
    setPropertyTypes((prev) =>
      prev.includes(pt) ? prev.filter((p) => p !== pt) : [...prev, pt]
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "Name is required";
    // Email, phone, price bands and property types are all optional — the real
    // buyer network has missing values and the marketplace must not invent them.
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    const num = (s: string): number | null => (s.trim() === "" ? null : Number(s));
    onSave({
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      preferredMarkets: marketsInput.split(",").map((c) => c.trim()).filter(Boolean),
      preferredZips: zipsInput.split(",").map((z) => z.trim()).filter(Boolean),
      minPurchasePrice: num(minPrice),
      maxPurchasePrice: num(maxPrice),
      maxRehab: num(maxRehab),
      preferredArv: num(prefArv),
      preferredMao: num(prefMao),
      propertyTypes,
      cashOrHardMoney,
      closingSpeedDays: num(closingSpeed),
      minBedrooms: 0,
      minBaths: 0,
      desiredROI: 0,
      notes: notes.trim(),
      active,
    });
  }

  const inputCls = (err?: string) =>
    `w-full rounded-lg border bg-navy-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 ${
      err ? "border-red-500 focus:border-red-500 focus:ring-red-500" : "border-navy-700 focus:border-gold-500 focus:ring-gold-500"
    }`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-navy-900/80 backdrop-blur-sm"
        onClick={onCancel}
      />
      <div className="relative max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-navy-700 bg-navy-800 shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-navy-700 bg-navy-800/95 px-6 py-4 backdrop-blur">
          <h2 className="text-lg font-bold text-white">
            {isEditing ? "Edit Buyer — Buy Box" : "Add New Buyer"}
          </h2>
          <button
            onClick={onCancel}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-navy-700 hover:text-white"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 px-6 py-4">
          {/* Name */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
              Name / Company *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls(errors.name)}
              placeholder="e.g., Austin Cash Flow LLC"
            />
            {errors.name && <p className="mt-1 text-xs text-red-400">{errors.name}</p>}
          </div>

          {/* Email + Phone */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
                Email
              </label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls()} placeholder="deals@example.com" />
              <p className="mt-1 text-xs text-gray-500">Optional — leave blank if unknown.</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
                Phone
              </label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls()} placeholder="(210) 555-0100" />
              <p className="mt-1 text-xs text-gray-500">Optional — leave blank if unknown.</p>
            </div>
          </div>

          {/* Preferred Markets + Zips */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
                Preferred Markets (cities)
              </label>
              <input type="text" value={marketsInput} onChange={(e) => setMarketsInput(e.target.value)} className={inputCls()} placeholder="San Antonio, New Braunfels" />
              <p className="mt-1 text-xs text-gray-500">Comma-separated. Leave blank for all markets.</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
                Preferred Zip Codes
              </label>
              <input type="text" value={zipsInput} onChange={(e) => setZipsInput(e.target.value)} className={inputCls()} placeholder="78207, 78210" />
              <p className="mt-1 text-xs text-gray-500">Comma-separated. Leave blank for all zips.</p>
            </div>
          </div>

          {/* Price band: min + max */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
              Purchase Price Band ($)
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
                <input type="number" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} className={inputCls() + " pl-7"} placeholder="Min (e.g. 80000)" />
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
                <input type="number" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} className={inputCls() + " pl-7"} placeholder="Max (e.g. 300000)" />
              </div>
            </div>
            <p className="mt-1 text-xs text-gray-500">Both optional — deals outside the band won't match.</p>
          </div>

          {/* Max rehab + closing speed */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
                Max Rehab Budget ($)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
                <input type="number" value={maxRehab} onChange={(e) => setMaxRehab(e.target.value)} className={inputCls() + " pl-7"} placeholder="e.g. 40000" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
                Target Closing Speed (days)
              </label>
              <input type="number" value={closingSpeed} onChange={(e) => setClosingSpeed(e.target.value)} className={inputCls()} placeholder="e.g. 21" />
            </div>
          </div>

          {/* Preferred ARV + MAO */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
                Preferred ARV ($)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
                <input type="number" value={prefArv} onChange={(e) => setPrefArv(e.target.value)} className={inputCls() + " pl-7"} placeholder="e.g. 250000" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
                Preferred MAO ($)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
                <input type="number" value={prefMao} onChange={(e) => setPrefMao(e.target.value)} className={inputCls() + " pl-7"} placeholder="e.g. 180000" />
              </div>
            </div>
          </div>

          {/* Funding */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
              Funding Preference
            </label>
            <div className="flex flex-wrap gap-2">
              {(["cash", "hard_money", "both"] as const).map((fm) => (
                <button
                  key={fm}
                  type="button"
                  onClick={() => setCashOrHardMoney(cashOrHardMoney === fm ? null : fm)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    cashOrHardMoney === fm
                      ? "border-gold-500 bg-gold-500/20 text-gold-300"
                      : "border-navy-700 bg-navy-900 text-gray-400 hover:border-navy-600 hover:text-gray-300"
                  }`}
                >
                  {fm === "cash" ? "Cash" : fm === "hard_money" ? "Hard Money" : "Cash or Hard Money"}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCashOrHardMoney(null)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  cashOrHardMoney === null
                    ? "border-navy-600 bg-navy-700 text-gray-300"
                    : "border-navy-700 bg-navy-900 text-gray-500 hover:text-gray-300"
                }`}
              >
                Unknown
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Informational — no deal-side financing data exists yet, so this never blocks a match.
            </p>
          </div>

          {/* Property Types */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
              Property Types
            </label>
            <div className="flex flex-wrap gap-2">
              {ALL_PROPERTY_TYPES.map((pt) => (
                <button
                  key={pt}
                  type="button"
                  onClick={() => togglePropertyType(pt)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    propertyTypes.includes(pt)
                      ? "border-gold-500 bg-gold-500/20 text-gold-300"
                      : "border-navy-700 bg-navy-900 text-gray-400 hover:border-navy-600 hover:text-gray-300"
                  }`}
                >
                  {pt}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-gray-500">Leave empty for all types.</p>
          </div>

          {/* Notes */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className={inputCls() + " resize-none"}
              placeholder="Buying criteria, preferences, closing speed..."
            />
          </div>

          {/* Active toggle */}
          <div className="flex items-center justify-between rounded-lg border border-navy-700 bg-navy-900/50 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-white">Active buyer</p>
              <p className="text-xs text-gray-500">
                Inactive buyers are excluded from auto-match. Deactivation is automatic after 90 days without re-verification.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActive(!active)}
              className={`relative h-6 w-11 rounded-full transition-colors ${active ? "bg-green-500" : "bg-navy-700"}`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${active ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              className="flex-1 rounded-lg bg-gold-500 px-4 py-2.5 text-sm font-semibold text-navy-900 transition-colors hover:bg-gold-400"
            >
              {isEditing ? "Save Changes" : "Add Buyer"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-navy-600 bg-navy-700 px-4 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:bg-navy-600 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- Buyer Detail Modal ---

function BuyerDetailModal({
  buyer,
  onClose,
  onEdit,
  onDelete,
  onMarkVerified,
}: {
  buyer: MarketplaceBuyer;
  onClose: () => void;
  onEdit: (buyer: MarketplaceBuyer) => void;
  onDelete: (id: string) => void;
  onMarkVerified: (id: string) => void;
}) {
  const box = buyer.buyBox;
  const [marking, setMarking] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-navy-900/80 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-navy-700 bg-navy-800 shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-navy-700 bg-navy-800/95 px-6 py-4 backdrop-blur">
          <div>
            <h2 className="text-lg font-bold text-white">{buyer.name}</h2>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {buyer.active ? <Badge color="green">Active</Badge> : <Badge color="red">Inactive</Badge>}
              {buyer.verifiedPhone ? (
                <Badge color="gold">Phone verified (public listing)</Badge>
              ) : (
                <Badge color="gray">Phone not verified</Badge>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-navy-700 hover:text-white"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-6 px-6 py-4">
          {/* Contact */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-white">Contact Info</h3>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-gray-500">Email</dt>
                <dd className="text-sm text-gray-200">{buyer.email || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Phone</dt>
                <dd className="text-sm text-gray-200">{buyer.phone || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Date Added</dt>
                <dd className="text-sm text-gray-200">{formatDate(buyer.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Last Verified</dt>
                <dd className="text-sm text-gray-200">{formatDate(buyer.lastVerifiedAt)}</dd>
              </div>
            </dl>
            <button
              onClick={async () => {
                setMarking(true);
                try {
                  await onMarkVerified(buyer.id);
                } finally {
                  setMarking(false);
                }
              }}
              disabled={marking}
              className="mt-3 rounded-lg border border-gold-500/30 bg-gold-500/10 px-3 py-1.5 text-xs font-medium text-gold-400 transition-colors hover:bg-gold-500/20 disabled:opacity-50"
            >
              {marking ? "Recording…" : buyer.lastVerifiedAt ? "Re-verify now" : "Mark verified"}
            </button>
            <p className="mt-1 text-xs text-gray-600">
              Records today's date as the verification. Buyers not re-verified within 90 days are auto-flagged inactive.
            </p>
          </div>

          {/* Deal History — honest counters */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-white">Deal History</h3>
            {buyer.dealsReceived + buyer.dealsViewed + buyer.dealsRejected + buyer.dealsPurchased === 0 ? (
              <p className="rounded-lg border border-dashed border-navy-700 bg-navy-900/30 p-3 text-sm text-gray-500">
                No deals sent to this buyer yet — counters start at zero and only move when real deals are
                recorded (received / viewed / rejected / purchased).
              </p>
            ) : (
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="rounded-lg border border-navy-700 bg-navy-900/50 p-2">
                  <p className="text-lg font-bold text-white">{buyer.dealsReceived}</p>
                  <p className="text-[10px] uppercase tracking-wider text-gray-500">Received</p>
                </div>
                <div className="rounded-lg border border-navy-700 bg-navy-900/50 p-2">
                  <p className="text-lg font-bold text-white">{buyer.dealsViewed}</p>
                  <p className="text-[10px] uppercase tracking-wider text-gray-500">Viewed</p>
                </div>
                <div className="rounded-lg border border-navy-700 bg-navy-900/50 p-2">
                  <p className="text-lg font-bold text-white">{buyer.dealsRejected}</p>
                  <p className="text-[10px] uppercase tracking-wider text-gray-500">Rejected</p>
                </div>
                <div className="rounded-lg border border-navy-700 bg-navy-900/50 p-2">
                  <p className="text-lg font-bold text-white">{buyer.dealsPurchased}</p>
                  <p className="text-[10px] uppercase tracking-wider text-gray-500">Purchased</p>
                </div>
              </div>
            )}
          </div>

          {/* Buy Box */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-white">Buy Box</h3>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-gray-500">Price band</dt>
                <dd className="text-sm text-gray-200">
                  {box.min_purchase_price === null && box.max_purchase_price === null
                    ? "No band set"
                    : `${formatCurrency(box.min_purchase_price)} – ${formatCurrency(box.max_purchase_price)}`}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Max rehab</dt>
                <dd className="text-sm text-gray-200">{formatCurrency(box.max_rehab)}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Preferred ARV</dt>
                <dd className="text-sm text-gray-200">{formatCurrency(box.preferred_arv)}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Preferred MAO</dt>
                <dd className="text-sm text-gray-200">{formatCurrency(box.preferred_mao)}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Funding</dt>
                <dd className="text-sm text-gray-200">
                  {box.cash_or_hard_money === "cash"
                    ? "Cash"
                    : box.cash_or_hard_money === "hard_money"
                      ? "Hard Money"
                      : box.cash_or_hard_money === "both"
                        ? "Cash or Hard Money"
                        : "Unknown"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Closing speed</dt>
                <dd className="text-sm text-gray-200">{box.closing_speed_days ? `${box.closing_speed_days} days` : "—"}</dd>
              </div>
            </dl>
          </div>

          {/* Preferred Locations */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-white">Preferred Locations</h3>
            {box.preferred_markets.length > 0 && (
              <div className="mb-2">
                <p className="text-xs text-gray-500 mb-1">Markets</p>
                <div className="flex flex-wrap gap-1.5">
                  {box.preferred_markets.map((c) => (
                    <span key={c} className="rounded-full bg-navy-700 px-2.5 py-0.5 text-xs text-gray-300">{c}</span>
                  ))}
                </div>
              </div>
            )}
            {box.preferred_zips.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 mb-1">Zip Codes</p>
                <div className="flex flex-wrap gap-1.5">
                  {box.preferred_zips.map((z) => (
                    <span key={z} className="rounded-full bg-navy-700 px-2.5 py-0.5 text-xs text-gray-300">{z}</span>
                  ))}
                </div>
              </div>
            )}
            {box.preferred_markets.length === 0 && box.preferred_zips.length === 0 && (
              <p className="text-sm text-gray-500">All locations considered</p>
            )}
          </div>

          {/* Property Types */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-white">Property Types</h3>
            {box.property_types.length === 0 ? (
              <p className="text-sm text-gray-500">Any type considered</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {box.property_types.map((pt) => (
                  <Badge key={pt} color="blue">{pt}</Badge>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          {box.notes && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-white">Notes</h3>
              <p className="rounded-lg border border-navy-700 bg-navy-900/50 p-3 text-sm text-gray-300">{box.notes}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 border-t border-navy-700 px-6 py-4">
          <button
            onClick={() => onEdit(buyer)}
            className="flex-1 rounded-lg border border-gold-500/30 bg-gold-500/10 px-4 py-2 text-sm font-medium text-gold-400 transition-colors hover:bg-gold-500/20"
          >
            Edit Buy Box
          </button>
          <button
            onClick={() => {
              if (confirm(`Delete ${buyer.name}? This cannot be undone.`)) {
                onDelete(buyer.id);
                onClose();
              }
            }}
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Buyer List View ---

function BuyerListView({
  buyers,
  search,
  onSearchChange,
  onSelect,
  onAdd,
}: {
  buyers: MarketplaceBuyer[];
  search: string;
  onSearchChange: (v: string) => void;
  onSelect: (buyer: MarketplaceBuyer) => void;
  onAdd: () => void;
}) {
  const filtered = useMemo(() => {
    if (!search.trim()) return buyers;
    const q = search.toLowerCase();
    return buyers.filter((b) => {
      return (
        b.name.toLowerCase().includes(q) ||
        b.email.toLowerCase().includes(q) ||
        b.buyBox.preferred_markets.some((c) => c.toLowerCase().includes(q)) ||
        b.buyBox.preferred_zips.some((z) => z.includes(q)) ||
        b.buyBox.property_types.some((pt) => pt.toLowerCase().includes(q))
      );
    });
  }, [buyers, search]);

  return (
    <div>
      {/* Search + Add */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <svg
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by name, city, zip, property type..."
            className="w-full rounded-lg border border-navy-700 bg-navy-800 py-2 pl-10 pr-4 text-sm text-white placeholder-gray-500 focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500"
          />
        </div>
        <button
          onClick={onAdd}
          className="rounded-lg bg-gold-500 px-5 py-2.5 text-sm font-semibold text-navy-900 transition-colors hover:bg-gold-400 whitespace-nowrap"
        >
          + Add Buyer
        </button>
      </div>

      {/* Buyer Cards */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-navy-700 bg-navy-800/30 p-12 text-center">
          <svg
            className="mx-auto mb-3 h-10 w-10 text-navy-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          <p className="text-sm text-gray-500">
            {search.trim() ? "No buyers match your search." : "No buyers yet — add your first cash buyer"}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((buyer) => (
            <div
              key={buyer.id}
              onClick={() => onSelect(buyer)}
              className={`cursor-pointer rounded-xl border p-5 transition-all hover:shadow-lg ${
                buyer.active
                  ? "border-navy-700 bg-navy-800/50 hover:border-navy-600 hover:bg-navy-800/80"
                  : "border-navy-800 bg-navy-900/40 opacity-70 hover:border-navy-700"
              }`}
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <h3 className="font-semibold text-white">{buyer.name}</h3>
                {!buyer.active && <Badge color="red">Inactive</Badge>}
              </div>
              <div className="space-y-1.5 text-sm text-gray-400">
                <p>{buyer.email || "—"}</p>
                <p>{buyer.phone || "—"}</p>
                <div className="flex flex-wrap gap-1 pt-1">
                  {buyer.buyBox.max_purchase_price !== null && (
                    <Badge color="gold">{formatCurrency(buyer.buyBox.max_purchase_price)} max</Badge>
                  )}
                  {buyer.verifiedPhone ? (
                    <Badge color="blue">phone ✓</Badge>
                  ) : (
                    <Badge color="gray">phone unverified</Badge>
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {buyer.buyBox.property_types.slice(0, 3).map((pt) => (
                  <span key={pt} className="rounded bg-navy-700 px-1.5 py-0.5 text-[11px] text-gray-400">{pt}</span>
                ))}
                {buyer.buyBox.property_types.length > 3 && (
                  <span className="rounded bg-navy-700 px-1.5 py-0.5 text-[11px] text-gray-400">
                    +{buyer.buyBox.property_types.length - 3}
                  </span>
                )}
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                <span>
                  {buyer.buyBox.preferred_markets.length > 0
                    ? buyer.buyBox.preferred_markets.slice(0, 2).join(", ") +
                      (buyer.buyBox.preferred_markets.length > 2
                        ? ` +${buyer.buyBox.preferred_markets.length - 2} more`
                        : "")
                    : "All locations"}
                </span>
                <span title="Deal history counters — 0 means none recorded">
                  {buyer.dealsReceived + buyer.dealsViewed + buyer.dealsRejected + buyer.dealsPurchased === 0
                    ? "no deal history"
                    : `${buyer.dealsPurchased} bought · ${buyer.dealsRejected} rejected`}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Matching View (B9 — shared computeMatch, unchanged behavior) ---

function MatchingView({
  buyers,
  deals,
  onSelectBuyer,
}: {
  buyers: Buyer[];
  deals: DealForMatch[];
  onSelectBuyer: (buyer: Buyer) => void;
}) {
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);

  const matchResults = useMemo(() => {
    return deals.map((deal) => {
      const matches = buyers
        .map((buyer) => computeMatch(buyer, deal))
        .filter((m) => m.score > 0)
        .sort((a, b) => b.score - a.score);
      return { deal, matches };
    });
  }, [buyers, deals]);

  const selectedResult = selectedDealId
    ? matchResults.find((r) => r.deal.id === selectedDealId)
    : null;

  const statusLabels: Record<string, string> = {
    qualified: "Qualified",
    appointment: "Appt. Set",
    offer: "Offer Made",
    contract: "Contract Signed",
  };

  // Honest empty states — no fabricated buyers or deals (audit #11).
  if (buyers.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-navy-700 bg-navy-800/30 p-12 text-center">
        <svg
          className="mx-auto mb-3 h-10 w-10 text-navy-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
        <p className="text-sm text-gray-500">No buyers yet — add your first cash buyer</p>
        <p className="mt-1 text-xs text-gray-600">
          Buyers added on the “Buyer List” tab are matched against every deal in this view.
        </p>
      </div>
    );
  }

  if (deals.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-navy-700 bg-navy-800/30 p-12 text-center">
        <svg
          className="mx-auto mb-3 h-10 w-10 text-navy-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
          />
        </svg>
        <p className="text-sm text-gray-500">No deals ready for buyer matching yet</p>
        <p className="mt-1 text-xs text-gray-600">
          Deals appear here when a lead reaches the offer or contract stages of the pipeline and has a
          saved deal analysis (ARV, offer, repairs) from the Calculator.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Deal List */}
      <div className="lg:col-span-1 space-y-3">
        <h3 className="text-sm font-semibold text-white mb-3">Available Deals</h3>
        {matchResults.map(({ deal, matches }) => {
          const strongCount = matches.filter((m) => m.strength === "strong").length;
          const goodCount = matches.filter((m) => m.strength === "good").length;
          return (
            <div
              key={deal.id}
              onClick={() => setSelectedDealId(deal.id)}
              className={`cursor-pointer rounded-xl border p-4 transition-all ${
                selectedDealId === deal.id
                  ? "border-gold-500 bg-navy-800/80 shadow-lg shadow-gold-500/10"
                  : "border-navy-700 bg-navy-800/50 hover:border-navy-600 hover:bg-navy-800/70"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-white">{deal.leadName}</h4>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {deal.propertyAddress}, {deal.propertyCity}, {deal.propertyState} {deal.propertyZip}
                  </p>
                </div>
                <span className="rounded-full border border-navy-600 bg-navy-700 px-2 py-0.5 text-[10px] font-medium text-gray-300 whitespace-nowrap">
                  {statusLabels[deal.status] ?? deal.status}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                <span className="rounded bg-navy-700 px-1.5 py-0.5 text-gray-400">
                  {deal.propertyType || "Type not listed"}
                </span>
                <span className="rounded bg-navy-700 px-1.5 py-0.5 text-gray-400">
                  MAO: {formatCurrency(deal.estimatedMAO)}
                </span>
              </div>
              {/* Match count */}
              <div className="mt-2 flex gap-2 text-xs">
                {strongCount > 0 && (
                  <span className="text-green-400">{strongCount} strong</span>
                )}
                {goodCount > 0 && (
                  <span className="text-amber-400">{goodCount} good</span>
                )}
                {matches.length === 0 && (
                  <span className="text-gray-600">No matches</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Match Detail */}
      <div className="lg:col-span-2">
        {!selectedResult ? (
          <div className="flex h-full min-h-[300px] items-center justify-center rounded-xl border border-dashed border-navy-700 bg-navy-800/30">
            <div className="text-center">
              <svg
                className="mx-auto mb-3 h-10 w-10 text-navy-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                />
              </svg>
              <p className="text-sm text-gray-500">Select a deal on the left to see matching buyers</p>
            </div>
          </div>
        ) : selectedResult.matches.length === 0 ? (
          <div className="flex h-full min-h-[300px] items-center justify-center rounded-xl border border-dashed border-navy-700 bg-navy-800/30">
            <div className="text-center">
              <svg
                className="mx-auto mb-3 h-10 w-10 text-navy-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M18.364 5.636a9 9 0 010 12.728M5.636 5.636a9 9 0 000 12.728M8.05 8.05a5 5 0 000 7.9M15.95 8.05a5 5 0 010 7.9"
                />
              </svg>
              <p className="text-sm text-gray-500">No matching buyers found for this deal</p>
              <p className="text-xs text-gray-600 mt-1">
                {selectedResult.deal.propertyCity}, {selectedResult.deal.propertyType},{" "}
                {formatCurrency(selectedResult.deal.estimatedMAO)}
              </p>
            </div>
          </div>
        ) : (
          <div>
            {/* Deal header */}
            <div className="mb-4 rounded-xl border border-navy-700 bg-navy-800/50 p-4">
              <h3 className="text-lg font-semibold text-white">{selectedResult.deal.leadName}</h3>
              <p className="text-sm text-gray-400">
                {selectedResult.deal.propertyAddress}, {selectedResult.deal.propertyCity},{" "}
                {selectedResult.deal.propertyState} {selectedResult.deal.propertyZip}
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <Badge color="blue">{selectedResult.deal.propertyType || "Type not listed"}</Badge>
                <Badge color="gold">MAO: {formatCurrency(selectedResult.deal.estimatedMAO)}</Badge>
                <span className="rounded bg-navy-700 px-1.5 py-0.5 text-gray-400">
                  Repairs: {selectedResult.deal.repairs}
                </span>
              </div>
            </div>

            {/* Matched buyers */}
            <div className="space-y-3">
              {selectedResult.matches.map((match) => (
                <div
                  key={match.buyer.id}
                  onClick={() => onSelectBuyer(match.buyer)}
                  className="cursor-pointer rounded-xl border border-navy-700 bg-navy-800/50 p-4 transition-all hover:border-navy-600 hover:bg-navy-800/80"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="text-sm font-semibold text-white">{match.buyer.name}</h4>
                        <MatchBadge strength={match.strength} />
                      </div>
                      <p className="text-xs text-gray-400">
                        {match.buyer.email} · {match.buyer.phone}
                      </p>
                    </div>
                    <div className="text-right text-xs">
                      <p className="text-gray-400">
                        Max: {formatCurrency(match.buyer.maxPurchasePrice)}
                      </p>
                      <p className="text-gray-500">{match.buyer.desiredROI}% ROI</p>
                    </div>
                  </div>

                  {/* Match criteria breakdown */}
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                    {match.matchedOn.map((criterion) => (
                      <span
                        key={criterion}
                        className="rounded-full bg-green-500/10 border border-green-500/20 px-2 py-0.5 text-green-300"
                      >
                        ✓ {criterion}
                      </span>
                    ))}
                    {match.missedOn.map((criterion) => (
                      <span
                        key={criterion}
                        className="rounded-full bg-red-500/10 border border-red-500/20 px-2 py-0.5 text-red-300"
                      >
                        ✗ {criterion}
                      </span>
                    ))}
                  </div>

                  {/* Score bar */}
                  <div className="mt-3 flex items-center gap-2">
                    <div className="flex-1 rounded-full bg-navy-700 h-1.5 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          match.strength === "strong"
                            ? "bg-green-500"
                            : match.strength === "good"
                              ? "bg-amber-500"
                              : "bg-gray-500"
                        }`}
                        style={{ width: `${(match.score / match.total) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500">
                      {match.score}/{match.total}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Auto-Match View (PH1-B5 marketplace matcher) ---

/** Lead option shape returned by fetchLeadsForMatch (picker only). */
interface LeadOption {
  id: string;
  fullName: string;
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  propertyZip: string;
  propertyType: string;
}

function AutoMatchView() {
  const [leads, setLeads] = useState<LeadOption[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [selectedLeadId, setSelectedLeadId] = useState<string>("");
  const [result, setResult] = useState<{ lead: LeadForMatch | null; matches: BuyerMatchResult[] } | null>(null);
  const [running, setRunning] = useState(false);
  const [ranOnce, setRanOnce] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchLeadsForMatch()
      .then((data: LeadOption[]) => {
        if (cancelled) return;
        setLeads(data);
        // ?lead=ID pre-selects and auto-runs the match for that real lead.
        const preset = new URLSearchParams(window.location.search).get("lead");
        if (preset && data.some((l) => l.id === preset)) {
          setSelectedLeadId(preset);
          setRunning(true);
          runAutoMatch({ data: { leadId: preset } })
            .then((res) => {
              if (!cancelled) {
                setResult(res);
                setRanOnce(true);
              }
            })
            .finally(() => {
              if (!cancelled) setRunning(false);
            });
        }
      })
      .catch(() => {
        if (!cancelled) setLeads([]);
      })
      .finally(() => {
        if (!cancelled) setLeadsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  async function handleRun() {
    if (!selectedLeadId) return;
    setRunning(true);
    try {
      const res = await runAutoMatch({ data: { leadId: selectedLeadId } });
      setResult(res);
      setRanOnce(true);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Lead picker */}
      <div className="rounded-xl border border-navy-700 bg-navy-800/50 p-4">
        <h3 className="text-sm font-semibold text-white mb-3">Match buyers to a lead</h3>
        {leadsLoading ? (
          <p className="text-sm text-gray-500">Loading leads…</p>
        ) : leads.length === 0 ? (
          <p className="rounded-lg border border-dashed border-navy-700 bg-navy-900/30 p-3 text-sm text-gray-500">
            No leads to match against — add leads to the CRM first.
          </p>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row">
            <select
              value={selectedLeadId}
              onChange={(e) => setSelectedLeadId(e.target.value)}
              className="flex-1 rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-sm text-white focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500"
            >
              <option value="">Select a lead…</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.fullName} — {l.propertyAddress}, {l.propertyCity} {l.propertyZip}
                </option>
              ))}
            </select>
            <button
              onClick={handleRun}
              disabled={!selectedLeadId || running}
              className="rounded-lg bg-gold-500 px-5 py-2 text-sm font-semibold text-navy-900 transition-colors hover:bg-gold-400 disabled:opacity-50 whitespace-nowrap"
            >
              {running ? "Matching…" : "Match buyers"}
            </button>
          </div>
        )}
        <p className="mt-2 text-xs text-gray-600">
          Uses each buyer's buy-box (markets / zips / price band / property type / rehab budget). Buyers
          outside a stated market are never surfaced. Open this page with <code className="text-gray-400">/buyers?lead=ID</code> to
          auto-match a specific lead.
        </p>
      </div>

      {/* Results */}
      {!ranOnce && !running && (
        <div className="rounded-xl border border-dashed border-navy-700 bg-navy-800/30 p-10 text-center">
          <p className="text-sm text-gray-500">Pick a lead and run the match to see ranked buyers with reasons.</p>
        </div>
      )}

      {result && result.lead && (
        <div className="rounded-xl border border-navy-700 bg-navy-800/50 p-4">
          <h4 className="text-sm font-semibold text-white">{result.lead.fullName}</h4>
          <p className="text-xs text-gray-400">
            {result.lead.propertyAddress}, {result.lead.propertyCity}, {result.lead.propertyState} {result.lead.propertyZip}
            {" · "}{result.lead.propertyType || "type unknown"}
            {" · "}stage: {result.lead.pipelineStage}
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <Badge color="gold">
              {result.lead.price !== null ? `Price for matching: ${formatCurrency(result.lead.price)} (${result.lead.priceSource})` : "No price data (no analysis or score data)"}
            </Badge>
            <span className="rounded bg-navy-700 px-1.5 py-0.5 text-gray-400">
              Repairs: {result.lead.repairs !== null ? formatCurrency(result.lead.repairs) : "unknown"}
            </span>
          </div>
        </div>
      )}

      {result && result.lead && result.matches.length === 0 && (
        <div className="rounded-xl border border-dashed border-navy-700 bg-navy-800/30 p-10 text-center">
          <svg
            className="mx-auto mb-3 h-10 w-10 text-navy-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M18.364 5.636a9 9 0 010 12.728M5.636 5.636a9 9 0 000 12.728M8.05 8.05a5 5 0 000 7.9M15.95 8.05a5 5 0 010 7.9"
            />
          </svg>
          <p className="text-sm text-gray-500">No active buyers match this lead</p>
          <p className="mt-1 text-xs text-gray-600">
            Either no buyer covers this market/price/type, or the buyers that would are inactive or unverified.
          </p>
        </div>
      )}

      {result && result.lead && result.matches.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-white">
            {result.matches.length} buyer{result.matches.length !== 1 ? "s" : ""} match
          </h4>
          {result.matches.map((m) => (
            <div key={m.buyer.id} className="rounded-xl border border-navy-700 bg-navy-800/50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="text-sm font-semibold text-white">{m.buyer.name}</h4>
                    {m.buyer.verifiedPhone && <Badge color="blue">phone ✓</Badge>}
                    {!m.buyer.active && <Badge color="red">inactive</Badge>}
                  </div>
                  <p className="text-xs text-gray-400">
                    {m.buyer.email || "—"} · {m.buyer.phone || "—"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-gold-400">{m.score}%</p>
                  <p className="text-[10px] uppercase tracking-wider text-gray-500">match</p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                {m.matched.map((reason) => (
                  <span key={reason} className="rounded-full bg-green-500/10 border border-green-500/20 px-2 py-0.5 text-green-300">✓ {reason}</span>
                ))}
                {m.missed.map((reason) => (
                  <span key={reason} className="rounded-full bg-red-500/10 border border-red-500/20 px-2 py-0.5 text-red-300">✗ {reason}</span>
                ))}
                {m.neutral.map((reason) => (
                  <span key={reason} className="rounded-full bg-gray-500/10 border border-gray-500/20 px-2 py-0.5 text-gray-400">• {reason}</span>
                ))}
              </div>

              <div className="mt-3 flex items-center gap-2">
                <div className="flex-1 rounded-full bg-navy-700 h-1.5 overflow-hidden">
                  <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${m.score}%` }} />
                </div>
                <span className="text-xs text-gray-500">{m.score}% of evaluated criteria</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Page Component ---

function BuyersPage() {
  const [buyers, setBuyers] = useState<MarketplaceBuyer[]>([]);
  const [deals, setDeals] = useState<DealForMatch[]>([]);
  const [viewTab, setViewTab] = useState<ViewTab>("list");
  const [search, setSearch] = useState("");
  const [selectedBuyer, setSelectedBuyer] = useState<MarketplaceBuyer | null>(null);
  const [editingBuyer, setEditingBuyer] = useState<MarketplaceBuyer | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dealsLoading, setDealsLoading] = useState(true);

  // Load buyers from the real database. An empty result stays empty — the UI
  // shows an honest empty state instead of fabricated people (audit #11).
  useEffect(() => {
    let cancelled = false;
    fetchBuyers()
      .then((data: MarketplaceBuyer[]) => {
        if (!cancelled) setBuyers(data);
      })
      .catch(() => {
        if (!cancelled) setBuyers([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Load real matchable deals (leads at offer/contract stages with a saved
  // deal analysis). No fabricated deals when none exist (audit #11).
  useEffect(() => {
    let cancelled = false;
    fetchMatchableDeals()
      .then((data: DealForMatch[]) => {
        if (!cancelled) setDeals(data);
      })
      .catch(() => {
        if (!cancelled) setDeals([]);
      })
      .finally(() => {
        if (!cancelled) setDealsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const legacyBuyers = useMemo(() => buyers.map(toLegacyBuyer), [buyers]);

  function handleAdd() {
    setEditingBuyer(null);
    setShowForm(true);
  }

  function handleEdit(buyer: MarketplaceBuyer) {
    setEditingBuyer(buyer);
    setSelectedBuyer(null);
    setShowForm(true);
  }

  async function handleSave(data: BuyerFormData) {
    try {
      if (editingBuyer?.id) {
        const updated = await updateBuyerDb({
          data: { ...data, id: editingBuyer.id },
        });
        setBuyers((prev) => prev.map((b) => (b.id === editingBuyer.id ? updated : b)));
        setSelectedBuyer(updated);
      } else {
        const created = await addBuyerDb({ data });
        setBuyers((prev) => [...prev, created]);
      }
      setShowForm(false);
      setEditingBuyer(null);
    } catch {
      // No local-only fallback: an unsaved buyer must never appear in the list.
      alert("Couldn't save the buyer — the database is unavailable. No changes were made.");
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteBuyerDb({ data: { id } });
      setBuyers((prev) => prev.filter((b) => b.id !== id));
      setSelectedBuyer(null);
    } catch {
      alert("Couldn't delete the buyer — the database is unavailable. No changes were made.");
    }
  }

  async function handleMarkVerified(id: string) {
    try {
      const updated = await markBuyerVerified({ data: { id, operator: "buyers-ui" } });
      setBuyers((prev) => prev.map((b) => (b.id === id ? updated : b)));
      setSelectedBuyer((prev) => (prev && prev.id === id ? updated : prev));
    } catch {
      alert("Couldn't record verification — the database is unavailable. No changes were made.");
    }
  }

  function handleSelectBuyer(buyer: MarketplaceBuyer) {
    setSelectedBuyer(buyer);
  }

  const activeCount = buyers.filter((b) => b.active).length;

  return (
    <div className="min-h-dvh">
      {/* Page Header */}
      <div className="border-b border-navy-700 bg-navy-800/50">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white sm:text-3xl">Buyer Marketplace</h1>
              <p className="mt-1 text-gray-400">
                {buyers.length} buyer{buyers.length !== 1 ? "s" : ""} in network · {activeCount} active
              </p>
            </div>

            {/* Tab Toggle */}
            <div className="flex rounded-lg border border-navy-700 bg-navy-800 p-1">
              <button
                onClick={() => setViewTab("list")}
                className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  viewTab === "list" ? "bg-navy-700 text-white" : "text-gray-400 hover:text-white"
                }`}
              >
                Buyer List
              </button>
              <button
                onClick={() => setViewTab("match")}
                className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  viewTab === "match" ? "bg-navy-700 text-white" : "text-gray-400 hover:text-white"
                }`}
              >
                Match Deals
              </button>
              <button
                onClick={() => setViewTab("automatch")}
                className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  viewTab === "automatch" ? "bg-navy-700 text-white" : "text-gray-400 hover:text-white"
                }`}
              >
                Auto-Match
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {viewTab === "list" ? (
          loading && buyers.length === 0 ? (
            <div className="rounded-xl border border-dashed border-navy-700 bg-navy-800/30 p-12 text-center">
              <p className="text-sm text-gray-500">Loading buyers…</p>
            </div>
          ) : (
            <BuyerListView
              buyers={buyers}
              search={search}
              onSearchChange={setSearch}
              onSelect={handleSelectBuyer}
              onAdd={handleAdd}
            />
          )
        ) : viewTab === "match" ? (
          dealsLoading ? (
            <div className="rounded-xl border border-dashed border-navy-700 bg-navy-800/30 p-12 text-center">
              <p className="text-sm text-gray-500">Loading deals…</p>
            </div>
          ) : (
            <MatchingView
              buyers={legacyBuyers}
              deals={deals}
              onSelectBuyer={(b) => {
                const full = buyers.find((mb) => mb.id === b.id);
                if (full) handleSelectBuyer(full);
              }}
            />
          )
        ) : (
          <AutoMatchView />
        )}
      </div>

      {/* Buyer Detail Modal */}
      {selectedBuyer && !showForm && (
        <BuyerDetailModal
          buyer={selectedBuyer}
          onClose={() => setSelectedBuyer(null)}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onMarkVerified={handleMarkVerified}
        />
      )}

      {/* Add/Edit Buyer Form */}
      {showForm && (
        <BuyerForm
          buyer={editingBuyer}
          onSave={handleSave}
          onCancel={() => {
            setShowForm(false);
            setEditingBuyer(null);
          }}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute("/buyers")({
  component: () => (
    <OwnerGate>
      <BuyersPage />
    </OwnerGate>
  ),
  head: () => ({
    meta: [
      { title: "Buyer Marketplace — DealForge Properties" },
      {
        name: "description",
        content: "Manage cash buyers, buy-box criteria and auto-match deals with DealForge Properties's buyer network.",
      },
    ],
  }),
});
