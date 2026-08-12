import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useMemo, useEffect } from "react";
import type { PostcardCampaign } from "~/lib/postcard-templates";
import { VALID_TRANSITIONS, validNextStages } from "~/lib/pipeline-transitions";

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
  status: string; // legacy status column — kept for backward-compatible tooling
  pipeline_stage: string; // canonical pipeline stage (pipeline_stages table)
  time_in_stage?: string; // humanized time since the lead entered its current stage
  created_at: string;
  score?: number;
  trace_status: string; // NOT_TRACED / IN_PROGRESS / TRACED / STALLED / FAILED / MANUAL
  trace_source: string | null;
  traced_at: string | null;
  dnc_flag: string | null;
  contactable: boolean;
}

interface PipelineStageInfo {
  id: string;
  name: string;
  display_order: number;
  description: string | null;
  color: string | null;
  is_active: boolean;
}

interface PipelineHistoryEntry {
  id: string;
  from_stage: string | null;
  to_stage: string;
  triggered_by: string;
  agent_name: string | null;
  notes: string | null;
  created_at: string;
}

type ViewMode = "board" | "list";

// --- Pipeline config (fallbacks only) ---
// Stages always come from the DB via fetchPipelineStages; this list is only used
// as a resilience fallback when the database is unreachable. It mirrors the
// seed in migration 008 / src/db/seed.ts. It is the canonical pipeline
// vocabulary — NOT fabricated data — so showing empty columns is honest.
const MOCK_STAGES: PipelineStageInfo[] = [
  { id: "1", name: "new_lead", display_order: 1, description: "Lead captured from any source, awaiting enrichment.", color: "slate", is_active: true },
  { id: "2", name: "property_enrichment", display_order: 2, description: "Owner, property and lien data being enriched/skip-traced.", color: "blue", is_active: true },
  { id: "3", name: "ai_qualification", display_order: 3, description: "AI agent scoring motivation, equity and distress signals.", color: "cyan", is_active: true },
  { id: "4", name: "seller_contacted", display_order: 4, description: "First outreach sent to the seller.", color: "purple", is_active: true },
  { id: "5", name: "follow_up", display_order: 5, description: "Nurturing the seller across the follow-up sequence.", color: "violet", is_active: true },
  { id: "6", name: "deal_analysis", display_order: 6, description: "ARV, repairs and MAO being calculated by the deal analyst.", color: "teal", is_active: true },
  { id: "7", name: "offer_recommendation", display_order: 7, description: "AI recommends an offer range for human review.", color: "indigo", is_active: true },
  { id: "8", name: "human_approval", display_order: 8, description: "Offer awaiting human approval gate.", color: "amber", is_active: true },
  { id: "9", name: "offer_sent", display_order: 9, description: "Approved offer presented to the seller.", color: "orange", is_active: true },
  { id: "10", name: "negotiation", display_order: 10, description: "Back-and-forth with the seller on price and terms.", color: "pink", is_active: true },
  { id: "11", name: "contract_prepared", display_order: 11, description: "Contract drafted for the agreed terms.", color: "sky", is_active: true },
  { id: "12", name: "contract_sent", display_order: 12, description: "Contract sent to the seller for signature.", color: "fuchsia", is_active: true },
  { id: "13", name: "contract_signed", display_order: 13, description: "Signed contract in hand — deal is under contract.", color: "emerald", is_active: true },
  { id: "14", name: "buyer_matching", display_order: 14, description: "Matching the contract to cash buyers in the database.", color: "lime", is_active: true },
  { id: "15", name: "buyer_contacted", display_order: 15, description: "Buyer engaged on the assignment.", color: "green", is_active: true },
  { id: "16", name: "assignment", display_order: 16, description: "Assignment agreement signed with the end buyer.", color: "gold", is_active: true },
  { id: "17", name: "closing", display_order: 17, description: "Title/escrow working toward close.", color: "yellow", is_active: true },
  { id: "18", name: "closed_won", display_order: 18, description: "Deal closed — profit captured.", color: "gold", is_active: true },
  { id: "19", name: "closed_lost", display_order: 19, description: "Deal fell through or was abandoned.", color: "red", is_active: true },
];

// Color token -> Tailwind badge classes (design system; tokens come from the
// pipeline_stages.color column).
const STAGE_COLOR_CLASSES: Record<string, string> = {
  slate: "bg-slate-500/20 text-slate-300 border-slate-500/30",
  blue: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  cyan: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  purple: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  violet: "bg-violet-500/20 text-violet-300 border-violet-500/30",
  teal: "bg-teal-500/20 text-teal-300 border-teal-500/30",
  indigo: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
  amber: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  orange: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  pink: "bg-pink-500/20 text-pink-300 border-pink-500/30",
  sky: "bg-sky-500/20 text-sky-300 border-sky-500/30",
  fuchsia: "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30",
  emerald: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  lime: "bg-lime-500/20 text-lime-300 border-lime-500/30",
  green: "bg-green-500/20 text-green-300 border-green-500/30",
  gold: "bg-gold-500/20 text-gold-300 border-gold-500/30",
  yellow: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  red: "bg-red-500/20 text-red-300 border-red-500/30",
};

