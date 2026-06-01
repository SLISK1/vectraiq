-- ============================================================
-- Backtest engine: point-in-time, cost-aware momentum backtests
-- Stores one row per backtest run with params, computed metrics,
-- the equity curve, and (optionally) per-rebalance holdings/actions.
-- RLS is user-owned: a run belongs to the user who created it.
-- Created by the run-backtest edge function.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.backtest_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  name text,
  params jsonb NOT NULL,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  metrics jsonb,
  equity_curve jsonb,        -- array of { date, strategy, benchmark }
  trades jsonb,              -- optional: per-rebalance holdings / actions
  benchmark_ticker text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_backtest_runs_user_created
  ON public.backtest_runs(user_id, created_at DESC);

ALTER TABLE public.backtest_runs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for backtest_runs (user-specific) — 4-policy pattern
-- copied verbatim in shape from watchlist_cases (migration 20260205220950).
CREATE POLICY "Users can view their own backtest runs"
ON public.backtest_runs FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own backtest runs"
ON public.backtest_runs FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own backtest runs"
ON public.backtest_runs FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own backtest runs"
ON public.backtest_runs FOR DELETE
USING (auth.uid() = user_id);
