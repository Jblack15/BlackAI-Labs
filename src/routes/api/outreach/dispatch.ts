// Cron endpoint for the scheduled outreach dispatcher.
//
// Processes every due outreach_sequences row (steps 2–N of the SMS/email drips
// whose scheduled_for has passed) and sends the follow-up. Returns JSON counts.
//
//   GET/POST /api/outreach/dispatch          -> process due rows (default 100)
//   GET/POST /api/outreach/dispatch?limit=25 -> cap how many rows are handled
//
// Response: { processed: N, sent: N, failed: N, errors: [...] }
//
// Callable by any cron system (GET or POST, no auth token required — same as
// the rest of the public site; the endpoint is idempotent and never crashes).

import { createFileRoute } from "@tanstack/react-router";
import { dispatchDueOutreach } from "~/lib/outreach-dispatcher";

// Handlers receive the middleware context object ({ request, params, ... }),
// not the bare Request.
async function run({ request }: { request: Request }): Promise<Response> {
  try {
    const url = new URL(request.url);
    // Number(null) is 0 (finite!), which would clamp the limit to 1 — treat a
    // missing/empty param as "use the default".
    const rawParam = url.searchParams.get("limit");
    const raw = rawParam ? Number(rawParam) : NaN;
    const limit = Number.isFinite(raw) ? Math.min(500, Math.max(1, Math.floor(raw))) : 100;
    const result = await dispatchDueOutreach(limit);
    return Response.json(result, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    // The dispatcher itself never throws, but guard the route anyway so a
    // cron failure is a JSON 500, not a crash.
    return Response.json(
      {
        processed: 0,
        sent: 0,
        failed: 0,
        errors: [{ id: "", channel: "", step: 0, error: err instanceof Error ? err.message : "Unknown error" }],
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

// `server.handlers` is the TanStack Start server-route convention (handled in
// createStartHandler): no component, so the handler response is returned as-is.
// The route options are loosely typed in this version, hence the cast.
export const Route = createFileRoute("/api/outreach/dispatch")({
  server: {
    handlers: {
      GET: run,
      POST: run,
    },
  },
} as never);
