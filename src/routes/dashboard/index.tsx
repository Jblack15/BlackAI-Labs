import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/")({
  component: DashboardOverview,
});

function DashboardOverview() {
  const shopName = "Your Shop";

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div className="rounded-2xl border border-slate-700/50 bg-slate-800/50 p-6 sm:p-8">
        <h1 className="text-2xl font-extrabold text-white sm:text-3xl">
          Welcome to CollisionAI,{" "}
          <span className="bg-gradient-to-r from-orange-400 to-orange-600 bg-clip-text text-transparent">
            {shopName}
          </span>
          !
        </h1>
        <p className="mt-2 text-slate-400 max-w-2xl">
          Your AI-powered front office is ready. Manage customer communication,
          estimates, appointments, and more — all from one place.
        </p>
      </div>

      {/* Quick stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-5">
          <p className="text-sm text-slate-400 font-medium">Active Repairs</p>
          <p className="mt-2 text-3xl font-extrabold text-white">--</p>
        </div>
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-5">
          <p className="text-sm text-slate-400 font-medium">Messages Sent</p>
          <p className="mt-2 text-3xl font-extrabold text-white">--</p>
        </div>
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-5">
          <p className="text-sm text-slate-400 font-medium">Est. Saved This Month</p>
          <p className="mt-2 text-3xl font-extrabold text-white">$0</p>
        </div>
      </div>

      {/* Coming soon cards */}
      <div>
        <h2 className="text-lg font-bold text-white mb-4">Coming Soon</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { emoji: "💬", title: "AI Chatbot", desc: "24/7 automated customer conversations via SMS and email" },
            { emoji: "📋", title: "Estimate Explainer", desc: "Plain-English translations of complex repair estimates" },
            { emoji: "📅", title: "Smart Scheduling", desc: "Online booking with automated reminders" },
            { emoji: "🔧", title: "Repair Tracking", desc: "Real-time status updates for every customer" },
            { emoji: "⭐", title: "Review Collector", desc: "Automated review requests after repairs" },
            { emoji: "📈", title: "AI Marketing", desc: "Auto-generated social posts and promotions" },
          ].map((feature) => (
            <div
              key={feature.title}
              className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-700/50 text-xl">
                {feature.emoji}
              </div>
              <h3 className="mt-3 font-semibold text-white">{feature.title}</h3>
              <p className="mt-1 text-sm text-slate-400">{feature.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
