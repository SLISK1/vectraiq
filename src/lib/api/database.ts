import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { FundamentalMetrics, SymbolMetadata } from "@/lib/analysis/types";

export type Symbol = Tables<'symbols'>;
export type RawPrice = Tables<'raw_prices'>;
export type WatchlistCase = Tables<'watchlist_cases'>;
export type Signal = Tables<'signals'>;

export interface SymbolWithPrice extends Symbol {
  latestPrice?: RawPrice;
  fundamentals?: FundamentalMetrics;
}

// Fetch all symbols with their latest prices
// Prioritizes price_history (real data) over raw_prices (may have fallback)
export const fetchSymbolsWithPrices = async (): Promise<SymbolWithPrice[]> => {
  // Get all symbols
  const { data: symbols, error: symbolsError } = await supabase
    .from('symbols')
    .select('*')
    .eq('is_active', true);

  if (symbolsError) {
    console.error('Error fetching symbols:', symbolsError);
    throw symbolsError;
  }

  if (!symbols || symbols.length === 0) {
    return [];
  }

  const symbolIds = symbols.map(s => s.id);
  
  // Get the latest raw prices
  const { data: rawPrices, error: rawPricesError } = await supabase
    .from('raw_prices')
    .select('*')
    .in('symbol_id', symbolIds)
    .order('recorded_at', { ascending: false });

  if (rawPricesError) {
    console.error('Error fetching raw prices:', rawPricesError);
  }

  // Map latest raw price to each symbol
  const latestRawPrices = new Map<string, RawPrice>();
  rawPrices?.forEach(price => {
    if (!latestRawPrices.has(price.symbol_id)) {
      latestRawPrices.set(price.symbol_id, price);
    }
  });

  // Get the latest price_history (which has validated data)
  // This is more accurate for Nordic stocks
  const { data: historyPrices, error: historyError } = await supabase
    .from('price_history')
    .select('symbol_id, date, close_price, open_price, high_price, low_price, volume, source')
    .in('symbol_id', symbolIds)
    .order('date', { ascending: false });

  if (historyError) {
    console.error('Error fetching price history:', historyError);
  }

  // Map latest history price to each symbol
  const latestHistoryPrices = new Map<string, {
    close: number;
    open: number;
    high: number;
    low: number;
    volume: number | null;
    date: string;
    source: string;
  }>();
  
  historyPrices?.forEach(price => {
    if (!latestHistoryPrices.has(price.symbol_id)) {
      latestHistoryPrices.set(price.symbol_id, {
        close: Number(price.close_price),
        open: Number(price.open_price),
        high: Number(price.high_price),
        low: Number(price.low_price),
        volume: price.volume ? Number(price.volume) : null,
        date: price.date,
        source: price.source,
      });
    }
  });

  return symbols.map(symbol => {
    // Parse fundamentals from metadata if available
    const metadata = symbol.metadata as SymbolMetadata | null;
    const fundamentals = metadata?.fundamentals;
    
    const rawPrice = latestRawPrices.get(symbol.id);
    const historyPrice = latestHistoryPrices.get(symbol.id);
    
    // Use history price if raw price is from fallback source OR if history is newer
    // History prices are more accurate than fallback
    const useHistoryPrice = historyPrice && (
      rawPrice?.source === 'fallback' || 
      rawPrice?.source === 'nav_estimate' ||
      !rawPrice
    );
    
    let finalPrice: RawPrice | undefined = rawPrice;
    
    if (useHistoryPrice && historyPrice) {
      // Calculate change from previous day using history data
      const prevDayPrice = historyPrice.open;
      const change = historyPrice.close - prevDayPrice;
      const changePercent = prevDayPrice > 0 ? (change / prevDayPrice) * 100 : 0;
      
      // Create a synthetic RawPrice from history data
      finalPrice = {
        id: `history-${symbol.id}`,
        symbol_id: symbol.id,
        price: historyPrice.close,
        open_price: historyPrice.open,
        high_price: historyPrice.high,
        low_price: historyPrice.low,
        change_24h: change,
        change_percent_24h: changePercent,
        volume: historyPrice.volume,
        market_cap: rawPrice?.market_cap || null,
        source: historyPrice.source,
        recorded_at: historyPrice.date,
        created_at: historyPrice.date,
      };
    }
    
    return {
      ...symbol,
      latestPrice: finalPrice,
      fundamentals: fundamentals ? {
        peRatio: fundamentals.peRatio,
        pbRatio: fundamentals.pbRatio,
        roe: fundamentals.roe,
        debtToEquity: fundamentals.debtToEquity,
        dividendYield: fundamentals.dividendYield,
        marketCap: fundamentals.marketCap,
        revenueGrowth: fundamentals.revenueGrowth,
        earningsGrowth: fundamentals.earningsGrowth,
        week52High: fundamentals.week52High,
        week52Low: fundamentals.week52Low,
        lastUpdated: fundamentals.lastUpdated,
      } : undefined,
    };
  });
};

// Fetch user's watchlist
export const fetchWatchlist = async (userId: string): Promise<WatchlistCase[]> => {
  const { data, error } = await supabase
    .from('watchlist_cases')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching watchlist:', error);
    throw error;
  }

  return data || [];
};

// Add to watchlist
export const addToWatchlist = async (watchlistCase: Omit<WatchlistCase, 'id' | 'created_at' | 'updated_at'>): Promise<WatchlistCase> => {
  const { data, error } = await supabase
    .from('watchlist_cases')
    .insert(watchlistCase)
    .select()
    .single();

  if (error) {
    console.error('Error adding to watchlist:', error);
    throw error;
  }

  return data;
};

// Remove from watchlist
export const removeFromWatchlist = async (id: string): Promise<void> => {
  const { error } = await supabase
    .from('watchlist_cases')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error removing from watchlist:', error);
    throw error;
  }
};

// Update watchlist case with result
export const updateWatchlistResult = async (
  id: string, 
  exitPrice: number, 
  returnPct: number, 
  hit: boolean
): Promise<void> => {
  const { error } = await supabase
    .from('watchlist_cases')
    .update({
      exit_price: exitPrice,
      return_pct: returnPct,
      hit,
      result_locked_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    console.error('Error updating watchlist result:', error);
    throw error;
  }
};

// Trigger price fetch
export const triggerPriceFetch = async (): Promise<{ updated: number }> => {
  // Check if user is authenticated before calling the edge function
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    console.log('Skipping price fetch: no authenticated session');
    return { updated: 0 };
  }

  const { data, error } = await supabase.functions.invoke('fetch-prices');
  
  if (error) {
    console.error('Error triggering price fetch:', error);
    throw error;
  }

  return data;
};
