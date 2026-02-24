
-- Step 4: Add calibration columns
ALTER TABLE public.calibration_stats
  ADD COLUMN IF NOT EXISTS ece numeric,
  ADD COLUMN IF NOT EXISTS log_loss numeric,
  ADD COLUMN IF NOT EXISTS calibration_version text DEFAULT 'v1-5bucket',
  ADD COLUMN IF NOT EXISTS sample_count integer DEFAULT 0;
