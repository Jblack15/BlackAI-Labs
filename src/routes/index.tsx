import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      {
        title: "DealFlow AI — Sell Your House Fast For Cash | No Repairs, No Fees",
      },
      {
        name: "description",
        content:
          "Get a fair cash offer for your home in 24 hours. Close in 7 days. No repairs, no agents, no commissions. DealFlow AI makes selling simple.",
      },
    ],
  }),
  component: Home,
});

function Home() {
  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden px-4 pb-24 pt-20 sm:px-6 lg:px-8">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-navy-800/50 to-transparent" />
        <div className="absolute -top-40 right-0 h-[500px] w-[500px] rounded-full bg-gold-500/5 blur-3xl" />
        <div className="absolute -bottom-20 left-0 h-[400px] w-[400px] rounded-full bg-gold-500/5 blur-3xl" />

        <div className="relative mx-auto max-w-4xl text-center">
          <span className="inline-block rounded-full border border-gold-500/30 bg-gold-500/10 px-4 py-1 text-sm font-medium text-gold-500">
            Technology-Driven Real Estate Solutions
          </span>
          <h1 className="mt-6 text-4xl font-bold tracking-tight text-white sm:text-6xl lg:text-7xl">
            Sell Your House Fast
            <br />
            <span className="text-gold-500">For Cash.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-300 sm:text-xl">
            No repairs. No agents. No commissions. Get a fair, no-obligation cash offer in 24 hours and close on your timeline.
          </p>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              to="/get-offer"
              className="rounded-lg bg-gold-500 px-8 py-4 text-lg font-semibold text-navy-900 transition-all hover:bg-gold-400 hover:shadow-lg hover:shadow-gold-500/25"
            >
              Get Your Cash Offer Now →
            </Link>
            <a
              href="#how-it-works"
              className="rounded-lg border border-gray-500 px-8 py-4 text-lg font-medium text-gray-300 transition-colors hover:border-gray-300 hover:text-white"
            >
              How It Works
            </a>
          </div>
          <div className="mt-12">
            <img
              src="/hero-banner.png"
              alt="DealFlow AI — Sell Your House Fast For Cash"
              className="mx-auto w-full max-w-3xl rounded-xl shadow-2xl shadow-navy-950/50"
            />
          </div>
        </div>
      </section>

      {/* Value Propositions */}
      <section className="border-t border-navy-700 px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-bold text-white sm:text-4xl">
            Why Sell to DealFlow AI?
          </h2>
          <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                icon: (
                  <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ),
                title: "Close in 7 Days",
                desc: "We can close in as little as 7 days. You pick the date that works best for your schedule.",
              },
              {
                icon: (
                  <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                ),
                title: "Sell As-Is",
                desc: "Don't lift a finger. We buy homes in any condition — no repairs, no cleaning, no staging required.",
              },
              {
                icon: (
                  <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                ),
                title: "No Commissions",
                desc: "No real estate agent means no 6% commission. The offer we make is the amount you get at closing.",
              },
              {
                icon: (
                  <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                ),
                title: "Fair Cash Offer",
                desc: "We use data-driven analysis to make you the strongest possible cash offer. No lowballing, no games.",
              },
            ].map((item, i) => (
              <div
                key={i}
                className="rounded-xl border border-navy-700 bg-navy-800/50 p-6 text-center transition-colors hover:border-gold-500/30"
              >
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gold-500/10 text-gold-500">
                  {item.icon}
                </div>
                <h3 className="mt-4 text-lg font-semibold text-white">{item.title}</h3>
                <p className="mt-2 text-sm text-gray-400">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="border-t border-navy-700 px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-center text-3xl font-bold text-white sm:text-4xl">
            How It Works
          </h2>
          <p className="mt-4 text-center text-gray-400">
            Three simple steps from your first click to cash in your hand.
          </p>
          <div className="mt-12 grid gap-8 sm:grid-cols-3">
            {[
              {
                step: "01",
                title: "Tell Us About Your Home",
                desc: "Fill out our quick form with details about your property and situation. It takes less than 5 minutes.",
              },
              {
                step: "02",
                title: "Receive Your Cash Offer",
                desc: "We analyze your property using our AI-powered valuation engine and present a fair cash offer within 24 hours.",
              },
              {
                step: "03",
                title: "Close & Get Paid",
                desc: "Accept the offer and close on your timeline — as fast as 7 days. Walk away with cash in hand.",
              },
            ].map((item, i) => (
              <div key={i} className="relative text-center">
                {i < 2 && (
                  <div className="absolute left-1/2 top-8 hidden h-px w-full bg-gradient-to-r from-transparent via-gold-500/30 to-transparent sm:block" />
                )}
                <div className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-navy-800 text-xl font-bold text-gold-500 ring-2 ring-gold-500/30">
                  {item.step}
                </div>
                <h3 className="mt-6 text-lg font-semibold text-white">{item.title}</h3>
                <p className="mt-2 text-sm text-gray-400">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials Placeholder */}
      <section className="border-t border-navy-700 px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            What Homeowners Say
          </h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-2">
            {[
              {
                quote:
                  "I needed to sell my mother's house after she passed. DealFlow AI made it painless. Fair offer, fast close. No stress.",
                author: "— Michael R., Probate Sale",
              },
              {
                quote:
                  "Had code violations and couldn't list with an agent. DealFlow AI bought it as-is, closed in 10 days. Couldn't be happier.",
                author: "— Lisa T., Code Violation Property",
              },
            ].map((t, i) => (
              <div key={i} className="rounded-xl border border-navy-700 bg-navy-800/50 p-6 text-left">
                <p className="text-gray-300 italic">"{t.quote}"</p>
                <p className="mt-4 text-sm font-medium text-gold-500">{t.author}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Seller Situations */}
      <section className="border-t border-navy-700 px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-bold text-white sm:text-4xl">
            We Help in Any Situation
          </h2>
          <p className="mt-4 text-center text-gray-400">
            No matter why you need to sell, we have a solution.
          </p>
          <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { to: "/sell/tax-delinquent", label: "Tax Delinquent" },
              { to: "/sell/probate", label: "Probate / Inherited" },
              { to: "/sell/vacant", label: "Vacant Home" },
              { to: "/sell/absentee", label: "Absentee Owner" },
              { to: "/sell/pre-foreclosure", label: "Pre-Foreclosure" },
              { to: "/sell/code-violations", label: "Code Violations" },
              { to: "/sell/tired-landlord", label: "Tired Landlord" },
              { to: "/sell/high-equity", label: "High Equity" },
              { to: "/sell/divorce", label: "Divorce Sale" },
              { to: "/sell/eviction", label: "Eviction" },
              { to: "/sell/expired-listing", label: "Expired Listing" },
            ].map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="flex items-center justify-between rounded-lg border border-navy-700 bg-navy-800/50 px-5 py-4 transition-colors hover:border-gold-500/30 hover:bg-navy-800"
              >
                <span className="text-sm font-medium text-gray-200">{link.label}</span>
                <svg className="h-4 w-4 text-gold-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-navy-700 px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl rounded-2xl bg-gradient-to-br from-navy-800 to-navy-700 p-10 text-center sm:p-16">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            Ready to Get Your Cash Offer?
          </h2>
          <p className="mt-4 text-lg text-gray-300">
            No pressure. No obligation. Just a fair offer for your home — in 24 hours or less.
          </p>
          <Link
            to="/get-offer"
            className="mt-8 inline-block rounded-lg bg-gold-500 px-8 py-4 text-lg font-semibold text-navy-900 transition-all hover:bg-gold-400 hover:shadow-lg hover:shadow-gold-500/25"
          >
            Get Your Cash Offer Now →
          </Link>
        </div>
      </section>
    </div>
  );
}
