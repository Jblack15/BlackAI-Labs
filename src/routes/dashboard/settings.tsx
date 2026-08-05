import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { sendSms } from "~/sms";

export const Route = createFileRoute("/dashboard/settings")({
  component: SettingsPage,
});

const tabs = [
  { id: "general", label: "General" },
  { id: "billing", label: "Billing" },
] as const;

type TabId = (typeof tabs)[number]["id"];

const STRIPE_LINKS = {
  Starter: "https://buy.stripe.com/bJe14n2ip8LB85r8KigIo00",
  Professional: "https://buy.stripe.com/8x2fZh5uBbXN5Xj6CagIo01",
  Enterprise: "https://buy.stripe.com/00wcN56yF4vl0CZbWugIo02",
} as const;

// Mock billing history — will be replaced with real Stripe webhook data
const mockInvoices = [
  { id: "INV-001", date: "Jul 1, 2026", amount: "$199.00", status: "Paid" },
  { id: "INV-002", date: "Jun 1, 2026", amount: "$199.00", status: "Paid" },
  { id: "INV-003", date: "May 1, 2026", amount: "$199.00", status: "Paid" },
];

function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabId>("general");

  return (
    <div>
      <h1 className="text-2xl font-extrabold text-white">Settings</h1>

      {/* Tab bar */}
      <div className="mt-6 flex border-b border-slate-700">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-3 text-sm font-medium transition border-b-2 -mb-px ${
              activeTab === tab.id
                ? "text-orange-400 border-orange-500"
                : "text-slate-400 border-transparent hover:text-slate-200 hover:border-slate-500"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="mt-6">
        {activeTab === "general" && <GeneralTab />}
        {activeTab === "billing" && <BillingTab />}
      </div>
    </div>
  );
}

/* ── General Tab ────────────────────────────────────────────────── */
function GeneralTab() {
  const [smsEnabled, setSmsEnabled] = useState(true);
  const [smsPhone, setSmsPhone] = useState("");
  const [testStatus, setTestStatus] = useState("");

  const handleTestSms = async () => {
    if (!smsPhone) { setTestStatus("Enter the shop phone number first."); return; }
    setTestStatus("Sending test message...");
    try {
      const result = await sendSms({ data: { recipient: smsPhone, message: "CollisionAI SMS notifications are working!" } });
      setTestStatus(result.success ? "Test SMS sent successfully." : result.error);
    } catch { setTestStatus("We couldn't send the test SMS right now."); }
  };

  return (
    <div className="rounded-2xl border border-slate-700/50 bg-slate-800/50 p-6 sm:p-8">
      <h2 className="text-lg font-bold text-white">Shop Profile</h2>
      <p className="mt-1 text-sm text-slate-400">
        Manage your shop name and contact details.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">
            Shop Name
          </label>
          <input
            type="text"
            defaultValue="Your Shop"
            className="w-full rounded-xl border border-slate-600 bg-slate-800 px-4 py-2.5 text-white placeholder-slate-500 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">
            Email Address
          </label>
          <input
            type="email"
            defaultValue="owner@yourshop.com"
            className="w-full rounded-xl border border-slate-600 bg-slate-800 px-4 py-2.5 text-white placeholder-slate-500 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">
            Phone Number
          </label>
          <input
            type="tel"
            defaultValue="(555) 123-4567"
            className="w-full rounded-xl border border-slate-600 bg-slate-800 px-4 py-2.5 text-white placeholder-slate-500 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">
            Time Zone
          </label>
          <select className="w-full rounded-xl border border-slate-600 bg-slate-800 px-4 py-2.5 text-white outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20">
            <option>Eastern (ET)</option>
            <option>Central (CT)</option>
            <option>Mountain (MT)</option>
            <option>Pacific (PT)</option>
          </select>
        </div>
      </div>

      <div className="mt-6 border-t border-slate-700/50 pt-6">
        <h3 className="text-base font-bold text-white">SMS Notifications</h3>
        <p className="mt-1 text-sm text-slate-400">Send estimate explanations and repair updates by text.</p>
        <div className="mt-4 flex items-center justify-between rounded-xl border border-slate-700 bg-slate-800 px-4 py-3">
          <div><p className="text-sm font-medium text-slate-200">Enable SMS notifications</p><p className="text-xs text-slate-500">You can turn texting off at any time.</p></div>
          <button type="button" role="switch" aria-checked={smsEnabled} onClick={() => setSmsEnabled(!smsEnabled)} className={`relative h-6 w-11 rounded-full transition ${smsEnabled ? "bg-orange-500" : "bg-slate-600"}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${smsEnabled ? "left-6" : "left-1"}`} /></button>
        </div>
        <label className="mt-4 block text-sm font-medium text-slate-300">Shop outgoing phone number</label>
        <input type="tel" value={smsPhone} onChange={(e) => setSmsPhone(e.target.value)} placeholder="+15551234567" className="mt-1.5 w-full rounded-xl border border-slate-600 bg-slate-800 px-4 py-2.5 text-white placeholder-slate-500 outline-none focus:border-orange-500" />
        <div className="mt-3 flex flex-wrap items-center gap-3"><button type="button" onClick={handleTestSms} disabled={!smsEnabled} className="rounded-xl border border-slate-600 px-4 py-2.5 text-sm font-medium text-slate-300 hover:border-orange-500 hover:text-white disabled:opacity-40">Test SMS</button>{testStatus && <span className={`text-sm ${testStatus.includes("success") ? "text-emerald-400" : "text-slate-400"}`}>{testStatus}</span>}</div>
      </div>
      <div className="mt-6">
        <button className="rounded-xl bg-orange-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-orange-500/25 transition hover:bg-orange-600">Save Changes</button>
      </div>
    </div>
  );
}

