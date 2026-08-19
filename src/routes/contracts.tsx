import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { requireOwnerMiddleware } from "~/lib/auth";
import { OwnerGate } from "~/components/OwnerGate";
import { useState, useEffect, useMemo } from "react";
import type { ContractDetail, ContractListItem, ClosingChecklistItem, AttentionItem } from "~/lib/closing";
import type { TransactionCommandCenterData, TransactionRow, DealPickerLead, ArcAdvanceResult } from "~/lib/transaction-command-center";
import type { BuyerMatchResult, LeadForMatch } from "~/lib/buyer-marketplace";

// DealForge — /contracts: two tabs.
//   1. Closing Workflow (PH1-B12): the last mile of the deal lifecycle —
//      contract → title → closed → assignment paid. Lists real contracts from
//      the DB (0 today is the correct production state), with a status
//      stepper, title/escrow fields, close dates, deadlines, an audit-logged
//      closing checklist, a profit panel (honest "—" until the assignment fee
//      is actually recorded) and a B11-gated "Record assignment paid" button
//      (fires the assignment approval request → owner decides on /approvals →
//      then records). The platform only TRACKS proceeds — real money flows
//      title company → owner's bank.
//   2. Contract Builder: the print-ready purchase/assignment document
//      generator (preserved as-is; its save now writes status 'new' — the
//      closing vocabulary's starting state).

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

/** The closing vocabulary in stepper order (mirrors migration 020's CHECK). */
const CLOSING_STATUSES = [
  "new", "title_open", "title_clear", "docs_sent", "docs_signed", "funded", "closed", "cancelled",
] as const;
const STATUS_LABELS: Record<string, string> = {
  new: "New",
  title_open: "Title Open",
  title_clear: "Title Clear",
  docs_sent: "Docs Sent",
  docs_signed: "Docs Signed",
  funded: "Funded",
  closed: "Closed",
  cancelled: "Cancelled",
};
const STATUS_BADGE: Record<string, string> = {
  new: "bg-navy-700 text-gray-300",
  title_open: "bg-blue-500/15 text-blue-400",
  title_clear: "bg-blue-500/15 text-blue-400",
  docs_sent: "bg-gold-500/15 text-gold-400",
  docs_signed: "bg-gold-500/15 text-gold-400",
  funded: "bg-emerald-500/15 text-emerald-400",
  closed: "bg-emerald-500/20 text-emerald-300",
  cancelled: "bg-red-500/15 text-red-400",
};

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

function fmtDollars(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(`${d}T12:00:00`);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// --- Server Functions (builder) ---
const fetchContractLeads = createServerFn({ method: "GET", middleware: [requireOwnerMiddleware] }).handler(async () => {
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
    return { leads: rows.map((r) => ({ ...r, created_at: String(r.created_at) })), dbUnavailable: false };
  } catch {
    // DB unreachable: honest empty state (no fabricated leads).
    return { leads: [], dbUnavailable: true };
  }
});

const fetchBuyersForContracts = createServerFn({ method: "GET", middleware: [requireOwnerMiddleware] }).handler(async () => {
  try {
    const { sql } = await import("~/db");
    const rows = (await sql`
      SELECT id, name, email, phone, buying_criteria, created_at
      FROM buyers
      ORDER BY name ASC
    `) as BuyerRow[];
    return { buyers: rows.map(rowToBuyer), dbUnavailable: false };
  } catch {
    // DB unreachable: honest empty state (no fabricated buyers).
    return { buyers: [], dbUnavailable: true };
  }
});

const saveContractDb = createServerFn({ method: "POST", middleware: [requireOwnerMiddleware] })
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
        'new',
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

// --- Server Functions (closing workflow, PH1-B12) ---
const fetchContracts = createServerFn({ method: "GET", middleware: [requireOwnerMiddleware] }).handler(async () => {
  try {
    const { listContracts } = await import("~/lib/closing");
    return await listContracts();
  } catch {
    return [] as ContractListItem[];
  }
});

const fetchContractDetail = createServerFn({ method: "GET", middleware: [requireOwnerMiddleware] })
  .validator((d: unknown) => d as { contractId: string })
  .handler(async ({ data }) => {
    try {
      const { getContractDetail } = await import("~/lib/closing");
      return await getContractDetail(data.contractId);
    } catch {
      return null;
    }
  });

const toggleChecklist = createServerFn({ method: "POST", middleware: [requireOwnerMiddleware] })
  .validator((d: unknown) => d as { itemId: string; done: boolean })
  .handler(async ({ data }) => {
    try {
      const { updateClosingChecklistItem } = await import("~/lib/closing");
      return await updateClosingChecklistItem(data.itemId, data.done, "owner");
    } catch (e) {
      return { success: false as const, error: e instanceof Error ? e.message : "Toggle failed" };
    }
  });

const saveClosingDetails = createServerFn({ method: "POST", middleware: [requireOwnerMiddleware] })
  .validator((d: unknown) => {
    const x = d as { contractId: string; titleCompany?: string; escrowAccount?: string; expectedCloseDate?: string; closeDate?: string };
    if (!x.contractId) throw new Error("contractId is required");
    return x;
  })
  .handler(async ({ data }) => {
    try {
      const { updateContractClosing } = await import("~/lib/closing");
      return await updateContractClosing(
        data.contractId,
        {
          titleCompany: data.titleCompany ?? null,
          escrowAccount: data.escrowAccount ?? null,
          expectedCloseDate: data.expectedCloseDate || null,
          closeDate: data.closeDate || null,
        },
        "owner",
      );
    } catch (e) {
      return { success: false as const, error: e instanceof Error ? e.message : "Save failed" };
    }
  });

