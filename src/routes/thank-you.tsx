import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/thank-you")({
  head: () => ({
    meta: [
      { title: "Thank You — DealForge Properties" },
      {
        name: "description",
        content: "Your information has been received. A DealForge Properties representative will contact you within 24 hours.",
      },
    ],
  }),
  component: ThankYou,
});

function ThankYou() {
  return (
    <div className="flex min-h-[70dvh] items-center justify-center px-4 py-20 sm:px-6 lg:px-8">
      <div className="max-w-lg text-center">
        {/* Success icon */}
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-gold-500/10">
          <svg
            className="h-10 w-10 text-gold-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>

        <h1 className="mt-6 text-3xl font-bold text-white sm:text-4xl">
          Thank You!
        </h1>
        <p className="mt-4 text-lg text-gray-300">
          We received your information. A DealForge Properties representative will contact you
          within <span className="font-semibold text-gold-500">24 hours</span> with a cash offer.
        </p>

        {/* What to expect */}
        <div className="mt-10 rounded-xl border border-navy-700 bg-navy-800/50 p-6 text-left">
          <h2 className="text-sm font-semibold text-gold-500 uppercase tracking-wide">
            What to Expect Next
          </h2>
          <ul className="mt-4 space-y-3">
            {[
              "A DealForge Properties specialist will review your submission.",
              "We may reach out for a quick phone call to confirm property details.",
              "You'll receive a no-obligation cash offer — usually within 24 hours.",
              "If you accept, we can close in as little as 7 days.",
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-gold-500 text-xs font-bold text-navy-900">
                  {i + 1}
                </span>
                <span className="text-sm text-gray-300">{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-10">
          <Link
            to="/"
            className="text-sm text-gray-400 transition-colors hover:text-gold-500"
          >
            ← Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
