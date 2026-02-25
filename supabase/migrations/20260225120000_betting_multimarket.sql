
-- A1: Multi-market support for betting_predictions
-- Adds market/line/selection/bet_outcome/actual_value/settled_at columns
-- Backward-compatible: existing rows default to market='1X2'

ALTER TABLE public.betting_predictions
  ADD COLUMN IF NOT EXISTS market text DEFAULT '1X2',
  ADD COLUMN IF NOT EXISTS line numeric,
  ADD COLUMN IF NOT EXISTS selection text,
  ADD COLUMN IF NOT EXISTS bet_outcome text,
  ADD COLUMN IF NOT EXISTS actual_value numeric,
  ADD COLUMN IF NOT EXISTS settled_at timestamptz;

-- Stamp all existing rows as 1X2 (they were all main market predictions)
UPDATE public.betting_predictions
  SET market = '1X2'
  WHERE market IS NULL;

-- Index for match-level deduplication and BettingPage queries
CREATE INDEX IF NOT EXISTS idx_betting_pred_match_market_created
  ON public.betting_predictions(match_id, market, created_at DESC);

-- Partial index for fast settlement queries (unsettled rows only)
CREATE INDEX IF NOT EXISTS idx_betting_pred_unsettled
  ON public.betting_predictions(match_id, market)
  WHERE bet_outcome IS NULL;
