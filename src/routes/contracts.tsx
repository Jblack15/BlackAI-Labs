import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useEffect, useMemo } from "react";

// --- Types ---

type PipelineStage =
  | "new" | "contacted" | "qualified" | "appointment"
  | "offer" | "contract" | "closed" | "dead";

interface Lead {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  property_address: string;
  property_city: string;
  property_state: string;
  property_zip: string;
  property_type: string;
  property_condition: string;
  estimated_repairs: string;
  reason_for_selling: string;
  desired_timeline: string;
  mortgage_status: string;
  notes: string;
  lead_source: string;
  status: PipelineStage;
  created_at: string;
}

interface Buyer {
  id: string;
  name: string;
  email: string;
  phone: string;
  preferredCities: string[];
  preferredZips: string[];
  maxPurchasePrice: number;
  propertyTypes: string[];
  minBedrooms: number;
  minBaths: number;
  desiredROI: number;
  notes: string;
  createdAt: string;
}

interface BuyerRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  buying_criteria: Record<string, unknown>;
  created_at: string;
}

type ContractType = "purchase" | "assignment";

interface ContractFormData {
  purchasePrice: string;
  earnestMoney: string;
  closingDate: string;
  inspectionPeriod: string;
  assignmentFee: string;
  assigneeName: string;
}

const CONTRACT_READY_STAGES: PipelineStage[] = ["appointment", "offer", "contract"];

const STAGE_LABELS: Record<string, string> = {
  appointment: "Appt. Set",
  offer: "Offer Made",
  contract: "Contract Signed",
};

// --- Mock Data ---
const MOCK_LEADS: Lead[] = [
  {
    id: "6", full_name: "Linda Thompson", email: "linda.t@email.com", phone: "(817) 555-0606",
    property_address: "333 Birch Street", property_city: "Fort Worth", property_state: "TX",
    property_zip: "76102", property_type: "Single Family", property_condition: "Poor",
    estimated_repairs: "40,000 - 60,000", reason_for_selling: "Code violations, cannot afford repairs",
    desired_timeline: "ASAP", mortgage_status: "Paid off",
    notes: "City issued 5 code violations. Needs major work. Owner on fixed income.",
    lead_source: "code-violations", status: "appointment", created_at: "2026-07-25T08:30:00Z",
  },
  {
    id: "7", full_name: "Michael Davis", email: "mike.d@email.com", phone: "(469) 555-0707",
    property_address: "612 Cedar Court", property_city: "Plano", property_state: "TX",
    property_zip: "75023", property_type: "Single Family", property_condition: "Good",
    estimated_repairs: "5,000 - 10,000", reason_for_selling: "Divorce, need to liquidate",
    desired_timeline: "30 days", mortgage_status: "Current",
    notes: "Both parties want quick sale. ARV $420k, offered $340k.",
    lead_source: "divorce", status: "offer", created_at: "2026-07-22T13:15:00Z",
  },
  {
    id: "8", full_name: "Sarah Johnson", email: "sarah.j@email.com", phone: "(972) 555-0808",
    property_address: "1890 Walnut Way", property_city: "Arlington", property_state: "TX",
    property_zip: "76010", property_type: "Single Family", property_condition: "Average",
    estimated_repairs: "12,000 - 18,000", reason_for_selling: "Vacant property, tired of paying taxes",
    desired_timeline: "ASAP", mortgage_status: "Paid off",
    notes: "Contract signed 7/21. Assignment fee $18,500. Buyer: CashFlow REI LLC.",
    lead_source: "vacant", status: "contract", created_at: "2026-07-15T09:00:00Z",
  },
];