/**
 * The B11-gated record flow: if an approved 'assignment' approval exists for
 * the contract, record the payment; otherwise fire the approval request and
 * tell the owner to decide on /approvals (then press Record again).
 */
const recordAssignmentFlow = createServerFn({ method: "POST", middleware: [requireOwnerMiddleware] })
  .validator((d: unknown) => d as { contractId: string; amountCents: number })
  .handler(async ({ data }) => {
    try {
      const { hasApproval } = await import("~/lib/approvals");
      const { recordAssignmentPaid, requestAssignmentApproval } = await import("~/lib/closing");
      const approved = await hasApproval("assignment", "contract", data.contractId, ["approved"]);
      if (!approved) {
        const req = await requestAssignmentApproval(data.contractId, data.amountCents, "owner");
        return { requested: true as const, ...req };
      }
      return await recordAssignmentPaid(data.contractId, data.amountCents, "owner");
    } catch (e) {
      return { success: false as const, error: e instanceof Error ? e.message : "Record failed" };
    }
  });

// --- D3 Transaction Command Center + buyer shortlist (Steps 8 & 9) -----------
const fetchTransactionCC = createServerFn({ method: "GET", middleware: [requireOwnerMiddleware] }).handler(async () => {
  const { transactionCommandCenter } = await import("~/lib/transaction-command-center");
  return transactionCommandCenter();
});
const fetchDealPicker = createServerFn({ method: "GET", middleware: [requireOwnerMiddleware] }).handler(async () => {
  const { listDealsForShortlist } = await import("~/lib/transaction-command-center");
  return listDealsForShortlist();
});
const fetchDealShortlist = createServerFn({ method: "POST", middleware: [requireOwnerMiddleware] })
  .validator((d: unknown) => d as { leadId: string })
  .handler(async ({ data }) => {
    if (!data.leadId) return { lead: null, matches: [] };
    const { buyerShortlistForDeal } = await import("~/lib/transaction-command-center");
    return buyerShortlistForDeal(data.leadId);
  });
