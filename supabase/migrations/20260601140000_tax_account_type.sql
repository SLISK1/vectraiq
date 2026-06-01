-- ============================================================
-- Swedish tax / account-type modeling for the paper portfolio.
--
-- Adds Swedish kontotyp (account type) to paper_portfolios so the
-- tax engine can model the three real-world Swedish wrappers:
--   isk  = Investeringssparkonto       (schablonbeskattat)
--   kf   = Kapitalförsäkring           (avkastningsskatt, schablon)
--   depa = Aktie-/fonddepå (VP-konto)  (reavinstbeskattat, K4)
--
-- Adds realized_gain to paper_trades: on a SELL we store the realized
-- capital gain/loss computed with GENOMSNITTSMETODEN (the average-cost
-- method, NOT FIFO — see src/lib/tax.ts for why). This feeds the depå
-- K4-sammanställning (Avsnitt A) in the Skatt tab.
--
-- Additive + idempotent (ADD COLUMN IF NOT EXISTS). No RLS changes:
-- existing paper_portfolios / paper_trades policies (migration
-- 20260223194740) already cover these columns.
-- ============================================================

ALTER TABLE public.paper_portfolios
  ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'isk'
  CHECK (account_type IN ('isk', 'kf', 'depa'));

-- Realized gain/loss on a sell, computed via genomsnittsmetoden
-- (sell_price - weighted_avg_cost) * qty. NULL for buys.
ALTER TABLE public.paper_trades
  ADD COLUMN IF NOT EXISTS realized_gain numeric;
