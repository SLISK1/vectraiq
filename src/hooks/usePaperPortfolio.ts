import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { AccountType } from '@/lib/tax';

export interface PaperPortfolio {
  id: string;
  user_id: string;
  base_currency: string;
  starting_cash: number;
  cash_balance: number;
  created_at: string;
  /** Swedish account type for tax modeling (isk | kf | depa). Added 20260601140000. */
  account_type?: AccountType;
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
  /** Realized gain via genomsnittsmetoden, set on sells. Added 20260601140000. */
  realized_gain?: number | null;
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

      // Get holdings with symbol info in a single query (avoids N+1)
      const { data: holdings } = await supabase
        .from('paper_holdings')
        .select('*, symbols:symbol_id(name, asset_type)')
        .eq('portfolio_id', portfolio.id);

      const enrichedHoldings: PaperHolding[] = [];
      let holdingsValue = 0;

      if (holdings && holdings.length > 0) {
        // Batch-fetch latest prices for all holdings in one query
        const symbolIds = holdings.map(h => h.symbol_id);
        const { data: latestPrices } = await supabase
          .from('raw_prices')
          .select('symbol_id, price')
          .in('symbol_id', symbolIds)
          .order('recorded_at', { ascending: false });

        // Build a map of symbol_id -> latest price (first occurrence per symbol)
        const priceMap = new Map<string, number>();
        if (latestPrices) {
          for (const p of latestPrices) {
            if (!priceMap.has(p.symbol_id)) {
              priceMap.set(p.symbol_id, Number(p.price));
            }
          }
        }

        for (const h of holdings) {
          const symbol = h.symbols as { name: string; asset_type: string } | null;
          const lastPrice = priceMap.get(h.symbol_id) ?? Number(h.avg_cost);
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

      // account_type was added in migration 20260601140000 and is not yet in the
      // generated Supabase types — read it via a cast, defaulting to 'isk'.
      const accountType: AccountType =
        ((portfolio as { account_type?: AccountType }).account_type) || 'isk';

      return {
        portfolio: { ...portfolio, account_type: accountType } as PaperPortfolio,
        accountType,
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

/**
 * All SELL trades carrying a realized_gain (genomsnittsmetoden) for the current
 * paper portfolio — used to build the depå K4-sammanställning. Unlike
 * usePaperTrades this is not capped at 20 rows, since a K4 needs every sell.
 */
export function usePaperRealizedTrades() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['paper-realized-trades', user?.id],
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
        .eq('side', 'sell')
        .order('executed_at', { ascending: false });

      return (data || []) as PaperTrade[];
    },
    enabled: !!user,
  });
}

/**
 * Set the Swedish account type (isk | kf | depa) on the current paper portfolio.
 * Updates the row directly (RLS restricts to the owner). Invalidates the
 * portfolio query so the Skatt tab reflects the new wrapper immediately.
 */
export function useSetAccountType() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (accountType: AccountType) => {
      if (!user) throw new Error('Not authenticated');
      const { data: portfolio } = await supabase
        .from('paper_portfolios')
        .select('id')
        .eq('user_id', user.id)
        .single();
      if (!portfolio) throw new Error('No portfolio');

      // account_type is not in the generated types yet (migration 20260601140000),
      // so cast the update payload.
      const { error } = await supabase
        .from('paper_portfolios')
        .update({ account_type: accountType } as never)
        .eq('id', portfolio.id);
      if (error) throw error;
      return accountType;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paper-portfolio'] });
    },
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
