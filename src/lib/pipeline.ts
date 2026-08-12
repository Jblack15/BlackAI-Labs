// DealFlow AI — Pipeline service.
// Server-only: use only inside createServerFn handlers or API routes.
// Owns stage transitions, the pipeline_events audit trail, and automation rules.
import { sql } from "~/db";
import { VALID_TRANSITIONS, validNextStages } from "./pipeline-transitions";

// Valid transitions map (defined in the pure module so the client can import
// it without pulling in the database layer).
export { VALID_TRANSITIONS, validNextStages };

export interface TransitionResult {
  success: boolean;
  error?: string;
}

export interface PipelineStageInfo {
  stage: string;
  entered_at: string;
}

export interface PipelineEvent {
  id: string;
  from_stage: string | null;
  to_stage: string;
  triggered_by: string;
  agent_name: string | null;
  notes: string | null;
  created_at: string;
}

export interface PipelineStat {
  stage: string;
  count: number;
}

export interface AutomationResult {
  action_type: string;
  executed: boolean;
  error?: string;
}

/**
 * Move a lead to `toStage`, recording a pipeline_events audit row and then
 * evaluating any matching automation rules. Only transitions listed in
 * VALID_TRANSITIONS are allowed. `status` (legacy column) is intentionally left
 * untouched — existing tooling (bulk outreach, dashboard funnel) still reads it.
 */
export async function transitionLead(
  leadId: string,
  toStage: string,
  triggeredBy: string,
  notes?: string,
): Promise<TransitionResult> {
  try {
    const leadRows = await sql`
      SELECT pipeline_stage FROM leads WHERE id = ${leadId}
    ` as { pipeline_stage: string | null }[];
    const lead = leadRows[0];
    if (!lead) return { success: false, error: "Lead not found" };

    const fromStage = lead.pipeline_stage || "new_lead";
    const valid = VALID_TRANSITIONS[fromStage];
    if (!valid || !valid.includes(toStage)) {
      return { success: false, error: `Invalid transition from ${fromStage} to ${toStage}` };
    }

    await sql`
      UPDATE leads SET pipeline_stage = ${toStage}, updated_at = now() WHERE id = ${leadId}
    `;
    await sql`
      INSERT INTO pipeline_events (lead_id, from_stage, to_stage, triggered_by, notes)
      VALUES (${leadId}, ${fromStage}, ${toStage}, ${triggeredBy}, ${notes ?? null})
    `;

    // Fire automation rules — a failure here must not fail the transition.
    try {
      await evaluateAutomations(leadId);
    } catch {
      // automation evaluation is best-effort
    }

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: msg };
  }
}

/** Current stage of a lead plus when it entered that stage (latest pipeline
 *  event, or lead creation if the lead has never been transitioned). */
export async function getPipelineStage(leadId: string): Promise<{ stage: string; entered_at: string } | null> {
  const rows = await sql`
    SELECT l.pipeline_stage AS stage,
           COALESCE(pe.created_at, l.created_at) AS entered_at
    FROM leads l
    LEFT JOIN LATERAL (
      SELECT created_at FROM pipeline_events
      WHERE lead_id = l.id
      ORDER BY created_at DESC
      LIMIT 1
    ) pe ON true
    WHERE l.id = ${leadId}
  ` as { stage: string; entered_at: Date }[];
  const r = rows[0];
  if (!r) return null;
  return { stage: r.stage, entered_at: String(r.entered_at) };
}

/** Full stage-change audit trail for a lead, newest first. */
export async function getPipelineHistory(leadId: string): Promise<PipelineEvent[]> {
  const rows = await sql`
    SELECT id, from_stage, to_stage, triggered_by, agent_name, notes, created_at
    FROM pipeline_events
    WHERE lead_id = ${leadId}
    ORDER BY created_at DESC
  ` as Array<Omit<PipelineEvent, "created_at"> & { created_at: Date }>;
  return rows.map((r) => ({ ...r, created_at: String(r.created_at) }));
}

