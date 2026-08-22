import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useOwnerSession } from "~/components/OwnerGate";

/**
 * DealForge — MobileNav: a fixed bottom tab bar for small screens (owner only).
 *
 * The desktop header hides its nav below `md` (`hidden md:flex`), so on a phone
 * the owner previously had no way to move between screens. This bar restores a
 * first-class mobile path: 4 primary tabs + a "More" sheet for the full set.
 *
 * Honesty/compliance: shown ONLY when `useOwnerSession()` is 'authenticated',
 * and every target route is still gated server-side by requireOwnerMiddleware.
 * "More → Sign out" revokes the session via POST /api/auth/logout and returns
 * to the public site — the same cookie-based single-owner auth is preserved.
 */
const PRIMARY_TABS = [
  { to: "/command-center", label: "Command Center", short: "Center" },
  { to: "/dashboard", label: "Dashboard", short: "Dash" },
  { to: "/crm", label: "CRM Pipeline", short: "CRM" },
  { to: "/approvals", label: "Approvals", short: "Approvals" },
] as const;

const MORE_LINKS = [
  { to: "/operations", label: "Operations" },
  { to: "/performance", label: "Performance" },
  { to: "/briefing", label: "Briefing" },
  { to: "/channels", label: "Channels" },
  { to: "/calculator", label: "Deal Calculator" },
  { to: "/contracts", label: "Contracts" },
  { to: "/buyers", label: "Buyers" },
] as const;

function isActive(pathname: string, to: string) {
  if (to === "/") return pathname === "/";
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function MobileNav() {
  const session = useOwnerSession();
  const { pathname } = useLocation();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (session !== "authenticated") return null;

  const signOut = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* best-effort; cookie is HttpOnly and cleared by the server response */
    }
    router.invalidate().finally(() => {
      window.location.assign("/");
    });
  };

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-navy-700 bg-navy-900/95 backdrop-blur supports-[backdrop-filter]:bg-navy-900/90 md:hidden"
      aria-label="Mobile navigation"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="grid grid-cols-5">
        {[...PRIMARY_TABS, { to: "", label: "More", short: "More" }].map((tab) => {
          const active = tab.to === "" ? open : isActive(pathname, tab.to);
          return tab.to === "" ? (
            <button
              key="more"
              type="button"
              onClick={() => setOpen((v) => !v)}
              className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
                active ? "text-gold-400" : "text-gray-400"
              }`}
            >
              <MoreIcon />
              {tab.short}
            </button>
          ) : (
            <Link
              key={tab.to}
              to={tab.to}
              onClick={() => setOpen(false)}
              className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
                active ? "text-gold-400" : "text-gray-400 active:text-gray-200"
              }`}
            >
              <TabIcon to={tab.to} />
              {tab.short}
            </Link>
          );
        })}
      </div>

      {open && (
        <div className="absolute inset-x-0 bottom-full max-h-[70vh] overflow-y-auto border-t border-navy-700 bg-navy-900 shadow-2xl">
          <div className="px-4 py-3">
            <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              All owner screens
            </p>
            <div className="grid grid-cols-2 gap-1">
              {[...PRIMARY_TABS, ...MORE_LINKS].map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  onClick={() => setOpen(false)}
                  className={`rounded-lg px-3 py-3 text-sm font-medium transition-colors ${
                    isActive(pathname, link.to)
                      ? "bg-navy-800 text-gold-400"
                      : "text-gray-300 active:bg-navy-800"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
              <button
                type="button"
                onClick={signOut}
                className="col-span-2 rounded-lg border border-navy-700 px-3 py-3 text-left text-sm font-medium text-gray-300 active:bg-navy-800"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}

function TabIcon({ to }: { to: string }) {
  const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  switch (to) {
    case "/command-center":
      return (
        <svg className="h-5 w-5" viewBox="0 0 24 24" {...stroke}>
          <rect x="3" y="3" width="7" height="9" rx="1" />
          <rect x="14" y="3" width="7" height="5" rx="1" />
          <rect x="14" y="12" width="7" height="9" rx="1" />
          <rect x="3" y="16" width="7" height="5" rx="1" />
        </svg>
      );
    case "/dashboard":
      return (
        <svg className="h-5 w-5" viewBox="0 0 24 24" {...stroke}>
          <rect x="3" y="3" width="8" height="8" rx="1" />
          <rect x="13" y="3" width="8" height="4" rx="1" />
          <rect x="13" y="9" width="8" height="12" rx="1" />
          <rect x="3" y="13" width="8" height="8" rx="1" />
        </svg>
      );
    case "/crm":
      return (
        <svg className="h-5 w-5" viewBox="0 0 24 24" {...stroke}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" />
        </svg>
      );
    case "/approvals":
      return (
        <svg className="h-5 w-5" viewBox="0 0 24 24" {...stroke}>
          <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    default:
      return null;
  }
}

function MoreIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
      <circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
