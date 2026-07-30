import { Link } from "@tanstack/react-router";

export function Footer() {
  return (
    <footer className="border-t border-navy-700 bg-navy-800">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Link to="/" className="text-lg font-bold text-white">
              DealFlow<span className="text-gold-500">AI</span>
            </Link>
            <p className="mt-3 text-sm text-gray-400">
              Technology-driven real estate solutions. We help homeowners sell fast for cash — no repairs, no agents, no fees.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Seller Solutions</h3>
            <ul className="mt-3 space-y-2">
              {[
                { to: "/sell/tax-delinquent", label: "Tax Issues" },
                { to: "/sell/probate", label: "Probate / Inherited" },
                { to: "/sell/vacant", label: "Vacant Homes" },
                { to: "/sell/pre-foreclosure", label: "Pre-Foreclosure" },
                { to: "/sell/tired-landlord", label: "Tired Landlords" },
              ].map((link) => (
                <li key={link.to}>
                  <Link to={link.to} className="text-sm text-gray-400 transition-colors hover:text-gold-500">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">More Solutions</h3>
            <ul className="mt-3 space-y-2">
              {[
                { to: "/sell/divorce", label: "Divorce Sale" },
                { to: "/sell/eviction", label: "Eviction" },
                { to: "/sell/expired-listing", label: "Expired Listings" },
                { to: "/sell/code-violations", label: "Code Violations" },
                { to: "/sell/high-equity", label: "High Equity" },
              ].map((link) => (
                <li key={link.to}>
                  <Link to={link.to} className="text-sm text-gray-400 transition-colors hover:text-gold-500">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Get Started</h3>
            <p className="mt-3 text-sm text-gray-400">
              Ready to sell? Get a no-obligation cash offer in 24 hours.
            </p>
            <Link
              to="/get-offer"
              className="mt-4 inline-block rounded-lg bg-gold-500 px-5 py-2.5 text-sm font-semibold text-navy-900 transition-colors hover:bg-gold-400"
            >
              Get Cash Offer
            </Link>
            <Link
              to="/dashboard"
              className="mt-3 block text-sm text-gray-400 transition-colors hover:text-gold-500"
            >
              Dashboard →
            </Link>
            <Link
              to="/calculator"
              className="mt-2 block text-sm text-gray-400 transition-colors hover:text-gold-500"
            >
              Deal Calculator →
            </Link>
            <Link
              to="/crm"
              className="mt-2 block text-sm text-gray-400 transition-colors hover:text-gold-500"
            >
              CRM Pipeline →
            </Link>
            <Link
              to="/contracts"
              className="mt-2 block text-sm text-gray-400 transition-colors hover:text-gold-500"
            >
              Contracts →
            </Link>
            <Link
              to="/buyers"
              className="mt-2 block text-sm text-gray-400 transition-colors hover:text-gold-500"
            >
              Buyer Network →
            </Link>
            <Link
              to="/settings"
              className="mt-2 block text-sm text-gray-400 transition-colors hover:text-gold-500"
            >
              Settings →
            </Link>
          </div>
        </div>
        <div className="mt-10 border-t border-navy-700 pt-6 text-center text-sm text-gray-500">
          &copy; {new Date().getFullYear()} DealFlow AI. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
