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
import { fetchPriceHistory, triggerHistoryFetch, getHistoryDaysForHorizon, type PriceHistoryPoint } from '@/lib/api/priceHistory';
import { Horizon, RankedAsset, Direction } from '@/types/market';
import { addDays, addWeeks, addMonths, addYears } from 'date-fns';
import { runAnalysis, createAnalysisContext, PriceData } from '@/lib/analysis';
import { supabase } from '@/integrations/supabase/client';

// Convert price history to analysis format
const convertToAnalysisPriceData = (history: PriceHistoryPoint[]): PriceData[] => {
  return history.map(h => ({
    price: h.close,
    open: h.open,
    high: h.high,
    low: h.low,
    close: h.close,
    volume: h.volume || 0,
    timestamp: h.date,
  }));
};

// No mock data - only use real price history from database

// Transform database symbols to RankedAsset format with real analysis
const transformToRankedAsset = async (
  symbol: SymbolWithPrice, 
  horizon: Horizon, 
  filterDirection: 'UP' | 'DOWN',
  priceHistoryCache: Map<string, PriceData[]>
): Promise<RankedAsset | null> => {
  const price = symbol.latestPrice;
  const currentPrice = price ? Number(price.price) : 0;
  
  // Only use real price history - skip if not enough data
  const priceHistory = priceHistoryCache.get(symbol.id);
  if (!priceHistory || priceHistory.length < 10) {
    console.log(`Skipping ${symbol.ticker}: insufficient price history (${priceHistory?.length || 0} points)`);
    return null;
  }
  
  if (currentPrice <= 0) {
    console.log(`Skipping ${symbol.ticker}: no valid current price`);
    return null;
  }
  
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
  if (analysis.direction !== filterDirection && analysis.direction !== 'NEUTRAL') {
    return null;
  }
  
  // Helper to get market cap category
  const getMarketCapCategory = (marketCap?: number): 'small' | 'medium' | 'large' => {
    if (!marketCap) return 'small';
    if (marketCap >= 10_000_000_000) return 'large';
    if (marketCap >= 2_000_000_000) return 'medium';
    return 'small';
  };

  const marketCapValue = price?.market_cap ? Number(price.market_cap) : undefined;
  
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
    marketCap: marketCapValue,
    marketCapCategory: getMarketCapCategory(marketCapValue),
    totalScore: analysis.totalScore,
    direction: analysis.direction === 'NEUTRAL' ? filterDirection : analysis.direction,
    confidence: analysis.confidence,
    confidenceBreakdown: analysis.confidenceBreakdown,
    signals: analysis.signals,
    topContributors: analysis.topContributors,
    horizon,
    lastUpdated: analysis.lastUpdated,
    predictedReturns: analysis.predictedReturns,
    trendPrediction: analysis.trendPrediction,
    aiSummary: analysis.aiSummary,
  };
};

// Fetch all price history for symbols (handles pagination to avoid 1000 row limit)
const fetchAllPriceHistory = async (symbolIds: string[], days: number = 60): Promise<Map<string, PriceData[]>> => {
  const cache = new Map<string, PriceData[]>();
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split('T')[0];
  
  console.log(`Fetching price history for ${symbolIds.length} symbols, from ${startDateStr}`);
  
  // Fetch in batches to avoid row limits - batch by symbol groups
  const batchSize = 10; // Process 10 symbols at a time
  
  for (let i = 0; i < symbolIds.length; i += batchSize) {
    const batchIds = symbolIds.slice(i, i + batchSize);
    
    const { data, error } = await supabase
      .from('price_history')
      .select('symbol_id, date, open_price, high_price, low_price, close_price, volume')
      .in('symbol_id', batchIds)
      .gte('date', startDateStr)
      .order('date', { ascending: true });
    
    if (error) {
      console.error(`Error fetching price history batch ${i}:`, error);
      continue;
    }
    
    // Group by symbol_id
    for (const row of data || []) {
      const existing = cache.get(row.symbol_id) || [];
      existing.push({
        price: Number(row.close_price),
        open: Number(row.open_price),
        high: Number(row.high_price),
        low: Number(row.low_price),
        close: Number(row.close_price),
        volume: row.volume ? Number(row.volume) : 0,
        timestamp: row.date,
      });
      cache.set(row.symbol_id, existing);
    }
  }
  
  console.log(`Price history cache has ${cache.size} unique symbols with data`);
  
  return cache;
};

export const useSymbols = () => {
  return useQuery({
    queryKey: ['symbols'],
    queryFn: fetchSymbolsWithPrices,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};

export const useRankedAssets = (horizon: Horizon, direction: 'UP' | 'DOWN') => {
  const { data: symbols } = useSymbols();
  
  // Use separate query for ranked assets to handle async transformation
  return useQuery({
    queryKey: ['rankedAssets', horizon, direction, symbols?.map(s => s.id).join(',')],
    queryFn: async () => {
      if (!symbols || symbols.length === 0) return [];
      
      // Fetch price history for all symbols
      const days = getHistoryDaysForHorizon(horizon);
      const priceHistoryCache = await fetchAllPriceHistory(
        symbols.map(s => s.id),
        days
      );
      
      // Transform all symbols with their history
      const promises = symbols.map(s => 
        transformToRankedAsset(s, horizon, direction, priceHistoryCache)
      );
      const results = await Promise.all(promises);
      
      return results
        .filter((a): a is RankedAsset => a !== null)
        .sort((a, b) => b.totalScore - a.totalScore)
        .slice(0, 10);
    },
    enabled: !!symbols && symbols.length > 0,
    staleTime: 1000 * 60 * 2, // 2 minutes
  });
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
