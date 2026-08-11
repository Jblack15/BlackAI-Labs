import { Link } from "@tanstack/react-router";

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-navy-700 bg-navy-900/95 backdrop-blur supports-[backdrop-filter]:bg-navy-900/80">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <Link to="/" className="flex items-center gap-2">
          <span className="text-xl font-bold text-white">
            DealFlow<span className="text-gold-500">AI</span>
          </span>
        </Link>
        <nav className="hidden items-center gap-6 md:flex">
          <Link
            to="/dashboard"
            className="text-sm font-medium text-gray-300 transition-colors hover:text-white"
          >
            Dashboard
          </Link>
          <Link
            to="/calculator"
            className="text-sm font-medium text-gray-300 transition-colors hover:text-white"
          >
            Deal Calculator
          </Link>
          <Link
            to="/crm"
            className="text-sm font-medium text-gray-300 transition-colors hover:text-white"
          >
            CRM Pipeline
          </Link>
          <Link
            to="/contracts"
            className="text-sm font-medium text-gray-300 transition-colors hover:text-white"
          >
            Contracts
          </Link>
          <Link
            to="/buyers"
            className="text-sm font-medium text-gray-300 transition-colors hover:text-white"
          >
            Buyers
          </Link>
          <div className="group relative">
            <button className="flex items-center gap-1 text-sm font-medium text-gray-300 transition-colors hover:text-white">
              Sell Your Home
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <div className="absolute left-1/2 top-full mt-2 w-56 -translate-x-1/2 rounded-lg border border-navy-700 bg-navy-800 py-2 opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
              <DropDownLinks />
            </div>
          </div>
          <Link
            to="/get-offer"
            className="rounded-lg bg-gold-500 px-5 py-2.5 text-sm font-semibold text-navy-900 transition-colors hover:bg-gold-400"
          >
            Get Your Cash Offer
          </Link>
        </nav>
        <Link
          to="/get-offer"
          className="rounded-lg bg-gold-500 px-4 py-2 text-sm font-semibold text-navy-900 md:hidden"
        >
          Get Offer
        </Link>
      </div>
    </header>
  );
}

function DropDownLinks() {
  const links = [
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
  ];

  return (
    <>
      {links.map((link) => (
        <Link
          key={link.to}
          to={link.to}
          className="block px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-navy-700 hover:text-white"
        >
          {link.label}
        </Link>
      ))}
    </>
  );
}
