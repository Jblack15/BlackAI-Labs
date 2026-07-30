import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/dashboard/settings")({
  component: SettingsPage,
});

type Tab = "profile" | "ai" | "notifications" | "billing";

const tabs: { key: Tab; label: string; emoji: string }[] = [
  { key: "profile", label: "Shop Profile", emoji: "🏪" },
  { key: "ai", label: "AI Preferences", emoji: "🤖" },
  { key: "notifications", label: "Notifications", emoji: "🔔" },
  { key: "billing", label: "Billing", emoji: "💳" },
];

const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function ToggleSwitch({ enabled, onChange, label }: { enabled: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
        enabled ? "bg-orange-500" : "bg-slate-600"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
          enabled ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [saved, setSaved] = useState(false);

  // Profile state
  const [shopName, setShopName] = useState("Joe's Auto Repair");
  const [phone, setPhone] = useState("(555) 123-4567");
  const [email, setEmail] = useState("shop@joesautorepair.com");
  const [address, setAddress] = useState("123 Main Street, Springfield, IL 62701");
  const [website, setWebsite] = useState("https://joesautorepair.com");
  const [hours, setHours] = useState<Record<string, { open: string; close: string; closed: boolean }>>({
    Monday: { open: "08:00", close: "17:00", closed: false },
    Tuesday: { open: "08:00", close: "17:00", closed: false },
    Wednesday: { open: "08:00", close: "17:00", closed: false },
    Thursday: { open: "08:00", close: "17:00", closed: false },
    Friday: { open: "08:00", close: "17:00", closed: false },
    Saturday: { open: "09:00", close: "14:00", closed: false },
    Sunday: { open: "09:00", close: "14:00", closed: true },
  });

  // AI prefs
  const [aiTone, setAiTone] = useState("friendly");
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [autoReview, setAutoReview] = useState(true);
  const [businessHoursOnly, setBusinessHoursOnly] = useState(false);

  // Notifications
  const [notifyNewConv, setNotifyNewConv] = useState(true);
  const [notifyNegReview, setNotifyNegReview] = useState(true);
  const [notifyAppointment, setNotifyAppointment] = useState(true);
  const [smsUrgent, setSmsUrgent] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleDelete = () => {
    if (showDeleteConfirm) {
      alert("Account deletion requested. This is a mock — nothing actually deleted.");
      setShowDeleteConfirm(false);
    } else {
      setShowDeleteConfirm(true);
    }
  };

  const renderTab = () => {
    switch (activeTab) {
      case "profile":
        return (
          <div className="space-y-6">
            {/* Shop Name */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Shop Name</label>
              <input
                type="text"
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/20"
              />
            </div>

            {/* Phone + Email */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Phone</label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/20"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/20"
                />
              </div>
            </div>

            {/* Address */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Address</label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/20"
              />
            </div>

            {/* Website */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Website</label>
              <input
                type="text"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/20"
              />
            </div>

            {/* Hours */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-3">Hours of Operation</label>
              <div className="space-y-2">
                {daysOfWeek.map((day) => (
                  <div key={day} className="flex items-center gap-3">
                    <span className="w-24 text-sm text-slate-400 shrink-0">{day}</span>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={hours[day].closed}
                        onChange={() =>
                          setHours((prev) => ({
                            ...prev,
                            [day]: { ...prev[day], closed: !prev[day].closed },
                          }))
                        }
                        className="rounded border-slate-600 bg-slate-800 text-orange-500 focus:ring-orange-500/30"
                      />
                      <span className="text-xs text-slate-500">Closed</span>
                    </label>
                    {!hours[day].closed && (
                      <div className="flex items-center gap-2">
                        <input
                          type="time"
                          value={hours[day].open}
                          onChange={(e) =>
                            setHours((prev) => ({
                              ...prev,
                              [day]: { ...prev[day], open: e.target.value },
                            }))
                          }
                          className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-white focus:outline-none focus:border-orange-500/50"
                        />
                        <span className="text-xs text-slate-500">to</span>
                        <input
                          type="time"
                          value={hours[day].close}
                          onChange={(e) =>
                            setHours((prev) => ({
                              ...prev,
                              [day]: { ...prev[day], close: e.target.value },
                            }))
                          }
                          className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-white focus:outline-none focus:border-orange-500/50"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Save button */}
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleSave}
                className="rounded-lg bg-orange-500 px-6 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 transition shadow-lg shadow-orange-500/20"
              >
                Save Changes
              </button>
              {saved && (
                <span className="text-sm text-emerald-400 animate-pulse">✓ Saved!</span>
              )}
            </div>
          </div>
        );

      case "ai":
        return (
          <div className="space-y-6">
            {/* AI Response Tone */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-3">AI Response Tone</label>
              <div className="space-y-2">
                {[
                  { value: "friendly", label: "Friendly & Casual", desc: "Warm, conversational replies that build rapport" },
                  { value: "professional", label: "Professional & Concise", desc: "Polished, to-the-point responses for efficiency" },
                  { value: "technical", label: "Technical & Detailed", desc: "In-depth explanations with mechanical terminology" },
                ].map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition ${
                      aiTone === opt.value
                        ? "border-orange-500/50 bg-orange-500/5"
                        : "border-slate-700/50 bg-slate-800/30 hover:border-slate-600/50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="aiTone"
                      value={opt.value}
                      checked={aiTone === opt.value}
                      onChange={(e) => setAiTone(e.target.value)}
                      className="mt-0.5 text-orange-500 focus:ring-orange-500/30"
                    />
                    <div>
                      <p className="text-sm font-medium text-white">{opt.label}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{opt.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Toggles */}
            <div className="space-y-4 pt-2">
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium text-slate-200">Auto-send repair updates</p>
                  <p className="text-xs text-slate-400">Customers get automated status updates during repairs</p>
                </div>
                <ToggleSwitch enabled={autoUpdate} onChange={setAutoUpdate} />
              </div>
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium text-slate-200">Auto-request reviews</p>
                  <p className="text-xs text-slate-400">Send review requests after repair completion</p>
                </div>
                <ToggleSwitch enabled={autoReview} onChange={setAutoReview} />
              </div>
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium text-slate-200">Business hours only</p>
                  <p className="text-xs text-slate-400">AI only responds during shop operating hours</p>
                </div>
                <ToggleSwitch enabled={businessHoursOnly} onChange={setBusinessHoursOnly} />
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleSave}
                className="rounded-lg bg-orange-500 px-6 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 transition shadow-lg shadow-orange-500/20"
              >
                Save Preferences
              </button>
              {saved && (
                <span className="text-sm text-emerald-400 animate-pulse">✓ Saved!</span>
              )}
            </div>
          </div>
        );

      case "notifications":
        return (
          <div className="space-y-6">
            {/* Email */}
            <div>
              <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                <span>📧</span> Email Notifications
              </h3>
              <div className="space-y-3">
                {[
                  { key: "newConv", label: "New conversations", desc: "When a customer starts a chat", value: notifyNewConv, setter: setNotifyNewConv },
                  { key: "negReview", label: "Negative reviews", desc: "When a review is 3 stars or below", value: notifyNegReview, setter: setNotifyNegReview },
                  { key: "appointment", label: "Appointment bookings", desc: "When a customer schedules online", value: notifyAppointment, setter: setNotifyAppointment },
                ].map((item) => (
                  <div key={item.key} className="flex items-center justify-between py-2">
                    <div>
                      <p className="text-sm font-medium text-slate-200">{item.label}</p>
                      <p className="text-xs text-slate-400">{item.desc}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={item.value}
                      onChange={(e) => item.setter(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-orange-500 focus:ring-orange-500/30"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* SMS */}
            <div>
              <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                <span>📱</span> SMS Notifications
              </h3>
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium text-slate-200">Urgent customer messages</p>
                  <p className="text-xs text-slate-400">Text alerts for flagged messages needing immediate attention</p>
                </div>
                <ToggleSwitch enabled={smsUrgent} onChange={setSmsUrgent} />
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleSave}
                className="rounded-lg bg-orange-500 px-6 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 transition shadow-lg shadow-orange-500/20"
              >
                Save Preferences
              </button>
              {saved && (
                <span className="text-sm text-emerald-400 animate-pulse">✓ Saved!</span>
              )}
            </div>
          </div>
        );

      case "billing":
        return (
          <div className="space-y-6">
            {/* Current Plan */}
            <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-slate-400">Current Plan</p>
                  <p className="text-xl font-extrabold text-white mt-1">Professional</p>
                  <p className="text-sm text-slate-400">$199/month</p>
                </div>
                <div className="flex gap-2">
                  <button className="rounded-lg border border-orange-500/30 px-4 py-2 text-sm font-medium text-orange-400 hover:bg-orange-500/10 transition">
                    Upgrade to Enterprise
                  </button>
                  <button className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:text-white hover:border-slate-600 transition">
                    Manage Billing
                  </button>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-orange-500/10 grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-slate-400">Next billing date</p>
                  <p className="text-sm font-medium text-white">August 30, 2026</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Payment method</p>
                  <p className="text-sm font-medium text-white">Visa ending in 4242</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Billing cycle</p>
                  <p className="text-sm font-medium text-white">Monthly</p>
                </div>
              </div>
            </div>

            {/* Billing History */}
            <div>
              <h3 className="text-sm font-semibold text-slate-300 mb-3">Billing History</h3>
              <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700/50">
                      <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Date</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Description</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Amount</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Status</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-slate-400">Invoice</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-700/30">
                      <td className="px-4 py-3 text-slate-300">Jul 30, 2026</td>
                      <td className="px-4 py-3 text-white">Professional Plan — Monthly</td>
                      <td className="px-4 py-3 text-white">$199.00</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">Paid</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button className="text-xs text-orange-400 hover:text-orange-300 transition">Download</button>
                      </td>
                    </tr>
                    <tr className="border-b border-slate-700/30">
                      <td className="px-4 py-3 text-slate-300">Jun 30, 2026</td>
                      <td className="px-4 py-3 text-white">Professional Plan — Monthly</td>
                      <td className="px-4 py-3 text-white">$199.00</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">Paid</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button className="text-xs text-orange-400 hover:text-orange-300 transition">Download</button>
                      </td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 text-slate-300">May 30, 2026</td>
                      <td className="px-4 py-3 text-white">Professional Plan — Monthly</td>
                      <td className="px-4 py-3 text-white">$199.00</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">Paid</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button className="text-xs text-orange-400 hover:text-orange-300 transition">Download</button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Danger Zone */}
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-5">
              <h3 className="text-sm font-semibold text-red-400 mb-2">Danger Zone</h3>
              <p className="text-xs text-slate-400 mb-4">
                Permanently delete your account and all associated data. This action cannot be undone.
              </p>
              {showDeleteConfirm ? (
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleDelete}
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 transition"
                  >
                    Confirm Delete
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleDelete}
                  className="rounded-lg border border-red-500/30 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/10 transition"
                >
                  Delete Account
                </button>
              )}
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold text-white">Settings</h1>
        <p className="text-sm text-slate-400 mt-1">Manage your shop profile, preferences, and billing</p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 rounded-xl bg-slate-800/50 border border-slate-700/50 p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key); setSaved(false); }}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
              activeTab === tab.key
                ? "bg-orange-500 text-white shadow-lg"
                : "text-slate-400 hover:text-white hover:bg-slate-700/50"
            }`}
          >
            <span className="text-base">{tab.emoji}</span>
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-5 sm:p-6">
        {renderTab()}
      </div>
    </div>
  );
}