const MOCK_BUYERS: Buyer[] = [
  { id: "1", name: "CashFlow REI LLC", email: "deals@cashflowrei.com", phone: "(512) 555-1001",
    preferredCities: ["Austin", "Round Rock", "Georgetown"], preferredZips: ["78701", "78664"],
    maxPurchasePrice: 400000, propertyTypes: ["SFR", "Multi-Family"], minBedrooms: 2, minBaths: 1,
    desiredROI: 15, notes: "Preferred buyer — quick closings", createdAt: "2026-07-15" },
  { id: "2", name: "Lone Star Investments", email: "info@lonestarinv.com", phone: "(214) 555-1002",
    preferredCities: ["Dallas", "Fort Worth", "Arlington"], preferredZips: [],
    maxPurchasePrice: 350000, propertyTypes: ["SFR"], minBedrooms: 3, minBaths: 2,
    desiredROI: 12, notes: "Prefers North Dallas area", createdAt: "2026-07-16" },
  { id: "3", name: "Texan Dream Homes", email: "buy@texandreamhomes.com", phone: "(713) 555-1003",
    preferredCities: ["Houston", "Katy"], preferredZips: ["77002", "77449"],
    maxPurchasePrice: 500000, propertyTypes: ["SFR", "Townhouse", "Condo"], minBedrooms: 2, minBaths: 2,
    desiredROI: 10, notes: "Buy-and-hold investor", createdAt: "2026-07-17" },
  { id: "4", name: "Capital Flip Group", email: "flips@capitalflip.com", phone: "(210) 555-1004",
    preferredCities: ["San Antonio", "Austin"], preferredZips: [],
    maxPurchasePrice: 300000, propertyTypes: ["SFR", "Townhouse"], minBedrooms: 2, minBaths: 1,
    desiredROI: 20, notes: "Fast closer, all cash", createdAt: "2026-07-18" },
  { id: "5", name: "Premier Property Solutions", email: "deals@premierpropsol.com", phone: "(512) 555-1005",
    preferredCities: ["Austin", "Dallas", "Houston"], preferredZips: [],
    maxPurchasePrice: 600000, propertyTypes: ["SFR", "Multi-Family", "Commercial"], minBedrooms: 2, minBaths: 1,
    desiredROI: 14, notes: "Institutional buyer — large portfolio", createdAt: "2026-07-19" },
  { id: "6", name: "Texas Rehab Specialists", email: "offers@txrehab.com", phone: "(817) 555-1006",
    preferredCities: ["Fort Worth", "Arlington"], preferredZips: [],
    maxPurchasePrice: 250000, propertyTypes: ["SFR"], minBedrooms: 2, minBaths: 1,
    desiredROI: 18, notes: "Does own rehab work", createdAt: "2026-07-20" },
  { id: "7", name: "Hill Country Holdings", email: "buy@hillcountryholdings.com", phone: "(830) 555-1007",
    preferredCities: ["Georgetown", "Round Rock", "Kyle"], preferredZips: [],
    maxPurchasePrice: 450000, propertyTypes: ["SFR", "Land"], minBedrooms: 3, minBaths: 2,
    desiredROI: 11, notes: "Looking for suburban properties", createdAt: "2026-07-21" },
  { id: "8", name: "Metroplex Acquisitions", email: "metro@metroplexacq.com", phone: "(469) 555-1008",
    preferredCities: ["Dallas", "Plano", "Richardson"], preferredZips: [],
    maxPurchasePrice: 500000, propertyTypes: ["SFR", "Townhouse", "Condo"], minBedrooms: 2, minBaths: 2,
    desiredROI: 13, notes: "Quick due diligence", createdAt: "2026-07-22" },
];

// --- Helpers ---
function rowToBuyer(row: BuyerRow): Buyer {
  const c = row.buying_criteria || {};
  return {
    id: row.id,
    name: row.name,
    email: row.email || "",
    phone: row.phone || "",
    preferredCities: (c.preferredCities as string[]) || [],
    preferredZips: (c.preferredZips as string[]) || [],
    maxPurchasePrice: (c.maxPurchasePrice as number) || 0,
    propertyTypes: (c.propertyTypes as string[]) || [],
    minBedrooms: (c.minBedrooms as number) || 0,
    minBaths: (c.minBaths as number) || 0,
    desiredROI: (c.desiredROI as number) || 0,
    notes: (c.notes as string) || "",
    createdAt: String(row.created_at),
  };
}

