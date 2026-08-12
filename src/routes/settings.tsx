import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Settings — Compliance panel (PH1-B2)
//   • Channel status (honest labels only — NOT CONNECTED where nothing is live)
//   • Suppression counts across the CRM
//   • Business identity profile (drives every outbound template; empty profile
//     blocks outbound sends with "business identity not configured")
//   • Recent outreach audit log
// ─────────────────────────────────────────────────────────────────────────────

type ComplianceSummary = {
  channels: {
    email: { status: string; detail: string };
    sms: { status: string; detail: string };
    mail: { status: string; detail: string };
    voice: { status: string; detail: string };
  };
  suppression: {
    dnc: number;
    do_not_mail: number;
    opted_out: number;
    invalid_contact: number;
    wrong_number: number;
    consent_recorded: number;
  };
  audit_log_rows: number;
  identity: {
    business_name: string;
    phone: string | null;
    website: string | null;
    return_address: string | null;
    email: string | null;
    updated_at: string;
  };
  identityComplete: {
    business_name: boolean;
    website: boolean;
    return_address: boolean;
    phone: boolean;
    email: boolean;
  };
};

type AuditRow = {
  id: number;
  lead_id: string | null;
  channel: string;
  direction: string;
  status: string;
  reason: string | null;
  contact_value: string | null;
  content_preview: string | null;
  operator: string | null;
  created_at: string;
};

const fetchComplianceSummary = createServerFn({ method: "GET" }).handler(async (): Promise<ComplianceSummary | null> => {
  try {
    const { getComplianceSummary } = await import("~/lib/compliance");
    return await getComplianceSummary();
  } catch {
    return null;
  }
});

const fetchAuditLog = createServerFn({ method: "GET" }).handler(async (): Promise<AuditRow[]> => {
  try {
    const { listRecentAuditLog } = await import("~/lib/compliance");
    return await listRecentAuditLog(15);
  } catch {
    return [];
  }
});

const saveIdentity = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { business_name?: string; phone?: string; website?: string; return_address?: string; email?: string })
  .handler(async ({ data }) => {
    try {
      const { saveBusinessProfile } = await import("~/lib/compliance");
      return await saveBusinessProfile({
        business_name: data.business_name?.trim() || undefined,
        phone: data.phone?.trim() || undefined,
        website: data.website?.trim() || undefined,
        return_address: data.return_address?.trim() || undefined,
        email: data.email?.trim() || undefined,
      });
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : "Failed to save profile" };
    }
  });

const EMPTY_SUMMARY: ComplianceSummary = {
  channels: {
    email: { status: "NOT CONNECTED", detail: "no SMTP configured" },
    sms: { status: "NOT CONNECTED", detail: "channel discontinued 2026-08-12" },
    mail: { status: "EXTERNAL — PILOT STAGED", detail: "direct mail runs via PropStream Campaigns (external)" },
    voice: { status: "EXTERNAL — PENDING", detail: "voice runs via BatchDialer (external)" },
  },
  suppression: { dnc: 0, do_not_mail: 0, opted_out: 0, invalid_contact: 0, wrong_number: 0, consent_recorded: 0 },
  audit_log_rows: 0,
  identity: { business_name: "DealForge Properties", phone: null, website: null, return_address: null, email: null, updated_at: "" },
  identityComplete: { business_name: true, website: false, return_address: false, phone: false, email: false },
};

