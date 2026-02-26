-- Betting calibration buckets for 3-phase probability calibration.
-- Mirrors the calibrator.py approach from the scoring engine:
--   Phase 1 (N < 80):  use p_raw * 0.85 as conservative prior
--   Phase 2 (80-199):  Laplace-weighted blend of proxy and empirical bucket
--   Phase 3 (N >= 200): full empirical Laplace-smoothed bucket
--
-- bucket_idx 0-9 maps to decile of p_raw (0.0-0.1 → 0, 0.1-0.2 → 1, etc.)
-- Updated by betting-settle whenever a bet is resolved (win/loss).

CREATE TABLE IF NOT EXISTS public.betting_calibration_buckets (
  market      text     NOT NULL,
  bucket_idx  smallint NOT NULL CHECK (bucket_idx BETWEEN 0 AND 9),
  n_bets      integer  NOT NULL DEFAULT 0,
  n_wins      integer  NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (market, bucket_idx)
);

ALTER TABLE public.betting_calibration_buckets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "betting_cal_buckets_select_all"
  ON public.betting_calibration_buckets FOR SELECT USING (true);
CREATE POLICY "betting_cal_buckets_service_write"
  ON public.betting_calibration_buckets FOR ALL USING (true) WITH CHECK (true);

-- Useful view: empirical hit rate per market + bucket
CREATE OR REPLACE VIEW public.betting_calibration_summary AS
SELECT
  market,
  bucket_idx,
  n_bets,
  n_wins,
  CASE WHEN n_bets > 0 THEN round((n_wins::numeric / n_bets) * 100, 1) END AS hit_rate_pct,
  -- Laplace-smoothed probability
  round(((n_wins + 1.0) / (n_bets + 2.0)) * 100, 1) AS laplace_pct,
  updated_at
FROM public.betting_calibration_buckets
ORDER BY market, bucket_idx;

-- RPC called by betting-settle to atomically increment bucket counters.
-- Uses INSERT ... ON CONFLICT to avoid races.
CREATE OR REPLACE FUNCTION public.upsert_betting_cal_bucket(
  p_market      text,
  p_bucket_idx  smallint,
  p_n_bets_delta  integer,
  p_n_wins_delta  integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.betting_calibration_buckets (market, bucket_idx, n_bets, n_wins, updated_at)
  VALUES (p_market, p_bucket_idx, p_n_bets_delta, p_n_wins_delta, now())
  ON CONFLICT (market, bucket_idx) DO UPDATE
    SET n_bets     = betting_calibration_buckets.n_bets + EXCLUDED.n_bets,
        n_wins     = betting_calibration_buckets.n_wins + EXCLUDED.n_wins,
        updated_at = now();
END;
$$;
