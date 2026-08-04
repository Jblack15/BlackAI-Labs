-- DealFlow AI — CSV Lead Import
-- Migration 006: columns used by the /crm/import page. `source` tags where the
-- lead came from (default 'csv_import'), `pipeline_stage` mirrors the CRM stage
-- for tooling that expects a dedicated stage column (default 'new_lead').
-- Both are idempotent and backward-compatible with the existing pipeline (the
-- CRM's kanban continues to read `status`).
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'csv_import';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS pipeline_stage TEXT DEFAULT 'new_lead';
