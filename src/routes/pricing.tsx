import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
});

const STRIPE_LINKS = {
  Starter: "https://buy.stripe.com/bJe14n2ip8LB85r8KigIo00",
  Professional: "https://buy.stripe.com/8x2fZh5uBbXN5Xj6CagIo01",
  Enterprise: "https://buy.stripe.com/00wcN56yF4vl0CZbWugIo02",
} as const;

const tiers = [
  {
    name: "Starter",
    price: "$99",
    accent: "border-slate-600",
    highlight: false,
    desc: "Perfect for small shops getting started with AI automation.",
    features: [
      "AI Chatbot (up to 500 conversations/mo)",
      "Estimate Explainer",
      "Basic Scheduling",
      "Email Support",
    ],
    stripeLink: STRIPE_LINKS.Starter,
  },
  {
    name: "Professional",
    price: "$199",
    accent: "border-orange-500",
    highlight: true,
    badge: "Most Popular",
    desc: "For growing shops that want full AI-powered front office automation.",
    features: [
      "Everything in Starter",
      "Unlimited AI conversations",
      "Repair Tracking & Status Updates",
      "Review Collection",
      "SMS Notifications",
      "Priority Support",
    ],
    stripeLink: STRIPE_LINKS.Professional,
  },
  {
    name: "Enterprise",
    price: "$399",
    accent: "border-slate-600",
    highlight: false,
    desc: "For multi-location shops needing advanced integrations and white-label options.",
    features: [
      "Everything in Professional",
      "AI Marketing Assistant",
      "Insurance Workflow Tools",
      "Custom Integrations",
      "Dedicated Account Manager",
      "White-Label Option",
    ],
    stripeLink: STRIPE_LINKS.Enterprise,
  },
];

const faqs = [
  {
    q: "Can I cancel anytime?",
    a: "Yes. No contracts, no cancellation fees. You can cancel your subscription at any time through your Stripe billing portal.",
  },
  {
    q: "Is there a free trial?",
    a: "We offer a 30-day money-back guarantee on all plans. If you're not satisfied within the first 30 days, we'll refund your payment — no questions asked.",
  },
  {
    q: "Can I switch plans?",
    a: "Yes, you can upgrade or downgrade your plan at any time. Changes take effect immediately, and we'll prorate any difference.",
  },
  {
    q: "What payment methods do you accept?",
    a: "We accept all major credit cards (Visa, Mastercard, American Express, Discover) via Stripe. All payments are processed securely.",
  },
];

function PricingPage() {
  return (
    <div className="min-h-dvh bg-slate-900">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <a href="/" className="text-lg font-extrabold text-white">
            <span className="bg-gradient-to-r from-orange-400 to-orange-600 bg-clip-text text-transparent">
              CollisionAI
            </span>
          </a>
          <div className="flex items-center gap-4">
            <a
              href="/login"
              className="text-sm font-medium text-slate-300 hover:text-white transition"
            >
              Log In
            </a>
            <a
              href="/signup"
              className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-600"
            >
              Sign Up
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="px-6 py-20 sm:py-28">
        <div className="mx-auto max-w-4xl text-center">
          <span className="text-sm font-semibold uppercase tracking-widest text-orange-400">
            Pricing
          </span>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-white sm:text-5xl lg:text-6xl">
            Simple, Transparent Pricing
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-400">
            Start small, scale as you grow. No hidden fees, no long-term
            contracts. Every plan includes a 30-day money-back guarantee.
          </p>
          <p className="mt-4 text-sm text-slate-500">
            All plans billed monthly via Stripe. Cancel anytime.
          </p>
        </div>
      </section>

      {/* Tier cards */}
      <section className="px-6 pb-20">
        <div className="mx-auto max-w-6xl grid gap-8 lg:grid-cols-3">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={`relative rounded-2xl border-2 bg-slate-800/50 p-8 backdrop-blur-sm ${
                tier.highlight
                  ? "border-orange-500 shadow-lg shadow-orange-500/10"
                  : tier.accent
              }`}
            >
              {tier.badge && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-orange-500 px-4 py-1 text-sm font-semibold text-white">
                  {tier.badge}
                </span>
              )}
              <h3 className="text-xl font-bold text-white">{tier.name}</h3>
              <p className="mt-2 text-sm text-slate-400 min-h-[40px]">{tier.desc}</p>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-5xl font-extrabold tracking-tight text-white">
                  {tier.price}
                </span>
                <span className="text-slate-400">/month</span>
              </div>
              <ul className="mt-8 space-y-3">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-3 text-slate-300">
                    <span className="mt-0.5 shrink-0 text-emerald-400">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <a
                href={tier.stripeLink}
                target="_blank"
                rel="noopener noreferrer"
                className={`mt-8 block rounded-xl px-6 py-3 text-center text-sm font-semibold transition ${
                  tier.highlight
                    ? "bg-orange-500 text-white hover:bg-orange-600 shadow-lg shadow-orange-500/25"
                    : "border border-slate-600 bg-transparent text-slate-300 hover:border-slate-400 hover:text-white"
                }`}
              >
                {tier.highlight ? "Subscribe Now" : "Get Started"}
              </a>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="px-6 pb-20 sm:pb-28">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-2xl font-bold text-white text-center sm:text-3xl">
            Frequently Asked Questions
          </h2>
          <div className="mt-10 space-y-4">
            {faqs.map((faq) => (
              <details
                key={faq.q}
                className="group rounded-xl border border-slate-700/50 bg-slate-800/50"
              >
                <summary className="flex cursor-pointer items-center justify-between px-6 py-4 text-left text-white font-medium list-none">
                  {faq.q}
                  <span className="ml-4 shrink-0 text-slate-400 transition group-open:rotate-180">
                    ▼
                  </span>
                </summary>
                <p className="px-6 pb-4 text-slate-400 leading-relaxed">
                  {faq.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 pb-20 sm:pb-28">
        <div className="mx-auto max-w-2xl text-center rounded-2xl border border-orange-500/20 bg-slate-800/50 p-10 sm:p-12">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">
            Ready to get started?
          </h2>
          <p className="mt-3 text-slate-400">
            Join hundreds of auto shops using AI to run their front office.
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
            <a
              href={STRIPE_LINKS.Professional}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl bg-orange-500 px-8 py-3 text-sm font-semibold text-white shadow-lg shadow-orange-500/25 transition hover:bg-orange-600"
            >
              Start Free Trial
            </a>
            <a
              href="mailto:hello@collisionai.com"
              className="rounded-xl border border-slate-600 px-8 py-3 text-sm font-medium text-slate-300 transition hover:border-slate-400 hover:text-white"
            >
              Talk to Sales
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800 px-6 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left">
          <div>
            <p className="font-semibold text-white">CollisionAI</p>
            <p className="text-sm text-slate-500">© 2026 CollisionAI</p>
          </div>
          <p className="text-sm text-slate-500">
            Questions?{" "}
            <a
              href="mailto:hello@collisionai.com"
              className="font-medium text-orange-400 hover:text-orange-300"
            >
              hello@collisionai.com
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