function stageLabel(name: string | null | undefined): string {
  if (!name) return "New Lead";
  return name
    .split("_")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function stageColor(color: string | null | undefined): string {
  return (color && STAGE_COLOR_CLASSES[color]) || STAGE_COLOR_CLASSES.slate;
}

// Rank of each stage used for lead scoring (higher stage = warmer lead).
const STAGE_RANK: Record<string, number> = {
  new_lead: 0, property_enrichment: 1, ai_qualification: 2, seller_contacted: 3,
  follow_up: 4, deal_analysis: 5, offer_recommendation: 6, human_approval: 7,
  offer_sent: 8, negotiation: 9, contract_prepared: 10, contract_sent: 11,
  contract_signed: 12, buyer_matching: 13, buyer_contacted: 14, assignment: 15,
  closing: 16, closed_won: 17, closed_lost: 18,
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

// Direct-mail postcard campaigns (Click2Mail). "auto" maps each lead to the
// campaign matching its lead_source (see lib/postcard-templates.ts).
const MAIL_CAMPAIGNS = ["general", "pre-foreclosure", "probate", "tax-delinquent"] as const;
const MAIL_CAMPAIGN_LABELS: Record<string, string> = {
  general: "General",
  "pre-foreclosure": "Pre-Foreclosure",
  probate: "Probate / Inherited",
  "tax-delinquent": "Tax Delinquent",
};
const MAIL_COST_PER_PIECE = 0.6;

// --- Server Functions ---
const fetchLeads = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { sql } = await import("~/db");
    const rows = (await sql`
      SELECT
        l.id, l.full_name, l.email, l.phone,
        l.property_address, l.property_city, l.property_state, l.property_zip,
        l.property_type, l.property_condition, l.estimated_repairs,
        l.reason_for_selling, l.desired_timeline, l.mortgage_status,
        l.notes, l.lead_source, l.status, l.created_at,
        COALESCE(NULLIF(l.pipeline_stage, ''), 'new_lead') AS pipeline_stage,
        COALESCE(l.trace_status, 'NOT_TRACED') AS trace_status,
        l.trace_source, l.traced_at, l.dnc_flag, l.contactable,
        COALESCE(pe.entered_at, l.created_at) AS stage_entered_at
      FROM leads l
      LEFT JOIN LATERAL (
        SELECT created_at AS entered_at
        FROM pipeline_events
        WHERE lead_id = l.id
        ORDER BY created_at DESC
        LIMIT 1
      ) pe ON true
      ORDER BY l.created_at DESC
    `) as Array<Lead & { stage_entered_at: string }>;
    return {
      leads: rows.map((r) => ({
        ...r,
        created_at: String(r.created_at),
        pipeline_stage: r.pipeline_stage || "new_lead",
        time_in_stage: humanizeDuration(Date.now() - new Date(r.stage_entered_at).getTime()),
        score: leadScore(r),
      })),
      dbUnavailable: false,
    };
  } catch {
    // DB unreachable: show an honest empty state (no fabricated leads).
    return { leads: [], dbUnavailable: true };
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
            smsMessage = `Hi ${lead.full_name}, this is DealForge Properties. We'd like to discuss your property at ${address}. When's a good time to talk?`;
            break;
          case "offer_sent":
            smsMessage = `Great news ${lead.full_name}! Your appointment is confirmed. We'll see you soon to discuss your cash offer for ${address}.`;
            break;
          case "negotiating":
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
// --- Skip-trace monitor (PH1-B1) ---
const fetchSkipTraceJobs = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { listSkipTraceJobs, getTraceSummary } = await import("~/lib/skip-trace");
    const [jobs, summary] = await Promise.all([listSkipTraceJobs(), getTraceSummary()]);
    return { jobs: jobs.map((j) => ({ ...j })), summary };
  } catch {
    return { jobs: [], summary: null };
  }
});
const runMonitorNow = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const { detectStalledJobs } = await import("~/lib/skip-trace");
    return await detectStalledJobs();
  } catch (e) {
    return { stalled: [], notificationsCreated: 0, error: e instanceof Error ? e.message : "Monitor check failed" };
  }
});
const recordManualTrace = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { leadId: string; phone?: string; email?: string; dncFlag?: string };
    if (!d?.leadId) throw new Error("leadId is required");
    return d;
  })
  .handler(async ({ data }) => {
    try {
      const { markTraceResult } = await import("~/lib/skip-trace");
      return await markTraceResult([data.leadId], {
        source: "manual",
        dncFlag: data.dncFlag || null,
        phone: data.phone || null,
        email: data.email || null,
      });
    } catch (e) {
      return { success: false, updated: 0, error: e instanceof Error ? e.message : "Manual trace failed" };
    }
  });
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

// --- Pipeline server functions ---
// Fetches the canonical pipeline stages from the DB (ordered by display_order).
const fetchPipelineStages = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { sql } = await import("~/db");
    const rows = await sql`
      SELECT id, name, display_order, description, color, is_active
      FROM pipeline_stages
      WHERE is_active = true
      ORDER BY display_order ASC
    ` as PipelineStageInfo[];
    if (rows.length === 0) return MOCK_STAGES;
    return rows;
  } catch {
    return MOCK_STAGES;
  }
});

// Validates and performs a pipeline stage transition (updates leads.pipeline_stage,
// writes a pipeline_events audit row, then evaluates automation rules).
const transitionLeadStage = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { leadId: string; toStage: string; triggeredBy?: string; notes?: string };
    if (!d?.leadId || !d?.toStage) throw new Error("leadId and toStage are required");
    return { leadId: d.leadId, toStage: d.toStage, triggeredBy: d.triggeredBy || "manual", notes: d.notes };
  })
  .handler(async ({ data }) => {
    try {
      const { transitionLead } = await import("~/lib/pipeline");
      return await transitionLead(data.leadId, data.toStage, data.triggeredBy, data.notes);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return { success: false as const, error: msg };
    }
  });

// Fetches the stage-change audit trail for a lead (newest first).
const fetchPipelineHistory = createServerFn({ method: "GET" })
  .validator((data: unknown) => {
    const d = data as { leadId: string };
    if (!d?.leadId) throw new Error("leadId is required");
    return d;
  })
  .handler(async ({ data }) => {
    try {
      const { getPipelineHistory } = await import("~/lib/pipeline");
      return await getPipelineHistory(data.leadId);
    } catch {
      return [];
    }
  });

// --- Direct mail (Click2Mail) ---
const resolveMailCampaign = (campaign?: string): PostcardCampaign | undefined =>
  campaign && (MAIL_CAMPAIGNS as readonly string[]).includes(campaign)
    ? (campaign as PostcardCampaign)
    : undefined;

const sendMailToLead = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { leadId: string; campaign?: string };
    if (!d.leadId) throw new Error("leadId is required");
    return d;
  })
  .handler(async ({ data }) => {
    try {
      const { sendPostcardsToLeads } = await import("~/lib/click2mail");
      return await sendPostcardsToLeads([data.leadId], { campaign: resolveMailCampaign(data.campaign) });
    } catch (e) {
      return { success: false, sent: 0, failed: 0, error: e instanceof Error ? e.message : "Direct mail failed" };
    }
  });

