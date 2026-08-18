// GET /api/auth/status — {authenticated:boolean, role?:'owner'} for the client
// gate (OwnerGate) and Header. Public by design (spec §1): it IS the protocol.
// Reads the df_session cookie and validates the session; never throws, always
// honest JSON with Cache-Control: no-store (never cache auth state).
import { createFileRoute } from "@tanstack/react-router";
import { getSessionFromRequest } from "~/lib/auth";

async function status({ request }: { request: Request }): Promise<Response> {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return Response.json({ authenticated: false }, { status: 200, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ authenticated: true, role: session.role }, { status: 200, headers: { "Cache-Control": "no-store" } });
}

export const Route = createFileRoute("/api/auth/status")({
  server: {
    handlers: {
      GET: status,
    },
  },
} as never);