/** Number of leads currently in each pipeline stage. */
export async function getPipelineStats(): Promise<PipelineStat[]> {
  const rows = await sql`
    SELECT COALESCE(NULLIF(pipeline_stage, ''), 'new_lead') AS stage, COUNT(*)::int AS count
    FROM leads
    GROUP BY pipeline_stage
    ORDER BY count DESC
  ` as PipelineStat[];
  return rows;
}

interface AutomationRow {
  id: string;
  from_stage: string | null;
  to_stage: string | null;
  trigger_condition: Record<string, unknown> | null;
  action_type: string;
  action_config: Record<string, unknown> | null;
  is_active: boolean;
}

/**
 * Evaluate active automation rules for a lead. Rules match on the lead's
 * current stage (from_stage) and optionally a to_stage. Supported actions:
 *  - transition: move the lead (guarded against infinite loops)
 *  - notify:     insert a notifications row
 *  - create_task: insert a notifications row with type 'task'
 */
export async function evaluateAutomations(leadId: string): Promise<AutomationResult[]> {
  const depth = (evaluateAutomations as unknown as { _depth?: number })._depth ?? 0;
  if (depth > 5) return [];

  const leadRows = await sql`
    SELECT pipeline_stage FROM leads WHERE id = ${leadId}
  ` as { pipeline_stage: string | null }[];
  const lead = leadRows[0];
  if (!lead) return [];

  const stage = lead.pipeline_stage || "new_lead";
  const automations = (await sql`
    SELECT id, from_stage, to_stage, trigger_condition, action_type, action_config, is_active
    FROM pipeline_automations
    WHERE is_active = true AND (from_stage IS NULL OR from_stage = ${stage})
  `) as AutomationRow[];

  const results: AutomationResult[] = [];
  for (const auto of automations) {
    try {
      // Evaluate trigger_condition (jsonb) if present — supports { lead_field: value }
      // equality checks for fields like lead_source, plus a catch-all {} / null.
      let matched = true;
      if (auto.trigger_condition && Object.keys(auto.trigger_condition).length > 0) {
        const cond = auto.trigger_condition as Record<string, unknown>;
        const leadRow = (
          await sql`SELECT * FROM leads WHERE id = ${leadId}`
        ) as Record<string, unknown>[];
        matched = Object.entries(cond).every(([k, v]) => leadRow[0]?.[k] === v);
      }
      if (!matched) {
        results.push({ action_type: auto.action_type, executed: false });
        continue;
      }

      if (auto.action_type === "transition" && auto.to_stage) {
        (evaluateAutomations as unknown as { _depth?: number })._depth = depth + 1;
        const res = await transitionLead(leadId, auto.to_stage, "auto");
        results.push({ action_type: "transition", executed: res.success, error: res.error });
      } else if (auto.action_type === "notify") {
        const cfg = (auto.action_config ?? {}) as { title?: string; message?: string; type?: string };
        await sql`
          INSERT INTO notifications (lead_id, type, title, body)
          VALUES (${leadId}, ${cfg.type ?? "auto"}, ${cfg.title ?? `Stage: ${stage}`}, ${cfg.message ?? `Automation triggered at stage ${stage}.`})
        `;
        results.push({ action_type: "notify", executed: true });
      } else if (auto.action_type === "create_task") {
        const cfg = (auto.action_config ?? {}) as { title?: string; message?: string };
        await sql`
          INSERT INTO notifications (lead_id, type, title, body)
          VALUES (${leadId}, 'task', ${cfg.title ?? `Follow up: ${stage}`}, ${cfg.message ?? "Automation-created task."})
        `;
        results.push({ action_type: "create_task", executed: true });
      } else {
        results.push({ action_type: auto.action_type, executed: false, error: "Unsupported action_type" });
      }
    } catch (err: unknown) {
      results.push({
        action_type: auto.action_type,
        executed: false,
        error: err instanceof Error ? err.message : "Automation failed",
      });
    }
  }
  (evaluateAutomations as unknown as { _depth?: number })._depth = depth;
  return results;
}
