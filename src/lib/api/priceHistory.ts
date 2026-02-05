import { supabase } from "@/integrations/supabase/client";
import type { Horizon } from "@/types/market";

export interface PriceHistoryPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

// Fetch historical price data for a symbol
export const fetchPriceHistory = async (
  symbolId: string,
  days: number = 60
): Promise<PriceHistoryPoint[]> => {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const { data, error } = await supabase
    .from('price_history')
    .select('date, open_price, high_price, low_price, close_price, volume')
    .eq('symbol_id', symbolId)
    .gte('date', startDate.toISOString().split('T')[0])
    .order('date', { ascending: true });

  if (error) {
    console.error('Error fetching price history:', error);
    return [];
  }

  return (data || []).map(row => ({
    date: row.date,
    open: Number(row.open_price),
    high: Number(row.high_price),
    low: Number(row.low_price),
    close: Number(row.close_price),
    volume: row.volume ? Number(row.volume) : undefined,
  }));
};

// Trigger historical data fetch via edge function
export const triggerHistoryFetch = async (
  tickers?: string[],
  days: number = 60
): Promise<{ success: boolean; fetched?: any[]; errors?: string[] }> => {
  const { data, error } = await supabase.functions.invoke('fetch-history', {
    body: { tickers, days },
  });

  if (error) {
    console.error('Error triggering history fetch:', error);
    throw error;
  }

  return data;
};

// Get the number of days to fetch based on horizon
export const getHistoryDaysForHorizon = (horizon: Horizon): number => {
  switch (horizon) {
    case '1d': return 30;
    case '1w': return 60;
    case '1mo': return 120;
    case '1y': return 365;
    default: return 60;
  }
};
