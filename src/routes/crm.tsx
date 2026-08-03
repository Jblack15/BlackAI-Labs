import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useMemo, useEffect } from "react";

// --- Types ---
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

type PipelineStage =
  | "new"
  | "contacted"
  | "qualified"
  | "appointment"
  | "offer"
  | "contract"
  | "closed"
  | "dead";

type ViewMode = "board" | "list";

// --- Pipeline Config ---
const PIPELINE_STAGES: { key: PipelineStage; label: string }[] = [
  { key: "new", label: "New Lead" },
  { key: "contacted", label: "Contacted" },
  { key: "qualified", label: "Qualified" },
  { key: "appointment", label: "Appt. Set" },
  { key: "offer", label: "Offer Made" },
  { key: "contract", label: "Contract Signed" },
  { key: "closed", label: "Closed Won" },
  { key: "dead", label: "Dead" },
];

const STATUS_COLORS: Record<PipelineStage, string> = {
  new: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  contacted: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  qualified: "bg-teal-500/20 text-teal-300 border-teal-500/30",
  appointment: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  offer: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  contract: "bg-green-500/20 text-green-300 border-green-500/30",
  closed: "bg-gold-500/20 text-gold-300 border-gold-500/30",
  dead: "bg-red-500/20 text-red-300 border-red-500/30",
};

const SOURCE_LABELS: Record<string, string> = {
  "tax-delinquent": "Tax Delinquent",
  probate: "Probate",
  vacant: "Vacant",
  absentee: "Absentee",
  "pre-foreclosure": "Pre-Foreclosure",
  "code-violations": "Code Violations",
  "tired-landlord": "Tired Landlord",
  "high-equity": "High Equity",
  divorce: "Divorce",
  eviction: "Eviction",
  "expired-listing": "Expired Listing",
};

