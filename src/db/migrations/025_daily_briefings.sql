-- DealFlow AI — Daily autopilot briefing + performance snapshot (migration 025)
-- D4/D5: the single persisted row the morning autopilot (Step 13) writes each
-- run, and the source-truth snapshot behind the consolidated performance
-- dashboard (Step 15). One row per generation -- the OWNER regenerates it on
-- demand from the Briefing screen. There is NO scheduler yet (no cron or
-- scheduled-task hook exists in this platform plan), so nothing fires it
-- automatically until the platform supports scheduled tasks.
--
--   id            SERIAL PK
--   generated_at  when this briefing was generated (the date it covers)
--   briefing_json full JSON snapshot of that run (funnel, targets, tasks,
--                 attention, queue, conversions -- REAL data only)
--   summary       compact one-minute-readable text for the owner (nullable)
--
-- Idempotent (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS) so the
-- migration runner is safe to re-run. No semicolons inside comments and no
-- literal dollar-quote openers inside comments (migration-runner rules).
CREATE TABLE IF NOT EXISTS daily_briefings (
  id SERIAL PRIMARY KEY,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  briefing_json JSONB,
  summary TEXT
);
CREATE INDEX IF NOT EXISTS idx_daily_briefings_generated ON daily_briefings (generated_at DESC);
