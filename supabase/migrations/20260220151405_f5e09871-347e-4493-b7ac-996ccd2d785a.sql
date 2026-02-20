
-- ===========================
-- Fas 1: Nya tabeller
-- ===========================

-- 1. asset_predictions: append-only historik för alla predictions
CREATE TABLE public.asset_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol_id UUID NOT NULL REFERENCES public.symbols(id) ON DELETE CASCADE,
  rank_run_id UUID REFERENCES public.rank_runs(id) ON DELETE SET NULL,
  horizon horizon_type NOT NULL,
  predicted_direction signal_direction NOT NULL,
  predicted_prob NUMERIC(4,3),
  confidence INTEGER NOT NULL,
  total_score INTEGER NOT NULL,
  entry_price NUMERIC NOT NULL,
  baseline_ticker TEXT,
  baseline_price NUMERIC,
  exit_price NUMERIC,
  return_pct NUMERIC,
  excess_return NUMERIC,
  outcome signal_direction,
  hit BOOLEAN,
  scored_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.asset_predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "asset_predictions_select_all"
  ON public.asset_predictions FOR SELECT
  USING (true);

CREATE POLICY "asset_predictions_deny_insert"
  ON public.asset_predictions FOR INSERT
  WITH CHECK (false);

CREATE POLICY "asset_predictions_deny_update"
  ON public.asset_predictions FOR UPDATE
  USING (false);

CREATE POLICY "asset_predictions_deny_delete"
  ON public.asset_predictions FOR DELETE
  USING (false);

-- 2. module_reliability: walk-forward hit rates per modul/horisont
CREATE TABLE public.module_reliability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module TEXT NOT NULL,
  horizon horizon_type NOT NULL,
  asset_type TEXT NOT NULL,
  total_predictions INTEGER NOT NULL DEFAULT 0,
  correct_predictions INTEGER NOT NULL DEFAULT 0,
  hit_rate NUMERIC(4,3),
  reliability_weight NUMERIC(4,3),
  window_days INTEGER NOT NULL DEFAULT 90,
  last_updated TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(module, horizon, asset_type)
);

ALTER TABLE public.module_reliability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "module_reliability_select_all"
  ON public.module_reliability FOR SELECT
  USING (true);

CREATE POLICY "module_reliability_deny_insert"
  ON public.module_reliability FOR INSERT
  WITH CHECK (false);

CREATE POLICY "module_reliability_deny_update"
  ON public.module_reliability FOR UPDATE
  USING (false);

CREATE POLICY "module_reliability_deny_delete"
  ON public.module_reliability FOR DELETE
  USING (false);

-- 3. macro_cache: cachat makrodata från Riksbanken/SCB/ECB
CREATE TABLE public.macro_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_key TEXT NOT NULL UNIQUE,
  value NUMERIC NOT NULL,
  unit TEXT,
  source_url TEXT,
  fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  valid_until TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.macro_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "macro_cache_select_all"
  ON public.macro_cache FOR SELECT
  USING (true);

CREATE POLICY "macro_cache_deny_insert"
  ON public.macro_cache FOR INSERT
  WITH CHECK (false);

CREATE POLICY "macro_cache_deny_update"
  ON public.macro_cache FOR UPDATE
  USING (false);

CREATE POLICY "macro_cache_deny_delete"
  ON public.macro_cache FOR DELETE
  USING (false);

-- 4. ALTER watchlist_cases: lägg till excess_return + baseline kolumner
ALTER TABLE public.watchlist_cases
  ADD COLUMN IF NOT EXISTS excess_return NUMERIC,
  ADD COLUMN IF NOT EXISTS baseline_ticker TEXT,
  ADD COLUMN IF NOT EXISTS baseline_entry_price NUMERIC,
  ADD COLUMN IF NOT EXISTS baseline_exit_price NUMERIC;

-- 5. RLS-härdning: news_cache SELECT → authenticated only
DROP POLICY IF EXISTS "News cache is viewable by everyone" ON public.news_cache;
CREATE POLICY "news_cache_select_authenticated"
  ON public.news_cache FOR SELECT
  TO authenticated
  USING (true);

-- 6. Index för snabbare queries
CREATE INDEX IF NOT EXISTS idx_asset_predictions_symbol_horizon ON public.asset_predictions(symbol_id, horizon);
CREATE INDEX IF NOT EXISTS idx_asset_predictions_scored_at ON public.asset_predictions(scored_at) WHERE scored_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_module_reliability_lookup ON public.module_reliability(module, horizon, asset_type);
