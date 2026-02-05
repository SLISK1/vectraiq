import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type Symbol = Tables<'symbols'>;
export type RawPrice = Tables<'raw_prices'>;
export type WatchlistCase = Tables<'watchlist_cases'>;
export type Signal = Tables<'signals'>;

export interface SymbolWithPrice extends Symbol {
  latestPrice?: RawPrice;
}

// Fetch all symbols with their latest prices
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

  // Get the latest price for each symbol
  // Using a subquery approach to get the most recent price per symbol
  const symbolIds = symbols.map(s => s.id);
  
  const { data: prices, error: pricesError } = await supabase
    .from('raw_prices')
    .select('*')
    .in('symbol_id', symbolIds)
    .order('recorded_at', { ascending: false });

  if (pricesError) {
    console.error('Error fetching prices:', pricesError);
    // Continue without prices
  }

  // Map latest price to each symbol
  const latestPrices = new Map<string, RawPrice>();
  prices?.forEach(price => {
    if (!latestPrices.has(price.symbol_id)) {
      latestPrices.set(price.symbol_id, price);
    }
  });

  return symbols.map(symbol => ({
    ...symbol,
    latestPrice: latestPrices.get(symbol.id),
  }));
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
  const { data, error } = await supabase.functions.invoke('fetch-prices');
  
  if (error) {
    console.error('Error triggering price fetch:', error);
    throw error;
  }

  return data;
};
