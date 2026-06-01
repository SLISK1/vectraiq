-- ============================================================
-- Liquidity metrics for equities (stocks + funds)
-- Adds computed liquidity columns to symbols so illiquid names can
-- be filtered out and transaction costs modeled honestly.
-- Populated by the compute-liquidity edge function (daily-pipeline).
-- No backfill here — values are written on the next pipeline run.
-- ============================================================

ALTER TABLE public.symbols
  ADD COLUMN IF NOT EXISTS avg_dollar_volume_30d numeric,   -- mean daily turnover (close * volume) in the symbol's own currency
  ADD COLUMN IF NOT EXISTS is_liquid boolean,               -- currency-aware threshold; NULL = unknown (too few days)
  ADD COLUMN IF NOT EXISTS liquidity_updated_at timestamptz; -- last time compute-liquidity wrote this row
