// DealFlow AI — Daily Autopilot briefing (D5, Step 13)
//
// generateDailyBriefing() is ONE pass that:
//   (a) refreshes priorities + seller summaries (existing fns)
//   (b) recomputes the top-25 call list + calls due today + due follow-ups
//   (c) counts pending approvals
//   (d) collects attention / blocked items
//   (e) recomputes the REAL funnel counts + conversion quick-stats
//   (f) persists ONE row to daily_briefings (migration 025) and returns it
//
// HONESTY & SCHEDULING: there is NO scheduler / cron / scheduled-task hook in
// this platform plan, so this never runs by itself. The owner (or the Briefing
// route's "Regenerate briefing" button) triggers it. We do NOT build a fake
// scheduler (no self-hosted setTimeout loop). When the platform supports
// scheduled tasks, this same function is the unit that would run on a schedule.
//
// NOTHING here is autonomous outbound: refreshPriorities/refreshSellerSummaries
// are internal recomputation, and give a briefing for the OWNER to read. No
// call, SMS, or email is ever sent.
import { sql } from "~/db";
import { refreshPriorities } from "~/lib/prioritization";
import { refreshSellerSummaries } from "~/lib/seller-summary";
import { getOperationsOverview } from "~/lib/owner-action-queue";
import { performanceFunnel, conversionsFromFunnel } from "~/lib/performance-dashboard";
import { fmtDollars, fmtRate } from "~/lib/command-center";

export interface DailyBriefing {
  id: number;
  generatedAt: string;
  summary: string;
  data: unknown;
}

/** Compose the one-minute-readable plain-text summary from the live data. */
function buildSummary(o: {
  overview: Awaited<ReturnType<typeof getOperationsOverview>>;
  funnel: Awaited<ReturnType<typeof performanceFunnel>>;
}): string {
  const c = o.overview.counts;
  const funnel = o.funnel.stages;
  const v = (k: string) => funnel.find((s) => s.key === k)?.value ?? 0;
  const line: string[] = [];
  line.push(`DealForge daily briefing`);
  line.push(`Leads ${c.totalLeads} · traced ${c.traced} · contactable ${c.contactable} · callable ${c.withPhone}`);
  line.push(
    `Funnel: ${v("qualified")} qualified · ${v("offers")} offers · ${v("contracts")} contracts · ` +
    `${v("closed")} closed · ${fmtDollars(Math.round(v("assignment_revenue") * 100))} assignment revenue`,
  );
  line.push(`Owner actions: ${o.overview.needsApprovalCount} approval(s) · ${o.overview.callNowCount} call-now · ${o.overview.dueFollowUps.length} follow-up(s) due`);
  line.push(`Attention: ${o.overview.attention.length} item(s)`);
  const convs = conversionsFromFunnel(funnel);
  const headline = convs.find((c2) => c2.label.includes("Contracts of offers"));
  line.push(`Offer→contract ${headline?.rate !== null && headline?.rate !== undefined ? fmtRate(headline.rate) : "—"} (target 15%)`);
  return line.join(" | ");
}

/** Latest persisted briefing (most recent row), or null when none yet. */
export async function getLatestBriefing(): Promise<DailyBriefing | null> {
  const rows = (await sql`
    SELECT id, generated_at, briefing_json, summary
    FROM daily_briefings
    ORDER BY generated_at DESC
    LIMIT 1
  `) as Array<{ id: number; generated_at: string; briefing_json: unknown; summary: string | null }>;
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: Number(r.id),
    generatedAt: String(r.generated_at),
    summary: r.summary ?? "",
    data: r.briefing_json,
  };
}

/**
 * Generate (or regenerate) today's briefing: (a)-(f) above in one pass, then
 * persist ONE row to daily_briefings. Returns the full briefing.
 */
export async function generateDailyBriefing(): Promise<DailyBriefing> {
  // (a) refresh priorities + seller summaries (existing fns)
  await refreshPriorities();
  await refreshSellerSummaries();

  // (b)+(c)+(d) recompose the operations/action state + attention
  const overview = await getOperationsOverview();

  // (e) REAL funnel + conversions
  const funnel = await performanceFunnel();

  const summary = buildSummary({ overview, funnel });
  const data = {
    generatedAt: new Date().toISOString(),
    overview: {
      counts: overview.counts,
      queue: overview.queue,
      callNowCount: overview.callNowCount,
      dueFollowUps: overview.dueFollowUps.length,
      needsApprovalCount: overview.needsApprovalCount,
      attentionCount: overview.attention.length,
      attentionCritical: overview.attention.filter((a) => a.severity === "critical").length,
      attention: overview.attention.map((a) => ({ severity: a.severity, title: a.title, detail: a.detail })),
    },
    funnel: funnel.stages,
    conversions: conversionsFromFunnel(funnel.stages),
    dbOk: funnel.dbOk,
  };

  // (f) persist ONE row
  const inserted = (await sql`
    INSERT INTO daily_briefings (generated_at, briefing_json, summary)
    VALUES (now(), ${JSON.stringify(data)}, ${summary})
    RETURNING id
  `) as Array<{ id: number }>;

  return { id: Number(inserted[0].id), generatedAt: data.generatedAt, summary, data };
}
