import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/billing/success")({
  component: BillingSuccessPage,
});

function BillingSuccessPage() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="max-w-md text-center">
        <div className="text-6xl mb-6">🎉</div>
        <h1 className="text-2xl font-extrabold text-white sm:text-3xl">
          Payment Successful!
        </h1>
        <p className="mt-4 text-slate-400 leading-relaxed">
          Your CollisionAI subscription is now active. You'll receive a
          confirmation email shortly with your receipt and next steps.
        </p>
        <div className="mt-8 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
          <p className="text-sm text-emerald-400 font-medium">
            What happens next?
          </p>
          <ul className="mt-3 space-y-2 text-sm text-slate-400 text-left">
            <li className="flex items-start gap-2">
              <span className="text-emerald-400 shrink-0">✓</span>
              Check your email for your receipt and setup instructions
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-400 shrink-0">✓</span>
              Configure your shop profile in Settings
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-400 shrink-0">✓</span>
              Start using the AI Chatbot and Estimate Explainer right away
            </li>
          </ul>
        </div>
        <a
          href="/dashboard"
          className="mt-8 inline-flex rounded-xl bg-orange-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-orange-500/25 transition hover:bg-orange-600"
        >
          Return to Dashboard
        </a>
      </div>
    </div>
  );
}
