
-- K: Add calibration columns to asset_predictions
ALTER TABLE asset_predictions 
  ADD COLUMN IF NOT EXISTS p_up numeric,
  ADD COLUMN IF NOT EXISTS weights_version text DEFAULT '1.0',
  ADD COLUMN IF NOT EXISTS model_version text DEFAULT '1.0';

-- K: Create calibration_stats table
CREATE TABLE IF NOT EXISTS calibration_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  horizon text NOT NULL,
  asset_type text NOT NULL,
  bucket_center numeric NOT NULL,
  predicted_count integer DEFAULT 0,
  actual_up_count integer DEFAULT 0,
  brier_score numeric,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(horizon, asset_type, bucket_center)
);

ALTER TABLE calibration_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "calibration_stats_select_all" ON calibration_stats
  FOR SELECT USING (true);
CREATE POLICY "calibration_stats_deny_insert" ON calibration_stats
  FOR INSERT WITH CHECK (false);
CREATE POLICY "calibration_stats_deny_update" ON calibration_stats
  FOR UPDATE USING (false);
CREATE POLICY "calibration_stats_deny_delete" ON calibration_stats
  FOR DELETE USING (false);

-- M: Add quality columns to raw_prices
ALTER TABLE raw_prices 
  ADD COLUMN IF NOT EXISTS quality_score smallint DEFAULT 100,
  ADD COLUMN IF NOT EXISTS market_timestamp timestamptz;
