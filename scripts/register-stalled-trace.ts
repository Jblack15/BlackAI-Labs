/* Register the observed PropStream skip-trace stall in the in-app job registry.
 * Real data only: counts verified by grid probes on 2026-08-18.
 */
import { registerSkipTraceJob } from "../src/lib/skip-trace";
import { sql } from "../src/db";

async function main() {
  // The traced list is the marketing list where the 59/65 counts were observed
  const listName = "Bexar Top1000 2026-08";
  const groupId = "5433294";
  const totalLeads = 978;
  const tracedCount = 124; // 59 mobile + 65 landline observed (08-12 recheck; 59 mobile reconfirmed 08-18)
  const errorMsg =
    "PropStream Connect job-side error: trace stalled at 59 mobile / 65 landline (124 of 978). " +
    "Re-verified 2026-08-18 via grid probe: mobile count still 59 (no progress in 6 days); " +
    "432 skip-trace credits consumed per Account page. Exact error text not visible in web app " +
    "(no Jobs/Activity UI element found in app shell). Requires owner check in PropStream or backup trace.";

  const { job, duplicate } = await registerSkipTraceJob(listName, groupId, totalLeads);
  console.log(JSON.stringify({ duplicate, registeredJob: job }));

  // Mark STALLED with the real counts + error text (detectStalledJobs only auto-flags
  // jobs stale by 45min; this is a historical job we are backfilling).
  const updated = await sql`
    UPDATE skip_trace_jobs
    SET status = 'STALLED', traced_count = ${tracedCount}, error_message = ${errorMsg},
        last_progress_at = now() - interval '6 days'
    WHERE id = ${job.id}
    RETURNING id, list_name, status, traced_count, error_message, created_at
  `;
  console.log("UPDATED:" + JSON.stringify(updated[0]));
}

main().then(() => process.exit(0)).catch((e) => { console.error("ERR", e); process.exit(1); });
