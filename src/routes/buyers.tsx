import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useMemo, useEffect } from "react";
import {
  ALL_PROPERTY_TYPES,
  computeMatch,
  rowToBuyer,
  buyerToCriteria,
  type Buyer,
  type BuyerRow,
  type DealForMatch,
  type MatchStrength,
  type PropertyType,
  type BuyerMatch,
} from "~/lib/buyer-match";

// --- Types ---
// Buyer / DealForMatch / MatchStrength / BuyerMatch / computeMatch / mappers
// live in src/lib/buyer-match.ts (PH1-B9) so the Calculator and the Buyers
// page share one matcher. Only the city/zip/price/type buy-box keys exist
// today — B5 buyer-demand fields are absent and never rendered.

interface DealMatchResult {
  deal: DealForMatch;
  matches: BuyerMatch[];
}

type ViewTab = "list" | "match";

// --- Server Functions ---
const fetchBuyers = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { sql } = await import("~/db");
    const rows = (await sql`
      SELECT id, name, email, phone, buying_criteria, created_at
      FROM buyers
      ORDER BY created_at DESC
    `) as BuyerRow[];
    return rows.map(rowToBuyer);
  } catch {
    // Honest empty list — never fabricate buyers (audit #11).
    return [] as Buyer[];
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
const fetchMatchableDeals = createServerFn({ method: "GET" }).handler(async () => {
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

const addBuyerDb = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { name: string; email: string; phone: string; buying_criteria: Record<string, unknown> };
    if (!d.name) throw new Error("Name is required");
    return d;
  })
  .handler(async ({ data }) => {
    const { sql } = await import("~/db");
    const rows = (await sql`
      INSERT INTO buyers (name, email, phone, buying_criteria)
      VALUES (${data.name}, ${data.email || null}, ${data.phone || null}, ${JSON.stringify(data.buying_criteria)})
      RETURNING id, name, email, phone, buying_criteria, created_at
    `) as BuyerRow[];
    return rowToBuyer(rows[0]);
  });

const updateBuyerDb = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { id: string; name: string; email: string; phone: string; buying_criteria: Record<string, unknown> };
    if (!d.id || !d.name) throw new Error("id and name are required");
    return d;
  })
  .handler(async ({ data }) => {
    const { sql } = await import("~/db");
    const rows = (await sql`
      UPDATE buyers
      SET name = ${data.name}, email = ${data.email || null}, phone = ${data.phone || null},
          buying_criteria = ${JSON.stringify(data.buying_criteria)}
      WHERE id = ${data.id}
      RETURNING id, name, email, phone, buying_criteria, created_at
    `) as BuyerRow[];
    return rowToBuyer(rows[0]);
  });

const deleteBuyerDb = createServerFn({ method: "POST" })
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

