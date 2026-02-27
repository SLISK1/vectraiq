UPDATE public.strategy_configs
SET
  coverage_min  = 60,
  agreement_min = 60,
  vol_risk_max  = 75,
  max_staleness_h = 48
WHERE coverage_min >= 90;