// --- Mock Data ---
const MOCK_LEADS: Lead[] = [
  {
    id: "1",
    full_name: "James Rodriguez",
    email: "james.r@email.com",
    phone: "(512) 555-0101",
    property_address: "1423 Elm Street",
    property_city: "Austin",
    property_state: "TX",
    property_zip: "78701",
    property_type: "Single Family",
    property_condition: "Fair",
    estimated_repairs: "25,000 - 40,000",
    reason_for_selling: "Inherited property, out of state owner",
    desired_timeline: "ASAP",
    mortgage_status: "Paid off",
    notes: "Inherited from aunt. Tenant occupied but lease ending soon.",
    lead_source: "probate",
    status: "new",
    created_at: "2026-07-30T09:15:00Z",
  },
  {
    id: "2",
    full_name: "Maria Gonzalez",
    email: "maria.g@email.com",
    phone: "(210) 555-0202",
    property_address: "890 Oak Drive",
    property_city: "San Antonio",
    property_state: "TX",
    property_zip: "78209",
    property_type: "Single Family",
    property_condition: "Poor",
    estimated_repairs: "50,000 - 75,000",
    reason_for_selling: "Behind on taxes, facing lien",
    desired_timeline: "Within 30 days",
    mortgage_status: "Delinquent",
    notes: "Tax lien of $12,400. Needs roof and foundation work.",
    lead_source: "tax-delinquent",
    status: "new",
    created_at: "2026-07-29T14:30:00Z",
  },
  {
    id: "3",
    full_name: "David Chen",
    email: "david.c@email.com",
    phone: "(214) 555-0303",
    property_address: "455 Pine Lane",
    property_city: "Dallas",
    property_state: "TX",
    property_zip: "75201",
    property_type: "Duplex",
    property_condition: "Good",
    estimated_repairs: "10,000 - 15,000",
    reason_for_selling: "Tired landlord, tenant issues",
    desired_timeline: "1-2 months",
    mortgage_status: "Current",
    notes: "Both units currently vacant after eviction. Wants out of landlording.",
    lead_source: "tired-landlord",
    status: "contacted",
    created_at: "2026-07-28T11:00:00Z",
  },
  {
    id: "4",
    full_name: "Patricia Williams",
    email: "pat.w@email.com",
    phone: "(713) 555-0404",
    property_address: "2200 Maple Avenue",
    property_city: "Houston",
    property_state: "TX",
    property_zip: "77002",
    property_type: "Single Family",
    property_condition: "Fair",
    estimated_repairs: "20,000 - 30,000",
    reason_for_selling: "Pre-foreclosure, need to sell fast",
    desired_timeline: "ASAP",
    mortgage_status: "Behind 3 payments",
    notes: "Bank has started pre-foreclosure process. Owe $180k, ARV ~$290k.",
    lead_source: "pre-foreclosure",
    status: "contacted",
    created_at: "2026-07-27T10:45:00Z",
  },
  {
    id: "5",
    full_name: "Robert Kim",
    email: "robert.k@email.com",
    phone: "(512) 555-0505",
    property_address: "77 Canyon Ridge Rd",
    property_city: "Round Rock",
    property_state: "TX",
    property_zip: "78664",
    property_type: "Single Family",
    property_condition: "Average",
    estimated_repairs: "15,000 - 25,000",
    reason_for_selling: "Relocating for work",
    desired_timeline: "Within 60 days",
    mortgage_status: "Current",
    notes: "Motivated. Relocating to Seattle. Needs to close before moving.",
    lead_source: "high-equity",
    status: "qualified",
    created_at: "2026-07-26T16:00:00Z",
  },
  {
    id: "6",
    full_name: "Linda Thompson",
    email: "linda.t@email.com",
    phone: "(817) 555-0606",
    property_address: "333 Birch Street",
    property_city: "Fort Worth",
    property_state: "TX",
    property_zip: "76102",
    property_type: "Single Family",
    property_condition: "Poor",
    estimated_repairs: "40,000 - 60,000",
    reason_for_selling: "Code violations, cannot afford repairs",
    desired_timeline: "ASAP",
    mortgage_status: "Paid off",
    notes: "City issued 5 code violations. Needs major work. Owner on fixed income.",
    lead_source: "code-violations",
    status: "appointment",
    created_at: "2026-07-25T08:30:00Z",
  },
  {
    id: "7",
    full_name: "Michael Davis",
    email: "mike.d@email.com",
    phone: "(469) 555-0707",
    property_address: "612 Cedar Court",
    property_city: "Plano",
    property_state: "TX",
    property_zip: "75023",
    property_type: "Single Family",
    property_condition: "Good",
    estimated_repairs: "5,000 - 10,000",
    reason_for_selling: "Divorce, need to liquidate",
    desired_timeline: "30 days",
    mortgage_status: "Current",
    notes: "Both parties want quick sale. ARV $420k, offered $340k.",
    lead_source: "divorce",
    status: "offer",
    created_at: "2026-07-22T13:15:00Z",
  },
  {
    id: "8",
    full_name: "Sarah Johnson",
    email: "sarah.j@email.com",
    phone: "(972) 555-0808",
    property_address: "1890 Walnut Way",
    property_city: "Arlington",
    property_state: "TX",
    property_zip: "76010",
    property_type: "Single Family",
    property_condition: "Average",
    estimated_repairs: "12,000 - 18,000",
    reason_for_selling: "Vacant property, tired of paying taxes",
    desired_timeline: "ASAP",
    mortgage_status: "Paid off",
    notes: "Contract signed 7/21. Assignment fee $18,500. Buyer: CashFlow REI LLC.",
    lead_source: "vacant",
    status: "contract",
    created_at: "2026-07-15T09:00:00Z",
  },
  {
    id: "9",
    full_name: "Thomas Brown",
    email: "tom.b@email.com",
    phone: "(512) 555-0909",
    property_address: "445 Pecan Drive",
    property_city: "Georgetown",
    property_state: "TX",
    property_zip: "78626",
    property_type: "Single Family",
    property_condition: "Fair",
    estimated_repairs: "20,000 - 30,000",
    reason_for_selling: "Absentee owner, tired of managing remotely",
    desired_timeline: "Closed",
    mortgage_status: "Paid off",
    notes: "Closed 7/14. Assignment fee $22,000. ARV $350k, sold at $275k.",
    lead_source: "absentee",
    status: "closed",
    created_at: "2026-07-01T10:30:00Z",
  },
  {
    id: "10",
    full_name: "Karen Miller",
    email: "karen.m@email.com",
    phone: "(281) 555-1010",
    property_address: "900 Spruce Hollow",
    property_city: "Katy",
    property_state: "TX",
    property_zip: "77449",
    property_type: "Townhouse",
    property_condition: "Good",
    estimated_repairs: "3,000 - 5,000",
    reason_for_selling: "Expired listing, wants cash offer",
    desired_timeline: "Not urgent",
    mortgage_status: "Current",
    notes: "DNC — decided to stay. Listed with agent again. Not interested in cash offers.",
    lead_source: "expired-listing",
    status: "dead",
    created_at: "2026-06-28T16:45:00Z",
  },
];

