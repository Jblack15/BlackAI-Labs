import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/reviews")({
  component: ReviewsPage,
});

const reviewStats = [
  { label: "Average Rating", value: "4.8", emoji: "⭐", color: "text-amber-400" },
  { label: "Total Reviews", value: "247", emoji: "", color: "text-white" },
  { label: "This Month", value: "12", emoji: "", color: "text-emerald-400" },
  { label: "Response Rate", value: "94%", emoji: "", color: "text-blue-400" },
];

const reviews = [
  {
    rating: 5,
    text: "Great communication! I knew exactly when my car would be ready. Sarah at the front desk was amazing.",
    author: "Jennifer M.",
    time: "2 days ago",
  },
  {
    rating: 5,
    text: "First time here and they explained everything clearly. No surprises on the bill.",
    author: "Robert K.",
    time: "3 days ago",
  },
  {
    rating: 4,
    text: "Good work but took a day longer than expected. Would have appreciated a heads up.",
    author: "Lisa T.",
    time: "5 days ago",
  },
  {
    rating: 5,
    text: "They sent me text updates throughout the repair. Never had to wonder what was happening.",
    author: "Mark S.",
    time: "1 week ago",
  },
  {
    rating: 3,
    text: "Repair was fine but communication could be better. Played phone tag for 2 days.",
    author: "David L.",
    time: "1 week ago",
  },
];

const ratingColors: Record<number, string> = {
  5: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  4: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  3: "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

function Stars({ rating }: { rating: number }) {
  return (
    <span className="text-amber-400">
      {"★".repeat(rating)}{"☆".repeat(5 - rating)}
    </span>
  );
}

function ReviewsPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-extrabold text-white">Reviews</h1>
        <button className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 transition shadow-lg shadow-orange-500/20">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
          </svg>
          Request Reviews
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {reviewStats.map((s) => (
          <div key={s.label} className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
            <p className="text-xs font-medium text-slate-400">{s.label}</p>
            <p className={`mt-1 text-2xl font-extrabold ${s.color}`}>
              {s.emoji ? `${s.emoji} ` : ""}{s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Pending review requests */}
      <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <p className="font-semibold text-white">3 customers ready for review requests</p>
          <p className="text-sm text-slate-400">Vehicles completed in the last 48 hours without a review sent</p>
        </div>
        <button className="shrink-0 inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 transition">
          Send 3 Requests
        </button>
      </div>

      {/* AI Insight */}
      <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 flex items-start gap-3">
        <div className="shrink-0 mt-0.5 text-lg">💡</div>
        <div>
          <p className="font-semibold text-blue-300 text-sm">AI Insight</p>
          <p className="text-sm text-slate-300 mt-0.5">
            Customers who receive repair updates are 3× more likely to leave a 5-star review.
            You've sent <span className="text-white font-semibold">47 updates</span> this month.
          </p>
        </div>
      </div>

      {/* Recent reviews */}
      <div>
        <h2 className="text-lg font-bold text-white mb-4">Recent Reviews</h2>
        <div className="space-y-3">
          {reviews.map((review, i) => (
            <div
              key={i}
              className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4 sm:p-5 hover:border-slate-600/50 transition"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Stars rating={review.rating} />
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${ratingColors[review.rating]}`}>
                      {review.rating}/5
                    </span>
                  </div>
                  <p className="text-sm text-slate-200 leading-relaxed">{review.text}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <div className="h-6 w-6 rounded-full bg-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-300">
                      {review.author.split(" ")[0][0]}{review.author.split(" ")[1]?.[0] || ""}
                    </div>
                    <span className="text-xs text-slate-400">{review.author}</span>
                    <span className="text-xs text-slate-600">·</span>
                    <span className="text-xs text-slate-500">{review.time}</span>
                  </div>
                </div>
                <button className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 border border-slate-700 hover:text-white hover:border-slate-600 transition">
                  Reply
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