const bulkSendMail = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { ids?: string[]; campaign?: string };
    return { ids: Array.isArray(d?.ids) ? d.ids : [], campaign: d?.campaign };
  })
  .handler(async ({ data }) => {
    try {
      const { sendPostcardsToLeads } = await import("~/lib/click2mail");
      return await sendPostcardsToLeads(data.ids, { campaign: resolveMailCampaign(data.campaign) });
    } catch (e) {
      return { success: false, sent: 0, failed: 0, error: e instanceof Error ? e.message : "Bulk direct mail failed" };
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

function humanizeDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
}

function leadScore(lead: Pick<Lead, "lead_source" | "status" | "pipeline_stage" | "phone" | "email">): number {
  const stage = lead.pipeline_stage || lead.status;
  return Math.min(100, (lead.phone ? 20 : 0) + (lead.email ? 10 : 0) + (["tax-delinquent", "pre-foreclosure", "code-violations"].includes(lead.lead_source) ? 45 : 25) + ((STAGE_RANK[stage] ?? 0) * 1.5));
}
function getSourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

// --- Components ---
function StatusBadge({ stage, stages }: { stage: string; stages: PipelineStageInfo[] }) {
  const info = stages.find((s) => s.name === stage);
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${stageColor(info?.color)}`}
    >
      {stageLabel(stage)}
    </span>
  );
}
// --- Skip-trace status badge (PH1-B1) ---
const TRACE_BADGE_CLASSES: Record<string, string> = {
  NOT_TRACED: "bg-slate-500/20 text-slate-300 border-slate-500/30",
  IN_PROGRESS: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  TRACED: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  STALLED: "bg-red-500/20 text-red-300 border-red-500/30",
  FAILED: "bg-red-500/20 text-red-300 border-red-500/30",
  MANUAL: "bg-gold-500/20 text-gold-300 border-gold-500/30",
};
function TraceBadge({ status }: { status: string }) {
  const cls = TRACE_BADGE_CLASSES[status] || TRACE_BADGE_CLASSES.NOT_TRACED;
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      {status}
    </span>
  );
}
function ContactableDot({ contactable }: { contactable: boolean }) {
  return contactable ? (
    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" title="Contactable — has valid contact info" />
  ) : (
    <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-600" title="Not contactable — no usable contact info" />
  );
}
// --- Skip-trace job panel types (mirror of lib/skip-trace.ts) ---
interface SkipTraceJobRow {
  id: number;
  list_name: string;
  propstream_group_id: string | null;
  status: string;
  total_leads: number | null;
  traced_count: number;
  started_at: string;
  last_progress_at: string;
  error_message: string | null;
  created_at: string;
}
function SkipTracePanel({
  jobs,
  summary,
  onRefresh,
  onMonitor,
  busy,
  lastMessage,
}: {
  jobs: SkipTraceJobRow[];
  summary: { total: number; contactable: number; nonContactable: number } | null;
  onRefresh: () => void;
  onMonitor: () => void;
  busy: boolean;
  lastMessage: string | null;
}) {
  return (
    <div className="mt-6 rounded-xl border border-navy-700 bg-navy-800/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Skip Trace Monitor</h2>
          <p className="text-xs text-gray-500">
            Tracks PropStream Connect / manual trace batches; flags stalled jobs and refuses duplicate runs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onMonitor}
            disabled={busy}
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 disabled:opacity-50"
          >
            Check for stalls
          </button>
          <button
            onClick={onRefresh}
            disabled={busy}
            className="rounded-lg border border-navy-600 bg-navy-700 px-3 py-1.5 text-xs font-medium text-gray-300 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>
      {summary && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-navy-700 bg-navy-900 px-2.5 py-1 text-gray-400">
            {summary.total} leads
          </span>
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-300">
            {summary.contactable} contactable
          </span>
          <span className="rounded-full border border-slate-600/40 bg-slate-700/30 px-2.5 py-1 text-slate-300">
            {summary.nonContactable} not contactable
          </span>
        </div>
      )}
      {lastMessage && (
        <div className="mt-3 rounded-lg border border-navy-700 bg-navy-900/60 px-3 py-2 text-xs text-gray-300">
          {lastMessage}
        </div>
      )}
      {jobs.length === 0 ? (
        <p className="mt-3 text-xs text-gray-500">No skip-trace jobs yet — start one from a lead's Skip Trace button.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead>
              <tr className="border-b border-navy-700 text-gray-500">
                <th className="px-2 py-1.5 font-medium">Job</th>
                <th className="px-2 py-1.5 font-medium">List / Group</th>
                <th className="px-2 py-1.5 font-medium">Status</th>
                <th className="px-2 py-1.5 font-medium">Progress</th>
                <th className="px-2 py-1.5 font-medium">Last progress</th>
                <th className="px-2 py-1.5 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-b border-navy-700/50">
                  <td className="px-2 py-1.5 font-medium text-gray-200">#{job.id}</td>
                  <td className="px-2 py-1.5 text-gray-400">
                    {job.list_name}
                    {job.propstream_group_id ? (
                      <span className="block text-[10px] text-gray-600">{job.propstream_group_id}</span>
                    ) : null}
                  </td>
                  <td className="px-2 py-1.5">
                    <TraceBadge status={job.status} />
                  </td>
                  <td className="px-2 py-1.5 text-gray-400">
                    {job.traced_count}
                    {job.total_leads != null ? ` / ${job.total_leads}` : ""}
                  </td>
                  <td className="px-2 py-1.5 text-gray-500">{formatDate(job.last_progress_at)}</td>
                  <td className="px-2 py-1.5 text-red-400/80">{job.error_message || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LeadCard({
  lead,
  stages,
  onClick,
}: {
  lead: Lead;
  stages: PipelineStageInfo[];
  onClick: (lead: Lead) => void;
}) {
  return (
    <div
      onClick={() => onClick(lead)}
      className="cursor-pointer rounded-xl border border-navy-700 bg-navy-800/50 p-4 transition-all hover:border-navy-600 hover:bg-navy-800/80 hover:shadow-lg"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold text-white">
          <ContactableDot contactable={lead.contactable} />
          {lead.full_name}
        </h4>
        <StatusBadge stage={lead.pipeline_stage} stages={stages} />
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <TraceBadge status={lead.trace_status} />
        {lead.dnc_flag ? (
          <span className="rounded border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-300">
            {lead.dnc_flag}
          </span>
        ) : null}
      </div>
      <p className="text-xs text-gray-400">
        {lead.property_city}, {lead.property_state}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span className="rounded bg-navy-700 px-1.5 py-0.5 text-[11px]">
          {getSourceLabel(lead.lead_source)}
        </span>
        <span>{formatDate(lead.created_at)}</span>
        <span
          className="text-[11px] text-gray-600"
          title={`In ${stageLabel(lead.pipeline_stage)} for ${lead.time_in_stage ?? "—"}`}
        >
          ⏱ {lead.time_in_stage ?? "—"} in stage
        </span>
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
  stages,
  onClose,
  onStatusChange,
  smsLogs,
  onSendSms,
  smsSending,
  smsResult,
  onSkipTrace,
  onStartOutreach,
  onStartEmailOutreach,
  onSendMail,
  onManualTrace,
  automationBusy,
  pipelineHistory,
}: {
  lead: Lead;
  stages: PipelineStageInfo[];
  onClose: () => void;
  onStatusChange: (id: string, stage: string) => void;
  smsLogs: SmsLogEntry[];
  onSendSms: (leadId: string, message: string) => void;
  smsSending: boolean;
  smsResult: { success: boolean; error?: string } | null;
  onSkipTrace: (id: string) => void;
  onStartOutreach: (id: string) => void;
  onStartEmailOutreach: (id: string) => void;
  onSendMail: (leadId: string, campaign?: string) => void;
  onManualTrace: (leadId: string, contact: { phone?: string; email?: string; dncFlag?: string }) => Promise<{ success: boolean; error?: string }>;
  automationBusy: boolean;
  pipelineHistory: PipelineHistoryEntry[];
}) {
  const [smsMessage, setSmsMessage] = useState("");
  const [mailCampaign, setMailCampaign] = useState("auto");
  // Backup trace form state (PH1-B1): manual contact-info entry works regardless
  // of which trace service is used.
  const [showBackupTrace, setShowBackupTrace] = useState(false);
  const [tracePhone, setTracePhone] = useState("");
  const [traceEmail, setTraceEmail] = useState("");
  const [traceDnc, setTraceDnc] = useState(false);
  const [traceSaving, setTraceSaving] = useState(false);
  const [traceResult, setTraceResult] = useState<{ success: boolean; error?: string } | null>(null);
  const handleSaveManualTrace = async () => {
    if (!tracePhone.trim() && !traceEmail.trim()) {
      setTraceResult({ success: false, error: "Enter at least a phone number or an email address." });
      return;
    }
    setTraceSaving(true);
    setTraceResult(null);
    try {
      const result = await onManualTrace(lead.id, {
        phone: tracePhone.trim() || undefined,
        email: traceEmail.trim() || undefined,
        dncFlag: traceDnc ? "DNC" : undefined,
      });
      setTraceResult(result);
      if (result.success) setShowBackupTrace(false);
    } catch {
      setTraceResult({ success: false, error: "Failed to save contact info" });
    } finally {
      setTraceSaving(false);
    }
  };

  // Valid next stages for the lead's current stage (only these are offered).
  const nextOptions = useMemo(() => {
    const all = stages.map((s) => s.name);
    return validNextStages(lead.pipeline_stage, all).filter((s) => s !== lead.pipeline_stage);
  }, [lead.pipeline_stage, stages]);

  const recommendedNext = useMemo(
    () => (VALID_TRANSITIONS[lead.pipeline_stage] || []).find((s) => s !== "closed_lost"),
    [lead.pipeline_stage],
  );

  // Pre-populate SMS message based on lead status
  const defaultMessages: Record<string, string> = {
    new: `Hi ${lead.full_name}, thanks for your interest in selling your property at ${lead.property_address}. We'd love to learn more. When's a good time to chat?`,
    contacted: `Hi ${lead.full_name}, following up from DealForge Properties about your property at ${lead.property_address}. Let us know if you have any questions!`,
    qualified: `Hi ${lead.full_name}, great news — your property at ${lead.property_address} qualifies for a cash offer. Let's discuss the next steps!`,
    appointment: `Hi ${lead.full_name}, just a reminder about your upcoming appointment to discuss your cash offer for ${lead.property_address}. Looking forward to it!`,
    offer: `Hi ${lead.full_name}, following up on the cash offer we prepared for your property at ${lead.property_address}. Have you had a chance to review it?`,
    contract: `Hi ${lead.full_name}, your contract for ${lead.property_address} is moving forward. We'll keep you updated on the closing process!`,
    closed: `Hi ${lead.full_name}, congratulations on closing the sale of ${lead.property_address}! Thank you for choosing DealForge Properties.`,
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

  const hasMailAddress = !!(
    lead.property_address && lead.property_city && lead.property_state && lead.property_zip
  );

  const handleSendMail = () => {
    if (!hasMailAddress) return;
    const campaignLabel =
      mailCampaign === "auto"
        ? "Auto (matches lead source)"
        : MAIL_CAMPAIGN_LABELS[mailCampaign] || mailCampaign;
    const confirmed = window.confirm(
      `Send a 6×9 postcard to ${lead.full_name} at ${lead.property_address}, ${lead.property_city}, ${lead.property_state} ${lead.property_zip}?\n\nTemplate: ${campaignLabel}\nEstimated cost: ${MAIL_COST_PER_PIECE.toFixed(2)} (print + first-class postage).`,
    );
    if (confirmed) onSendMail(lead.id, mailCampaign === "auto" ? undefined : mailCampaign);
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
            <button onClick={() => setShowBackupTrace((v) => !v)} className="rounded-lg border border-gold-500/30 bg-gold-500/10 px-4 py-2 text-sm font-medium text-gold-300">Backup Trace</button>
            <button onClick={() => onStartOutreach(lead.id)} disabled={automationBusy || !lead.phone} className="rounded-lg border border-gold-500/30 bg-gold-500/10 px-4 py-2 text-sm font-medium text-gold-300 disabled:opacity-50">Start SMS Outreach</button>
            <button onClick={() => onStartEmailOutreach(lead.id)} disabled={automationBusy || !lead.email} title={!lead.email ? "Lead has no email address" : "Send email 1 now, schedule follow-ups on days 1, 3, 5, 10"} className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-sm font-medium text-blue-300 disabled:opacity-50">Start Email Outreach</button>
            <select
              value={mailCampaign}
              onChange={(e) => setMailCampaign(e.target.value)}
              title="Postcard template"
              className="rounded-lg border border-navy-700 bg-navy-900 px-2 py-2 text-sm text-gray-300 focus:border-gold-500 focus:outline-none"
            >
              <option value="auto">Mail: Auto (by source)</option>
              {MAIL_CAMPAIGNS.map((c) => (
                <option key={c} value={c}>
                  Mail: {MAIL_CAMPAIGN_LABELS[c]}
                </option>
              ))}
            </select>
            <button
              onClick={handleSendMail}
              disabled={automationBusy || !hasMailAddress}
              title={
                hasMailAddress
                  ? `Send a 6×9 postcard (~${MAIL_COST_PER_PIECE.toFixed(2)}/piece) via Click2Mail`
                  : "Lead is missing a mailing address"
              }
              className="rounded-lg border border-purple-500/30 bg-purple-500/10 px-4 py-2 text-sm font-medium text-purple-300 disabled:opacity-50"
            >
              Send Mail
            </button>
            <Link
              to="/calculator"
              className="rounded-lg bg-gold-500 px-4 py-2 text-sm font-semibold text-navy-900 transition-colors hover:bg-gold-400"
            >
              Calculate Deal
            </Link>
            {lead.pipeline_stage !== "closed_lost" && (
              <button
                onClick={() => onStatusChange(lead.id, "closed_lost")}
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20"
              >
                Mark as Dead
              </button>
            )}
            {recommendedNext && (
              <button
                onClick={() => onStatusChange(lead.id, recommendedNext)}
                className="rounded-lg border border-gold-500/30 bg-gold-500/10 px-4 py-2 text-sm font-medium text-gold-400 transition-colors hover:bg-gold-500/20"
              >
                Move to Next Stage →
              </button>
            )}
          </div>

          {/* Trace & Contact (PH1-B1) */}
          <div className="rounded-lg border border-navy-700 bg-navy-900/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-white">Skip Trace Status</h3>
              <span className="flex items-center gap-2">
                <ContactableDot contactable={lead.contactable} />
                <TraceBadge status={lead.trace_status} />
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
              <DetailItem label="Trace source" value={lead.trace_source || "—"} />
              <DetailItem label="Traced at" value={lead.traced_at ? new Date(lead.traced_at).toLocaleString() : "—"} />
              <DetailItem label="DNC flag" value={lead.dnc_flag || "—"} />
              <DetailItem label="Contactable" value={lead.contactable ? "Yes" : "No"} />
            </dl>
            {lead.phone && <p className="mt-2 text-xs text-gray-400">Phone: <span className="text-gray-200">{lead.phone}</span></p>}
            {lead.email && <p className="mt-1 text-xs text-gray-400">Email: <span className="text-gray-200">{lead.email}</span></p>}
            {showBackupTrace && (
              <div className="mt-4 rounded-lg border border-gold-500/30 bg-navy-900 p-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gold-400">
                  Backup Trace — manual contact entry
                </h4>
                <p className="mt-1 text-[11px] text-gray-500">
                  Record contact info found outside the system (PropStream Connect, county records, public listings).
                  Marks the lead TRACED with source "manual". Works regardless of which trace service is used.
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-gray-400">Phone</span>
                    <input
                      value={tracePhone}
                      onChange={(e) => setTracePhone(e.target.value)}
                      placeholder="+12105550199"
                      className="w-full rounded-lg border border-navy-700 bg-navy-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-gold-500 focus:outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-gray-400">Email</span>
                    <input
                      value={traceEmail}
                      onChange={(e) => setTraceEmail(e.target.value)}
                      placeholder="owner@example.com"
                      className="w-full rounded-lg border border-navy-700 bg-navy-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-gold-500 focus:outline-none"
                    />
                  </label>
                </div>
                <label className="mt-3 flex items-center gap-2 text-xs text-gray-300">
                  <input
                    type="checkbox"
                    checked={traceDnc}
                    onChange={(e) => setTraceDnc(e.target.checked)}
                    className="rounded border-navy-600 bg-navy-800"
                  />
                  On the Do-Not-Call list (DNC flag) — suppresses phone outreach
                </label>
                <div className="mt-3 flex items-center gap-3">
                  <button
                    onClick={handleSaveManualTrace}
                    disabled={traceSaving}
                    className="rounded-lg bg-gold-500 px-4 py-2 text-xs font-semibold text-navy-900 hover:bg-gold-400 disabled:opacity-50"
                  >
                    {traceSaving ? "Saving..." : "Save Contact Info"}
                  </button>
                  {traceResult && (
                    <span className={`text-xs ${traceResult.success ? "text-emerald-400" : "text-red-400"}`}>
                      {traceResult.success ? "Saved — lead is now TRACED." : traceResult.error}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
          {/* Stage Dropdown (valid next stages only) */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">
              Pipeline Stage
            </label>
            <select
              value={lead.pipeline_stage}
              onChange={(e) => {
                if (e.target.value !== lead.pipeline_stage) onStatusChange(lead.id, e.target.value);
              }}
              className="w-full rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-sm text-white focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500"
            >
              <option value={lead.pipeline_stage}>{stageLabel(lead.pipeline_stage)}</option>
              {nextOptions.map((s) => (
                <option key={s} value={s}>
                  {stageLabel(s)}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-gray-600">
              Only valid next stages are shown (enforced by the pipeline rules).
            </p>
          </div>

          {/* Pipeline History */}
          <div className="rounded-lg border border-navy-700 bg-navy-900/50 p-4">
            <h3 className="mb-3 text-sm font-semibold text-white">Pipeline History</h3>
            {pipelineHistory.length === 0 ? (
              <p className="text-sm text-gray-500">
                No stage changes recorded yet — the lead is in{" "}
                <span className="text-gold-400">{stageLabel(lead.pipeline_stage)}</span>.
              </p>
            ) : (
              <ol className="relative space-y-3 border-l border-navy-700 pl-4">
                {pipelineHistory.map((h) => (
                  <li key={h.id} className="relative">
                    <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-gold-500" />
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="text-sm font-medium text-gray-200">
                        {stageLabel(h.from_stage)} <span className="text-gray-500">→</span>{" "}
                        <span className="text-gold-300">{stageLabel(h.to_stage)}</span>
                      </span>
                      <span className="text-[11px] text-gray-500">
                        {new Date(h.created_at).toLocaleString()}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-gray-500">
                      {h.triggered_by === "auto" && "Auto"} 
                      {h.triggered_by === "manual" && "Manual"} 
                      {h.triggered_by === "ai_agent" && "AI agent"}
                      {h.agent_name ? ` · ${h.agent_name}` : ""}
                      {h.notes ? ` · ${h.notes}` : ""}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* Send SMS */}
          <div className="rounded-lg border border-navy-700 bg-navy-900/50 p-4">
            <h3 className="mb-3 text-sm font-semibold text-white">Send SMS</h3>
            <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              SMS — NOT CONNECTED. Channel discontinued 2026-08-12 (owner
              decision; outreach is voice via BatchDialer + direct mail/email via
              PropStream). Sends are disabled and attempts are logged as failed.
            </div>
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
  stages,
  onCardClick,
  onStatusChange,
}: {
  leads: Lead[];
  stages: PipelineStageInfo[];
  onCardClick: (lead: Lead) => void;
  onStatusChange: (id: string, stage: string) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
      {stages.map((stage) => {
        const stageLeads = leads.filter((l) => l.pipeline_stage === stage.name);
        const allNames = stages.map((s) => s.name);
        const options = validNextStages(stage.name, allNames);

        return (
          <div
            key={stage.id}
            className="flex min-w-0 flex-col rounded-xl border border-navy-700 bg-navy-800/30"
          >
            {/* Column Header */}
            <div className="flex items-center justify-between border-b border-navy-700 px-3 py-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                {stageLabel(stage.name)}
              </h3>
              <span className="rounded-full bg-navy-700 px-2 py-0.5 text-xs font-medium text-gray-300">
                {stageLeads.length}
              </span>
            </div>

            {/* Cards */}
            <div className="min-h-[120px] flex-1 space-y-2 overflow-y-auto p-2">
              {stageLeads.length === 0 ? (
                <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-navy-700 text-xs text-gray-600">
                  No leads
                </div>
              ) : (
                stageLeads.map((lead) => (
                  <div key={lead.id} className="group relative">
                    <LeadCard lead={lead} stages={stages} onClick={onCardClick} />
                    {/* Dropdown for quick status change — valid next stages only */}
                    <select
                      value={lead.pipeline_stage}
                      onChange={(e) => {
                        if (e.target.value !== lead.pipeline_stage) onStatusChange(lead.id, e.target.value);
                      }}
                      className="absolute top-2 right-10 z-10 rounded border border-navy-600 bg-navy-800 px-1 py-0.5 text-[10px] text-gray-400 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 focus:outline-none"
                    >
                      <option value={lead.pipeline_stage}>{stageLabel(lead.pipeline_stage)}</option>
                      {options
                        .filter((s) => s !== lead.pipeline_stage)
                        .map((s) => (
                          <option key={s} value={s}>
                            {stageLabel(s)}
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
  stages,
  onCardClick,
  onStatusChange,
}: {
  leads: Lead[];
  stages: PipelineStageInfo[];
  onCardClick: (lead: Lead) => void;
  onStatusChange: (id: string, stage: string) => void;
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
    if (sortField !== field) return <span className="ml-1 text-navy-600">↕</span>;
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
              Stage
            </th>
            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
              Source
            </th>
            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
              Trace
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
          {sortedLeads.map((lead) => {
            const allNames = stages.map((s) => s.name);
            const options = validNextStages(lead.pipeline_stage, allNames);
            return (
              <tr
                key={lead.id}
                className="border-b border-navy-700/50 transition-colors hover:bg-navy-800/50"
              >
                <td className="px-4 py-3">
                  <button
                    onClick={() => onCardClick(lead)}
                    className="font-medium text-white transition-colors hover:text-gold-500"
                  >
                    {lead.full_name}
                  </button>
                </td>
                <td className="px-4 py-3 text-gray-400">
                  {lead.property_city}, {lead.property_state}
                </td>
                <td className="px-4 py-3">
                  <select
                    value={lead.pipeline_stage}
                    onChange={(e) => {
                      if (e.target.value !== lead.pipeline_stage) onStatusChange(lead.id, e.target.value);
                    }}
                    className="rounded border border-navy-600 bg-navy-800 px-1.5 py-0.5 text-xs text-gray-300 focus:border-gold-500 focus:outline-none"
                  >
                    <option value={lead.pipeline_stage}>{stageLabel(lead.pipeline_stage)}</option>
                    {options
                      .filter((s) => s !== lead.pipeline_stage)
                      .map((s) => (
                        <option key={s} value={s}>
                          {stageLabel(s)}
                        </option>
                      ))}
                  </select>
                </td>
                <td className="px-4 py-3 text-xs text-gray-400">
                  {getSourceLabel(lead.lead_source)}
                </td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-1.5">
                    <ContactableDot contactable={lead.contactable} />
                    <TraceBadge status={lead.trace_status} />
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">
                  {formatDate(lead.created_at)}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => onCardClick(lead)}
                    className="text-xs text-gold-500 transition-colors hover:text-gold-400"
                  >
                    View
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// --- Page Component ---
function CrmPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stages, setStages] = useState<PipelineStageInfo[]>(MOCK_STAGES);
  const [viewMode, setViewMode] = useState<ViewMode>("board");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [dbUnavailable, setDbUnavailable] = useState(false);
  const [smsLogs, setSmsLogs] = useState<SmsLogEntry[]>([]);
  const [smsSending, setSmsSending] = useState(false);
  const [smsResult, setSmsResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [automationBusy, setAutomationBusy] = useState(false);
  const [pipelineHistory, setPipelineHistory] = useState<PipelineHistoryEntry[]>([]);
  const runSkipTrace = async (ids?: string[]) => { setAutomationBusy(true); try { const result = await skipTrace({ data: { ids } }); if (!result.success) alert(result.error); else { alert(result.message || `Skip trace requested: ${result.updated} lead(s) marked.`); loadTraceJobs(); } if (result.success && ids?.[0]) { const refreshed = await fetchLeads(); setLeads(refreshed.leads); setDbUnavailable(refreshed.dbUnavailable); setSelectedLead(refreshed.leads.find((l) => l.id === ids[0]) || null); } } catch { alert("Skip trace failed"); } finally { setAutomationBusy(false); } };
  const runOutreach = async (id: string) => { setAutomationBusy(true); try { const result = await startOutreach({ data: { leadId: id } }); if (!result.success) alert(result.error); else alert("SMS outreach started."); } catch { alert("Outreach failed"); } finally { setAutomationBusy(false); } };
  const runEmailOutreach = async (id: string) => { setAutomationBusy(true); try { const result = await startEmailOutreach({ data: { leadId: id } }); if (!result.success) alert(result.error); else alert(`Email outreach started — Email 1 sent, ${result.scheduled || 4} follow-ups scheduled.`); } catch { alert("Email outreach failed"); } finally { setAutomationBusy(false); } };
  const runSendMail = async (id: string, campaign?: string) => { setAutomationBusy(true); try { const result = await sendMailToLead({ data: { leadId: id, campaign } }); if (!result.success) alert(result.error || "Direct mail failed"); else alert(`Postcard submitted to Click2Mail — ${result.sent} piece(s) queued.`); } catch { alert("Direct mail failed"); } finally { setAutomationBusy(false); } };
  const runBulkSendMail = async (ids: string[]) => { setAutomationBusy(true); try { const result = await bulkSendMail({ data: { ids } }); if (!result.success) alert(result.error || "Bulk direct mail failed"); else alert(`Direct mail submitted — ${result.sent} postcard(s) queued.`); } catch { alert("Bulk direct mail failed"); } finally { setAutomationBusy(false); } };
  // --- Skip-trace monitor state (PH1-B1) ---
  const [traceJobs, setTraceJobs] = useState<SkipTraceJobRow[]>([]);
  const [traceSummary, setTraceSummary] = useState<{ total: number; contactable: number; nonContactable: number } | null>(null);
  const [traceBusy, setTraceBusy] = useState(false);
  const [traceLastMessage, setTraceLastMessage] = useState<string | null>(null);
  const loadTraceJobs = async () => {
    try {
      const data = await fetchSkipTraceJobs();
      if (data) {
        setTraceJobs(data.jobs || []);
        if (data.summary) {
          setTraceSummary({ total: data.summary.total, contactable: data.summary.contactable, nonContactable: data.summary.nonContactable });
        }
      }
    } catch {
      // panel shows an honest empty state
    }
  };
  const handleMonitorNow = async () => {
    setTraceBusy(true);
    setTraceLastMessage(null);
    try {
      const result = await runMonitorNow();
      if (result && "error" in result && result.error) {
        setTraceLastMessage(`Monitor check failed: ${result.error}`);
      } else {
        const stalled = result?.stalled?.length || 0;
        setTraceLastMessage(
          stalled > 0
            ? `${stalled} stalled job(s) flagged — notification(s) created (${result.notificationsCreated}). Check PropStream Jobs/Activity or trigger a backup trace.`
            : "No stalled jobs detected.",
        );
      }
      await loadTraceJobs();
    } catch {
      setTraceLastMessage("Monitor check failed.");
    } finally {
      setTraceBusy(false);
    }
  };
  const handleManualTrace = async (leadId: string, contact: { phone?: string; email?: string; dncFlag?: string }) => {
    try {
      const result = await recordManualTrace({ data: { leadId, ...contact } });
      if (result.success) {
        const refreshed = await fetchLeads().catch(() => null);
        if (refreshed) {
          setLeads(refreshed.leads);
          setDbUnavailable(refreshed.dbUnavailable);
          setSelectedLead((prev) => (prev ? refreshed.leads.find((l) => l.id === prev.id) ?? prev : prev));
        }
      }
      return { success: result.success, error: result.error };
    } catch {
      return { success: false, error: "Failed to save contact info" };
    }
  };
  // Load skip-trace jobs once on mount.
  useEffect(() => {
    loadTraceJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load pipeline stages from DB (falls back to MOCK_STAGES)
  useEffect(() => {
    fetchPipelineStages()
      .then((data: PipelineStageInfo[]) => {
        if (data && data.length > 0) setStages(data);
      })
      .catch(() => {});
  }, []);

  // Load leads from the server (honest empty state on DB failure — no mock data)
  useEffect(() => {
    let cancelled = false;
    fetchLeads()
      .then((data) => {
        if (!cancelled && data) {
          setLeads(data.leads);
          setDbUnavailable(data.dbUnavailable);
        }
      })
      .catch(() => {
        if (!cancelled) setDbUnavailable(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Load SMS logs + pipeline history when a lead is selected
  useEffect(() => {
    if (selectedLead) {
      setSmsLogs([]);
      setSmsResult(null);
      setPipelineHistory([]);
      fetchLeadSmsLogs({ data: { leadId: selectedLead.id } })
        .then((data) => {
          if (data) setSmsLogs(data);
        })
        .catch(() => {});
      fetchPipelineHistory({ data: { leadId: selectedLead.id } })
        .then((data) => {
          if (data) setPipelineHistory(data);
        })
        .catch(() => {});
    }
  }, [selectedLead?.id]);

  const handleStageChange = async (id: string, newStage: string) => {
    // Optimistic update
    setLeads((prev) =>
      prev.map((l) => (l.id === id ? { ...l, pipeline_stage: newStage, time_in_stage: "just now" } : l))
    );
    setSelectedLead((prev) =>
      prev?.id === id ? { ...prev, pipeline_stage: newStage, time_in_stage: "just now" } : prev
    );
    // Persist via the pipeline service (validates the transition, writes the event)
    const result = await transitionLeadStage({
      data: { leadId: id, toStage: newStage, triggeredBy: "manual" },
    }).catch(() => null);
    if (result && !result.success) {
      alert(result.error || "Transition failed");
    }
    // Refresh from the server to stay consistent
    const refreshed = await fetchLeads().catch(() => null);
    if (refreshed) {
      setLeads(refreshed.leads);
      setDbUnavailable(refreshed.dbUnavailable);
      setSelectedLead((prev) => (prev ? refreshed.leads.find((l) => l.id === prev.id) ?? prev : prev));
    }
    if (selectedLead?.id === id) {
      const rows = await fetchPipelineHistory({ data: { leadId: id } }).catch(() => []);
      if (rows) setPipelineHistory(rows);
    }
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

  const [stageFilter, setStageFilter] = useState<string | "all">("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [scoreFilter, setScoreFilter] = useState("all");
  const sources = useMemo(() => Array.from(new Set(leads.map((l) => l.lead_source).filter(Boolean))).sort(), [leads]);
  const visibleLeads = useMemo(() => leads.filter((l) =>
    (stageFilter === "all" || l.pipeline_stage === stageFilter) &&
    (sourceFilter === "all" || l.lead_source === sourceFilter) &&
    (scoreFilter === "all" || (scoreFilter === "high" ? l.score >= 70 : scoreFilter === "medium" ? l.score >= 40 && l.score < 70 : l.score < 40))
  ), [leads, stageFilter, sourceFilter, scoreFilter]);
  const pipelineCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    visibleLeads.forEach((l) => {
      counts[l.pipeline_stage] = (counts[l.pipeline_stage] || 0) + 1;
    });
    return counts;
  }, [visibleLeads]);

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

            {/* Database unreachable — never show fabricated data */}
            {dbUnavailable && (
              <div className="w-full rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
                ⚠️ Data unavailable — NOT CONNECTED (live database unreachable). No
                leads are shown rather than displaying placeholder information.
                The CRM will populate once the database connection is restored.
              </div>
            )}

            {/* Automation actions */}
            <div className="flex flex-wrap gap-2">
              <Link
                to="/crm/import"
                className="inline-flex items-center rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-2 text-sm font-medium text-gold-300 transition-colors hover:bg-gold-500/20"
              >
                <svg className="mr-1.5 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                  />
                </svg>
                Import Leads
              </Link>
              <button onClick={() => runSkipTrace()} disabled={automationBusy} className="rounded-lg border border-teal-500/30 bg-teal-500/10 px-3 py-2 text-sm font-medium text-teal-300 disabled:opacity-50">{automationBusy ? "Working..." : "Skip Trace All"}</button>
              <button onClick={async () => { setAutomationBusy(true); try { const result = await bulkOutreach(); if (!result.success) alert(result.error); else alert(`Started SMS outreach for ${result.started} qualified lead(s).`); } finally { setAutomationBusy(false); } }} disabled={automationBusy} className="rounded-lg border border-gold-500/30 bg-gold-500/10 px-3 py-2 text-sm font-medium text-gold-300 disabled:opacity-50">Bulk SMS Outreach</button>
              <button onClick={async () => { setAutomationBusy(true); try { const result = await bulkEmailOutreach(); if (!result.success) alert(result.error); else alert(`Started email outreach for ${result.started} qualified lead(s).`); } finally { setAutomationBusy(false); } }} disabled={automationBusy} className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm font-medium text-blue-300 disabled:opacity-50">Bulk Email Outreach</button>
              <button
                onClick={async () => {
                  const count = visibleLeads.length;
                  if (!count) { alert("No leads match the current filters."); return; }
                  const cost = (count * MAIL_COST_PER_PIECE).toFixed(2);
                  if (!window.confirm(`Send ${count} postcard${count === 1 ? "" : "s"} to the currently filtered lead${count === 1 ? "" : "s"}?\n\nTemplate: auto-matched to each lead's source.\nEstimated cost: ${cost} (~${MAIL_COST_PER_PIECE.toFixed(2)}/piece, 6×9 + first-class postage).`)) return;
                  await runBulkSendMail(visibleLeads.map((l) => l.id));
                }}
                disabled={automationBusy}
                className="rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-2 text-sm font-medium text-purple-300 disabled:opacity-50"
              >
                Bulk Direct Mail
              </button>
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

          {/* Pipeline Stats Bar (dynamic from DB) */}
          <div className="mt-6 flex flex-wrap gap-2">
            {stages.map((stage) => {
              const count = pipelineCounts[stage.name] || 0;
              return (
                <div
                  key={stage.id}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${stageColor(stage.color)}`}
                >
                  <span className="font-medium">{stageLabel(stage.name)}</span>
                  <span className="opacity-70">{count}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className="rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-sm text-gray-300"><option value="all">All stages</option>{stages.map((s) => <option key={s.id} value={s.name}>{stageLabel(s.name)}</option>)}</select>
            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-sm text-gray-300"><option value="all">All sources</option>{sources.map((s) => <option key={s} value={s}>{getSourceLabel(s)}</option>)}</select>
            <select value={scoreFilter} onChange={(e) => setScoreFilter(e.target.value)} className="rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-sm text-gray-300"><option value="all">All scores</option><option value="high">High score (70+)</option><option value="medium">Medium (40–69)</option><option value="low">Low (&lt;40)</option></select>
          </div>
        </div>
      </div>

      {/* Skip Trace Monitor panel (PH1-B1) */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SkipTracePanel
          jobs={traceJobs}
          summary={traceSummary}
          onRefresh={loadTraceJobs}
          onMonitor={handleMonitorNow}
          busy={traceBusy}
          lastMessage={traceLastMessage}
        />
      </div>
      {/* Pipeline Content */}
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {viewMode === "board" ? (
          <BoardView
            leads={visibleLeads}
            stages={stages}
            onCardClick={setSelectedLead}
            onStatusChange={handleStageChange}
          />
        ) : (
          <ListView
            leads={visibleLeads}
            stages={stages}
            onCardClick={setSelectedLead}
            onStatusChange={handleStageChange}
          />
        )}
      </div>

      {/* Lead Detail Modal */}
      {selectedLead && (
        <LeadDetailModal
          lead={selectedLead}
          stages={stages}
          onClose={() => setSelectedLead(null)}
          onStatusChange={handleStageChange}
          smsLogs={smsLogs}
          onSendSms={handleSendSms}
          smsSending={smsSending}
          smsResult={smsResult}
          onSkipTrace={(id) => runSkipTrace([id])}
          onStartOutreach={runOutreach}
          onStartEmailOutreach={runEmailOutreach}
          onSendMail={runSendMail}
          onManualTrace={handleManualTrace}
          automationBusy={automationBusy}
          pipelineHistory={pipelineHistory}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute("/crm")({
  component: CrmPage,
  head: () => ({
    meta: [
      { title: "CRM Pipeline — DealForge Properties" },
      {
        name: "description",
        content: "Manage your real estate wholesaling pipeline with DealForge Properties' CRM.",
      },
    ],
  }),
});