// --- Server Functions ---
const fetchLeads = createServerFn({ method: "GET" }).handler(async () => {
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
      ORDER BY created_at DESC
    `) as Lead[];
    return rows.map((r) => ({
      ...r,
      created_at: String(r.created_at),
    }));
  } catch {
    // Return mock data when DB query fails
    return MOCK_LEADS;
  }
});

const updateLeadStatus = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { id: string; status: string };
    if (!d.id || !d.status) throw new Error("id and status are required");
    return d;
  })
  .handler(async ({ data }) => {
    try {
      const { sql } = await import("~/db");
      await sql`
        UPDATE leads SET status = ${data.status} WHERE id = ${data.id}
      `;

      // Send SMS on certain status changes
      const leadRows = await sql`
        SELECT full_name, phone, property_address, property_city, property_state
        FROM leads WHERE id = ${data.id}
      ` as { full_name: string; phone: string | null; property_address: string; property_city: string; property_state: string }[];

      const lead = leadRows[0];
      if (lead?.phone) {
        const { sendSms } = await import("~/lib/sms");
        const address = `${lead.property_address}, ${lead.property_city}, ${lead.property_state}`;
        let smsMessage = "";

        switch (data.status) {
          case "contacted":
            smsMessage = `Hi ${lead.full_name}, this is DealFlow AI. We'd like to discuss your property at ${address}. When's a good time to talk?`;
            break;
          case "appointment":
            smsMessage = `Great news ${lead.full_name}! Your appointment is confirmed. We'll see you soon to discuss your cash offer for ${address}.`;
            break;
          case "offer":
            smsMessage = `Hi ${lead.full_name}, we've reviewed your property at ${address} and prepared a cash offer. Check your email or call us to discuss.`;
            break;
        }

        if (smsMessage) {
          await sendSms(lead.phone, smsMessage, data.id);
        }
      }

      return { success: true as const };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return { success: false as const, error: msg };
    }
  });

const fetchLeadSmsLogs = createServerFn({ method: "GET" })
  .validator((data: unknown) => {
    const d = data as { leadId: string };
    if (!d.leadId) throw new Error("leadId is required");
    return d;
  })
  .handler(async ({ data }) => {
    try {
      const { sql } = await import("~/db");
      const rows = await sql`
        SELECT id, lead_id, to_phone, message, status, twilio_sid, created_at
        FROM sms_logs
        WHERE lead_id = ${data.leadId}
        ORDER BY created_at DESC
        LIMIT 5
      ` as { id: string; lead_id: string; to_phone: string; message: string; status: string; twilio_sid: string | null; created_at: string }[];
      return rows.map((r) => ({ ...r, created_at: String(r.created_at) }));
    } catch {
      return [];
    }
  });

const skipTrace = createServerFn({ method: "POST" }).validator((data: unknown) => data as { ids?: string[] }).handler(async ({ data }) => { try { const { skipTraceLeads } = await import("~/lib/skip-trace"); return await skipTraceLeads(data.ids); } catch (e) { return { success: false, updated: 0, error: e instanceof Error ? e.message : "Skip trace failed" }; } });
const startOutreach = createServerFn({ method: "POST" }).validator((data: unknown) => data as { leadId: string }).handler(async ({ data }) => { try { const { startSmsOutreach } = await import("~/lib/outreach"); return await startSmsOutreach(data.leadId); } catch (e) { return { success: false, error: e instanceof Error ? e.message : "Outreach failed" }; } });
const bulkOutreach = createServerFn({ method: "POST" }).handler(async () => { try { const { startBulkOutreach } = await import("~/lib/outreach"); return await startBulkOutreach(); } catch (e) { return { success: false, started: 0, error: e instanceof Error ? e.message : "Outreach failed" }; } });
const startEmailOutreach = createServerFn({ method: "POST" }).validator((data: unknown) => data as { leadId: string }).handler(async ({ data }) => { try { const { startEmailOutreach: runDrip } = await import("~/lib/email-outreach"); return await runDrip(data.leadId); } catch (e) { return { success: false, error: e instanceof Error ? e.message : "Email outreach failed" }; } });
const bulkEmailOutreach = createServerFn({ method: "POST" }).handler(async () => { try { const { startBulkEmailOutreach } = await import("~/lib/email-outreach"); return await startBulkEmailOutreach(); } catch (e) { return { success: false, started: 0, error: e instanceof Error ? e.message : "Email outreach failed" }; } });

