// DealFlow AI — /login: PUBLIC owner sign-in page (PH1-B14, part 2).
//
// Honest protocol page (spec §1/§2): the PIN form POSTs to /api/auth/login
// (an API route — server functions cannot set the session cookie). Every
// response state is surfaced truthfully:
//   - success (201/200, ok:true)        -> redirect to ?next= or /dashboard
//   - not configured (401, "not configured") -> honest setup-needed message
//   - wrong PIN (401, generic copy)     -> "check the PIN and try again"
//   - rate-limit lockout (429, locked)  -> "Too many attempts — try again…"
// No overclaiming anywhere: the page never promises access, and the owner PIN
// is never shown, guessed, or referenced beyond the honest setup note.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    next: typeof search.next === "string" ? search.next : undefined,
  }),
  component: LoginPage,
});

type LoginState = "idle" | "submitting" | "not-configured" | "locked" | "error";

function LoginPage() {
  const { next } = Route.useSearch();
  const [pin, setPin] = useState("");
  const [state, setState] = useState<LoginState>("idle");
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!pin) return;
    setState("submitting");
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        locked?: boolean;
        alreadyAuthenticated?: boolean;
        error?: string;
      };
      if (body.ok === true) {
        // Session cookie is set; hard-navigate so the whole app re-reads it.
        const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
        window.location.assign(target);
        return;
      }
      if (body.locked === true) {
        setState("locked");
        setError("Too many attempts — try again in a few minutes");
        return;
      }
      if (typeof body.error === "string" && body.error.includes("not configured")) {
        setState("not-configured");
        setError(body.error);
        return;
      }
      setState("error");
      setError(typeof body.error === "string" ? body.error : "Sign-in failed — check the PIN and try again");
    } catch {
      setState("error");
      setError("Could not reach the sign-in service — try again in a moment.");
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-4 py-16">
      <div className="w-full rounded-2xl border border-navy-700 bg-navy-800 p-8 shadow-xl">
        <div className="mb-6 text-center">
          <span className="text-xl font-bold text-white">
            DealForge <span className="text-gold-500">Properties</span>
          </span>
          <h1 className="mt-4 text-2xl font-bold text-white">Owner sign-in</h1>
          <p className="mt-2 text-sm text-gray-400">
            Restricted to the DealForge owner. Enter your PIN to open the operating system.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="pin" className="mb-1.5 block text-sm font-medium text-gray-300">
              Owner PIN
            </label>
            <input
              id="pin"
              name="pin"
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              autoFocus
              required
              minLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              disabled={state === "submitting"}
              className="w-full rounded-lg border border-navy-600 bg-navy-900 px-4 py-2.5 text-white placeholder-gray-500 outline-none transition-colors focus:border-gold-500 disabled:opacity-60"
              placeholder="••••••••"
            />
          </div>

          {state === "not-configured" && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300" role="alert">
              {error || "Sign-in is not configured yet."} The owner PIN is set with{" "}
              <code className="text-amber-200">scripts/set-owner-pin.ts</code> — until then this page can&apos;t sign anyone in.
            </p>
          )}
          {state === "locked" && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300" role="alert">
              {error} Please wait before trying again.
            </p>
          )}
          {state === "error" && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={state === "submitting" || pin.length < 8}
            className="w-full rounded-lg bg-gold-500 px-5 py-2.5 text-sm font-semibold text-navy-900 transition-colors hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {state === "submitting" ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-gray-500">
          Owner-only access. Nothing on this page is shared with sellers, buyers, or visitors.
        </p>
      </div>

      <Link to="/" className="mt-6 text-sm text-gray-400 transition-colors hover:text-gold-400 hover:underline">
        ← Back to the public site
      </Link>
    </div>
  );
}
