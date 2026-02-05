import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { 
  fetchSymbolsWithPrices, 
  fetchWatchlist, 
  addToWatchlist, 
  removeFromWatchlist,
  triggerPriceFetch,
  type SymbolWithPrice 
} from '@/lib/api/database';
import { Horizon, RankedAsset, Direction, ConfidenceBreakdown, ModuleSignal } from '@/types/market';
import { addDays, addWeeks, addMonths, addYears } from 'date-fns';

// Transform database symbols to RankedAsset format with mock analysis
const transformToRankedAsset = (
  symbol: SymbolWithPrice, 
  horizon: Horizon, 
  direction: Direction
): RankedAsset => {
  const price = symbol.latestPrice;
  
  const generateMockSignal = (module: string): ModuleSignal => ({
    module,
    direction: Math.random() > 0.3 ? direction : (Math.random() > 0.5 ? 'NEUTRAL' : (direction === 'UP' ? 'DOWN' : 'UP')),
    strength: Math.floor(Math.random() * 40 + 40),
    horizon,
    confidence: Math.floor(Math.random() * 30 + 50),
    evidence: [],
    coverage: Math.floor(Math.random() * 30 + 70),
    weight: 10,
  });

  const signals = [
    'technical', 'fundamental', 'sentiment', 'elliottWave', 
    'quant', 'macro', 'volatility', 'seasonal', 'orderFlow', 'ml'
  ].map(generateMockSignal);

  const confidenceBreakdown: ConfidenceBreakdown = {
    freshness: Math.floor(Math.random() * 30 + 60),
    coverage: Math.floor(Math.random() * 25 + 70),
    agreement: Math.floor(Math.random() * 40 + 50),
    reliability: Math.floor(Math.random() * 30 + 55),
    regimeRisk: Math.floor(Math.random() * 40 + 20),
  };

  const confidence = Math.floor(
    0.25 * confidenceBreakdown.freshness +
    0.20 * confidenceBreakdown.coverage +
    0.25 * confidenceBreakdown.agreement +
    0.20 * confidenceBreakdown.reliability +
    0.10 * (100 - confidenceBreakdown.regimeRisk)
  );

  return {
    ticker: symbol.ticker,
    name: symbol.name,
    type: symbol.asset_type as 'stock' | 'crypto' | 'metal',
    sector: symbol.sector || undefined,
    exchange: symbol.exchange || undefined,
    currency: symbol.currency,
    lastPrice: price ? Number(price.price) : 100,
    change24h: price ? Number(price.change_24h || 0) : 0,
    changePercent24h: price ? Number(price.change_percent_24h || 0) : 0,
    volume24h: price ? Number(price.volume || 0) : 0,
    marketCap: price?.market_cap ? Number(price.market_cap) : undefined,
    totalScore: Math.floor(Math.random() * 30 + 50),
    direction,
    confidence,
    confidenceBreakdown,
    signals,
    topContributors: signals
      .filter(s => s.direction === direction)
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 3)
      .map(s => ({ module: s.module, contribution: s.strength })),
    horizon,
    lastUpdated: price?.recorded_at || new Date().toISOString(),
  };
};

export const useSymbols = () => {
  return useQuery({
    queryKey: ['symbols'],
    queryFn: fetchSymbolsWithPrices,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};

export const useRankedAssets = (horizon: Horizon, direction: 'UP' | 'DOWN') => {
  const { data: symbols, isLoading, error } = useSymbols();

  const rankedAssets: RankedAsset[] = symbols
    ? symbols
        .map(s => transformToRankedAsset(s, horizon, direction))
        .sort((a, b) => b.totalScore - a.totalScore)
        .slice(0, 10)
    : [];

  return { data: rankedAssets, isLoading, error };
};

export const useWatchlist = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['watchlist', user?.id],
    queryFn: () => user ? fetchWatchlist(user.id) : Promise.resolve([]),
    enabled: !!user,
  });
};

export const useAddToWatchlist = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ 
      asset, 
      horizon 
    }: { 
      asset: RankedAsset; 
      horizon: Horizon;
    }) => {
      if (!user) throw new Error('Must be logged in');

      // Find the symbol ID from the database
      const symbols = queryClient.getQueryData<SymbolWithPrice[]>(['symbols']);
      const symbol = symbols?.find(s => s.ticker === asset.ticker);
      if (!symbol) throw new Error('Symbol not found');

      const getTargetDate = (h: Horizon): Date => {
        const now = new Date();
        switch (h) {
          case '1d': return addDays(now, 1);
          case '1w': return addWeeks(now, 1);
          case '1mo': return addMonths(now, 1);
          case '1y': return addYears(now, 1);
          default: return addWeeks(now, 1);
        }
      };

      return addToWatchlist({
        user_id: user.id,
        symbol_id: symbol.id,
        horizon: horizon,
        prediction_direction: asset.direction,
        entry_price: asset.lastPrice,
        entry_price_source: 'MarketLens',
        target_end_time: getTargetDate(horizon).toISOString(),
        confidence_at_save: asset.confidence,
        expected_move: null,
        model_snapshot_id: null,
        exit_price: null,
        return_pct: null,
        hit: null,
        result_locked_at: null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['watchlist'] });
    },
  });
};

export const useRemoveFromWatchlist = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: removeFromWatchlist,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['watchlist'] });
    },
  });
};

export const useRefreshPrices = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: triggerPriceFetch,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['symbols'] });
    },
  });
};