// --- Server Functions ---
const fetchContractLeads = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { sql } = await import("~/db");
    const rows = (await sql`
      SELECT
        id, full_name, email, phone,
        property_address, property_city, property_state, property_zip,
        property_type, property_condition, estimated_repairs,
        reason_for_selling, desired_timeline, mortgage_status,
        notes, lead_source, status, created_at
      FROM leads
      WHERE status IN ('appointment', 'offer', 'contract')
      ORDER BY created_at DESC
    `) as Lead[];
    return rows.map((r) => ({ ...r, created_at: String(r.created_at) }));
  } catch {
    return MOCK_LEADS;
  }
});

const fetchBuyersForContracts = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { sql } = await import("~/db");
    const rows = (await sql`
      SELECT id, name, email, phone, buying_criteria, created_at
      FROM buyers
      ORDER BY name ASC
    `) as BuyerRow[];
    return rows.map(rowToBuyer);
  } catch {
    return MOCK_BUYERS;
  }
});

const saveContractDb = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as {
      lead_id: string;
      buyer_id?: string;
      contract_type: string;
      purchase_price?: number;
      assignment_fee?: number;
      earnest_money?: number;
      closing_date?: string;
      contract_data?: Record<string, unknown>;
    };
    if (!d.lead_id || !d.contract_type) throw new Error("lead_id and contract_type are required");
    return d;
  })
  .handler(async ({ data }) => {
    const { sql } = await import("~/db");
    const result = await sql`
      INSERT INTO contracts (
        lead_id, buyer_id, contract_type, status,
        purchase_price, assignment_fee, earnest_money,
        closing_date, contract_data
      )
      VALUES (
        ${data.lead_id},
        ${data.buyer_id || null},
        ${data.contract_type},
        'draft',
        ${data.purchase_price || null},
        ${data.assignment_fee || null},
        ${data.earnest_money || 1000},
        ${data.closing_date ? new Date(data.closing_date).toISOString().split("T")[0] : null},
        ${JSON.stringify(data.contract_data || {})}
      )
      RETURNING id
    `;
    return { success: true as const, id: (result[0] as { id: string }).id };
  });

// --- Default Form Data ---
function defaultFormData(): ContractFormData {
  const today = new Date();
  const closing = new Date(today);
  closing.setDate(closing.getDate() + 30);
  return {
    purchasePrice: "",
    earnestMoney: "1000",
    closingDate: closing.toISOString().split("T")[0],
    inspectionPeriod: "7",
    assignmentFee: "15000",
    assigneeName: "",
  };
}

// --- Components ---

