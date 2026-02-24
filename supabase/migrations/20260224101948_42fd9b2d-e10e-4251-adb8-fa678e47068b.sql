
-- Add pipeline diagnostic columns to strategy_automation_jobs
ALTER TABLE public.strategy_automation_jobs
  ADD COLUMN IF NOT EXISTS analysis_rows_fetched integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS passed_gate_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS matched_regime_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS candidates_upserted_count integer DEFAULT 0;

-- Add debug_force_one_candidate flag to strategy_configs
ALTER TABLE public.strategy_configs
  ADD COLUMN IF NOT EXISTS debug_force_one_candidate boolean NOT NULL DEFAULT false;
