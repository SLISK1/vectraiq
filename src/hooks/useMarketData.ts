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
import { initMacroCache } from '@/lib/analysis/macro';

// Initialize macro cache once at module load
initMacroCache().catch(() => {});

// Minimum daily volume for crypto (USD) — filter out illiquid assets
const CRYPTO_MIN_VOLUME_USD = 10_000_000;

// Portfolio holding type
export interface PortfolioHolding {
  id: string;
  user_id: string;
  symbol_id: string;
  quantity: number;
  purchase_price: number;
  purchase_date: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

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

// Z-score normalization: compute z-score of totalScore within same sector + asset_type bucket
const computeZScores = (assets: RankedAsset[]): Map<string, number> => {
  const groups = new Map<string, RankedAsset[]>();
  for (const a of assets) {
    const key = `${a.type}:${a.sector || 'unknown'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(a);
  }
  
  const zScores = new Map<string, number>();
  for (const [, group] of groups) {
    if (group.length < 2) {
      for (const a of group) zScores.set(a.ticker, 0);
      continue;
    }
    const scores = group.map(a => a.totalScore);
    const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
    const variance = scores.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / scores.length;
    const std = Math.sqrt(variance) || 1;
    for (const a of group) {
      zScores.set(a.ticker, Math.round(((a.totalScore - mean) / std) * 10) / 10);
    }
  }
  return zScores;
};

// Transform database symbols to RankedAsset format with real analysis
const transformToRankedAsset = async (
  symbol: SymbolWithPrice, 
  horizon: Horizon, 
  filterDirection: 'UP' | 'DOWN',
  priceHistoryCache: Map<string, PriceData[]>,
  avCacheMap?: Map<string, { indicator_type: string; data: any }[]>
): Promise<RankedAsset | null> => {
  const price = symbol.latestPrice;
  const currentPrice = price ? Number(price.price) : 0;
  
  // Liquidity filter for crypto: skip if volume < 10M USD
  if (symbol.asset_type === 'crypto') {
    const vol = price?.volume ? Number(price.volume) : 0;
    const marketCap = price?.market_cap ? Number(price.market_cap) : 0;
    if (vol < CRYPTO_MIN_VOLUME_USD && marketCap < CRYPTO_MIN_VOLUME_USD * 10) {
      console.log(`Skipping crypto ${symbol.ticker}: insufficient liquidity (vol: ${vol})`);
      return null;
    }
  }
  
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
  
  const avCache = avCacheMap?.get(symbol.id);
  
  const context = createAnalysisContext(
    symbol.ticker,
    symbol.name,
    symbol.asset_type as 'stock' | 'crypto' | 'metal' | 'fund',
    symbol.currency,
    currentPrice,
    priceHistory,
    horizon,
    symbol.fundamentals,
    avCache
  );
  
  const analysis = runAnalysis(context);
  
  if (analysis.direction !== filterDirection && analysis.direction !== 'NEUTRAL') {
    return null;
  }
  
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
    type: symbol.asset_type as 'stock' | 'crypto' | 'metal' | 'fund',
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

      // Fetch Alpha Vantage indicator cache
      let avCacheMap: Map<string, { indicator_type: string; data: any }[]> | undefined;
      try {
        const { data: avData } = await supabase
          .from('alpha_indicators_cache')
          .select('symbol_id, indicator_type, data')
          .in('symbol_id', symbols.map(s => s.id))
          .gt('valid_until', new Date().toISOString());
        
        if (avData && avData.length > 0) {
          avCacheMap = new Map();
          for (const row of avData) {
            const existing = avCacheMap.get(row.symbol_id) || [];
            existing.push({ indicator_type: row.indicator_type, data: row.data });
            avCacheMap.set(row.symbol_id, existing);
          }
          console.log(`AV cache: ${avCacheMap.size} symbols with enriched indicators`);
        }
      } catch (e) {
        console.log('AV cache fetch failed (non-critical):', e);
      }
      
      // Transform symbols with concurrency limit to avoid browser thread saturation
      const CONCURRENCY = 10;
      const results: (RankedAsset | null)[] = [];
      for (let i = 0; i < symbols.length; i += CONCURRENCY) {
        const batch = symbols.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.all(
          batch.map(s => transformToRankedAsset(s, horizon, direction, priceHistoryCache, avCacheMap))
        );
        results.push(...batchResults);
      }
      
      const validAssets = results.filter((a): a is RankedAsset => a !== null);
      
      // Compute z-scores within peer groups
      const zScores = computeZScores(validAssets);
      
      return validAssets
        .map(a => ({ ...a, peerZScore: zScores.get(a.ticker) ?? 0 }))
        .sort((a, b) => b.totalScore - a.totalScore);
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
        excess_return: null,
        baseline_ticker: null,
        baseline_entry_price: null,
        baseline_exit_price: null,
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

// Add a new symbol to the database
export const useAddSymbol = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ticker: string) => {
      const { data, error } = await supabase.functions.invoke('add-symbol', {
        body: { ticker },
      });

      if (error) {
        console.error('Error adding symbol:', error);
        // Parse error message from edge function response
        let errorMessage = `Kunde inte lägga till ${ticker}.`;
        try {
          const parsed = JSON.parse(error.message || '{}');
          if (parsed.error) errorMessage = parsed.error;
        } catch {
          // Check if the context has the error
          if (data?.error) errorMessage = data.error;
        }
        throw new Error(errorMessage);
      }

      // Edge function returns error in data when status >= 400
      if (data?.error) {
        throw new Error(data.error);
      }

      return data;
    },
    onSuccess: () => {
      // Invalidate symbols to refresh the list
      queryClient.invalidateQueries({ queryKey: ['symbols'] });
      queryClient.invalidateQueries({ queryKey: ['rankedAssets'] });
    },
  });
};

// Portfolio hooks
export const usePortfolio = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['portfolio', user?.id],
    queryFn: async () => {
      if (!user) return [];
      
      const { data, error } = await supabase
        .from('portfolio_holdings')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching portfolio:', error);
        throw error;
      }

      return data as PortfolioHolding[];
    },
    enabled: !!user,
  });
};

export const useAddHolding = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (data: { 
      symbolId: string; 
      quantity: number; 
      purchasePrice: number; 
      purchaseDate: string; 
      notes?: string 
    }) => {
      if (!user) throw new Error('Must be logged in');

      const { data: holding, error } = await supabase
        .from('portfolio_holdings')
        .insert({
          user_id: user.id,
          symbol_id: data.symbolId,
          quantity: data.quantity,
          purchase_price: data.purchasePrice,
          purchase_date: data.purchaseDate,
          notes: data.notes || null,
        })
        .select()
        .single();

      if (error) {
        console.error('Error adding holding:', error);
        throw error;
      }

      return holding;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
    },
  });
};

export const useDeleteHolding = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('portfolio_holdings')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Error deleting holding:', error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
    },
  });
};

export const useUpdateHolding = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { 
      id: string;
      data: { 
        quantity: number; 
        purchasePrice: number; 
        purchaseDate: string; 
        notes?: string 
      }
    }) => {
      const { data: holding, error } = await supabase
        .from('portfolio_holdings')
        .update({
          quantity: data.quantity,
          purchase_price: data.purchasePrice,
          purchase_date: data.purchaseDate,
          notes: data.notes || null,
        })
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error('Error updating holding:', error);
        throw error;
      }

      return holding;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
    },
  });
};
