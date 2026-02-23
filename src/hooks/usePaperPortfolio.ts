import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface PaperPortfolio {
  id: string;
  user_id: string;
  base_currency: string;
  starting_cash: number;
  cash_balance: number;
  created_at: string;
}

export interface PaperHolding {
  id: string;
  symbol_id: string;
  ticker: string;
  qty: number;
  avg_cost: number;
  last_price?: number;
  market_value?: number;
  pnl?: number;
  pnl_pct?: number;
  asset_type?: string;
  name?: string;
}

export interface PaperTrade {
  id: string;
  ticker: string;
  asset_type: string;
  side: string;
  qty: number;
  price: number;
  fee: number;
  notional: number;
  executed_at: string;
}

export interface PaperSnapshot {
  id: string;
  snapshot_at: string;
  cash_balance: number;
  holdings_value: number;
  total_value: number;
  pnl_total: number;
  pnl_pct: number;
  benchmark_value?: number;
  benchmark_return_pct?: number;
}

export function usePaperPortfolio() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['paper-portfolio', user?.id],
    queryFn: async () => {
      if (!user) return null;

      // Get portfolio
      const { data: portfolio } = await supabase
        .from('paper_portfolios')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (!portfolio) return null;

      // Get holdings with prices
      const { data: holdings } = await supabase
        .from('paper_holdings')
        .select('*')
        .eq('portfolio_id', portfolio.id);

      const enrichedHoldings: PaperHolding[] = [];
      let holdingsValue = 0;

      if (holdings) {
        for (const h of holdings) {
          // Get symbol info
          const { data: symbol } = await supabase
            .from('symbols')
            .select('name, asset_type')
            .eq('id', h.symbol_id)
            .single();

          // Get latest price
          const { data: priceData } = await supabase
            .from('raw_prices')
            .select('price')
            .eq('symbol_id', h.symbol_id)
            .order('recorded_at', { ascending: false })
            .limit(1)
            .single();

          const lastPrice = priceData ? Number(priceData.price) : Number(h.avg_cost);
          const qty = Number(h.qty);
          const avgCost = Number(h.avg_cost);
          const mv = qty * lastPrice;
          const pnl = mv - qty * avgCost;
          const pnlPct = avgCost > 0 ? ((lastPrice - avgCost) / avgCost) * 100 : 0;
          holdingsValue += mv;

          enrichedHoldings.push({
            id: h.id,
            symbol_id: h.symbol_id,
            ticker: h.ticker,
            qty,
            avg_cost: avgCost,
            last_price: lastPrice,
            market_value: mv,
            pnl,
            pnl_pct: pnlPct,
            asset_type: symbol?.asset_type,
            name: symbol?.name,
          });
        }
      }

      const cashBalance = Number(portfolio.cash_balance);
      const totalValue = cashBalance + holdingsValue;
      const startingCash = Number(portfolio.starting_cash);
      const pnlTotal = totalValue - startingCash;
      const pnlPct = startingCash > 0 ? (pnlTotal / startingCash) * 100 : 0;

      return {
        portfolio: portfolio as PaperPortfolio,
        holdings: enrichedHoldings,
        holdingsValue,
        totalValue,
        pnlTotal,
        pnlPct,
      };
    },
    enabled: !!user,
    staleTime: 30_000,
  });
}

export function usePaperTrades() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['paper-trades', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data: portfolio } = await supabase
        .from('paper_portfolios')
        .select('id')
        .eq('user_id', user.id)
        .single();
      if (!portfolio) return [];

      const { data } = await supabase
        .from('paper_trades')
        .select('*')
        .eq('portfolio_id', portfolio.id)
        .order('executed_at', { ascending: false })
        .limit(20);

      return (data || []) as PaperTrade[];
    },
    enabled: !!user,
  });
}

export function usePaperSnapshots() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['paper-snapshots', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data: portfolio } = await supabase
        .from('paper_portfolios')
        .select('id')
        .eq('user_id', user.id)
        .single();
      if (!portfolio) return [];

      const { data } = await supabase
        .from('paper_portfolio_snapshots')
        .select('*')
        .eq('portfolio_id', portfolio.id)
        .order('snapshot_at', { ascending: true })
        .limit(365);

      return (data || []) as PaperSnapshot[];
    },
    enabled: !!user,
  });
}

export function usePaperTradeMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      symbol_id: string;
      ticker: string;
      asset_type?: string;
      side: 'buy' | 'sell';
      amount_type: 'cash' | 'qty';
      amount: number;
    }) => {
      const { data, error } = await supabase.functions.invoke('paper-trade', {
        body: params,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paper-portfolio'] });
      queryClient.invalidateQueries({ queryKey: ['paper-trades'] });
      queryClient.invalidateQueries({ queryKey: ['paper-snapshots'] });
    },
  });
}

export function useResetPaperPortfolio() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('paper-trade', {
        body: { action: 'reset' },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paper-portfolio'] });
      queryClient.invalidateQueries({ queryKey: ['paper-trades'] });
      queryClient.invalidateQueries({ queryKey: ['paper-snapshots'] });
    },
  });
}
