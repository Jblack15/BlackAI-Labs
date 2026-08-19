import { Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { requireOwnerMiddleware } from "~/lib/auth";
import { useOwnerSession } from "~/components/OwnerGate";
// Pending-approvals count for the nav badge (PH1-B11). 0 is the correct
// production state until a real offer/contract/spend/change is requested.
// Guarded by requireOwnerMiddleware (PH1-B14): with no owner session the call
// 401s {authRequired:true} and the badge stays hidden (count 0) — the badge is
// owner data and must never render for anonymous visitors.
const fetchPendingApprovalCount = createServerFn({
  method: "GET",
  middleware: [requireOwnerMiddleware],
}).handler(async () => {
  try {
    const { pendingApprovalCount } = await import("~/lib/approvals");
    return await pendingApprovalCount();
  } catch {
    return 0;
  }
});
function ApprovalBadge() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    fetchPendingApprovalCount()
      .then((n) => setCount(typeof n === "number" ? n : 0))
      .catch(() => {});
  }, []);
  if (count === 0) return null;
  return (
    <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-gold-500 px-1 text-[10px] font-bold text-navy-900">
      {count}
    </span>
  );
}
export function Header() {
  // PH1-B14 honesty fix: owner links (and the approvals badge) render ONLY for
  // an authenticated owner. Anonymous/loading visitors get the marketing nav
  // (Sell Your Home dropdown + Get Your Cash Offer CTA) plus a muted
  // "Owner sign-in" link to /login. This is UX only — every owner server fn
  // enforces the session server-side regardless of what the header shows.
  const session = useOwnerSession();
  const authed = session === "authenticated";
  return (
    <header className="sticky top-0 z-50 border-b border-navy-700 bg-navy-900/95 backdrop-blur supports-[backdrop-filter]:bg-navy-900/80">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <Link to="/" className="flex items-center gap-2">
          <span className="text-xl font-bold text-white">
            DealForge <span className="text-gold-500">Properties</span>
          </span>
        </Link>
        <nav className="hidden items-center gap-6 md:flex">
          {authed ? (
            <>
              <Link
                to="/operations"
                className="text-sm font-medium text-gray-300 transition-colors hover:text-white"
              >
                Operations
              </Link>
              <Link
                to="/performance"
                className="text-sm font-medium text-gray-300 transition-colors hover:text-white"
              >
                Performance
              </Link>
              <Link
                to="/briefing"
                className="text-sm font-medium text-gray-300 transition-colors hover:text-white"
              >
                Briefing
              </Link>
              <Link
                to="/channels"
                className="text-sm font-medium text-gray-300 transition-colors hover:text-white"
              >
                Channels
              </Link>
              <Link
                to="/command-center"
                className="text-sm font-medium text-gray-300 transition-colors hover:text-white"
              >
                Command Center
              </Link>
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
              <Link
                to="/approvals"
                className="flex items-center text-sm font-medium text-gray-300 transition-colors hover:text-white"
              >
                Approvals
                <ApprovalBadge />
              </Link>
            </>
          ) : (
            <Link
              to="/login"
              className="text-sm font-medium text-gray-500 transition-colors hover:text-gray-300"
            >
              Owner sign-in
            </Link>
          )}
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
