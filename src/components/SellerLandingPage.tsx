import { Link } from "@tanstack/react-router";

export interface SellerLandingProps {
  title: string;
  headline: string;
  painPoints: string[];
  description: string;
  whyDealFlow: string;
  sellerType: string;
}

export function SellerLandingPage(props: SellerLandingProps) {
  const { title, headline, painPoints, description, whyDealFlow } = props;

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden bg-navy-800 px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <span className="inline-block rounded-full bg-gold-500/10 px-4 py-1 text-sm font-medium text-gold-500">
            {title}
          </span>
          <h1 className="mt-6 text-4xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl">
            {headline}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-300">{description}</p>
          <div className="mt-10">
            <Link
              to="/get-offer"
              className="inline-block rounded-lg bg-gold-500 px-8 py-4 text-lg font-semibold text-navy-900 transition-all hover:bg-gold-400 hover:shadow-lg hover:shadow-gold-500/25"
            >
              Get Your Cash Offer Now →
            </Link>
          </div>
        </div>
      </section>

      {/* Pain Points */}
      <section className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">We Understand Your Situation</h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {painPoints.map((point, i) => (
              <li
                key={i}
                className="flex items-start gap-3 rounded-lg border border-navy-700 bg-navy-800/50 p-4"
              >
                <svg
                  className="mt-0.5 h-5 w-5 flex-shrink-0 text-gold-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-gray-200">{point}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Why DealFlow AI */}
      <section className="border-t border-navy-700 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">How DealFlow AI Helps</h2>
          <div className="mt-6 space-y-4 text-gray-300 leading-relaxed">
            {whyDealFlow.split("\n\n").map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="border-t border-navy-700 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-center text-2xl font-bold text-white sm:text-3xl">
            How It Works
          </h2>
          <div className="mt-10 grid gap-8 sm:grid-cols-3">
            {[
              {
                step: "1",
                title: "Tell Us About Your Property",
                desc: "Fill out our simple form with details about your home and situation. Takes less than 5 minutes.",
              },
              {
                step: "2",
                title: "Get Your Cash Offer",
                desc: "We analyze your property and present a fair, no-obligation cash offer within 24 hours.",
              },
              {
                step: "3",
                title: "Close on Your Timeline",
                desc: "Accept the offer and close in as little as 7 days. You choose the date. No repairs, no stress.",
              },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gold-500 text-lg font-bold text-navy-900">
                  {item.step}
                </div>
                <h3 className="mt-4 font-semibold text-white">{item.title}</h3>
                <p className="mt-2 text-sm text-gray-400">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="border-t border-navy-700 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            Ready to Move Forward?
          </h2>
          <p className="mt-4 text-lg text-gray-300">
            No pressure. No obligation. Just a fair cash offer for your home.
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
