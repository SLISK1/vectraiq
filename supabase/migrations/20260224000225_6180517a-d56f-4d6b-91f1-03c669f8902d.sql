-- Add value-bet columns to betting_predictions
ALTER TABLE public.betting_predictions 
ADD COLUMN IF NOT EXISTS is_value_bet boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS suggested_stake_pct numeric DEFAULT null;

-- Backfill existing predictions: mark as value bet if edge > 5% and confidence >= 60
UPDATE public.betting_predictions
SET is_value_bet = true,
    suggested_stake_pct = LEAST(1.0, GREATEST(0.25, model_edge * 5))
WHERE model_edge IS NOT NULL 
  AND model_edge > 0.05 
  AND confidence_capped >= 60;