// --- Helpers ---
// ALL_PROPERTY_TYPES, normalizePropertyType, locationMatch, priceMatch,
// propertyTypeMatch and computeMatch are shared via src/lib/buyer-match.ts.

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(dateStr: string): string {
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

function Badge({ children, color = "gray" }: { children: React.ReactNode; color?: "gray" | "blue" | "green" | "amber" | "gold" }) {
  const colors: Record<string, string> = {
    gray: "bg-gray-500/20 text-gray-300 border-gray-500/30",
    blue: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    green: "bg-green-500/20 text-green-300 border-green-500/30",
    amber: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    gold: "bg-gold-500/20 text-gold-300 border-gold-500/30",
  };
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${colors[color]}`}
    >
      {children}
    </span>
  );
}

// --- Form Component ---

function BuyerForm({
  buyer,
  onSave,
  onCancel,
}: {
  buyer: Partial<Buyer> | null;
  onSave: (data: Omit<Buyer, "id" | "createdAt">) => void;
  onCancel: () => void;
}) {
  const isEditing = buyer?.id !== undefined;
  const [name, setName] = useState(buyer?.name ?? "");
  const [email, setEmail] = useState(buyer?.email ?? "");
  const [phone, setPhone] = useState(buyer?.phone ?? "");
  const [citiesInput, setCitiesInput] = useState(
    buyer?.preferredCities?.join(", ") ?? ""
  );
  const [zipsInput, setZipsInput] = useState(
    buyer?.preferredZips?.join(", ") ?? ""
  );
  const [maxPrice, setMaxPrice] = useState(buyer?.maxPurchasePrice?.toString() ?? "");
  const [propertyTypes, setPropertyTypes] = useState<PropertyType[]>(
    buyer?.propertyTypes ?? []
  );
  const [minBedrooms, setMinBedrooms] = useState(buyer?.minBedrooms?.toString() ?? "0");
  const [minBaths, setMinBaths] = useState(buyer?.minBaths?.toString() ?? "0");
  const [desiredROI, setDesiredROI] = useState(buyer?.desiredROI?.toString() ?? "");
  const [notes, setNotes] = useState(buyer?.notes ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});

  function togglePropertyType(pt: PropertyType) {
    setPropertyTypes((prev) =>
      prev.includes(pt) ? prev.filter((p) => p !== pt) : [...prev, pt]
    );
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "Name is required";
    if (!email.trim()) errs.email = "Email is required";
    if (!phone.trim()) errs.phone = "Phone is required";
    const price = Number(maxPrice);
    if (!maxPrice.trim() || isNaN(price) || price <= 0) errs.maxPrice = "Valid purchase price required";
    if (propertyTypes.length === 0) errs.propertyTypes = "Select at least one property type";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    onSave({
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      preferredCities: citiesInput
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
      preferredZips: zipsInput
        .split(",")
        .map((z) => z.trim())
        .filter(Boolean),
      maxPurchasePrice: Number(maxPrice),
      propertyTypes,
      minBedrooms: Number(minBedrooms) || 0,
      minBaths: Number(minBaths) || 0,
      desiredROI: Number(desiredROI) || 0,
      notes: notes.trim(),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-navy-900/80 backdrop-blur-sm"
        onClick={onCancel}
      />
      <div className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-navy-700 bg-navy-800 shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-navy-700 bg-navy-800/95 px-6 py-4 backdrop-blur">
          <h2 className="text-lg font-bold text-white">
            {isEditing ? "Edit Buyer" : "Add New Buyer"}
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
              className={`w-full rounded-lg border px-3 py-2 text-sm text-white bg-navy-900 focus:outline-none focus:ring-1 ${
                errors.name
                  ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                  : "border-navy-700 focus:border-gold-500 focus:ring-gold-500"
              }`}
              placeholder="e.g., Austin Cash Flow LLC"
            />
            {errors.name && <p className="mt-1 text-xs text-red-400">{errors.name}</p>}
          </div>

          {/* Email + Phone */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
                Email *
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`w-full rounded-lg border px-3 py-2 text-sm text-white bg-navy-900 focus:outline-none focus:ring-1 ${
                  errors.email
                    ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                    : "border-navy-700 focus:border-gold-500 focus:ring-gold-500"
                }`}
                placeholder="deals@example.com"
              />
              {errors.email && <p className="mt-1 text-xs text-red-400">{errors.email}</p>}
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
                Phone *
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={`w-full rounded-lg border px-3 py-2 text-sm text-white bg-navy-900 focus:outline-none focus:ring-1 ${
                  errors.phone
                    ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                    : "border-navy-700 focus:border-gold-500 focus:ring-gold-500"
                }`}
                placeholder="(512) 555-0100"
              />
              {errors.phone && <p className="mt-1 text-xs text-red-400">{errors.phone}</p>}
            </div>
          </div>

          {/* Preferred Cities */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
              Preferred Cities
            </label>
            <input
              type="text"
              value={citiesInput}
              onChange={(e) => setCitiesInput(e.target.value)}
              className="w-full rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-sm text-white focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500"
              placeholder="Austin, Round Rock, Pflugerville"
            />
            <p className="mt-1 text-xs text-gray-500">Comma-separated. Leave blank for all cities.</p>
          </div>

          {/* Preferred Zip Codes */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
              Preferred Zip Codes
            </label>
            <input
              type="text"
              value={zipsInput}
              onChange={(e) => setZipsInput(e.target.value)}
              className="w-full rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-sm text-white focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500"
              placeholder="78701, 78704, 78664"
            />
            <p className="mt-1 text-xs text-gray-500">Comma-separated. Leave blank for all zips.</p>
          </div>

          {/* Max Purchase Price + Desired ROI */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
                Max Purchase Price *
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
                <input
                  type="number"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                  className={`w-full rounded-lg border py-2 pl-7 pr-3 text-sm text-white bg-navy-900 focus:outline-none focus:ring-1 ${
                    errors.maxPrice
                      ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                      : "border-navy-700 focus:border-gold-500 focus:ring-gold-500"
                  }`}
                  placeholder="350000"
                />
              </div>
              {errors.maxPrice && <p className="mt-1 text-xs text-red-400">{errors.maxPrice}</p>}
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
                Desired ROI (%)
              </label>
              <div className="relative">
                <input
                  type="number"
                  value={desiredROI}
                  onChange={(e) => setDesiredROI(e.target.value)}
                  className="w-full rounded-lg border border-navy-700 bg-navy-900 py-2 pl-3 pr-7 text-sm text-white focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500"
                  placeholder="12"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">%</span>
              </div>
            </div>
          </div>

          {/* Property Types */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
              Property Types *
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
            {errors.propertyTypes && (
              <p className="mt-1 text-xs text-red-400">{errors.propertyTypes}</p>
            )}
          </div>

          {/* Min Beds + Baths */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
                Min Bedrooms
              </label>
              <input
                type="number"
                value={minBedrooms}
                onChange={(e) => setMinBedrooms(e.target.value)}
                className="w-full rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-sm text-white focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500"
                min="0"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
                Min Baths
              </label>
              <input
                type="number"
                value={minBaths}
                onChange={(e) => setMinBaths(e.target.value)}
                className="w-full rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-sm text-white focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500"
                min="0"
                step="0.5"
              />
            </div>
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
              className="w-full rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-sm text-white focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500 resize-none"
              placeholder="Buying criteria, preferences, closing speed..."
            />
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
}: {
  buyer: Buyer;
  onClose: () => void;
  onEdit: (buyer: Buyer) => void;
  onDelete: (id: string) => void;
}) {
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
            <p className="text-sm text-gray-400">Cash Buyer</p>
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
            </dl>
          </div>

          {/* Buying Criteria */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-white">Buying Criteria</h3>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-gray-500">Max Price</dt>
                <dd className="text-sm text-gray-200">{formatCurrency(buyer.maxPurchasePrice)}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Desired ROI</dt>
                <dd className="text-sm text-gray-200">{buyer.desiredROI}%</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Min Beds</dt>
                <dd className="text-sm text-gray-200">{buyer.minBedrooms || "Any"}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Min Baths</dt>
                <dd className="text-sm text-gray-200">{buyer.minBaths || "Any"}</dd>
              </div>
            </dl>
          </div>

          {/* Preferred Locations */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-white">Preferred Locations</h3>
            {buyer.preferredCities.length > 0 && (
              <div className="mb-2">
                <p className="text-xs text-gray-500 mb-1">Cities</p>
                <div className="flex flex-wrap gap-1.5">
                  {buyer.preferredCities.map((c) => (
                    <span key={c} className="rounded-full bg-navy-700 px-2.5 py-0.5 text-xs text-gray-300">
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {buyer.preferredZips.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 mb-1">Zip Codes</p>
                <div className="flex flex-wrap gap-1.5">
                  {buyer.preferredZips.map((z) => (
                    <span key={z} className="rounded-full bg-navy-700 px-2.5 py-0.5 text-xs text-gray-300">
                      {z}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {buyer.preferredCities.length === 0 && buyer.preferredZips.length === 0 && (
              <p className="text-sm text-gray-500">All locations considered</p>
            )}
          </div>

          {/* Property Types */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-white">Property Types</h3>
            <div className="flex flex-wrap gap-1.5">
              {buyer.propertyTypes.map((pt) => (
                <Badge key={pt} color="blue">{pt}</Badge>
              ))}
            </div>
          </div>

          {/* Notes */}
          {buyer.notes && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-white">Notes</h3>
              <p className="rounded-lg border border-navy-700 bg-navy-900/50 p-3 text-sm text-gray-300">
                {buyer.notes}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 border-t border-navy-700 px-6 py-4">
          <button
            onClick={() => onEdit(buyer)}
            className="flex-1 rounded-lg border border-gold-500/30 bg-gold-500/10 px-4 py-2 text-sm font-medium text-gold-400 transition-colors hover:bg-gold-500/20"
          >
            Edit
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
  buyers: Buyer[];
  search: string;
  onSearchChange: (v: string) => void;
  onSelect: (buyer: Buyer) => void;
  onAdd: () => void;
}) {
  const filtered = useMemo(() => {
    if (!search.trim()) return buyers;
    const q = search.toLowerCase();
    return buyers.filter((b) => {
      return (
        b.name.toLowerCase().includes(q) ||
        b.email.toLowerCase().includes(q) ||
        b.preferredCities.some((c) => c.toLowerCase().includes(q)) ||
        b.preferredZips.some((z) => z.includes(q)) ||
        b.propertyTypes.some((pt) => pt.toLowerCase().includes(q))
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
              className="cursor-pointer rounded-xl border border-navy-700 bg-navy-800/50 p-5 transition-all hover:border-navy-600 hover:bg-navy-800/80 hover:shadow-lg"
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <h3 className="font-semibold text-white">{buyer.name}</h3>
              </div>
              <div className="space-y-1.5 text-sm text-gray-400">
                <p>{buyer.email}</p>
                <p>{buyer.phone}</p>
                <div className="flex flex-wrap gap-1 pt-1">
                  <Badge color="gold">{formatCurrency(buyer.maxPurchasePrice)} max</Badge>
                  <Badge color="blue">{buyer.desiredROI}% ROI</Badge>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {buyer.propertyTypes.slice(0, 3).map((pt) => (
                  <span key={pt} className="rounded bg-navy-700 px-1.5 py-0.5 text-[11px] text-gray-400">
                    {pt}
                  </span>
                ))}
                {buyer.propertyTypes.length > 3 && (
                  <span className="rounded bg-navy-700 px-1.5 py-0.5 text-[11px] text-gray-400">
                    +{buyer.propertyTypes.length - 3}
                  </span>
                )}
              </div>
              <div className="mt-3 text-xs text-gray-500">
                {buyer.preferredCities.length > 0
                  ? buyer.preferredCities.slice(0, 2).join(", ") +
                    (buyer.preferredCities.length > 2
                      ? ` +${buyer.preferredCities.length - 2} more`
                      : "")
                  : "All locations"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Matching View ---

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

// --- Page Component ---

function BuyersPage() {
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [deals, setDeals] = useState<DealForMatch[]>([]);
  const [viewTab, setViewTab] = useState<ViewTab>("list");
  const [search, setSearch] = useState("");
  const [selectedBuyer, setSelectedBuyer] = useState<Buyer | null>(null);
  const [editingBuyer, setEditingBuyer] = useState<Partial<Buyer> | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dealsLoading, setDealsLoading] = useState(true);

  // Load buyers from the real database. An empty result stays empty — the UI
  // shows an honest empty state instead of fabricated people (audit #11).
  useEffect(() => {
    let cancelled = false;
    fetchBuyers()
      .then((data: Buyer[]) => {
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

  function handleAdd() {
    setEditingBuyer(null);
    setShowForm(true);
  }

  function handleEdit(buyer: Buyer) {
    setEditingBuyer(buyer);
    setSelectedBuyer(null);
    setShowForm(true);
  }

  async function handleSave(data: Omit<Buyer, "id" | "createdAt">) {
    try {
      if (editingBuyer?.id) {
        const updated = await updateBuyerDb({
          data: {
            id: editingBuyer.id,
            name: data.name,
            email: data.email,
            phone: data.phone,
            buying_criteria: buyerToCriteria(data),
          },
        });
        setBuyers((prev) =>
          prev.map((b) => (b.id === editingBuyer.id ? updated : b))
        );
      } else {
        const created = await addBuyerDb({
          data: {
            name: data.name,
            email: data.email,
            phone: data.phone,
            buying_criteria: buyerToCriteria(data),
          },
        });
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

  function handleSelectBuyer(buyer: Buyer) {
    setSelectedBuyer(buyer);
  }

  return (
    <div className="min-h-dvh">
      {/* Page Header */}
      <div className="border-b border-navy-700 bg-navy-800/50">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white sm:text-3xl">Cash Buyers</h1>
              <p className="mt-1 text-gray-400">
                {buyers.length} buyer{buyers.length !== 1 ? "s" : ""} in network
              </p>
            </div>

            {/* Tab Toggle */}
            <div className="flex rounded-lg border border-navy-700 bg-navy-800 p-1">
              <button
                onClick={() => setViewTab("list")}
                className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  viewTab === "list"
                    ? "bg-navy-700 text-white"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                <svg
                  className="mr-1.5 inline-block h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
                Buyer List
              </button>
              <button
                onClick={() => setViewTab("match")}
                className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  viewTab === "match"
                    ? "bg-navy-700 text-white"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                <svg
                  className="mr-1.5 inline-block h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                  />
                </svg>
                Match Deals
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
        ) : dealsLoading ? (
          <div className="rounded-xl border border-dashed border-navy-700 bg-navy-800/30 p-12 text-center">
            <p className="text-sm text-gray-500">Loading deals…</p>
          </div>
        ) : (
          <MatchingView
            buyers={buyers}
            deals={deals}
            onSelectBuyer={handleSelectBuyer}
          />
        )}
      </div>

      {/* Buyer Detail Modal */}
      {selectedBuyer && !showForm && (
        <BuyerDetailModal
          buyer={selectedBuyer}
          onClose={() => setSelectedBuyer(null)}
          onEdit={handleEdit}
          onDelete={handleDelete}
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
  component: BuyersPage,
  head: () => ({
    meta: [
      { title: "Cash Buyers — DealForge Properties" },
      {
        name: "description",
        content: "Manage cash buyers and match deals with DealForge Properties's buyer network.",
      },
    ],
  }),
});
