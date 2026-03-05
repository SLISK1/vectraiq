
-- ============================================================
-- Phase 1: Create all missing betting infrastructure tables
-- ============================================================

-- 1. team_rates_cache: stores per-match team rates + p_raw values
CREATE TABLE IF NOT EXISTS public.team_rates_cache (
  match_id uuid PRIMARY KEY REFERENCES public.betting_matches(id) ON DELETE CASCADE,
  home_team text NOT NULL,
  away_team text NOT NULL,
  home_btts_rate numeric NOT NULL DEFAULT 0.5,
  away_btts_rate numeric NOT NULL DEFAULT 0.5,
  home_o25_rate numeric NOT NULL DEFAULT 0.5,
  away_o25_rate numeric NOT NULL DEFAULT 0.5,
  home_crn_o95_rate numeric NOT NULL DEFAULT 0.5,
  away_crn_o95_rate numeric NOT NULL DEFAULT 0.5,
  home_crd_o35_rate numeric NOT NULL DEFAULT 0.5,
  away_crd_o35_rate numeric NOT NULL DEFAULT 0.5,
  p_raw_btts numeric,
  p_raw_o25 numeric,
  p_raw_crn_o95 numeric,
  p_raw_crd_o35 numeric,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.team_rates_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_rates_cache_select_all" ON public.team_rates_cache FOR SELECT USING (true);

-- 2. calibration_buckets: per-market calibration with Laplace smoothing
CREATE TABLE IF NOT EXISTS public.calibration_buckets (
  market text NOT NULL,
  bucket_idx smallint NOT NULL CHECK (bucket_idx >= 0 AND bucket_idx <= 9),
  n_samples integer NOT NULL DEFAULT 0,
  n_hits integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (market, bucket_idx)
);
ALTER TABLE public.calibration_buckets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "calibration_buckets_select_all" ON public.calibration_buckets FOR SELECT USING (true);

-- 3. odds_snapshots: multi-source odds with implied probs
CREATE TABLE IF NOT EXISTS public.odds_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.betting_matches(id) ON DELETE CASCADE,
  market text NOT NULL,
  selection text NOT NULL,
  odds_open numeric,
  odds_pre_match numeric,
  implied_open numeric,
  implied_pre_match numeric,
  overround_open numeric,
  overround_pre_match numeric,
  source text DEFAULT 'firecrawl',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  cache_expires_at timestamptz,
  UNIQUE (match_id, market, selection)
);
ALTER TABLE public.odds_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "odds_snapshots_select_all" ON public.odds_snapshots FOR SELECT USING (true);

-- 4. bets_log: tracks actual bets for ROI/PnL
CREATE TABLE IF NOT EXISTS public.bets_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.betting_matches(id) ON DELETE CASCADE,
  market text NOT NULL,
  selection text NOT NULL,
  phase smallint NOT NULL DEFAULT 1,
  odds numeric NOT NULL,
  p_raw numeric,
  p_proxy numeric,
  p_cal numeric,
  edge numeric,
  stake numeric NOT NULL DEFAULT 1.0,
  result text, -- 'win' | 'loss' | 'push' | 'void'
  pnl numeric,
  roi numeric,
  placed_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);
ALTER TABLE public.bets_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bets_log_select_all" ON public.bets_log FOR SELECT USING (true);

-- 5. coupon_recommendations: edge-gated recommendations
CREATE TABLE IF NOT EXISTS public.coupon_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.betting_matches(id) ON DELETE CASCADE,
  market text NOT NULL,
  selection text NOT NULL,
  phase smallint NOT NULL DEFAULT 1,
  implied_prob numeric,
  p_raw numeric,
  p_proxy numeric,
  p_cal numeric,
  edge numeric,
  chaos_score integer,
  goal_chaos integer,
  corner_pressure integer,
  card_heat integer,
  volatility integer,
  suggested_stake_pct numeric,
  is_valid boolean NOT NULL DEFAULT false,
  reason text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, market)
);
ALTER TABLE public.coupon_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coupon_recommendations_select_all" ON public.coupon_recommendations FOR SELECT USING (true);

-- 6. RPC: upsert_betting_cal_bucket (atomic calibration update)
CREATE OR REPLACE FUNCTION public.upsert_betting_cal_bucket(
  p_market text,
  p_bucket_idx smallint,
  p_n_bets_delta integer,
  p_n_wins_delta integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.calibration_buckets (market, bucket_idx, n_samples, n_hits, updated_at)
  VALUES (p_market, p_bucket_idx, p_n_bets_delta, p_n_wins_delta, now())
  ON CONFLICT (market, bucket_idx) DO UPDATE SET
    n_samples = calibration_buckets.n_samples + p_n_bets_delta,
    n_hits = calibration_buckets.n_hits + p_n_wins_delta,
    updated_at = now();
END;
$$;

-- 7. stock_prediction_outcomes: track stock prediction vs realized
CREATE TABLE IF NOT EXISTS public.stock_prediction_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.symbols(id) ON DELETE CASCADE,
  horizon text NOT NULL,
  predicted_return numeric,
  realized_return numeric,
  predicted_direction text NOT NULL,
  realized_direction text,
  entry_price numeric NOT NULL,
  exit_price numeric,
  predicted_at timestamptz NOT NULL DEFAULT now(),
  evaluated_at timestamptz,
  prediction_id uuid
);
ALTER TABLE public.stock_prediction_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stock_prediction_outcomes_select_all" ON public.stock_prediction_outcomes FOR SELECT USING (true);

-- 8. stock_calibration_buckets: score-to-return mapping
CREATE TABLE IF NOT EXISTS public.stock_calibration_buckets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  horizon text NOT NULL,
  bucket smallint NOT NULL,
  count integer NOT NULL DEFAULT 0,
  avg_realized_return numeric,
  win_rate numeric,
  avg_score numeric,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (horizon, bucket)
);
ALTER TABLE public.stock_calibration_buckets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stock_calibration_buckets_select_all" ON public.stock_calibration_buckets FOR SELECT USING (true);
