
-- 1) paper_portfolios
CREATE TABLE public.paper_portfolios (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  base_currency text NOT NULL DEFAULT 'SEK',
  starting_cash numeric NOT NULL DEFAULT 100000,
  cash_balance numeric NOT NULL DEFAULT 100000,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.paper_portfolios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "paper_portfolios_select_own" ON public.paper_portfolios FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "paper_portfolios_insert_own" ON public.paper_portfolios FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "paper_portfolios_update_own" ON public.paper_portfolios FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "paper_portfolios_delete_own" ON public.paper_portfolios FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER update_paper_portfolios_updated_at BEFORE UPDATE ON public.paper_portfolios FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) paper_trades (append-only)
CREATE TABLE public.paper_trades (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  portfolio_id uuid NOT NULL REFERENCES public.paper_portfolios(id) ON DELETE CASCADE,
  symbol_id uuid NOT NULL REFERENCES public.symbols(id),
  ticker text NOT NULL,
  asset_type text NOT NULL,
  side text NOT NULL CHECK (side IN ('buy', 'sell')),
  qty numeric NOT NULL,
  price numeric NOT NULL,
  fee numeric NOT NULL DEFAULT 0,
  notional numeric NOT NULL,
  executed_at timestamptz NOT NULL DEFAULT now(),
  notes text
);
ALTER TABLE public.paper_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "paper_trades_select_own" ON public.paper_trades FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "paper_trades_insert_own" ON public.paper_trades FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "paper_trades_deny_update" ON public.paper_trades FOR UPDATE USING (false);
CREATE POLICY "paper_trades_deny_delete" ON public.paper_trades FOR DELETE USING (false);

-- 3) paper_holdings
CREATE TABLE public.paper_holdings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  portfolio_id uuid NOT NULL REFERENCES public.paper_portfolios(id) ON DELETE CASCADE,
  symbol_id uuid NOT NULL REFERENCES public.symbols(id),
  ticker text NOT NULL,
  qty numeric NOT NULL DEFAULT 0,
  avg_cost numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (portfolio_id, symbol_id)
);
ALTER TABLE public.paper_holdings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "paper_holdings_select_own" ON public.paper_holdings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "paper_holdings_insert_own" ON public.paper_holdings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "paper_holdings_update_own" ON public.paper_holdings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "paper_holdings_delete_own" ON public.paper_holdings FOR DELETE USING (auth.uid() = user_id);

-- 4) paper_portfolio_snapshots
CREATE TABLE public.paper_portfolio_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  portfolio_id uuid NOT NULL REFERENCES public.paper_portfolios(id) ON DELETE CASCADE,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  cash_balance numeric NOT NULL,
  holdings_value numeric NOT NULL DEFAULT 0,
  total_value numeric NOT NULL,
  pnl_total numeric NOT NULL DEFAULT 0,
  pnl_pct numeric NOT NULL DEFAULT 0,
  benchmark_value numeric,
  benchmark_return_pct numeric
);
ALTER TABLE public.paper_portfolio_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "paper_snapshots_select_own" ON public.paper_portfolio_snapshots FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "paper_snapshots_insert_own" ON public.paper_portfolio_snapshots FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "paper_snapshots_deny_update" ON public.paper_portfolio_snapshots FOR UPDATE USING (false);
CREATE POLICY "paper_snapshots_deny_delete" ON public.paper_portfolio_snapshots FOR DELETE USING (false);
