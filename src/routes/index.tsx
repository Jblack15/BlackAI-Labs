import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { sql } from "~/db";

const subscribeEmail = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (typeof data !== "object" || data === null || !("email" in data)) {
      throw new Error("Email is required");
    }
    const { email } = data as { email: string };
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Valid email is required");
    }
    return { email: email.trim().toLowerCase() };
  })
  .handler(async ({ data }) => {
    // Check for duplicate
    const existing = await sql`SELECT id FROM waitlist WHERE email = ${data.email}`;
    if (existing.length > 0) {
      return { success: true, message: "You're already on the list!" };
    }
    await sql`INSERT INTO waitlist (email) VALUES (${data.email})`;
    return { success: true };
  });

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <div className="min-h-dvh bg-white text-gray-900">
      <Hero />
      <ProblemSolution />
      <Features />
      <Pricing />
      <Waitlist />
      <Footer />
    </div>
  );
}

/* ── Hero ─────────────────────────────────────────────────────── */
function Hero() {
  return (
    <section className="relative overflow-hidden bg-slate-900 px-6 pb-24 pt-28 sm:pb-32 sm:pt-36">
      {/* Subtle gradient glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(249,115,22,0.15),transparent_60%)]" />
      <div className="relative mx-auto max-w-4xl text-center">
        <span className="mb-4 inline-block rounded-full border border-orange-500/30 bg-orange-500/10 px-4 py-1.5 text-sm font-medium text-orange-400">
          AI-Powered Auto Shop Platform
        </span>
        <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-6xl lg:text-7xl">
          AI That Runs Your Auto Shop's{" "}
          <span className="bg-gradient-to-r from-orange-400 to-orange-600 bg-clip-text text-transparent">
            Front Office
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-300 sm:text-xl">
          24/7 customer communication, estimate explanations, and shop management —
          powered by AI. So you can focus on fixing cars.
        </p>
        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <a
            href="/signup"
            className="inline-flex rounded-xl bg-orange-500 px-8 py-4 text-lg font-semibold text-white shadow-lg shadow-orange-500/25 transition hover:bg-orange-600 hover:shadow-orange-500/40"
          >
            Sign Up Free
          </a>
          <a
            href="/login"
            className="inline-flex rounded-xl border border-slate-600 px-8 py-4 text-lg font-medium text-slate-300 transition hover:border-slate-400 hover:text-white"
          >
            Log In
          </a>
          <a
            href="#features"
            className="inline-flex rounded-xl border border-slate-600 px-8 py-4 text-lg font-medium text-slate-300 transition hover:border-slate-400 hover:text-white"
          >
            See What It Does
          </a>
        </div>
      </div>
    </section>
  );
}

/* ── Problem / Solution ────────────────────────────────────────── */
function ProblemSolution() {
  return (
    <section className="bg-white px-6 py-20 sm:py-28">
      <div className="mx-auto max-w-5xl">
        <div className="grid gap-12 md:grid-cols-2">
          {/* Problem */}
          <div className="rounded-2xl border border-red-200 bg-red-50 p-8 sm:p-10">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-red-100 text-2xl">
              ⚠️
            </div>
            <h3 className="text-xl font-bold text-red-800 sm:text-2xl">
              The Problem
            </h3>
            <p className="mt-4 leading-relaxed text-red-700">
              Shop owners spend hours on phone calls, explaining estimates,
              chasing customers, and managing admin — instead of fixing cars.
              Every call is a bay that sits empty. Every confused customer is a
              job that might walk.
            </p>
          </div>

          {/* Solution */}
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 sm:p-10">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 text-2xl">
              ✅
            </div>
            <h3 className="text-xl font-bold text-emerald-800 sm:text-2xl">
              The Solution
            </h3>
            <p className="mt-4 leading-relaxed text-emerald-700">
              CollisionAI handles all of it with AI automation. Your customers
              get instant answers, clear estimates, and real-time updates —
              while you get back to what you do best: fixing cars and growing
              your shop.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Features ──────────────────────────────────────────────────── */
const features = [
  {
    icon: "💬",
    title: "24/7 AI Chatbot",
    desc: "Answers customer questions anytime, sends repair updates by text and email — even when your shop is closed.",
  },
  {
    icon: "📋",
    title: "Estimate Explainer",
    desc: "Translates complex repair estimates into plain English customers actually understand, building trust instantly.",
  },
  {
    icon: "📅",
    title: "Smart Scheduling",
    desc: "Online booking with automated reminders. Fewer no-shows, fuller bays, happier customers.",
  },
  {
    icon: "🔔",
    title: "Repair Tracking",
    desc: "Real-time status updates keep customers informed at every step — no more \"when will my car be ready?\" calls.",
  },
  {
    icon: "⭐",
    title: "Review Collector",
    desc: "Automatically requests reviews after completed repairs. Build your reputation while you sleep.",
  },
  {
    icon: "📣",
    title: "AI Marketing",
    desc: "Generates social posts, emails, and promotions tailored to your shop — bringing in more business on autopilot.",
  },
];

function Features() {
  return (
    <section id="features" className="bg-slate-50 px-6 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl">
        <div className="text-center">
          <span className="text-sm font-semibold uppercase tracking-widest text-orange-500">
            Features
          </span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Everything your front office needs
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-500">
            One platform that replaces the administrative chaos of running a
            repair shop.
          </p>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="group rounded-2xl border border-gray-200 bg-white p-7 shadow-sm transition hover:shadow-md hover:shadow-orange-500/5"
            >
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-orange-50 text-2xl transition group-hover:scale-110">
                {f.icon}
              </div>
              <h3 className="text-lg font-bold">{f.title}</h3>
              <p className="mt-2 leading-relaxed text-gray-500">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Pricing ───────────────────────────────────────────────────── */
const STRIPE_LINKS = {
  Starter: "https://buy.stripe.com/bJe14n2ip8LB85r8KigIo00",
  Professional: "https://buy.stripe.com/8x2fZh5uBbXN5Xj6CagIo01",
  Enterprise: "https://buy.stripe.com/00wcN56yF4vl0CZbWugIo02",
} as const;

const tiers = [
  {
    name: "Starter",
    price: "$99",
    accent: "border-gray-300",
    highlight: false,
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
    accent: "border-gray-300",
    highlight: false,
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

function Pricing() {
  return (
    <section className="bg-white px-6 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl">
        <div className="text-center">
          <span className="text-sm font-semibold uppercase tracking-widest text-orange-500">
            Pricing
          </span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Simple, transparent pricing
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-500">
            Start small, scale as you grow. No hidden fees, no long-term
            contracts.
          </p>
        </div>

        <div className="mt-16 grid gap-8 lg:grid-cols-3">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={`relative rounded-2xl border-2 bg-white p-8 shadow-sm ${
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
              <h3 className="text-xl font-bold">{tier.name}</h3>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-5xl font-extrabold tracking-tight">
                  {tier.price}
                </span>
                <span className="text-gray-400">/month</span>
              </div>
              <ul className="mt-8 space-y-3">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-3 text-gray-600">
                    <span className="mt-0.5 shrink-0 text-emerald-500">✓</span>
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
                    ? "bg-orange-500 text-white hover:bg-orange-600"
                    : "border border-gray-300 bg-white text-gray-700 hover:border-gray-400 hover:bg-gray-50"
                }`}
              >
                {tier.highlight ? "Subscribe Now" : "Get Started"}
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Waitlist ──────────────────────────────────────────────────── */
function Waitlist() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const [successMsg, setSuccessMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setStatus("loading");
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const result = await subscribeEmail({ data: { email: email.trim() } });
      if (result.success) {
        setStatus("success");
        setEmail("");
        setSuccessMsg((result as any).message || "We'll be in touch soon. Keep an eye on your inbox.");
      } else {
        setStatus("error");
        setErrorMsg("Something went wrong. Please try again.");
      }
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(err?.message || "Something went wrong. Please try again.");
    }
  };

  return (
    <section id="waitlist" className="bg-slate-900 px-6 py-20 sm:py-28">
      <div className="mx-auto max-w-2xl text-center">
        <span className="text-sm font-semibold uppercase tracking-widest text-orange-400">
          Early Access
        </span>
        <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Be First In Line
        </h2>
        <p className="mt-4 text-lg text-slate-300">
          We're onboarding shops in batches. Drop your email and we'll let you
          know the moment your spot opens up.
        </p>

        {status === "success" ? (
          <div className="mt-8 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-8 py-6">
            <div className="text-4xl">🎉</div>
            <p className="mt-3 text-xl font-semibold text-emerald-400">
              You're on the list!
            </p>
            <p className="mt-2 text-slate-400">
              {successMsg}
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-8">
            <div className="mx-auto flex max-w-md flex-col gap-3 sm:flex-row">
              <input
                type="email"
                required
                placeholder="you@yourshop.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={status === "loading"}
                className="flex-1 rounded-xl border border-slate-600 bg-slate-800 px-5 py-4 text-white placeholder-slate-400 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={status === "loading"}
                className="rounded-xl bg-orange-500 px-6 py-4 font-semibold text-white shadow-lg shadow-orange-500/25 transition hover:bg-orange-600 disabled:opacity-60"
              >
                {status === "loading" ? "Submitting..." : "Get Early Access"}
              </button>
            </div>
            {status === "error" && (
              <p className="mt-3 text-sm text-red-400">{errorMsg}</p>
            )}
            <p className="mt-4 text-sm text-slate-500">
              No spam, ever. We'll only email you when your spot is ready.
            </p>
          </form>
        )}
      </div>
    </section>
  );
}

/* ── Footer ────────────────────────────────────────────────────── */
function Footer() {
  return (
    <footer className="border-t border-gray-200 bg-white px-6 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left">
        <div>
          <p className="font-semibold text-gray-900">CollisionAI</p>
          <p className="text-sm text-gray-400">© 2026 CollisionAI</p>
        </div>
        <p className="text-sm text-gray-400">
          Questions?{" "}
          <a
            href="mailto:hello@collisionai.com"
            className="font-medium text-orange-500 hover:text-orange-600"
          >
            hello@collisionai.com
          </a>
        </p>
      </div>
    </footer>
  );
}