function ContractsPage() {
  const [leads, setLeads] = useState<Lead[]>(MOCK_LEADS);
  const [buyers, setBuyers] = useState<Buyer[]>(MOCK_BUYERS);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [contractType, setContractType] = useState<ContractType>("purchase");
  const [selectedBuyer, setSelectedBuyer] = useState<string>("");
  const [formData, setFormData] = useState<ContractFormData>(defaultFormData());
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchContractLeads(),
      fetchBuyersForContracts(),
    ]).then(([leadData, buyerData]) => {
      if (cancelled) return;
      if (leadData && leadData.length > 0) setLeads(leadData);
      if (buyerData && buyerData.length > 0) setBuyers(buyerData);
    }).catch(() => {}).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const handleSelectLead = (lead: Lead) => {
    setSelectedLead(lead);
    setFormData(defaultFormData());
    setSelectedBuyer("");
    setSaveStatus("idle");
  };

  const handlePrint = () => {
    window.print();
  };

  const handleSave = async () => {
    if (!selectedLead) return;
    setSaveStatus("saving");
    try {
      await saveContractDb({
        data: {
          lead_id: selectedLead.id,
          buyer_id: selectedBuyer || undefined,
          contract_type: contractType,
          purchase_price: parseFloat(formData.purchasePrice) || undefined,
          assignment_fee: parseFloat(formData.assignmentFee) || undefined,
          earnest_money: parseFloat(formData.earnestMoney) || 1000,
          closing_date: formData.closingDate || undefined,
          contract_data: { ...formData, assigneeName: selectedBuyer ? buyers.find(b => b.id === selectedBuyer)?.name : formData.assigneeName },
        },
      });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  };

  const formatCurrency = (val: string) => {
    const num = parseFloat(val);
    if (isNaN(num)) return "$0.00";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(num);
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "_______________";
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  };

  const todayFormatted = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const selectedBuyerName = useMemo(() => {
    if (!selectedBuyer) return formData.assigneeName;
    const b = buyers.find((b) => b.id === selectedBuyer);
    return b ? b.name : formData.assigneeName;
  }, [selectedBuyer, buyers, formData.assigneeName]);

  const fullAddress = selectedLead
    ? `${selectedLead.property_address}, ${selectedLead.property_city}, ${selectedLead.property_state} ${selectedLead.property_zip}`
    : "";

  return (
    <div className="min-h-dvh flex flex-col">
      {/* Print-only header */}
      <div className="hidden print:block print:mb-6 print:text-center">
        <h1 className="text-xl font-bold">DealFlow AI</h1>
        <p className="text-sm text-gray-600">Technology-Driven Real Estate Solutions</p>
      </div>

      <div className="flex flex-1 flex-col lg:flex-row">
        {/* Sidebar */}
        <div className="w-full shrink-0 border-b border-navy-700 bg-navy-800/50 lg:w-80 lg:border-b-0 lg:border-r">
          <div className="p-4">
            <h2 className="text-lg font-bold text-white">Contract-Ready Leads</h2>
            <p className="mt-1 text-xs text-gray-400">
              Leads in Appointment, Offer, or Contract stage
            </p>
          </div>
          <div className="space-y-1 px-2 pb-4">
            {loading && (
              <div className="p-4 text-center text-sm text-gray-500">Loading leads...</div>
            )}
            {!loading && leads.length === 0 && (
              <div className="p-4 text-center text-sm text-gray-500">
                No contract-ready leads. Move leads to Appointment or Offer stage in the CRM.
              </div>
            )}
            {leads.map((lead) => (
              <button
                key={lead.id}
                onClick={() => handleSelectLead(lead)}
                className={`w-full rounded-lg px-3 py-3 text-left transition-colors ${
                  selectedLead?.id === lead.id
                    ? "bg-gold-500/10 border border-gold-500/30"
                    : "border border-transparent hover:bg-navy-700/50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-white">{lead.full_name}</span>
                  <span className="rounded-full bg-navy-700 px-2 py-0.5 text-[10px] font-medium text-gray-300">
                    {STAGE_LABELS[lead.status] || lead.status}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-gray-400 truncate">
                  {lead.property_address}, {lead.property_city}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 p-4 sm:p-6 lg:p-8">
          {!selectedLead ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-navy-800">
                  <svg className="h-10 w-10 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-white">Select a Lead</h3>
                <p className="mt-1 text-sm text-gray-400">
                  Choose a lead from the sidebar to generate a contract.
                </p>
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl">
              {/* Controls (hidden on print) */}
              <div className="mb-6 print:hidden">
                <div className="flex flex-wrap items-center gap-3">
                  {/* Contract Type Toggle */}
                  <div className="flex rounded-lg border border-navy-700 bg-navy-800 p-1">
                    <button
                      onClick={() => setContractType("purchase")}
                      className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                        contractType === "purchase"
                          ? "bg-gold-500 text-navy-900"
                          : "text-gray-400 hover:text-white"
                      }`}
                    >
                      Purchase Agreement
                    </button>
                    <button
                      onClick={() => setContractType("assignment")}
                      className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                        contractType === "assignment"
                          ? "bg-gold-500 text-navy-900"
                          : "text-gray-400 hover:text-white"
                      }`}
                    >
                      Assignment Contract
                    </button>
                  </div>

                  <div className="flex-1" />

                  {/* Print Button */}
                  <button
                    onClick={handlePrint}
                    className="rounded-lg border border-navy-600 bg-navy-700 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-navy-600"
                  >
                    <svg className="mr-1.5 inline-block h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                    </svg>
                    Download / Print
                  </button>

                  {/* Save Button */}
                  <button
                    onClick={handleSave}
                    disabled={saveStatus === "saving"}
                    className={`rounded-lg px-5 py-2 text-sm font-semibold transition-colors ${
                      saveStatus === "saved"
                        ? "bg-green-600 text-white"
                        : saveStatus === "error"
                          ? "bg-red-600 text-white"
                          : "bg-gold-500 text-navy-900 hover:bg-gold-400"
                    } disabled:opacity-50`}
                  >
                    {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "✓ Saved!" : saveStatus === "error" ? "✗ Error" : "Save Contract"}
                  </button>
                </div>
              </div>

              {/* Editable Fields Panel (hidden on print) */}
              <div className="mb-6 rounded-xl border border-navy-700 bg-navy-800/50 p-4 print:hidden">
                <h3 className="mb-3 text-sm font-semibold text-white">Contract Details</h3>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {contractType === "purchase" && (
                    <>
                      <FieldInput label="Purchase Price" value={formData.purchasePrice}
                        onChange={(v) => setFormData({ ...formData, purchasePrice: v })} prefix="$" />
                      <FieldInput label="Earnest Money" value={formData.earnestMoney}
                        onChange={(v) => setFormData({ ...formData, earnestMoney: v })} prefix="$" />
                      <FieldInput label="Closing Date" value={formData.closingDate}
                        onChange={(v) => setFormData({ ...formData, closingDate: v })} type="date" />
                      <FieldInput label="Inspection Period (days)" value={formData.inspectionPeriod}
                        onChange={(v) => setFormData({ ...formData, inspectionPeriod: v })} />
                    </>
                  )}
                  {contractType === "assignment" && (
                    <>
                      <FieldInput label="Assignment Fee" value={formData.assignmentFee}
                        onChange={(v) => setFormData({ ...formData, assignmentFee: v })} prefix="$" />
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-400">Assignee</label>
                        <select
                          value={selectedBuyer}
                          onChange={(e) => setSelectedBuyer(e.target.value)}
                          className="w-full rounded-lg border border-navy-600 bg-navy-900 px-3 py-2 text-sm text-white focus:border-gold-500 focus:outline-none"
                        >
                          <option value="">Type manually...</option>
                          {buyers.map((b) => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                          ))}
                        </select>
                        {!selectedBuyer && (
                          <input
                            type="text"
                            value={formData.assigneeName}
                            onChange={(e) => setFormData({ ...formData, assigneeName: e.target.value })}
                            placeholder="Enter assignee name"
                            className="mt-1 w-full rounded-lg border border-navy-600 bg-navy-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-gold-500 focus:outline-none"
                          />
                        )}
                      </div>
                      <FieldInput label="Closing Date" value={formData.closingDate}
                        onChange={(v) => setFormData({ ...formData, closingDate: v })} type="date" />
                    </>
                  )}
                </div>
              </div>

              {/* Contract Document */}
              <div className="rounded-lg border border-gray-300 bg-white p-8 shadow-lg print:border-none print:shadow-none print:p-0">
                <div className="font-serif text-black">
                  {contractType === "purchase" ? (
                    <PurchaseAgreement
                      lead={selectedLead}
                      purchasePrice={formatCurrency(formData.purchasePrice || "0")}
                      earnestMoney={formatCurrency(formData.earnestMoney)}
                      closingDate={formData.closingDate}
                      inspectionPeriod={formData.inspectionPeriod}
                      todayFormatted={todayFormatted}
                      fullAddress={fullAddress}
                    />
                  ) : (
                    <AssignmentContract
                      lead={selectedLead}
                      assigneeName={selectedBuyerName}
                      assignmentFee={formatCurrency(formData.assignmentFee)}
                      closingDate={formData.closingDate}
                      todayFormatted={todayFormatted}
                      fullAddress={fullAddress}
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FieldInput({
  label, value, onChange, type = "text", prefix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  prefix?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-400">{label}</label>
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">{prefix}</span>
        )}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full rounded-lg border border-navy-600 bg-navy-900 text-sm text-white placeholder-gray-500 focus:border-gold-500 focus:outline-none ${prefix ? "pl-7 pr-3 py-2" : "px-3 py-2"}`}
        />
      </div>
    </div>
  );
}

function PurchaseAgreement({
  lead, purchasePrice, earnestMoney, closingDate, inspectionPeriod, todayFormatted, fullAddress,
}: {
  lead: Lead;
  purchasePrice: string;
  earnestMoney: string;
  closingDate: string;
  inspectionPeriod: string;
  todayFormatted: string;
  fullAddress: string;
}) {
  return (
    <div className="text-sm leading-relaxed space-y-4">
      <h1 className="text-center text-lg font-bold uppercase tracking-wide">
        Real Estate Purchase Agreement
      </h1>

      <p className="text-center text-xs text-gray-600">
        This Purchase Agreement ("Agreement") is made and entered into as of {todayFormatted}.
      </p>

      <div className="border-t border-b border-gray-300 py-3 space-y-2">
        <p>
          <strong>1. Parties.</strong> This Agreement is between{" "}
          <strong>{lead.full_name}</strong> ("Seller"), whose property address is{" "}
          {fullAddress}, and <strong>DealFlow AI or Assigns</strong> ("Buyer").
        </p>

        <p>
          <strong>2. Property.</strong> Seller agrees to sell and Buyer agrees to buy the real property
          commonly known as <strong>{fullAddress}</strong> (the "Property"), together with all
          improvements, fixtures, and appurtenances.
        </p>

        <p>
          <strong>3. Purchase Price.</strong> The total purchase price for the Property shall be{" "}
          <strong>{purchasePrice}</strong>, payable in cash at closing.
        </p>

        <p>
          <strong>4. Earnest Money.</strong> Upon execution of this Agreement, Buyer shall deposit{" "}
          <strong>{earnestMoney}</strong> as earnest money with the title company, to be credited
          toward the purchase price at closing.
        </p>

        <p>
          <strong>5. Closing Date.</strong> The closing of this transaction shall occur on or before{" "}
          <strong>{formatDateOnly(closingDate)}</strong>, unless extended by mutual written agreement
          of the parties.
        </p>

        <p>
          <strong>6. Inspection Period.</strong> Buyer shall have <strong>{inspectionPeriod} days</strong> from
          the effective date of this Agreement to conduct any and all inspections of the Property.
          Buyer may terminate this Agreement for any reason during the Inspection Period by providing
          written notice to Seller.
        </p>

        <p>
          <strong>7. As-Is Condition.</strong> Seller shall sell the Property in its current
          "AS-IS" condition. Seller makes no representations or warranties regarding the condition
          of the Property, including but not limited to structural integrity, mechanical systems,
          environmental conditions, or any other aspect of the Property. Buyer acknowledges that
          Buyer is purchasing the Property based solely upon Buyer's own inspection and investigation.
        </p>

        <p>
          <strong>8. Assignment.</strong> Buyer may assign this Agreement, or any interest herein, to
          any third party without the consent of Seller. Any such assignment shall not release Buyer
          from liability under this Agreement unless otherwise agreed in writing.
        </p>

        <p>
          <strong>9. Closing Costs.</strong> Each party shall pay their respective closing costs
          as is customary in the jurisdiction where the Property is located, unless otherwise agreed
          in writing.
        </p>

        <p>
          <strong>10. Title.</strong> Seller shall convey marketable title to the Property by
          general warranty deed or equivalent at closing, free and clear of all liens and
          encumbrances except as otherwise agreed.
        </p>

        <p>
          <strong>11. Governing Law.</strong> This Agreement shall be governed by and construed in
          accordance with the laws of the State in which the Property is located.
        </p>

        <p>
          <strong>12. Entire Agreement.</strong> This Agreement constitutes the entire agreement
          between the parties and supersedes all prior negotiations, representations, and
          agreements, whether written or oral. Any modifications must be in writing and signed
          by both parties.
        </p>

        <p>
          <strong>13. Counterparts.</strong> This Agreement may be executed in one or more
          counterparts, each of which shall be deemed an original, and all of which together
          shall constitute one and the same instrument.
        </p>
      </div>

      {/* Signature Blocks */}
      <div className="mt-8 space-y-8">
        <div>
          <p className="font-bold">SELLER:</p>
          <p className="mt-1">________________________________</p>
          <p className="text-xs text-gray-600">{lead.full_name}</p>
          <p className="mt-4">Date: _______________</p>
        </div>

        <div>
          <p className="font-bold">BUYER:</p>
          <p className="mt-1">DealFlow AI or Assigns</p>
          <p className="mt-1">________________________________</p>
          <p className="text-xs text-gray-600">Authorized Representative</p>
          <p className="mt-4">Date: _______________</p>
        </div>
      </div>
    </div>
  );
}

function AssignmentContract({
  lead, assigneeName, assignmentFee, closingDate, todayFormatted, fullAddress,
}: {
  lead: Lead;
  assigneeName: string;
  assignmentFee: string;
  closingDate: string;
  todayFormatted: string;
  fullAddress: string;
}) {
  return (
    <div className="text-sm leading-relaxed space-y-4">
      <h1 className="text-center text-lg font-bold uppercase tracking-wide">
        Assignment of Real Estate Purchase Agreement
      </h1>

      <p className="text-center text-xs text-gray-600">
        This Assignment Agreement is made and entered into as of {todayFormatted}.
      </p>

      <div className="border-t border-b border-gray-300 py-3 space-y-2">
        <p>
          <strong>1. Parties.</strong> This Assignment Agreement is made by and between{" "}
          <strong>DealFlow AI</strong> ("Assignor") and{" "}
          <strong>{assigneeName || "_______________"}</strong> ("Assignee").
        </p>

        <p>
          <strong>2. Recitals.</strong> Whereas, Assignor has entered into a Real Estate Purchase
          Agreement ("Purchase Agreement") dated on or about _______________, with{" "}
          <strong>{lead.full_name}</strong> ("Seller"), for the purchase of the real property
          located at <strong>{fullAddress}</strong> (the "Property").
        </p>

        <p>
          <strong>3. Assignment.</strong> For good and valuable consideration, the receipt and
          sufficiency of which is hereby acknowledged, Assignor hereby assigns, transfers, and
          conveys to Assignee all of Assignor's right, title, and interest in and to the Purchase
          Agreement and the Property.
        </p>

        <p>
          <strong>4. Assignment Fee.</strong> In consideration for this assignment, Assignee shall
          pay to Assignor an assignment fee of <strong>{assignmentFee}</strong>, payable at
          closing on or before <strong>{formatDateOnly(closingDate)}</strong>.
        </p>

        <p>
          <strong>5. Assumption of Obligations.</strong> Assignee hereby accepts the assignment
          and agrees to assume all of Assignor's obligations under the Purchase Agreement, and
          agrees to perform all duties and obligations of the "Buyer" thereunder.
        </p>

        <p>
          <strong>6. Indemnification.</strong> Assignee agrees to indemnify, defend, and hold
          harmless Assignor from and against any and all claims, liabilities, damages, losses,
          and expenses arising out of or relating to Assignee's performance of the Purchase
          Agreement.
        </p>

        <p>
          <strong>7. No Modification.</strong> This Assignment does not modify, amend, or alter
          the terms of the Purchase Agreement in any way. Assignee shall be bound by all terms
          and conditions of the Purchase Agreement.
        </p>

        <p>
          <strong>8. Governing Law.</strong> This Assignment Agreement shall be governed by and
          construed in accordance with the laws of the State in which the Property is located.
        </p>

        <p>
          <strong>9. Counterparts.</strong> This Assignment Agreement may be executed in one or
          more counterparts, each of which shall be deemed an original, and all of which together
          shall constitute one and the same instrument.
        </p>
      </div>

      {/* Signature Blocks */}
      <div className="mt-8 space-y-8">
        <div>
          <p className="font-bold">ASSIGNOR:</p>
          <p className="mt-1">DealFlow AI</p>
          <p className="mt-1">________________________________</p>
          <p className="text-xs text-gray-600">Authorized Representative</p>
          <p className="mt-4">Date: _______________</p>
        </div>

        <div>
          <p className="font-bold">ASSIGNEE:</p>
          <p className="mt-1">{assigneeName || "_______________"}</p>
          <p className="mt-1">________________________________</p>
          <p className="text-xs text-gray-600">Signature</p>
          <p className="mt-4">Date: _______________</p>
        </div>
      </div>
    </div>
  );
}

function formatDateOnly(dateStr: string) {
  if (!dateStr) return "_______________";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export const Route = createFileRoute("/contracts")({
  component: ContractsPage,
  head: () => ({
    meta: [
      { title: "Contracts — DealFlow AI" },
      { name: "description", content: "Generate and manage real estate purchase and assignment contracts." },
    ],
  }),
});
