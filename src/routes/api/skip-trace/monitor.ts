// Cron endpoint for the skip-trace monitor.
//
//   GET/POST /api/skip-trace/monitor -> run stall detection, return job list
//                                      + contactability summary
//
// Callable by cron systems (the B10 command center will surface alerts from the
// notifications table). When CRON_SECRET is configured, callers must provide
// the matching ?token= value.
import { createFileRoute } from "@tanstack/react-router";
import { detectStalledJobs, listSkipTraceJobs, getTraceSummary } from "~/lib/skip-trace";

async function run({ request }: { request: Request }): Promise<Response> {
  try {
    const url = new URL(request.url);
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && url.searchParams.get("token") !== cronSecret) {
      return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    const detection = await detectStalledJobs();
    const jobs = await listSkipTraceJobs();
    const summary = await getTraceSummary();
    return Response.json(
      {
        stalled: detection.stalled,
        notificationsCreated: detection.notificationsCreated,
        jobs,
        summary,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const Route = createFileRoute("/api/skip-trace/monitor")({
  server: {
    handlers: {
      GET: run,
      POST: run,
    },
  },
} as never);
