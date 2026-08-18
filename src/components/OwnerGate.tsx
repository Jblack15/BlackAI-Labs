// DealFlow AI — OwnerGate: client-side gate for owner-only pages (PH1-B14, part 2).
//
// UX ONLY — never the security boundary. Security is server-side: every
// createServerFn in an owner route file carries requireOwnerMiddleware and 401s
// {authRequired:true} when there is no valid owner session (a crafted client
// that skips this gate gets honest 401s everywhere it tries to load data).
//
// Behaviour (spec §4):
//   - useOwnerSession() fetches /api/auth/status once on mount and resolves to
//     'loading' | 'authenticated' | 'anonymous'.
//   - OwnerGate renders the sign-in panel SYNCHRONOUSLY in the initial
//     'loading' state (headline "Sign in required", subtext "Checking access…")
//     — SSR HTML therefore contains the gate panel, never PII, and no data
//     effects mount before a session is confirmed.
//   - 'authenticated' -> children mount (their data-fetching effects run NOW,
//     not before); 'anonymous' -> the panel swaps its subtext for a link to
//     /login?next=<currentPath> so the owner lands back here after signing in.
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";

export type OwnerSessionState = "loading" | "authenticated" | "anonymous";

/** Current owner session state, resolved from GET /api/auth/status (public by
 *  design — it IS the protocol, spec §1). Never throws; network failure is
 *  treated as anonymous (fail closed to the sign-in panel, not to data). */
export function useOwnerSession(): OwnerSessionState {
  const [state, setState] = useState<OwnerSessionState>("loading");
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/status", { headers: { "Cache-Control": "no-store" } })
      .then((res) => res.json().catch(() => ({})))
      .then((body: { authenticated?: unknown }) => {
        if (cancelled) return;
        setState(body?.authenticated === true ? "authenticated" : "anonymous");
      })
      .catch(() => {
        if (!cancelled) setState("anonymous");
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

export function OwnerGate({ children }: { children: ReactNode }) {
  const status = useOwnerSession();
  if (status === "authenticated") return <>{children}</>;
  return <SignInPanel loading={status === "loading"} />;
}

function SignInPanel({ loading }: { loading: boolean }) {
  const { pathname } = useLocation();
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center px-4 py-16 text-center">
      <div className="w-full rounded-2xl border border-navy-700 bg-navy-800 p-8 shadow-xl">
        <h1 className="text-2xl font-bold text-white">Sign in required</h1>
        {loading ? (
          <p className="mt-3 text-sm text-gray-400">Checking access…</p>
        ) : (
          <p className="mt-3 text-sm text-gray-400">
            This area is for the DealForge owner only.{" "}
            <Link
              to="/login"
              search={{ next: pathname }}
              className="text-gold-500 transition-colors hover:text-gold-400 hover:underline"
            >
              Sign in
            </Link>{" "}
            to continue.
          </p>
        )}
      </div>
    </div>
  );
}
