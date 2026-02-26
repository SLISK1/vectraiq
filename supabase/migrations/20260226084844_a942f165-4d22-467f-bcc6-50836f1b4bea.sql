
-- Migration 1: Multi-market betting support
ALTER TABLE public.betting_predictions
  ADD COLUMN IF NOT EXISTS market text DEFAULT '1X2',
  ADD COLUMN IF NOT EXISTS line numeric,
  ADD COLUMN IF NOT EXISTS selection text,
  ADD COLUMN IF NOT EXISTS bet_outcome text,
  ADD COLUMN IF NOT EXISTS actual_value numeric,
  ADD COLUMN IF NOT EXISTS settled_at timestamptz;

UPDATE public.betting_predictions
  SET market = '1X2'
  WHERE market IS NULL;

CREATE INDEX IF NOT EXISTS idx_betting_pred_match_market_created
  ON public.betting_predictions(match_id, market, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_betting_pred_unsettled
  ON public.betting_predictions(match_id, market)
  WHERE bet_outcome IS NULL;