const STATUS_STYLES: Record<string, string> = {
  "NOT CONNECTED": "bg-red-500/20 text-red-300 border-red-500/30",
  "EXTERNAL — PILOT STAGED": "bg-amber-500/20 text-amber-300 border-amber-500/30",
  "EXTERNAL — PENDING": "bg-amber-500/20 text-amber-300 border-amber-500/30",
  OK: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status] || "bg-slate-500/20 text-slate-300 border-slate-500/30"}`}>
      {status}
    </span>
  );
}

function SettingsPage() {
  const [summary, setSummary] = useState<ComplianceSummary | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Identity form state
  const [form, setForm] = useState({ business_name: "", phone: "", website: "", return_address: "", email: "" });
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success: boolean; error?: string } | null>(null);

  const loadAll = async () => {
    const [s, a] = await Promise.all([fetchComplianceSummary(), fetchAuditLog()]);
    if (s) {
      setSummary(s);
      setForm({
        business_name: s.identity.business_name || "",
        phone: s.identity.phone || "",
        website: s.identity.website || "",
        return_address: s.identity.return_address || "",
        email: s.identity.email || "",
      });
    }
    setAudit(a);
    setLoading(false);
  };

  useEffect(() => {
    loadAll().catch(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaveResult(null);
    try {
      const result = await saveIdentity({ data: { ...form } });
      setSaveResult({ success: result.success, error: result.error });
      if (result.success) {
        const s = await fetchComplianceSummary();
        if (s) setSummary(s);
      }
    } catch {
      setSaveResult({ success: false, error: "Failed to save profile" });
    } finally {
      setSaving(false);
    }
  };

  const data = summary || EMPTY_SUMMARY;

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Settings</h1>
        <p className="mt-1 text-gray-400">
          Compliance panel — channel status, suppression, business identity, and the outreach audit trail.
        </p>
      </div>

      {/* Channel status */}
      <div className="mb-8 rounded-xl border border-navy-700 bg-navy-800/60 p-6">
        <h2 className="mb-1 text-lg font-semibold text-white">Outreach Channels</h2>
        <p className="mb-4 text-sm text-gray-500">
          Honest status only — nothing is labeled connected unless it is actually live.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {(["email", "sms", "mail", "voice"] as const).map((ch) => (
            <div key={ch} className="rounded-lg border border-navy-700 bg-navy-900/60 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold uppercase tracking-wider text-gray-300">{ch}</span>
                <StatusPill status={data.channels[ch].status} />
              </div>
              <p className="mt-2 text-xs leading-relaxed text-gray-500">{data.channels[ch].detail}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Business identity */}
      <div className="mb-8 rounded-xl border border-navy-700 bg-navy-800/60 p-6">
        <h2 className="mb-1 text-lg font-semibold text-white">Business Identity</h2>
        <p className="mb-4 text-sm text-gray-500">
          Rendered into every outbound template (email, SMS scripts, postcards).{" "}
          <span className="text-amber-400">
            Outbound sends are BLOCKED until the fields a channel needs are filled
            (business_name for all; website for email; return_address for mail; phone for voice/SMS) —
            nothing ever goes out in a name the owner did not set.
          </span>
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[11px] text-gray-400">
              Business name <span className="text-red-400">*</span>
            </span>
            <input
              value={form.business_name}
              onChange={(e) => setForm((f) => ({ ...f, business_name: e.target.value }))}
              placeholder="DealForge Properties"
              className="w-full rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-gold-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-gray-400">
              Phone <span className="text-red-400">*</span>
            </span>
            <input
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="(210) 555-0199"
              className="w-full rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-gold-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-gray-400">
              Website <span className="text-red-400">*</span>
            </span>
            <input
              value={form.website}
              onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
              placeholder="https://dealforgeproperties.com"
              className="w-full rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-gold-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-gray-400">
              Return address (mail) <span className="text-red-400">*</span>
            </span>
            <input
              value={form.return_address}
              onChange={(e) => setForm((f) => ({ ...f, return_address: e.target.value }))}
              placeholder="DealForge Properties, 100 Main St, San Antonio, TX 78205"
              className="w-full rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-gold-500 focus:outline-none"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[11px] text-gray-400">Email (unsubscribe / reply-to)</span>
            <input
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="hello@dealforgeproperties.com"
              className="w-full rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-gold-500 focus:outline-none"
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-gold-500 px-4 py-2 text-sm font-semibold text-navy-900 transition-colors hover:bg-gold-400 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Business Identity"}
          </button>
          {saveResult && (
            <span className={`text-xs ${saveResult.success ? "text-emerald-400" : "text-red-400"}`}>
              {saveResult.success ? "Saved — templates will render this identity." : saveResult.error}
            </span>
          )}
        </div>
      </div>

      {/* Suppression counts */}
      <div className="mb-8 rounded-xl border border-navy-700 bg-navy-800/60 p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">Suppression &amp; Consent</h2>
        {loading ? (
          <p className="text-sm text-gray-500">
            <span className="mr-1 inline-block h-3 w-3 animate-pulse rounded-full bg-gold-500" />
            Loading...
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              { label: "DNC flagged", value: data.suppression.dnc },
              { label: "Do-not-mail", value: data.suppression.do_not_mail },
              { label: "Opted out", value: data.suppression.opted_out },
              { label: "Invalid contact", value: data.suppression.invalid_contact },
              { label: "Wrong number", value: data.suppression.wrong_number },
              { label: "Consent recorded", value: data.suppression.consent_recorded },
            ].map((c) => (
              <div key={c.label} className="rounded-lg border border-navy-700 bg-navy-900/60 p-4">
                <div className="text-2xl font-bold text-white">{c.value}</div>
                <div className="mt-1 text-xs text-gray-500">{c.label}</div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-gray-500">
          Audit log rows: {data.audit_log_rows} · Suppression is enforced on every send path (SMS, email, mail,
          dispatcher) and the contactable trigger recomputes automatically.
        </p>
      </div>

      {/* Recent audit log */}
      <div className="mb-8 rounded-xl border border-navy-700 bg-navy-800/60">
        <div className="border-b border-navy-700 px-6 py-4">
          <h2 className="text-lg font-semibold text-white">Outreach Audit Log</h2>
          <p className="text-sm text-gray-500">
            Last {audit.length} attempts — sent, blocked, and failed rows are all recorded.
          </p>
        </div>
        {audit.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-gray-500">
            No outreach attempts recorded yet. Every send — sent or blocked — will appear here.
          </div>
        ) : (
          <div className="divide-y divide-navy-700">
            {audit.map((row) => (
              <div key={row.id} className="px-6 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-navy-600 bg-navy-900 px-2 py-0.5 text-[10px] font-medium text-gray-400">
                    #{row.id}
                  </span>
                  <span className="text-xs font-medium uppercase text-gray-300">{row.channel}</span>
                  <span className="text-[10px] uppercase text-gray-600">{row.direction}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                      row.status === "blocked" || row.status === "failed"
                        ? "bg-red-500/20 text-red-300"
                        : row.status === "sent"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-blue-500/20 text-blue-300"
                    }`}
                  >
                    {row.status}
                  </span>
                  {row.operator && <span className="text-[10px] text-gray-600">by {row.operator}</span>}
                  <span className="ml-auto text-[10px] text-gray-600">
                    {new Date(row.created_at).toLocaleString()}
                  </span>
                </div>
                {(row.reason || row.contact_value || row.content_preview) && (
                  <p className="mt-1 truncate text-xs text-gray-500">
                    {row.reason ? <span className="text-red-400/80">{row.reason}</span> : null}
                    {row.contact_value ? <span className="ml-1 font-mono text-gray-400">{row.contact_value}</span> : null}
                    {row.content_preview ? <span className="ml-1 text-gray-600">— {row.content_preview}</span> : null}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-4">
        <Link
          to="/dashboard"
          className="rounded-lg border border-navy-700 px-4 py-2 text-sm text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
        >
          ← Dashboard
        </Link>
        <Link
          to="/crm"
          className="rounded-lg border border-navy-700 px-4 py-2 text-sm text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
        >
          CRM Pipeline →
        </Link>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
  head: () => ({
    meta: [
      { title: "Settings — DealForge Properties" },
      {
        name: "description",
        content: "Compliance panel — channel status, suppression, business identity, and audit trail.",
      },
    ],
  }),
});
