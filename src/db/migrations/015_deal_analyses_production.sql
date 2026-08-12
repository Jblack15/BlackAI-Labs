-- DealFlow AI — Deal Analyzer production display (migration 015)
-- PH1-B9: extend deal_analyses so every saved analysis carries honest,
-- NULL-by-default production fields. The table has 0 rows today and every
-- new column starts NULL (analysis_status defaults to 'ESTIMATE') so it is
-- only filled by a real calculator save (src/routes/calculator.tsx). NULL is
-- the honest "not computed / unknown" state and nothing here fabricates data
--
-- New columns
--   confidence          NUMERIC   0-100 — NULL = not computed (no inspection
--                                    or comparable-sales evidence). The UI
--                                    NEVER auto-fills this column
--   current_value       NUMERIC   — from leads.score_factors.ev at save time
--   desired_buyer_margin NUMERIC  — target buyer margin pct (no input exists
--                                    yet, stays NULL)
--   distress_score      NUMERIC   — from score_factors.distress
--   tax_delinquent      BOOLEAN   — NULL = unknown (never default false,
--                                    that would claim verified-clean)
--   years_delinquent    INT       — from score_factors.years_delq
--   foreclosure_risk    TEXT      — CHECK vocab mirrors score_factors
--                                    (uppercased and underscore-joined)
--   equity_estimate     NUMERIC   — from score_factors.equity
--   property_type       TEXT      — from leads.property_type / score_factors
--   buyer_demand        TEXT      — NULL or 'NOT_VERIFIED' means no
--                                    buyer-demand data and the UI renders
--                                    "NOT VERIFIED / no buyer demand data"
--   offer_range_low/high NUMERIC  — recommended range [max(0, mao*0.9), mao]
--   assumptions         JSONB     — input echo (arv_input, repairs_input,
--                                    fee_input, closing_mode, closing_pct,
--                                    holding_input, arv_source, value_source,
--                                    repair_basis)
--   analysis_status     TEXT NOT NULL DEFAULT 'ESTIMATE' — CHECK
--                                    ESTIMATE/VERIFIED and outputs render an
--                                    ESTIMATE badge until human-verified
--
-- Existing NOT NULL DEFAULT 0 columns are NOT touched (back-compat with the
-- rowToAnalysis Number() coercion in calculator.tsx)
--
-- NOTE for the migration runner: no semicolons inside comment lines
ALTER TABLE deal_analyses ADD COLUMN IF NOT EXISTS confidence NUMERIC;
ALTER TABLE deal_analyses ADD COLUMN IF NOT EXISTS current_value NUMERIC;
ALTER TABLE deal_analyses ADD COLUMN IF NOT EXISTS desired_buyer_margin NUMERIC;
ALTER TABLE deal_analyses ADD COLUMN IF NOT EXISTS distress_score NUMERIC;
ALTER TABLE deal_analyses ADD COLUMN IF NOT EXISTS tax_delinquent BOOLEAN;
ALTER TABLE deal_analyses ADD COLUMN IF NOT EXISTS years_delinquent INT;
ALTER TABLE deal_analyses ADD COLUMN IF NOT EXISTS foreclosure_risk TEXT;
ALTER TABLE deal_analyses ADD COLUMN IF NOT EXISTS equity_estimate NUMERIC;
ALTER TABLE deal_analyses ADD COLUMN IF NOT EXISTS property_type TEXT;
ALTER TABLE deal_analyses ADD COLUMN IF NOT EXISTS buyer_demand TEXT;
ALTER TABLE deal_analyses ADD COLUMN IF NOT EXISTS offer_range_low NUMERIC;
ALTER TABLE deal_analyses ADD COLUMN IF NOT EXISTS offer_range_high NUMERIC;
ALTER TABLE deal_analyses ADD COLUMN IF NOT EXISTS assumptions JSONB;
ALTER TABLE deal_analyses ADD COLUMN IF NOT EXISTS analysis_status TEXT NOT NULL DEFAULT 'ESTIMATE';
-- Constraints (drop-then-add is idempotent and NULL stays allowed everywhere)
ALTER TABLE deal_analyses DROP CONSTRAINT IF EXISTS deal_analyses_confidence_check;
ALTER TABLE deal_analyses ADD CONSTRAINT deal_analyses_confidence_check CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100));
ALTER TABLE deal_analyses DROP CONSTRAINT IF EXISTS deal_analyses_foreclosure_risk_check;
ALTER TABLE deal_analyses ADD CONSTRAINT deal_analyses_foreclosure_risk_check CHECK (foreclosure_risk IS NULL OR foreclosure_risk IN ('LOW', 'MEDIUM_LOW', 'MEDIUM_HIGH', 'HIGH', 'VERY_HIGH'));
ALTER TABLE deal_analyses DROP CONSTRAINT IF EXISTS deal_analyses_analysis_status_check;
ALTER TABLE deal_analyses ADD CONSTRAINT deal_analyses_analysis_status_check CHECK (analysis_status IN ('ESTIMATE', 'VERIFIED'));
