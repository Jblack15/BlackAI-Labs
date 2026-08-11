import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";

// --- Types ---
interface SmsStats {
  totalThisMonth: number;
  recentLogs: SmsLogEntry[];
  twilioConfigured: boolean;
}

interface SmsLogEntry {
  id: string;
  lead_id: string | null;
  to_phone: string;
  message: string;
  status: string;
  twilio_sid: string | null;
  created_at: string;
}

// --- Server Functions ---
const fetchSmsStats = createServerFn({ method: "GET" }).handler(async (): Promise<SmsStats> => {
  const twilioConfigured = !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER
  );

  try {
    const { sql } = await import("~/db");

    // Total SMS this month
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const countRows = await sql`
      SELECT COUNT(*)::int as count FROM sms_logs
      WHERE created_at >= ${monthStart.toISOString()}
    ` as { count: number }[];
    const totalThisMonth = countRows[0]?.count ?? 0;

    // Recent 10 SMS logs
    const logRows = await sql`
      SELECT id, lead_id, to_phone, message, status, twilio_sid, created_at
      FROM sms_logs
      ORDER BY created_at DESC
      LIMIT 10
    ` as SmsLogEntry[];

    const recentLogs = logRows.map((r) => ({ ...r, created_at: String(r.created_at) }));

    return { totalThisMonth, recentLogs, twilioConfigured };
  } catch {
    return { totalThisMonth: 0, recentLogs: [], twilioConfigured };
  }
});

// --- Page Component ---
function SettingsPage() {
  const [stats, setStats] = useState<SmsStats>({
    totalThisMonth: 0,
    recentLogs: [],
    twilioConfigured: false,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSmsStats()
      .then((data) => {
        if (data) setStats(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function formatPhone(phone: string): string {
    // Mask middle digits for privacy
    const cleaned = phone.replace(/\D/g, "");
    if (cleaned.length >= 10) {
      return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-****`;
    }
    return phone;
  }

  function formatTime(dateStr: string): string {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Settings</h1>
        <p className="mt-1 text-gray-400">Manage integrations and monitor system health.</p>
      </div>

      {/* SMS Configuration Status */}
      <div className="mb-8 rounded-xl border border-navy-700 bg-navy-800/60 p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">SMS Integration (Twilio)</h2>
        <div className="flex items-center gap-3">
          <div
            className={`flex h-3 w-3 rounded-full ${
              stats.twilioConfigured ? "bg-green-500 animate-pulse" : "bg-red-500"
            }`}
          />
          <span
            className={`text-lg font-semibold ${
              stats.twilioConfigured ? "text-green-400" : "text-red-400"
            }`}
          >
            {stats.twilioConfigured ? "Connected" : "Not Configured"}
          </span>
        </div>
        <p className="mt-2 text-sm text-gray-500">
          {stats.twilioConfigured
            ? "Twilio API keys are set. SMS notifications are active."
            : "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER environment variables to enable SMS."}
        </p>
      </div>

      {/* SMS Stats Card */}
      <div className="mb-8 rounded-xl border border-navy-700 bg-navy-800/60 p-6">
        <h2 className="mb-2 text-lg font-semibold text-white">SMS Usage</h2>
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-bold text-white">
            {loading ? "—" : stats.totalThisMonth}
          </span>
          <span className="text-gray-400">messages sent this month</span>
        </div>
        <div className="mt-4 flex gap-4">
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

      {/* Recent SMS Log */}
      <div className="rounded-xl border border-navy-700 bg-navy-800/60">
        <div className="border-b border-navy-700 px-6 py-4">
          <h2 className="text-lg font-semibold text-white">Recent SMS Log</h2>
          <p className="text-sm text-gray-500">Last 10 messages sent</p>
        </div>
        {loading ? (
          <div className="px-6 py-12 text-center text-sm text-gray-500">
            <span className="inline-block h-4 w-4 animate-pulse rounded-full bg-gold-500" />{" "}
            Loading...
          </div>
        ) : stats.recentLogs.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-gray-500">
            No SMS messages have been sent yet.
          </div>
        ) : (
          <div className="divide-y divide-navy-700">
            {stats.recentLogs.map((log) => (
              <div key={log.id} className="px-6 py-4 transition-colors hover:bg-navy-800/50">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-200 truncate">{log.message}</p>
                    <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
                      <span>To: {formatPhone(log.to_phone)}</span>
                      {log.twilio_sid && (
                        <span className="font-mono text-[10px] text-gray-600">
                          SID: {log.twilio_sid.slice(0, 10)}...
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        log.status === "sent"
                          ? "bg-green-500/20 text-green-400"
                          : "bg-red-500/20 text-red-400"
                      }`}
                    >
                      {log.status}
                    </span>
                    <span className="text-xs text-gray-600">{formatTime(log.created_at)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
  head: () => ({
    meta: [
      { title: "Settings — DealFlow AI" },
      {
        name: "description",
        content: "Manage your DealFlow AI integrations, including Twilio SMS configuration.",
      },
    ],
  }),
});