const runArcAdvance = createServerFn({ method: "POST", middleware: [requireOwnerMiddleware] })
  .validator((d: unknown) => {
    const x = d as { contractId: string; to: "contract_signed" | "buyer_matched" | "title" };
    if (!x.contractId || !["contract_signed", "buyer_matched", "title"].includes(x.to)) {
      throw new Error("contractId and a valid arc target are required");
    }
    return x;
  })
  .handler(async ({ data }) => {
    const { advanceClosingArc } = await import("~/lib/transaction-command-center");
    return advanceClosingArc(data.contractId, data.to, "owner");
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

// ═══════════════════════════════════════════════════════════════════════════
// Tab 1 — Closing Workflow (PH1-B12)
// ═══════════════════════════════════════════════════════════════════════════

function ClosingWorkflowTab() {
  const [contracts, setContracts] = useState<ContractListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ContractDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [feeDraft, setFeeDraft] = useState<string>("15000");
  const [edit, setEdit] = useState<{ titleCompany: string; escrowAccount: string; expectedCloseDate: string; closeDate: string } | null>(null);
  const [savedEdit, setSavedEdit] = useState(false);

  const loadList = async () => {
    const rows = await fetchContracts();
    setContracts(rows ?? []);
    if (selectedId && !(rows ?? []).some((c) => c.id === selectedId)) setSelectedId(null);
    setLoading(false);
  };
  const refreshDetail = async (id: string | null = selectedId) => {
    if (!id) { setDetail(null); return; }
    const d = await fetchContractDetail({ data: { contractId: id } });
    setDetail(d);
    setEdit(d ? { titleCompany: d.titleCompany ?? "", escrowAccount: d.escrowAccount ?? "", expectedCloseDate: d.expectedCloseDate ?? "", closeDate: d.closeDate ?? "" } : null);
    setSavedEdit(false);
  };
  useEffect(() => {
    loadList();
  }, []);
  useEffect(() => {
    if (selectedId) refreshDetail(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const select = (id: string) => {
    setSelectedId(id);
    setMsg(null);
  };

  const handleToggle = async (item: ClosingChecklistItem) => {
    setBusy(`chk-${item.id}`);
    await toggleChecklist({ data: { itemId: item.id, done: !item.done } });
    await refreshDetail();
    setBusy(null);
  };

  const handleSaveDetails = async () => {
    if (!detail || !edit) return;
    setBusy("details");
    const res = await saveClosingDetails({
      data: {
        contractId: detail.id,
        titleCompany: edit.titleCompany,
        escrowAccount: edit.escrowAccount,
        expectedCloseDate: edit.expectedCloseDate,
        closeDate: edit.closeDate,
      },
    });
    if (res.success) {
      setSavedEdit(true);
      await refreshDetail();
    } else {
      setMsg({ ok: false, text: res.error || "Save failed" });
    }
    setBusy(null);
  };

  const handleRecordAssignment = async () => {
    if (!detail) return;
    const amount = Math.round(parseFloat(feeDraft.replace(/[$,]/g, "")) * 100);
    if (!Number.isFinite(amount) || amount < 0) { setMsg({ ok: false, text: "Enter a valid fee amount." }); return; }
    setBusy("record");
    setMsg(null);
    const res = await recordAssignmentFlow({ data: { contractId: detail.id, amountCents: amount } });
    if (res.success) {
      setMsg({ ok: true, text: "Assignment paid recorded — contract closed. Funds flow title company → owner's bank; the platform only tracks proceeds." });
      await refreshDetail();
    } else if ("requested" in res && res.requested) {
      setMsg({
        ok: true,
        text: res.duplicate
          ? "Assignment approval request is already pending — decide it on /approvals, then press Record again."
          : "Assignment approval requested — approve it on /approvals, then press Record again.",
      });
      await refreshDetail();
    } else {
      setMsg({ ok: false, text: res.error || "Failed to record" });
    }
    setBusy(null);
  };

  const attentionItems: AttentionItem[] = detail?.attention ?? [];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Closing Workflow</h1>
          <p className="mt-1 text-sm text-gray-400">
            Contract → title → closed → assignment paid. The platform tracks closing details and
            profit only — real funds flow title company → owner's bank, never through the platform.
          </p>
        </div>
        <span className="rounded-full bg-navy-700 px-3 py-1 text-xs font-medium text-gray-300">
          {contracts.length} contract{contracts.length === 1 ? "" : "s"}
        </span>
      </div>

      {contracts.length === 0 && !loading ? (
        <div className="rounded-2xl border border-navy-700 bg-navy-800 p-10 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-navy-700">
            <svg className="h-8 w-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-white">No contracts yet</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-gray-400">
            This is the correct production state — a contract appears here only when a real deal is
            signed (lead → offer → negotiation → contract). The closing checklist, title tracking and
            profit panel activate the moment the first contract is created.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          {/* Contract list */}
          <aside className="w-full shrink-0 lg:w-80">
            <div className="rounded-2xl border border-navy-700 bg-navy-800 p-3">
              <p className="px-2 pb-2 pt-1 text-xs font-semibold uppercase tracking-wider text-gray-500">Contracts</p>
              {loading ? (
                <p className="p-4 text-sm text-gray-500">Loading contracts…</p>
              ) : (
                <ul className="space-y-1.5">
                  {contracts.map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => select(c.id)}
                        className={`w-full rounded-xl px-3 py-2.5 text-left transition-colors ${
                          selectedId === c.id
                            ? "border border-gold-500/30 bg-gold-500/10"
                            : "border border-transparent hover:bg-navy-700/50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-white">
                            {c.address ?? "—"}
                          </span>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_BADGE[c.status] ?? "bg-navy-700 text-gray-400"}`}>
                            {STATUS_LABELS[c.status] ?? c.status}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-gray-500">
                          {c.contractType} · {fmtDate(c.expectedCloseDate)} · {fmtDollars(c.assignmentFeeCents)}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>

          {/* Detail */}
          <section className="min-w-0 flex-1">
            {!detail ? (
              <div className="rounded-2xl border border-navy-700 bg-navy-800 p-8 text-center text-sm text-gray-500">
                Select a contract to open its closing workflow.
              </div>
            ) : (
              <div className="space-y-6">
                {/* Header */}
                <div className="rounded-2xl border border-navy-700 bg-navy-800 p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-white">{detail.address ?? "Contract"}</h2>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {detail.contractType} contract{detail.campaignName ? ` · campaign: ${detail.campaignName}` : ""}
                        {detail.leadOutreachStatus ? ` · lead: ${detail.leadOutreachStatus}` : ""}
                      </p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_BADGE[detail.status] ?? "bg-navy-700 text-gray-400"}`}>
                      {STATUS_LABELS[detail.status] ?? detail.status}
                    </span>
                  </div>

                  {/* Status stepper */}
                  <div className="mt-5 flex flex-wrap items-center gap-1">
                    {CLOSING_STATUSES.map((s, i) => {
                      const curIdx = CLOSING_STATUSES.indexOf(detail.status as (typeof CLOSING_STATUSES)[number]);
                      const isDone = curIdx > i;
                      const isCurrent = curIdx === i;
                      const isCancelled = detail.status === "cancelled";
                      return (
                        <div key={s} className="flex items-center">
                          <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                            isCurrent ? "bg-gold-500 text-navy-900"
                              : isDone ? "bg-emerald-500/15 text-emerald-400"
                                : isCancelled ? "bg-navy-700 text-gray-500"
                                  : "bg-navy-700 text-gray-500"
                          }`}>
                            {isDone ? "✓ " : ""}{STATUS_LABELS[s] ?? s}
                          </div>
                          {i < CLOSING_STATUSES.length - 1 && <span className="mx-0.5 h-px w-3 bg-navy-600" />}
                        </div>
                      );
                    })}
                  </div>

                  {/* Attention */}
                  {attentionItems.length > 0 && (
                    <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
                      <p className="text-xs font-semibold text-amber-300">Needs attention</p>
                      <ul className="mt-1 list-inside list-disc text-xs text-amber-200/90">
                        {attentionItems.map((a, i) => (
                          <li key={i}>
                            {a.kind === "checklist"
                              ? `Overdue: ${a.label} (due ${fmtDate(a.dueDate)})`
                              : `${a.label} — ${fmtDate(a.date)}`}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {/* Title / escrow / dates */}
                <div className="rounded-2xl border border-navy-700 bg-navy-800 p-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Title &amp; Escrow</h3>
                    <button
                      onClick={handleSaveDetails}
                      disabled={busy === "details"}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 ${
                        savedEdit ? "bg-emerald-500/20 text-emerald-300" : "bg-gold-500 text-navy-900 hover:bg-gold-400"
                      }`}
                    >
                      {savedEdit ? "✓ Saved" : busy === "details" ? "Saving..." : "Save"}
                    </button>
                  </div>
                  {edit && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1 block text-xs text-gray-400">Title company</span>
                        <input
                          value={edit.titleCompany}
                          onChange={(e) => { setEdit({ ...edit, titleCompany: e.target.value }); setSavedEdit(false); }}
                          placeholder="e.g. Alamo Title Co."
                          className="w-full rounded-lg border border-navy-600 bg-navy-900 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-gold-500 focus:outline-none"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs text-gray-400">Escrow account</span>
                        <input
                          value={edit.escrowAccount}
                          onChange={(e) => { setEdit({ ...edit, escrowAccount: e.target.value }); setSavedEdit(false); }}
                          placeholder="escrow / file number"
                          className="w-full rounded-lg border border-navy-600 bg-navy-900 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-gold-500 focus:outline-none"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs text-gray-400">Expected close</span>
                        <input
                          type="date"
                          value={edit.expectedCloseDate}
                          onChange={(e) => { setEdit({ ...edit, expectedCloseDate: e.target.value }); setSavedEdit(false); }}
                          className="w-full rounded-lg border border-navy-600 bg-navy-900 px-3 py-2 text-sm text-white focus:border-gold-500 focus:outline-none"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs text-gray-400">Actual close</span>
                        <input
                          type="date"
                          value={edit.closeDate}
                          onChange={(e) => { setEdit({ ...edit, closeDate: e.target.value }); setSavedEdit(false); }}
                          className="w-full rounded-lg border border-navy-600 bg-navy-900 px-3 py-2 text-sm text-white focus:border-gold-500 focus:outline-none"
                        />
                      </label>
                    </div>
                  )}
                  {detail.closingDeadlines && typeof detail.closingDeadlines === "object" && (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-navy-700 pt-3">
                      {Object.entries(detail.closingDeadlines)
                        .filter(([, v]) => v !== null && v !== undefined && v !== "")
                        .map(([k, v]) => (
                          <span key={k} className="rounded-lg bg-navy-900 px-2.5 py-1 text-[11px] text-gray-400">
                            {k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}:{" "}
                            <span className="text-gray-200">{String(v).slice(0, 10)}</span>
                          </span>
                        ))}
                    </div>
                  )}
                </div>

                {/* Checklist */}
                <div className="rounded-2xl border border-navy-700 bg-navy-800 p-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Closing checklist</h3>
                    <span className="text-xs text-gray-500">
                      {detail.checklist.filter((i) => i.done).length}/{detail.checklist.length} done
                    </span>
                  </div>
                  <ul className="mt-3 space-y-1">
                    {detail.checklist.map((item) => (
                      <li key={item.id} className="flex items-start gap-3 rounded-xl px-2 py-1.5 hover:bg-navy-900/40">
                        <button
                          onClick={() => handleToggle(item)}
                          disabled={busy === `chk-${item.id}`}
                          aria-label={`Toggle ${item.label}`}
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[11px] transition-colors disabled:opacity-40 ${
                            item.done
                              ? "border-emerald-500 bg-emerald-500 text-navy-900"
                              : "border-navy-500 bg-navy-900 text-transparent hover:border-gold-500"
                          }`}
                        >
                          ✓
                        </button>
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm ${item.done ? "text-gray-500 line-through" : "text-gray-200"}`}>{item.label}</p>
                          {item.dueDate && (
                            <p className={`text-[11px] ${item.dueDate < new Date().toISOString().split("T")[0] && !item.done ? "text-amber-400" : "text-gray-600"}`}>
                              due {fmtDate(item.dueDate)}
                            </p>
                          )}
                        </div>
                        {item.completedAt && (
                          <span className="shrink-0 text-[10px] text-gray-600">
                            {item.operator ?? ""} · {new Date(item.completedAt).toLocaleDateString()}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Profit + assignment paid */}
                <div className="rounded-2xl border border-navy-700 bg-navy-800 p-6">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Profit</h3>
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <div className="rounded-xl bg-navy-900/70 p-3">
                      <p className="text-[11px] text-gray-500">Assignment fee</p>
                      <p className="mt-0.5 text-lg font-semibold text-white">{fmtDollars(detail.profit.assignmentFeeCents)}</p>
                    </div>
                    <div className="rounded-xl bg-navy-900/70 p-3">
                      <p className="text-[11px] text-gray-500">Platform costs</p>
                      <p className="mt-0.5 text-lg font-semibold text-white">{fmtDollars(detail.profit.costsCents)}</p>
                    </div>
                    <div className="rounded-xl bg-navy-900/70 p-3">
                      <p className="text-[11px] text-gray-500">Net</p>
                      <p className={`mt-0.5 text-lg font-semibold ${detail.profit.netCents === null ? "text-gray-500" : "text-emerald-400"}`}>
                        {fmtDollars(detail.profit.netCents)}
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] text-gray-600">
                    {detail.profit.assignmentFeeCents === null
                      ? "Fee not recorded yet — net shows “—” until the assignment fee is recorded (never a guessed $0)."
                      : "Net = recorded assignment fee − recorded platform costs (only what is actually recorded counts)."}
                    {" "}Real deal proceeds flow title company → owner's bank at closing; the platform only tracks.
                  </p>

                  <div className="mt-4 border-t border-navy-700 pt-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 text-sm text-gray-300">
                        Fee paid ($)
                        <input
                          value={feeDraft}
                          onChange={(e) => setFeeDraft(e.target.value)}
                          className="w-28 rounded-lg border border-navy-600 bg-navy-900 px-3 py-2 text-sm text-white focus:border-gold-500 focus:outline-none"
                        />
                      </label>
                      <button
                        onClick={handleRecordAssignment}
                        disabled={busy === "record" || detail.status === "closed" || detail.status === "cancelled"}
                        className={`rounded-lg px-5 py-2 text-sm font-semibold transition-colors disabled:opacity-40 ${
                          detail.status === "closed"
                            ? "bg-emerald-500/20 text-emerald-300"
                            : "bg-gold-500 text-navy-900 hover:bg-gold-400"
                        }`}
                      >
                        {detail.status === "closed"
                          ? "✓ Assignment paid — closed"
                          : detail.assignmentPending
                            ? "Approval pending — see /approvals"
                            : busy === "record"
                              ? "Working..."
                              : "Record assignment paid"}
                      </button>
                      {detail.assignmentPending && (
                        <Link to="/approvals" className="text-xs text-gold-400 hover:underline">
                          Decide the assignment approval →
                        </Link>
                      )}
                      {!detail.assignmentPending && !detail.assignmentApproved && detail.status !== "closed" && (
                        <span className="text-[11px] text-gray-600">
                          First press fires the owner approval request; after approval on /approvals, press again to record.
                        </span>
                      )}
                    </div>
                    {msg && (
                      <p className={`mt-2 text-xs ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Tab 2 — Contract Builder (preserved document generator)
// ═══════════════════════════════════════════════════════════════════════════

function ContractBuilderTab() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [contractType, setContractType] = useState<ContractType>("purchase");
  const [selectedBuyer, setSelectedBuyer] = useState<string>("");
  const [formData, setFormData] = useState<ContractFormData>(defaultFormData());
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [loading, setLoading] = useState(true);
  const [dbUnavailable, setDbUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchContractLeads(),
      fetchBuyersForContracts(),
    ]).then(([leadData, buyerData]) => {
      if (cancelled) return;
      if (leadData) { setLeads(leadData.leads); if (leadData.dbUnavailable) setDbUnavailable(true); }
      if (buyerData) { setBuyers(buyerData.buyers); if (buyerData.dbUnavailable) setDbUnavailable(true); }
    }).catch(() => {
      if (!cancelled) setDbUnavailable(true);
    }).finally(() => {
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
        <h1 className="text-xl font-bold">DealForge Properties</h1>
        <p className="text-sm text-gray-600">Technology-Driven Real Estate Solutions</p>
      </div>

      {/* Database unreachable — never show fabricated data */}
      {dbUnavailable && (
        <div className="mx-auto mt-6 max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            ⚠️ Data unavailable — NOT CONNECTED (live database unreachable). No
            contract-ready leads or buyers are shown rather than displaying
            placeholder information.
          </div>
        </div>
      )}

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
          {fullAddress}, and <strong>DealForge Properties or Assigns</strong> ("Buyer").
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
          <p className="mt-1">DealForge Properties or Assigns</p>
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
          <strong>DealForge Properties</strong> ("Assignor") and{" "}
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
          <p className="mt-1">DealForge Properties</p>
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

// ═══════════════════════════════════════════════════════════════════════════
function BuyerShortlistPanel() {
  const [leadId, setLeadId] = useState<string | null>(null);
  const [shortlist, setShortlist] = useState<{ lead: LeadForMatch | null; matches: BuyerMatchResult[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [pickers, setPickers] = useState<DealPickerLead[]>([]);
  const load = async (id: string) => {
    setLoading(true);
    const res = await fetchDealShortlist({ data: { leadId: id } });
    setShortlist(res);
    setLoading(false);
  };
  useEffect(() => {
    fetchDealPicker().then((rows) => {
      setPickers(rows ?? []);
      if (rows && rows.length > 0 && !leadId) {
        setLeadId(rows[0].id);
        load(rows[0].id);
      }
    }).catch(() => setPickers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="rounded-2xl border border-navy-700 bg-navy-800 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Buyer shortlist</h3>
          <p className="mt-1 text-xs text-gray-500">
            Auto-matched from your buyer database (San Antonio + SFR criteria) — recommendation only.{" "}
            <span className="text-gray-400 font-medium">Nothing is ever sent to a buyer; outreach is manual and owner-approved.</span>
          </p>
        </div>
        <select
          value={leadId ?? ""}
          onChange={(e) => { const v = e.target.value; setLeadId(v); if (v) load(v); }}
          className="w-full max-w-md rounded-lg border border-navy-600 bg-navy-900 px-3 py-2 text-sm text-white focus:border-gold-500 focus:outline-none"
        >
          {pickers.length === 0 && <option value="">No deals available</option>}
          {pickers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.fullName ?? "—"} — {p.address ?? "no address"} {p.outreachStatus ? `(${p.outreachStatus})` : ""}
            </option>
          ))}
        </select>
      </div>
      {loading ? (
        <p className="mt-4 text-sm text-gray-500">Computing shortlist from live buyer rows…</p>
      ) : shortlist ? (
        <div className="mt-4">
          {shortlist.lead && (
            <p className="mb-3 text-xs text-gray-500">
              Deal context: {shortlist.lead.propertyAddress}, {shortlist.lead.propertyCity},{" "}
              {shortlist.lead.propertyType ?? "—"} · price:{" "}
              {shortlist.lead.price === null ? "no price data" : fmtDollars(shortlist.lead.price)} (
              {shortlist.lead.priceSource})
            </p>
          )}
          {shortlist.matches.length === 0 ? (
            <p className="rounded-xl bg-navy-900/70 p-4 text-sm text-gray-400">
              No buyer matches on the stored criteria — honest result, nothing invented. As buyers add price bands and
              rehab budgets, matches firm up automatically.
            </p>
          ) : (
            <ul className="space-y-3">
              {shortlist.matches.slice(0, 12).map((m) => (
                <li key={m.buyer.id} className="rounded-xl bg-navy-900/70 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-white">{m.buyer.name}</span>
                    <span className="rounded-full bg-gold-500/15 px-2 py-0.5 text-[11px] font-bold text-gold-400">
                      {m.score}% match
                    </span>
                    {m.buyer.verifiedPhone && (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">
                        phone verified (public listing)
                      </span>
                    )}
                    {m.buyer.phone && <span className="text-xs text-gray-300">{m.buyer.phone}</span>}
                  </div>
                  <ul className="mt-2 space-y-0.5 text-xs">
                    {m.matched.map((s, i) => (
                      <li key={i} className="text-emerald-400">✓ {s}</li>
                    ))}
                    {m.missed.map((s, i) => (
                      <li key={i} className="text-amber-400">✗ {s}</li>
                    ))}
                    {m.neutral.map((s, i) => (
                      <li key={i} className="text-gray-600">· {s}</li>
                    ))}
                  </ul>
                </li>
              ))}
              {shortlist.matches.length > 12 && (
                <p className="text-xs text-gray-500">…{shortlist.matches.length - 12} more matches (top 12 shown).</p>
              )}
            </ul>
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm text-gray-500">No deal selected — choose a deal above.</p>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Tab 3 — Transaction Command Center (D3, Steps 8 & 9)
// ═══════════════════════════════════════════════════════════════════════════
/** Shortlist for a FIXED lead (e.g. the transaction's seller) — computed live
 *  from real buyer rows; recommendation only, nothing is ever sent. */
function BuyerShortlistCard({ leadId }: { leadId: string | null }) {
  const [shortlist, setShortlist] = useState<{ lead: LeadForMatch | null; matches: BuyerMatchResult[] } | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setShortlist(null);
    if (!leadId) { setLoading(false); return; }
    fetchDealShortlist({ data: { leadId } })
      .then((res) => { if (alive) setShortlist(res); })
      .catch(() => { if (alive) setShortlist({ lead: null, matches: [] }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [leadId]);
  return (
    <div className="rounded-2xl border border-navy-700 bg-navy-800 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Buyer shortlist — this deal</h3>
          <p className="mt-1 text-xs text-gray-500">
            Auto-matched from your buyer database. Recommendation only —{" "}
            <span className="font-medium text-gray-400">outreach is manual and owner-approved; nothing is ever promised or sent to a buyer.</span>
          </p>
        </div>
        <button
          onClick={() => leadId && fetchDealShortlist({ data: { leadId } }).then(setShortlist)}
          disabled={!leadId || loading}
          className="rounded-lg border border-navy-600 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:border-gold-500/60 disabled:opacity-40"
        >
          {loading ? "Computing…" : "Recompute"}
        </button>
      </div>
      <div className="mt-4">
        {loading ? (
          <p className="text-sm text-gray-500">Computing shortlist from live buyer rows…</p>
        ) : !leadId ? (
          <p className="text-sm text-gray-500">No linked lead — nothing to match.</p>
        ) : shortlist && shortlist.matches.length === 0 ? (
          <p className="rounded-xl bg-navy-900/70 p-4 text-sm text-gray-400">
            No buyer matches on the stored criteria — honest result, nothing invented.
          </p>
        ) : shortlist ? (
          <ul className="space-y-2">
            {shortlist.matches.slice(0, 10).map((m) => (
              <li key={m.buyer.id} className="rounded-xl bg-navy-900/70 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-white">{m.buyer.name}</span>
                  <span className="rounded-full bg-gold-500/15 px-2 py-0.5 text-[11px] font-bold text-gold-400">{m.score}%</span>
                  {m.buyer.phone && <span className="text-xs text-gray-300">{m.buyer.phone}</span>}
                  {m.buyer.verifiedPhone && <span className="text-[10px] text-emerald-400">public-verified</span>}
                </div>
                <ul className="mt-1.5 space-y-0.5 text-xs">
                  {m.matched.map((s, i) => <li key={i} className="text-emerald-400">✓ {s}</li>)}
                  {m.missed.map((s, i) => <li key={i} className="text-amber-400">✗ {s}</li>)}
                  {m.neutral.map((s, i) => <li key={i} className="text-gray-600">· {s}</li>)}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">No deal selected.</p>
        )}
      </div>
    </div>
  );
}
const ARC_NEXT_LABEL: Record<string, string> = {
  qualified: "Ready to record contract signed (needs approval)",
  offer: "Ready to record contract signed (needs approval)",
  negotiation: "Ready to record contract signed (needs approval)",
  contract_sent: "Ready to record contract signed (needs approval)",
  contract_signed: "Ready: advance to buyer matched",
  buyer_matched: "Ready: move toward closing (title)",
  title: "In title — closing workflow",
  closed: "Closed",
  assignment_paid: "Closed — assignment paid",
};
const OUTREACH_LABELS: Record<string, string> = {
  new: "New", contactable: "Contactable", outreach_queued: "Queued", contact_attempted: "Contact attempted",
  connected: "Connected", qualified: "Qualified", offer: "Offer", negotiation: "Negotiation",
  contract_sent: "Contract sent", contract_signed: "Contract signed", buyer_matched: "Buyer matched",
  title: "Title", closed: "Closed", assignment_paid: "Assignment paid", follow_up: "Follow-up",
  dnc: "DNC", do_not_mail: "Do not mail", opted_out: "Opted out", invalid_contact: "Invalid contact",
  wrong_number: "Wrong number", not_interested: "Not interested", dead_lead: "Dead lead",
};
function outreachLabel(status: string | null | undefined): string {
  return OUTREACH_LABELS[status ?? ""] ?? (status ? status.replace(/_/g, " ") : "—");
}
const ARC_SHORTCUTS: Array<{ to: "contract_signed" | "buyer_matched" | "title"; label: string; desc: string }> = [
  { to: "contract_signed", label: "Record contract signed", desc: "walks the approved offer arc; gated by a 'contract' approval" },
  { to: "buyer_matched", label: "Advance to buyer matched", desc: "forward arc after the contract is signed (no new gate)" },
  { to: "title", label: "Move toward closing (title)", desc: "opens title — contract status → 'title_open'" },
];
const ARC_LABEL: Record<string, string> = {
  contract_signed: "contract signed",
  buyer_matched: "buyer matched",
  title: "title",
};

function TransactionCommandCenterTab() {
  const [cc, setCc] = useState<TransactionCommandCenterData | null>(null);
  const [selected, setSelected] = useState<TransactionRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [shortlistKey, setShortlistKey] = useState<string | null>(null);
  const refresh = async () => {
    const d = await fetchTransactionCC();
    setCc(d);
    if (selected && !d.transactions.some((t) => t.contractId === selected.contractId)) {
      setSelected(null);
    }
  };
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const handleShortcut = async (to: "contract_signed" | "buyer_matched" | "title") => {
    if (!selected) return;
    setBusy(to);
    setMsg(null);
    const res: ArcAdvanceResult = await runArcAdvance({ data: { contractId: selected.contractId, to } });
    if ("approvalRequested" in res && res.approvalRequested) {
      setMsg({
        ok: true,
        text: `Approval requested (${res.kinds.join(" + ")}) — decide it on /approvals, then press "${ARC_LABEL[to]}" again to finish the arc step.`,
      });
    } else if (res.success) {
      setMsg({ ok: true, text: `Arc advanced to ${ARC_LABEL[to]}.` });
    } else {
      setMsg({ ok: false, text: res.error });
    }
    await refresh();
    setBusy(null);
  };
  const totals = cc?.totals ?? { transactions: 0, needsAttention: 0, overdueSteps: 0, closingWithin7d: 0, missingTitle: 0, cancelled: 0 };
  const empty = cc?.transactions.length === 0;
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Transaction Command Center</h1>
        <p className="mt-1 text-sm text-gray-400">
          Every transaction that needs your attention — overdue checklist steps, closings inside 7 days, missing
          title companies — computed live from the closing workflow tables. No rows are ever invented; with zero
          contracts this screen honestly reads zero.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {([
          ["Transactions", totals.transactions],
          ["Need attention", totals.needsAttention],
          ["Overdue steps", totals.overdueSteps],
          ["Closing ≤ 7 days", totals.closingWithin7d],
          ["Missing title co", totals.missingTitle],
          ["Cancelled", totals.cancelled],
        ] as const).map(([label, n]) => (
          <div key={label} className="rounded-2xl border border-navy-700 bg-navy-800 p-4">
            <p className="text-[11px] uppercase tracking-wider text-gray-500">{label}</p>
            <p className={`mt-1 text-2xl font-bold ${n > 0 ? "text-gold-400" : "text-gray-300"}`}>{n}</p>
          </div>
        ))}
      </div>
      {empty && cc?.dbOk ? (
        <div className="mt-6 rounded-2xl border border-navy-700 bg-navy-800 p-10 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-navy-700">
            <svg className="h-8 w-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-white">0 transactions — 0 blocked items</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-gray-400">
            This is the correct production state. A transaction appears here only when a real contract is signed;
            the closing-arc shortcuts, due-attention flags and buyer shortlists activate the moment the first one
            exists.
          </p>
        </div>
      ) : cc ? (
        <div className="mt-6 flex flex-col gap-6 lg:flex-row lg:items-start">
          <div className="w-full shrink-0 lg:w-96">
            <div className="rounded-2xl border border-navy-700 bg-navy-800 p-3">
              <p className="px-2 pb-2 pt-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
                Transactions
              </p>
              <ul className="space-y-1.5">
                {cc.transactions.map((t) => (
                  <li key={t.contractId}>
                    <button
                      onClick={() => { setSelected(t); setShortlistKey(`${t.contractId}-${Date.now()}`); }}
                      className={`w-full rounded-xl px-3 py-2.5 text-left transition-colors ${
                        selected?.contractId === t.contractId
                          ? "border border-gold-500/30 bg-gold-500/10"
                          : "border border-transparent hover:bg-navy-700/50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-white">{t.address ?? "—"}</span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_BADGE[t.status] ?? "bg-navy-700 text-gray-400"}`}>
                          {STATUS_LABELS[t.status] ?? t.status}
                        </span>
                      </div>
                      {t.attention.length > 0 ? (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {t.attention.map((a, i) => (
                            <span key={i} className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">
                              {a.kind === "overdue_checklist" ? `⏱ ${a.label}` : a.label}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-1 text-[10px] text-gray-600">no attention items</p>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="px-2 pt-2 text-[11px] text-gray-500">
                {cc.totals.needsAttention} of {cc.totals.transactions} need attention · {cc.totals.overdueSteps} overdue steps
              </p>
            </div>
          </div>
          {selected ? (
            <div className="min-w-0 flex-1 space-y-4">
              <div className="rounded-2xl border border-navy-700 bg-navy-800 p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Transaction detail</h3>
                    <p className="mt-1 text-sm text-white">{selected.address ?? "—"}</p>
                    <p className="text-xs text-gray-500">
                      {selected.fullName ?? "no seller name"} · expected close {fmtDate(selected.expectedCloseDate)} · title co:{" "}
                      {selected.titleCompany || "—"}
                    </p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE[selected.status] ?? "bg-navy-700 text-gray-400"}`}>
                    {STATUS_LABELS[selected.status] ?? selected.status}
                  </span>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-navy-900/70 p-3">
                    <p className="text-[11px] text-gray-500">Lead outreach arc</p>
                    <p className="mt-0.5 text-sm font-medium text-white">{outreachLabel(selected.leadOutreachStatus)}</p>
                    <p className="mt-1 text-[11px] text-gray-500">{ARC_NEXT_LABEL[selected.leadOutreachStatus ?? ""] ?? "—"}</p>
                  </div>
                  <div className="rounded-xl bg-navy-900/70 p-3">
                    <p className="text-[11px] text-gray-500">Closing checklist</p>
                    <p className="mt-0.5 text-sm font-medium text-white">
                      {selected.checklist.done}/{selected.checklist.total} done
                      {selected.checklist.overdue > 0 && <span className="text-amber-400"> · {selected.checklist.overdue} overdue</span>}
                    </p>
                  </div>
                </div>
                {selected.attention.length > 0 ? (
                  <ul className="mt-4 space-y-1">
                    {selected.attention.map((a, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm text-amber-300">
                        <span className="text-gold-400">⚠</span> {a.label} {a.date ? `(${fmtDate(a.date)})` : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-4 text-sm text-gray-500">No attention items for this transaction.</p>
                )}
              </div>
              <div className="rounded-2xl border border-navy-700 bg-navy-800 p-6">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Closing arc shortcuts</h3>
                <p className="mt-1 text-xs text-gray-500">
                  Owner-gated steps through the compliance state machine — nothing is ever bypassed; gated steps
                  request an approval that you decide on /approvals before the arc moves.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {ARC_SHORTCUTS.map((s) => (
                    <button
                      key={s.to}
                      onClick={() => handleShortcut(s.to)}
                      disabled={busy !== null || selected.status === "closed" || selected.status === "cancelled"}
                      className="rounded-xl border border-navy-600 bg-navy-900/70 p-3 text-left transition-colors hover:border-gold-500/50 disabled:opacity-40"
                    >
                      <p className="text-sm font-semibold text-white">{s.label}</p>
                      <p className="mt-1 text-[11px] text-gray-500">{s.desc}</p>
                    </button>
                  ))}
                </div>
                {msg && (
                  <p className={`mt-3 rounded-lg border px-3 py-2 text-sm ${msg.ok ? "border-emerald-500/30 bg-emerald-950/40 text-emerald-300" : "border-red-500/30 bg-red-950/40 text-red-300"}`}>
                    {msg.text}
                  </p>
                )}
              </div>
              <BuyerShortlistCard key={shortlistKey ?? undefined} leadId={selected.leadId} />
            </div>
          ) : (
            <div className="min-w-0 flex-1 rounded-2xl border border-navy-700 bg-navy-800 p-10 text-center text-sm text-gray-500">
              Select a transaction to see its due-attention, closing-arc shortcuts and buyer shortlist.
            </div>
          )}
        </div>
      ) : null}
      <div className="mt-8">
        <BuyerShortlistPanel />
      </div>
    </div>
  );
}

// Page (tab switcher)
// ═══════════════════════════════════════════════════════════════════════════

function ContractsPage() {
  const [tab, setTab] = useState<"closing" | "builder" | "center">("center");
  return (
    <div className="min-h-dvh bg-navy-950">
      <div className="border-b border-navy-700 bg-navy-900/60">
        <div className="mx-auto flex max-w-7xl gap-1 px-4 pt-4 sm:px-6 lg:px-8">
          {([
            ["center", "Command Center"],
            ["closing", "Closing Workflow"],
            ["builder", "Contract Builder"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`rounded-t-lg px-5 py-2.5 text-sm font-semibold transition-colors ${
                tab === key
                  ? "border border-b-0 border-navy-700 bg-navy-800 text-gold-400"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {tab === "center" ? <TransactionCommandCenterTab /> : tab === "closing" ? <ClosingWorkflowTab /> : <ContractBuilderTab />}
    </div>
  );
}

export const Route = createFileRoute("/contracts")({
  component: () => (
    <OwnerGate>
      <ContractsPage />
    </OwnerGate>
  ),
  head: () => ({
    meta: [
      { title: "Contracts & Closing — DealForge Properties" },
      {
        name: "description",
        content: "Contract builder and closing workflow — title, escrow, checklist, deadlines, assignment fee and profit tracking.",
      },
    ],
  }),
});
