import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/dashboard/marketing")({
  component: MarketingPage,
});

const stats = [
  { label: "Email Subscribers", value: "342", color: "text-white" },
  { label: "Campaigns Sent", value: "4", sub: "this month", color: "text-blue-400" },
  { label: "Avg Open Rate", value: "38%", color: "text-emerald-400" },
  { label: "New Customers", value: "8", sub: "from campaigns", color: "text-amber-400" },
];

const campaigns = [
  {
    title: "Oil Change Special",
    desc: "$10 off for returning customers",
    audience: 342,
    audienceLabel: "all subscribers",
  },
  {
    title: "Winter Tire Reminder",
    desc: "Book before November 1st",
    audience: 198,
    audienceLabel: "seasonal customers",
  },
  {
    title: "Referral Rewards",
    desc: "$50 credit for every friend you refer",
    audience: 342,
    audienceLabel: "all subscribers",
  },
  {
    title: "We Miss You",
    desc: "6 months since your last visit",
    audience: 57,
    audienceLabel: "lapsed customers",
  },
];

const recentCampaigns = [
  { name: "Summer AC Special", sent: "Jul 22", sentTo: 342, opens: "42%", clicks: "11%" },
  { name: "Brake Check Reminder", sent: "Jul 15", sentTo: 215, opens: "35%", clicks: "8%" },
  { name: "Customer Appreciation", sent: "Jul 1", sentTo: 342, opens: "51%", clicks: "14%" },
  { name: "Oil Change Promo", sent: "Jun 20", sentTo: 280, opens: "38%", clicks: "9%" },
];

function MarketingPage() {
  const [aiPrompt, setAiPrompt] = useState("");
  const [generatedContent, setGeneratedContent] = useState("");

  const handleGenerate = () => {
    if (!aiPrompt.trim()) return;
    setGeneratedContent(
      "🏎️ Keep your ride running smooth! 🛠️\n\n" +
      "Summer is here — don't let car trouble ruin your road trip. " +
      "Book a maintenance check at Joe's Auto Repair and get 10% off " +
      "your first visit. We'll make sure you hit the road with confidence.\n\n" +
      "📍 Downtown | 📞 Call or book online\n" +
      "#AutoRepair #CarCare #SummerReady"
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold text-white">Marketing</h1>
        <p className="text-sm text-slate-400 mt-1">AI-powered campaigns to grow your shop</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
            <p className="text-xs font-medium text-slate-400">{s.label}</p>
            <p className={`mt-1 text-2xl font-extrabold ${s.color}`}>{s.value}</p>
            {s.sub && <p className="text-xs text-slate-500">{s.sub}</p>}
          </div>
        ))}
      </div>

      {/* Quick Campaigns */}
      <div>
        <h2 className="text-lg font-bold text-white mb-4">Quick Campaigns</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {campaigns.map((c) => (
            <div
              key={c.title}
              className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-5 hover:border-slate-600/50 transition"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <h3 className="font-semibold text-white">{c.title}</h3>
                  <p className="text-sm text-slate-400 mt-0.5">{c.desc}</p>
                  <div className="flex items-center gap-2 mt-3">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                    </svg>
                    <span className="text-xs text-slate-400">
                      Send to <span className="text-white font-medium">{c.audience}</span> {c.audienceLabel}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-4">
                <button className="flex-1 rounded-lg bg-orange-500 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-600 transition">
                  Send Campaign
                </button>
                <button className="shrink-0 rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-400 hover:text-white hover:border-slate-600 transition">
                  Edit
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* AI Content Generator */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg">🤖</span>
          <h2 className="text-lg font-bold text-white">AI Content Generator</h2>
        </div>
        <div className="space-y-3">
          <textarea
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder='Generate a social media post about... (e.g. "summer maintenance specials")'
            rows={3}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/20 resize-none"
          />
          <div className="flex gap-2">
            <button
              onClick={handleGenerate}
              className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 transition"
            >
              Generate Post
            </button>
            <button
              onClick={() => setGeneratedContent("📧 Subject: Your car will thank you 🌟\n\n1. \"Quick Tip: Is Your Car Summer-Ready?\"\n2. \"Don't Miss Out — $10 Off Your Next Oil Change\"\n3. \"We Miss You! Here's $25 Toward Your Next Visit\"\n4. \"Refer a Friend = $50 Credit for Both of You\"")}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:text-white hover:border-slate-600 transition"
            >
              Suggest Subjects
            </button>
          </div>
          {generatedContent && (
            <div className="rounded-lg border border-slate-700 bg-slate-900 p-4">
              <pre className="text-sm text-slate-300 whitespace-pre-wrap font-sans">{generatedContent}</pre>
            </div>
          )}
        </div>
      </div>

      {/* Recent Campaigns */}
      <div>
        <h2 className="text-lg font-bold text-white mb-4">Recent Campaigns</h2>
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700/50">
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Campaign</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Sent</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Audience</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Open Rate</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Click Rate</th>
                </tr>
              </thead>
              <tbody>
                {recentCampaigns.map((c) => (
                  <tr key={c.name} className="border-b border-slate-700/30 last:border-0 hover:bg-slate-700/20 transition">
                    <td className="px-4 py-3 text-white font-medium">{c.name}</td>
                    <td className="px-4 py-3 text-slate-400">{c.sent}</td>
                    <td className="px-4 py-3 text-slate-400">{c.sentTo}</td>
                    <td className="px-4 py-3 text-emerald-400">{c.opens}</td>
                    <td className="px-4 py-3 text-blue-400">{c.clicks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
