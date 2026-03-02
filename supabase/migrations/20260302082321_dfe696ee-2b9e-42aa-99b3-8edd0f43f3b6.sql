-- Step 1: Make predicted_winner nullable for side bets
ALTER TABLE public.betting_predictions ALTER COLUMN predicted_winner DROP NOT NULL;

-- Step 2: Retroactively create side bet rows from existing 1X2 predictions' key_factors->side_predictions
-- This inserts OU_GOALS and BTTS rows for matches that already have 1X2 predictions with side_predictions data
INSERT INTO public.betting_predictions (
  match_id, market, line, selection, predicted_prob,
  confidence_raw, confidence_capped, model_edge, model_version,
  predicted_winner, created_at
)
SELECT
  p.match_id,
  'OU_GOALS' AS market,
  COALESCE((p.key_factors->'side_predictions'->'total_goals'->>'line')::numeric, 2.5) AS line,
  p.key_factors->'side_predictions'->'total_goals'->>'prediction' AS selection,
  (p.key_factors->'side_predictions'->'total_goals'->>'prob')::numeric AS predicted_prob,
  p.confidence_raw,
  p.confidence_capped,
  NULL AS model_edge,
  p.model_version,
  NULL AS predicted_winner,
  p.created_at
FROM public.betting_predictions p
WHERE p.market = '1X2'
  AND p.key_factors->'side_predictions'->'total_goals' IS NOT NULL
  AND p.key_factors->'side_predictions'->'total_goals'->>'prediction' IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.betting_predictions p2
    WHERE p2.match_id = p.match_id AND p2.market = 'OU_GOALS'
  );

INSERT INTO public.betting_predictions (
  match_id, market, line, selection, predicted_prob,
  confidence_raw, confidence_capped, model_edge, model_version,
  predicted_winner, created_at
)
SELECT
  p.match_id,
  'BTTS' AS market,
  NULL AS line,
  p.key_factors->'side_predictions'->'btts'->>'prediction' AS selection,
  (p.key_factors->'side_predictions'->'btts'->>'prob')::numeric AS predicted_prob,
  p.confidence_raw,
  p.confidence_capped,
  NULL AS model_edge,
  p.model_version,
  NULL AS predicted_winner,
  p.created_at
FROM public.betting_predictions p
WHERE p.market = '1X2'
  AND p.key_factors->'side_predictions'->'btts' IS NOT NULL
  AND p.key_factors->'side_predictions'->'btts'->>'prediction' IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.betting_predictions p2
    WHERE p2.match_id = p.match_id AND p2.market = 'BTTS'
  );

INSERT INTO public.betting_predictions (
  match_id, market, line, selection, predicted_prob,
  confidence_raw, confidence_capped, model_edge, model_version,
  predicted_winner, created_at
)
SELECT
  p.match_id,
  'HT_OU_GOALS' AS market,
  COALESCE((p.key_factors->'side_predictions'->'first_half_goals'->>'line')::numeric, 1.5) AS line,
  p.key_factors->'side_predictions'->'first_half_goals'->>'prediction' AS selection,
  (p.key_factors->'side_predictions'->'first_half_goals'->>'prob')::numeric AS predicted_prob,
  p.confidence_raw,
  p.confidence_capped,
  NULL AS model_edge,
  p.model_version,
  NULL AS predicted_winner,
  p.created_at
FROM public.betting_predictions p
WHERE p.market = '1X2'
  AND p.key_factors->'side_predictions'->'first_half_goals' IS NOT NULL
  AND p.key_factors->'side_predictions'->'first_half_goals'->>'prediction' IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.betting_predictions p2
    WHERE p2.match_id = p.match_id AND p2.market = 'HT_OU_GOALS'
  );

INSERT INTO public.betting_predictions (
  match_id, market, line, selection, predicted_prob,
  confidence_raw, confidence_capped, model_edge, model_version,
  predicted_winner, created_at
)
SELECT
  p.match_id,
  'CORNERS_OU' AS market,
  COALESCE((p.key_factors->'side_predictions'->'corners'->>'line')::numeric, 9.5) AS line,
  p.key_factors->'side_predictions'->'corners'->>'prediction' AS selection,
  (p.key_factors->'side_predictions'->'corners'->>'prob')::numeric AS predicted_prob,
  p.confidence_raw,
  p.confidence_capped,
  NULL AS model_edge,
  p.model_version,
  NULL AS predicted_winner,
  p.created_at
FROM public.betting_predictions p
WHERE p.market = '1X2'
  AND p.key_factors->'side_predictions'->'corners' IS NOT NULL
  AND p.key_factors->'side_predictions'->'corners'->>'prediction' IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.betting_predictions p2
    WHERE p2.match_id = p.match_id AND p2.market = 'CORNERS_OU'
  );