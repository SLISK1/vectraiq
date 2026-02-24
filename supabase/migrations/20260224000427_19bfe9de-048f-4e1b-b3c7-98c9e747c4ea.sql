-- Add closing odds columns to betting_matches
ALTER TABLE public.betting_matches
ADD COLUMN IF NOT EXISTS closing_odds_home numeric DEFAULT null,
ADD COLUMN IF NOT EXISTS closing_odds_draw numeric DEFAULT null,
ADD COLUMN IF NOT EXISTS closing_odds_away numeric DEFAULT null,
ADD COLUMN IF NOT EXISTS closing_odds_fetched_at timestamptz DEFAULT null;

-- Add CLV column to betting_predictions
ALTER TABLE public.betting_predictions
ADD COLUMN IF NOT EXISTS clv numeric DEFAULT null;