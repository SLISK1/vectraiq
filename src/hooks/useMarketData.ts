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
import { Horizon, RankedAsset, Direction } from '@/types/market';
import { addDays, addWeeks, addMonths, addYears } from 'date-fns';
import { runAnalysis, createAnalysisContext, PriceData } from '@/lib/analysis';

// Generate mock price history for analysis (until we have real historical data)
const generateMockPriceHistory = (
  currentPrice: number,
  days: number = 60
): PriceData[] => {
  const history: PriceData[] = [];
  let price = currentPrice * (0.85 + Math.random() * 0.3); // Start 85-115% of current
  
  for (let i = days; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    
    // Random walk with slight upward bias
    const change = (Math.random() - 0.48) * 0.03;
    price = price * (1 + change);
    
    const volatility = 0.02;
    const high = price * (1 + Math.random() * volatility);
    const low = price * (1 - Math.random() * volatility);
    const open = low + Math.random() * (high - low);
    const close = price;
    
    history.push({
      price: close,
      open,
      high,
      low,
      close,
      volume: Math.floor(Math.random() * 1000000 + 100000),
      timestamp: date.toISOString(),
    });
  }
  
  // Adjust last price to match current price
  if (history.length > 0) {
    const lastEntry = history[history.length - 1];
    const adjustment = currentPrice / lastEntry.close;
    history.forEach(h => {
      h.price *= adjustment;
      h.open = (h.open || h.price) * adjustment;
      h.high = (h.high || h.price) * adjustment;
      h.low = (h.low || h.price) * adjustment;
      h.close = (h.close || h.price) * adjustment;
    });
  }
  
  return history;
};

// Transform database symbols to RankedAsset format with real analysis
const transformToRankedAsset = (
  symbol: SymbolWithPrice, 
  horizon: Horizon, 
  filterDirection: 'UP' | 'DOWN'
): RankedAsset | null => {
  const price = symbol.latestPrice;
  const currentPrice = price ? Number(price.price) : 100;
  
  // Generate mock price history for analysis
  const priceHistory = generateMockPriceHistory(currentPrice, 60);
  
  // Create analysis context
  const context = createAnalysisContext(
    symbol.ticker,
    symbol.name,
    symbol.asset_type as 'stock' | 'crypto' | 'metal',
    symbol.currency,
    currentPrice,
    priceHistory,
    horizon
  );
  
  // Run full analysis
  const analysis = runAnalysis(context);
  
  // Only include assets that match the filter direction
  // For NEUTRAL, we'll include them with lower scores
  if (analysis.direction !== filterDirection && analysis.direction !== 'NEUTRAL') {
    return null;
  }
  
  return {
    ticker: symbol.ticker,
    name: symbol.name,
    type: symbol.asset_type as 'stock' | 'crypto' | 'metal',
    sector: symbol.sector || undefined,
    exchange: symbol.exchange || undefined,
    currency: symbol.currency,
    lastPrice: currentPrice,
    change24h: price ? Number(price.change_24h || 0) : 0,
    changePercent24h: price ? Number(price.change_percent_24h || 0) : 0,
    volume24h: price ? Number(price.volume || 0) : 0,
    marketCap: price?.market_cap ? Number(price.market_cap) : undefined,
    totalScore: analysis.totalScore,
    direction: analysis.direction === 'NEUTRAL' ? filterDirection : analysis.direction,
    confidence: analysis.confidence,
    confidenceBreakdown: analysis.confidenceBreakdown,
    signals: analysis.signals,
    topContributors: analysis.topContributors,
    horizon,
    lastUpdated: analysis.lastUpdated,
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
        .filter((a): a is RankedAsset => a !== null)
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