/* ── Billing Tab ────────────────────────────────────────────────── */
function BillingTab() {
  return (
    <div className="space-y-6">
      {/* Current plan */}
      <div className="rounded-2xl border border-slate-700/50 bg-slate-800/50 p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-white">Current Plan</h2>
            <p className="mt-1 text-sm text-slate-400">
              You are on the{" "}
              <span className="font-semibold text-orange-400">Professional</span>{" "}
              plan at $199/month.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <a
              href={STRIPE_LINKS.Enterprise}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex rounded-xl bg-orange-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-orange-500/25 transition hover:bg-orange-600"
            >
              Upgrade to Enterprise
            </a>
            <a
              href={STRIPE_LINKS.Professional}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex rounded-xl border border-slate-600 px-5 py-2.5 text-sm font-medium text-slate-300 transition hover:border-slate-400 hover:text-white"
            >
              Manage Billing
              <span className="ml-1.5 text-slate-500 text-xs">via Stripe</span>
            </a>
          </div>
        </div>

        {/* Feature list */}
        <div className="mt-6 pt-6 border-t border-slate-700/50">
          <h3 className="text-sm font-medium text-slate-400 mb-3">
            Your plan includes:
          </h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {[
              "Unlimited AI conversations",
              "Repair Tracking & Status Updates",
              "Review Collection",
              "SMS Notifications",
              "Estimate Explainer",
              "Priority Support",
            ].map((f) => (
              <li key={f} className="flex items-center gap-2 text-sm text-slate-300">
                <span className="text-emerald-400 shrink-0">✓</span>
                {f}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Billing history */}
      <div className="rounded-2xl border border-slate-700/50 bg-slate-800/50 p-6 sm:p-8">
        <h2 className="text-lg font-bold text-white">Billing History</h2>
        <p className="mt-1 text-sm text-slate-400">
          Your recent invoices. Managed through Stripe.
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700/50 text-left">
                <th className="pb-3 text-slate-400 font-medium">Invoice</th>
                <th className="pb-3 text-slate-400 font-medium">Date</th>
                <th className="pb-3 text-slate-400 font-medium">Amount</th>
                <th className="pb-3 text-slate-400 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {mockInvoices.map((inv) => (
                <tr key={inv.id} className="border-b border-slate-700/30">
                  <td className="py-3 text-white font-medium">{inv.id}</td>
                  <td className="py-3 text-slate-300">{inv.date}</td>
                  <td className="py-3 text-slate-300">{inv.amount}</td>
                  <td className="py-3">
                    <span className="inline-flex rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400 border border-emerald-500/20">
                      {inv.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Compare plans */}
      <div className="rounded-2xl border border-slate-700/50 bg-slate-800/50 p-6 sm:p-8">
        <h2 className="text-lg font-bold text-white">Explore Plans</h2>
        <p className="mt-1 text-sm text-slate-400">
          See all plans and find the right fit for your shop.
        </p>
        <a
          href="/pricing"
          className="mt-4 inline-flex rounded-xl border border-slate-600 px-5 py-2.5 text-sm font-medium text-slate-300 transition hover:border-slate-400 hover:text-white"
        >
          View Pricing Page
        </a>
      </div>
    </div>
  );
}
