
-- B1: Optimal Data Architecture for VectraIQ

-- 1. EXTEND existing signals table
ALTER TABLE public.signals
  ADD COLUMN IF NOT EXISTS ts timestamptz;

UPDATE public.signals SET ts = created_at WHERE ts IS NULL;

ALTER TABLE public.signals
  ADD COLUMN IF NOT EXISTS direction_num smallint
    GENERATED ALWAYS AS (
      CASE WHEN direction = 'UP' THEN 1
           WHEN direction = 'DOWN' THEN -1
           ELSE 0 END
    ) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS idx_signals_symbol_ts_horizon_module
  ON public.signals(symbol_id, ts, horizon, module);

-- 2. EXTEND existing rank_runs table
ALTER TABLE public.rank_runs
  ADD COLUMN IF NOT EXISTS ts timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS weights jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS universe_filter jsonb DEFAULT '{}';

-- 3. CREATE price_bars
CREATE TABLE IF NOT EXISTS public.price_bars (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  asset_id uuid NOT NULL REFERENCES public.symbols(id) ON DELETE CASCADE,
  ts timestamptz NOT NULL,
  interval text NOT NULL DEFAULT '1d',
  open numeric,
  high numeric,
  low numeric,
  close numeric,
  volume numeric,
  source_provider text,
  quality_score smallint DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, interval, ts)
);

CREATE INDEX IF NOT EXISTS idx_price_bars_asset_ts
  ON public.price_bars(asset_id, ts DESC);

ALTER TABLE public.price_bars ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'price_bars' AND policyname = 'price_bars_select_all') THEN
    CREATE POLICY "price_bars_select_all" ON public.price_bars FOR SELECT USING (true);
  END IF;
END $$;

-- 4. CREATE features
CREATE TABLE IF NOT EXISTS public.features (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  asset_id uuid NOT NULL REFERENCES public.symbols(id) ON DELETE CASCADE,
  ts timestamptz NOT NULL,
  feature_set_version text NOT NULL DEFAULT 'v1',
  data_coverage smallint DEFAULT 100,
  values jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, ts, feature_set_version)
);

CREATE INDEX IF NOT EXISTS idx_features_asset_ts
  ON public.features(asset_id, ts DESC);

ALTER TABLE public.features ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'features' AND policyname = 'features_select_all') THEN
    CREATE POLICY "features_select_all" ON public.features FOR SELECT USING (true);
  END IF;
END $$;

-- 5. CREATE rank_results
CREATE TABLE IF NOT EXISTS public.rank_results (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rank_run_id uuid NOT NULL REFERENCES public.rank_runs(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.symbols(id) ON DELETE CASCADE,
  score_signed numeric,
  confidence smallint,
  top_contributors jsonb DEFAULT '[]',
  rank integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rank_run_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_rank_results_run
  ON public.rank_results(rank_run_id);

ALTER TABLE public.rank_results ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rank_results' AND policyname = 'rank_results_select_all') THEN
    CREATE POLICY "rank_results_select_all" ON public.rank_results FOR SELECT USING (true);
  END IF;
END $$;

-- 6. CREATE predictions
CREATE TABLE IF NOT EXISTS public.predictions (
  prediction_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  asset_id uuid NOT NULL REFERENCES public.symbols(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  horizon horizon_type NOT NULL,
  predicted_direction signal_direction NOT NULL,
  predicted_prob numeric CHECK (predicted_prob BETWEEN 0 AND 1),
  confidence smallint CHECK (confidence BETWEEN 0 AND 100),
  entry_price numeric,
  target_ts timestamptz,
  rank_run_id uuid REFERENCES public.rank_runs(id) ON DELETE SET NULL,
  features_hash text
);

CREATE INDEX IF NOT EXISTS idx_predictions_asset_target
  ON public.predictions(asset_id, target_ts);

ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'predictions' AND policyname = 'predictions_select_all') THEN
    CREATE POLICY "predictions_select_all" ON public.predictions FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'predictions' AND policyname = 'predictions_insert_owner') THEN
    CREATE POLICY "predictions_insert_owner" ON public.predictions FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'predictions' AND policyname = 'predictions_update_owner') THEN
    CREATE POLICY "predictions_update_owner" ON public.predictions FOR UPDATE USING (auth.uid() = user_id);
  END IF;
END $$;

-- 7. CREATE outcomes
CREATE TABLE IF NOT EXISTS public.outcomes (
  prediction_id uuid PRIMARY KEY
    REFERENCES public.predictions(prediction_id) ON DELETE CASCADE,
  exit_price numeric,
  return_pct numeric,
  baseline_return_pct numeric,
  excess_return_pct numeric,
  hit boolean,
  scored_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.outcomes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'outcomes' AND policyname = 'outcomes_select_all') THEN
    CREATE POLICY "outcomes_select_all" ON public.outcomes FOR SELECT USING (true);
  END IF;
END $$;

-- 8. CREATE calibration_bins
CREATE TABLE IF NOT EXISTS public.calibration_bins (
  horizon horizon_type NOT NULL,
  score_bin int2 NOT NULL,
  n integer DEFAULT 0,
  hit_rate numeric,
  brier numeric,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (horizon, score_bin)
);

ALTER TABLE public.calibration_bins ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'calibration_bins' AND policyname = 'calibration_bins_select_all') THEN
    CREATE POLICY "calibration_bins_select_all" ON public.calibration_bins FOR SELECT USING (true);
  END IF;
END $$;
