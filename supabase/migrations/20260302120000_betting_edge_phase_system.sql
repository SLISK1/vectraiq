-- Phase-aware edge betting expansion:
-- caches team rates + odds snapshots, tracks calibration buckets, logs bet ROI,
-- and stores precomputed market/coupon recommendations.

CREATE TABLE IF NOT EXISTS public.team_rates_cache (
  match_id uuid PRIMARY KEY REFERENCES public.betting_matches(id) ON DELETE CASCADE,
  home_team text NOT NULL,
  away_team text NOT NULL,
  home_btts_rate numeric NOT NULL DEFAULT 0,
  away_btts_rate numeric NOT NULL DEFAULT 0,
  home_o25_rate numeric NOT NULL DEFAULT 0,
  away_o25_rate numeric NOT NULL DEFAULT 0,
  home_crn_o95_rate numeric NOT NULL DEFAULT 0,
  away_crn_o95_rate numeric NOT NULL DEFAULT 0,
  home_crd_o35_rate numeric NOT NULL DEFAULT 0,
  away_crd_o35_rate numeric NOT NULL DEFAULT 0,
  p_raw_btts numeric,
  p_raw_o25 numeric,
  p_raw_crn_o95 numeric,
  p_raw_crd_o35 numeric,
  source text NOT NULL DEFAULT 'derived_match_data',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.calibration_buckets (
  market text NOT NULL,
  bucket_idx smallint NOT NULL CHECK (bucket_idx BETWEEN 0 AND 9),
  n_samples integer NOT NULL DEFAULT 0,
  n_hits integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (market, bucket_idx)
);

CREATE TABLE IF NOT EXISTS public.odds_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.betting_matches(id) ON DELETE CASCADE,
  market text NOT NULL,
  selection text NOT NULL,
  book_name text,
  odds_open numeric,
  odds_pre_match numeric,
  implied_open numeric,
  implied_pre_match numeric,
  overround_open numeric,
  overround_pre_match numeric,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  cache_expires_at timestamptz NOT NULL,
  source text NOT NULL DEFAULT 'firecrawl',
  UNIQUE (match_id, market, selection)
);

CREATE TABLE IF NOT EXISTS public.bets_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.betting_matches(id) ON DELETE CASCADE,
  prediction_id uuid REFERENCES public.betting_predictions(id) ON DELETE SET NULL,
  market text NOT NULL,
  selection text NOT NULL,
  phase smallint NOT NULL,
  odds_taken numeric,
  implied_prob numeric,
  p_raw numeric,
  p_proxy numeric,
  p_cal numeric,
  edge numeric,
  suggested_stake_pct numeric,
  stake_amount numeric,
  result text,
  pnl numeric,
  roi numeric,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.coupon_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.betting_matches(id) ON DELETE CASCADE,
  market text NOT NULL,
  selection text NOT NULL,
  phase smallint NOT NULL,
  implied_prob numeric NOT NULL,
  p_raw numeric,
  p_proxy numeric,
  p_cal numeric NOT NULL,
  edge numeric NOT NULL,
  chaos_score numeric NOT NULL,
  goal_chaos numeric,
  corner_pressure numeric,
  card_heat numeric,
  volatility numeric,
  suggested_stake_pct numeric,
  is_valid boolean NOT NULL DEFAULT false,
  reason text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, market)
);

CREATE INDEX IF NOT EXISTS idx_coupon_recommendations_valid
  ON public.coupon_recommendations (is_valid, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_odds_snapshots_match
  ON public.odds_snapshots (match_id, market, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_bets_log_created
  ON public.bets_log (created_at DESC);

ALTER TABLE public.team_rates_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calibration_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.odds_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bets_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupon_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_rates_cache_select_all" ON public.team_rates_cache FOR SELECT USING (true);
CREATE POLICY "calibration_buckets_select_all" ON public.calibration_buckets FOR SELECT USING (true);
CREATE POLICY "odds_snapshots_select_all" ON public.odds_snapshots FOR SELECT USING (true);
CREATE POLICY "bets_log_select_all" ON public.bets_log FOR SELECT USING (true);
CREATE POLICY "coupon_recommendations_select_all" ON public.coupon_recommendations FOR SELECT USING (true);

CREATE POLICY "team_rates_cache_service_write" ON public.team_rates_cache FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "calibration_buckets_service_write" ON public.calibration_buckets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "odds_snapshots_service_write" ON public.odds_snapshots FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "bets_log_service_write" ON public.bets_log FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "coupon_recommendations_service_write" ON public.coupon_recommendations FOR ALL USING (true) WITH CHECK (true);