const sendManualSms = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { leadId: string; message: string };
    if (!d.leadId || !d.message) throw new Error("leadId and message are required");
    return d;
  })
  .handler(async ({ data }) => {
    try {
      const { sql } = await import("~/db");
      const leadRows = await sql`
        SELECT full_name, phone FROM leads WHERE id = ${data.leadId}
      ` as { full_name: string; phone: string | null }[];

      const lead = leadRows[0];
      if (!lead?.phone) {
        return { success: false as const, error: "Lead has no phone number" };
      }

      const { sendSms } = await import("~/lib/sms");
      const result = await sendSms(lead.phone, data.message, data.leadId);
      if (result.success) {
        return { success: true as const, sid: result.sid };
      }
      return { success: false as const, error: result.error || "SMS failed" };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return { success: false as const, error: msg };
    }
  });

// --- Format Helpers ---
function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getStatusLabel(status: PipelineStage): string {
  const stage = PIPELINE_STAGES.find((s) => s.key === status);
  return stage?.label ?? status;
}

function getSourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

// --- Components ---
function StatusBadge({ status }: { status: PipelineStage }) {
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[status]}`}
    >
      {getStatusLabel(status)}
    </span>
  );
}

function LeadCard({
  lead,
  onClick,
}: {
  lead: Lead;
  onClick: (lead: Lead) => void;
}) {
  return (
    <div
      onClick={() => onClick(lead)}
      className="cursor-pointer rounded-xl border border-navy-700 bg-navy-800/50 p-4 transition-all hover:border-navy-600 hover:bg-navy-800/80 hover:shadow-lg"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold text-white">{lead.full_name}</h4>
        <StatusBadge status={lead.status} />
      </div>
      <p className="text-xs text-gray-400">
        {lead.property_city}, {lead.property_state}
      </p>
      <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
        <span className="rounded bg-navy-700 px-1.5 py-0.5 text-[11px]">
          {getSourceLabel(lead.lead_source)}
        </span>
        <span>{formatDate(lead.created_at)}</span>
      </div>
    </div>
  );
}

interface SmsLogEntry {
  id: string;
  lead_id: string;
  to_phone: string;
  message: string;
  status: string;
  twilio_sid: string | null;
  created_at: string;
}

function LeadDetailModal({
  lead,
  onClose,
  onStatusChange,
  smsLogs,
  onSendSms,
  smsSending,
  smsResult,
  onSkipTrace,
  onStartOutreach,
  automationBusy,
}: {
  lead: Lead;
  onClose: () => void;
  onStatusChange: (id: string, status: PipelineStage) => void;
  smsLogs: SmsLogEntry[];
  onSendSms: (leadId: string, message: string) => void;
  smsSending: boolean;
  smsResult: { success: boolean; error?: string } | null;
  onSkipTrace: (id: string) => void;
  onStartOutreach: (id: string) => void;
  onStartEmailOutreach: (id: string) => void;
  automationBusy: boolean;
}) {
  const [smsMessage, setSmsMessage] = useState("");

  // Pre-populate SMS message based on lead status
  const defaultMessages: Record<string, string> = {
    new: `Hi ${lead.full_name}, thanks for your interest in selling your property at ${lead.property_address}. We'd love to learn more. When's a good time to chat?`,
    contacted: `Hi ${lead.full_name}, following up from DealFlow AI about your property at ${lead.property_address}. Let us know if you have any questions!`,
    qualified: `Hi ${lead.full_name}, great news — your property at ${lead.property_address} qualifies for a cash offer. Let's discuss the next steps!`,
    appointment: `Hi ${lead.full_name}, just a reminder about your upcoming appointment to discuss your cash offer for ${lead.property_address}. Looking forward to it!`,
    offer: `Hi ${lead.full_name}, following up on the cash offer we prepared for your property at ${lead.property_address}. Have you had a chance to review it?`,
    contract: `Hi ${lead.full_name}, your contract for ${lead.property_address} is moving forward. We'll keep you updated on the closing process!`,
    closed: `Hi ${lead.full_name}, congratulations on closing the sale of ${lead.property_address}! Thank you for choosing DealFlow AI.`,
    dead: "",
  };

  // Init message when modal opens
  useEffect(() => {
    setSmsMessage(defaultMessages[lead.status] || "");
  }, [lead.id, lead.status]);

  const handleSendSms = () => {
    if (!smsMessage.trim()) return;
    onSendSms(lead.id, smsMessage.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-navy-900/80 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-navy-700 bg-navy-800 shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-navy-700 bg-navy-800/95 px-6 py-4 backdrop-blur">
          <div>
            <h2 className="text-lg font-bold text-white">{lead.full_name}</h2>
            <p className="text-sm text-gray-400">
              {lead.property_address}, {lead.property_city}, {lead.property_state}{" "}
              {lead.property_zip}
            </p>
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

        {/* Body */}
        <div className="space-y-6 px-6 py-4">
          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => onSkipTrace(lead.id)} disabled={automationBusy} className="rounded-lg border border-teal-500/30 bg-teal-500/10 px-4 py-2 text-sm font-medium text-teal-300 disabled:opacity-50">Skip Trace</button>
            <button onClick={() => onStartOutreach(lead.id)} disabled={automationBusy || !lead.phone} className="rounded-lg border border-gold-500/30 bg-gold-500/10 px-4 py-2 text-sm font-medium text-gold-300 disabled:opacity-50">Start SMS Outreach</button>
            <button onClick={() => onStartEmailOutreach(lead.id)} disabled={automationBusy || !lead.email} title={!lead.email ? "Lead has no email address" : "Send email 1 now, schedule follow-ups on days 1, 3, 5, 10"} className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-sm font-medium text-blue-300 disabled:opacity-50">Start Email Outreach</button>
            <Link
              to="/calculator"
              className="rounded-lg bg-gold-500 px-4 py-2 text-sm font-semibold text-navy-900 transition-colors hover:bg-gold-400"
            >
              Calculate Deal
            </Link>
            {lead.status !== "dead" && (
              <button
                onClick={() => onStatusChange(lead.id, "dead")}
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20"
              >
                Mark as Dead
              </button>
            )}
            {lead.status !== "closed" && lead.status !== "dead" && (
              <button
                onClick={() => {
                  const currentIdx = PIPELINE_STAGES.findIndex((s) => s.key === lead.status);
                  if (currentIdx < PIPELINE_STAGES.length - 2) {
                    onStatusChange(lead.id, PIPELINE_STAGES[currentIdx + 1].key);
                  }
                }}
                className="rounded-lg border border-gold-500/30 bg-gold-500/10 px-4 py-2 text-sm font-medium text-gold-400 transition-colors hover:bg-gold-500/20"
              >
                Move to Next Stage →
              </button>
            )}
          </div>

          {/* Status Dropdown */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">
              Pipeline Status
            </label>
            <select
              value={lead.status}
              onChange={(e) => onStatusChange(lead.id, e.target.value as PipelineStage)}
              className="w-full rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-sm text-white focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500"
            >
              {PIPELINE_STAGES.map((stage) => (
                <option key={stage.key} value={stage.key}>
                  {stage.label}
                </option>
              ))}
            </select>
          </div>

          {/* Send SMS */}
          <div className="rounded-lg border border-navy-700 bg-navy-900/50 p-4">
            <h3 className="mb-3 text-sm font-semibold text-white">Send SMS</h3>
            {!lead.phone ? (
              <p className="text-sm text-gray-500">No phone number on file for this lead.</p>
            ) : (
              <>
                <textarea
                  rows={3}
                  value={smsMessage}
                  onChange={(e) => setSmsMessage(e.target.value)}
                  placeholder="Type your SMS message..."
                  className="w-full rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500"
                />
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-gray-500">
                    Sending to: <span className="text-gold-400">{lead.phone}</span>
                  </span>
                  <button
                    onClick={handleSendSms}
                    disabled={smsSending || !smsMessage.trim()}
                    className="rounded-lg bg-gold-500 px-4 py-2 text-sm font-semibold text-navy-900 transition-colors hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {smsSending ? "Sending..." : "Send SMS"}
                  </button>
                </div>
                {smsResult && (
                  <div
                    className={`mt-2 rounded-lg px-3 py-2 text-xs ${
                      smsResult.success
                        ? "bg-green-500/10 border border-green-500/30 text-green-400"
                        : "bg-red-500/10 border border-red-500/30 text-red-400"
                    }`}
                  >
                    {smsResult.success ? "SMS sent successfully!" : smsResult.error || "Failed to send SMS"}
                  </div>
                )}
              </>
            )}

            {/* SMS Log */}
            {smsLogs.length > 0 && (
              <div className="mt-4 space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Recent SMS
                </h4>
                {smsLogs.map((log) => (
                  <div
                    key={log.id}
                    className="rounded-lg border border-navy-700 bg-navy-800 p-3 text-xs"
                  >
                    <div className="flex items-center justify-between text-gray-500">
                      <span
                        className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                          log.status === "sent"
                            ? "bg-green-500/20 text-green-400"
                            : "bg-red-500/20 text-red-400"
                        }`}
                      >
                        {log.status}
                      </span>
                      <span>{new Date(log.created_at).toLocaleString()}</span>
                    </div>
                    <p className="mt-1 text-gray-300">{log.message}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Details Grid */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-white">Lead Details</h3>
            <dl className="grid gap-4 sm:grid-cols-2">
              <DetailItem label="Email" value={lead.email || "—"} />
              <DetailItem label="Phone" value={lead.phone || "—"} />
              <DetailItem label="Lead Source" value={getSourceLabel(lead.lead_source)} />
              <DetailItem label="Date Added" value={new Date(lead.created_at).toLocaleDateString()} />
              <DetailItem label="Property Type" value={lead.property_type || "—"} />
              <DetailItem label="Condition" value={lead.property_condition || "—"} />
              <DetailItem label="Est. Repairs" value={lead.estimated_repairs || "—"} />
              <DetailItem label="Reason for Selling" value={lead.reason_for_selling || "—"} />
              <DetailItem label="Timeline" value={lead.desired_timeline || "—"} />
              <DetailItem label="Mortgage" value={lead.mortgage_status || "—"} />
            </dl>
          </div>

          {/* Notes */}
          {lead.notes && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-white">Notes</h3>
              <p className="rounded-lg border border-navy-700 bg-navy-900/50 p-3 text-sm text-gray-300">
                {lead.notes}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-navy-700 px-6 py-4">
          <button
            onClick={onClose}
            className="w-full rounded-lg border border-navy-600 bg-navy-700 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-navy-600 hover:text-white"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-200">{value}</dd>
    </div>
  );
}

// --- Board View ---
function BoardView({
  leads,
  onCardClick,
  onStatusChange,
}: {
  leads: Lead[];
  onCardClick: (lead: Lead) => void;
  onStatusChange: (id: string, status: PipelineStage) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
      {PIPELINE_STAGES.map((stage) => {
        const stageLeads = leads.filter((l) => l.status === stage.key);

        // For mobile: each stage is a horizontal scroll section
        return (
          <div
            key={stage.key}
            className="flex min-w-0 flex-col rounded-xl border border-navy-700 bg-navy-800/30"
          >
            {/* Column Header */}
            <div className="flex items-center justify-between px-3 py-3 border-b border-navy-700">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                {stage.label}
              </h3>
              <span className="rounded-full bg-navy-700 px-2 py-0.5 text-xs font-medium text-gray-300">
                {stageLeads.length}
              </span>
            </div>

            {/* Cards */}
            <div className="flex-1 space-y-2 overflow-y-auto p-2 min-h-[120px]">
              {stageLeads.length === 0 ? (
                <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-navy-700 text-xs text-gray-600">
                  No leads
                </div>
              ) : (
                stageLeads.map((lead) => (
                  <div key={lead.id} className="relative group">
                    <LeadCard lead={lead} onClick={onCardClick} />
                    {/* Dropdown for quick status change */}
                    <select
                      value={lead.status}
                      onChange={(e) =>
                        onStatusChange(lead.id, e.target.value as PipelineStage)
                      }
                      className="absolute top-2 right-10 z-10 rounded border border-navy-600 bg-navy-800 px-1 py-0.5 text-[10px] text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100 focus:outline-none"
                    >
                      {PIPELINE_STAGES.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- List View ---
function ListView({
  leads,
  onCardClick,
  onStatusChange,
}: {
  leads: Lead[];
  onCardClick: (lead: Lead) => void;
  onStatusChange: (id: string, status: PipelineStage) => void;
}) {
  const [sortField, setSortField] = useState<"created_at" | "full_name" | "property_city">(
    "created_at"
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sortedLeads = useMemo(() => {
    return [...leads].sort((a, b) => {
      let cmp = 0;
      if (sortField === "created_at") {
        cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      } else {
        cmp = String(a[sortField]).localeCompare(String(b[sortField]));
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
  }, [leads, sortField, sortDir]);

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const SortIcon = ({ field }: { field: typeof sortField }) => {
    if (sortField !== field) return <span className="text-navy-600 ml-1">↕</span>;
    return <span className="ml-1 text-gold-500">{sortDir === "asc" ? "↑" : "↓"}</span>;
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-navy-700">
      <table className="w-full min-w-[700px] text-left text-sm">
        <thead>
          <tr className="border-b border-navy-700 bg-navy-800/50">
            <th
              className="cursor-pointer px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400 hover:text-white"
              onClick={() => toggleSort("full_name")}
            >
              Name <SortIcon field="full_name" />
            </th>
            <th
              className="cursor-pointer px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400 hover:text-white"
              onClick={() => toggleSort("property_city")}
            >
              Location <SortIcon field="property_city" />
            </th>
            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
              Status
            </th>
            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
              Source
            </th>
            <th
              className="cursor-pointer px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400 hover:text-white"
              onClick={() => toggleSort("created_at")}
            >
              Date <SortIcon field="created_at" />
            </th>
            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedLeads.map((lead) => (
            <tr
              key={lead.id}
              className="border-b border-navy-700/50 transition-colors hover:bg-navy-800/50"
            >
              <td className="px-4 py-3">
                <button
                  onClick={() => onCardClick(lead)}
                  className="font-medium text-white hover:text-gold-500 transition-colors"
                >
                  {lead.full_name}
                </button>
              </td>
              <td className="px-4 py-3 text-gray-400">
                {lead.property_city}, {lead.property_state}
              </td>
              <td className="px-4 py-3">
                <select
                  value={lead.status}
                  onChange={(e) =>
                    onStatusChange(lead.id, e.target.value as PipelineStage)
                  }
                  className="rounded border border-navy-600 bg-navy-800 px-1.5 py-0.5 text-xs text-gray-300 focus:outline-none focus:border-gold-500"
                >
                  {PIPELINE_STAGES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-4 py-3 text-gray-400 text-xs">
                {getSourceLabel(lead.lead_source)}
              </td>
              <td className="px-4 py-3 text-gray-500 text-xs">
                {formatDate(lead.created_at)}
              </td>
              <td className="px-4 py-3">
                <button
                  onClick={() => onCardClick(lead)}
                  className="text-xs text-gold-500 hover:text-gold-400 transition-colors"
                >
                  View
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Page Component ---
function CrmPage() {
  const [leads, setLeads] = useState<Lead[]>(MOCK_LEADS);
  const [viewMode, setViewMode] = useState<ViewMode>("board");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [smsLogs, setSmsLogs] = useState<SmsLogEntry[]>([]);
  const [smsSending, setSmsSending] = useState(false);
  const [smsResult, setSmsResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [automationBusy, setAutomationBusy] = useState(false);
  const runSkipTrace = async (ids?: string[]) => { setAutomationBusy(true); try { const result = await skipTrace({ data: { ids } }); if (!result.success) alert(result.error); else alert(`Skip trace complete: ${result.updated} lead(s) enriched.`); if (result.success && ids?.[0]) { const refreshed = await fetchLeads(); setLeads(refreshed); setSelectedLead(refreshed.find((l) => l.id === ids[0]) || null); } } catch { alert("Skip trace failed"); } finally { setAutomationBusy(false); } };
  const runOutreach = async (id: string) => { setAutomationBusy(true); try { const result = await startOutreach({ data: { leadId: id } }); if (!result.success) alert(result.error); else alert("SMS outreach started."); } catch { alert("Outreach failed"); } finally { setAutomationBusy(false); } };
  const runEmailOutreach = async (id: string) => { setAutomationBusy(true); try { const result = await startEmailOutreach({ data: { leadId: id } }); if (!result.success) alert(result.error); else alert(`Email outreach started — Email 1 sent, ${result.scheduled || 4} follow-ups scheduled.`); } catch { alert("Email outreach failed"); } finally { setAutomationBusy(false); } };

  // Load leads from server (falls back to mock data)
  useEffect(() => {
    let cancelled = false;
    fetchLeads()
      .then((data: Lead[]) => {
        if (!cancelled && data && data.length > 0) setLeads(data);
      })
      .catch(() => {
        // Already have mock data as default
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Load SMS logs when a lead is selected
  useEffect(() => {
    if (selectedLead) {
      setSmsLogs([]);
      setSmsResult(null);
      fetchLeadSmsLogs({ data: { leadId: selectedLead.id } })
        .then((data) => {
          if (data) setSmsLogs(data);
        })
        .catch(() => {});
    }
  }, [selectedLead?.id]);

  const handleStatusChange = (id: string, newStatus: PipelineStage) => {
    setLeads((prev) =>
      prev.map((l) => (l.id === id ? { ...l, status: newStatus } : l))
    );
    // Update selected lead if it's the one being changed
    setSelectedLead((prev) =>
      prev?.id === id ? { ...prev, status: newStatus } : prev
    );
    // Persist to DB (fire-and-forget — SMS is handled server-side)
    updateLeadStatus({ data: { id, status: newStatus } }).catch(() => {});
  };

  const handleSendSms = async (leadId: string, message: string) => {
    setSmsSending(true);
    setSmsResult(null);
    try {
      const result = await sendManualSms({ data: { leadId, message } });
      setSmsResult({ success: result.success, error: result.success ? undefined : result.error });
      // Reload SMS logs
      if (result.success) {
        const logs = await fetchLeadSmsLogs({ data: { leadId } });
        if (logs) setSmsLogs(logs);
      }
    } catch {
      setSmsResult({ success: false, error: "Network error" });
    } finally {
      setSmsSending(false);
    }
  };

  const pipelineCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    leads.forEach((l) => {
      counts[l.status] = (counts[l.status] || 0) + 1;
    });
    return counts;
  }, [leads]);

  return (
    <div className="min-h-dvh">
      {/* Page Header */}
      <div className="border-b border-navy-700 bg-navy-800/50">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white sm:text-3xl">CRM Pipeline</h1>
              <p className="mt-1 text-gray-400">
                {leads.length} lead{leads.length !== 1 ? "s" : ""} in pipeline
                {loading && (
                  <span className="ml-2 inline-block h-3 w-3 animate-pulse rounded-full bg-gold-500" />
                )}
              </p>
            </div>

            {/* Automation actions */}
            <div className="flex flex-wrap gap-2">
              <button onClick={() => runSkipTrace()} disabled={automationBusy} className="rounded-lg border border-teal-500/30 bg-teal-500/10 px-3 py-2 text-sm font-medium text-teal-300 disabled:opacity-50">{automationBusy ? "Working..." : "Skip Trace All"}</button>
              <button onClick={async () => { setAutomationBusy(true); try { const result = await bulkOutreach(); if (!result.success) alert(result.error); else alert(`Started SMS outreach for ${result.started} qualified lead(s).`); } finally { setAutomationBusy(false); } }} disabled={automationBusy} className="rounded-lg border border-gold-500/30 bg-gold-500/10 px-3 py-2 text-sm font-medium text-gold-300 disabled:opacity-50">Bulk SMS Outreach</button>
              <button onClick={async () => { setAutomationBusy(true); try { const result = await bulkEmailOutreach(); if (!result.success) alert(result.error); else alert(`Started email outreach for ${result.started} qualified lead(s).`); } finally { setAutomationBusy(false); } }} disabled={automationBusy} className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm font-medium text-blue-300 disabled:opacity-50">Bulk Email Outreach</button>
            </div>

            {/* View Toggle */}
            <div className="flex rounded-lg border border-navy-700 bg-navy-800 p-1">
              <button
                onClick={() => setViewMode("board")}
                className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  viewMode === "board"
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
                    d="M4 6h16M4 10h16M4 14h16M4 18h16"
                  />
                </svg>
                Board
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  viewMode === "list"
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
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
                List
              </button>
            </div>
          </div>

          {/* Pipeline Stats Bar */}
          <div className="mt-6 flex flex-wrap gap-2">
            {PIPELINE_STAGES.map((stage) => {
              const count = pipelineCounts[stage.key] || 0;
              return (
                <div
                  key={stage.key}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${STATUS_COLORS[stage.key]}`}
                >
                  <span className="font-medium">{stage.label}</span>
                  <span className="opacity-70">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Pipeline Content */}
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {viewMode === "board" ? (
          <BoardView
            leads={leads}
            onCardClick={setSelectedLead}
            onStatusChange={handleStatusChange}
          />
        ) : (
          <ListView
            leads={leads}
            onCardClick={setSelectedLead}
            onStatusChange={handleStatusChange}
          />
        )}
      </div>

      {/* Lead Detail Modal */}
      {selectedLead && (
        <LeadDetailModal
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onStatusChange={handleStatusChange}
          smsLogs={smsLogs}
          onSendSms={handleSendSms}
          smsSending={smsSending}
          smsResult={smsResult}
          onSkipTrace={(id) => runSkipTrace([id])}
          onStartOutreach={runOutreach}
          onStartEmailOutreach={runEmailOutreach}
          automationBusy={automationBusy}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute("/crm")({
  component: CrmPage,
  head: () => ({
    meta: [
      { title: "CRM Pipeline — DealFlow AI" },
      {
        name: "description",
        content: "Manage your real estate wholesaling pipeline with DealFlow AI's CRM.",
      },
    ],
  }),
});
