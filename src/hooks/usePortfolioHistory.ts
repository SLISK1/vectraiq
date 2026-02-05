import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { usePortfolio, useSymbols, type PortfolioHolding } from './useMarketData';
import type { SymbolWithPrice } from '@/lib/api/database';
import { format, subDays, eachDayOfInterval, parseISO, isAfter, isBefore, startOfDay } from 'date-fns';

export interface PortfolioHistoryPoint {
  date: string;
  value: number;
  invested: number;
  profitLoss: number;
  profitLossPct: number;
}

// Fetch price history for multiple symbols at once
const fetchPriceHistoryForSymbols = async (symbolIds: string[], days: number = 90) => {
  const startDate = subDays(new Date(), days);
  const startDateStr = format(startDate, 'yyyy-MM-dd');

  const { data, error } = await supabase
    .from('price_history')
    .select('symbol_id, date, close_price')
    .in('symbol_id', symbolIds)
    .gte('date', startDateStr)
    .order('date', { ascending: true });

  if (error) {
    console.error('Error fetching price history:', error);
    return new Map<string, Map<string, number>>();
  }

  // Group by symbol_id -> date -> close_price
  const priceMap = new Map<string, Map<string, number>>();
  for (const row of data || []) {
    if (!priceMap.has(row.symbol_id)) {
      priceMap.set(row.symbol_id, new Map());
    }
    priceMap.get(row.symbol_id)!.set(row.date, Number(row.close_price));
  }

  return priceMap;
};

// Calculate portfolio value for each day
const calculatePortfolioHistory = (
  holdings: PortfolioHolding[],
  symbols: SymbolWithPrice[],
  priceHistory: Map<string, Map<string, number>>,
  days: number = 90
): PortfolioHistoryPoint[] => {
  if (holdings.length === 0) return [];

  const today = startOfDay(new Date());
  const startDate = subDays(today, days);
  
  // Generate all dates in the range
  const dateRange = eachDayOfInterval({ start: startDate, end: today });
  
  const history: PortfolioHistoryPoint[] = [];

  for (const date of dateRange) {
    const dateStr = format(date, 'yyyy-MM-dd');
    let totalValue = 0;
    let totalInvested = 0;

    for (const holding of holdings) {
      const purchaseDate = parseISO(holding.purchase_date);
      
      // Only count holdings that were purchased on or before this date
      if (isAfter(purchaseDate, date)) continue;

      const symbol = symbols.find(s => s.id === holding.symbol_id);
      if (!symbol) continue;

      // Get price for this date
      const symbolPrices = priceHistory.get(holding.symbol_id);
      let price: number | undefined;

      if (symbolPrices) {
        // Try to get exact date price, or find nearest previous price
        price = symbolPrices.get(dateStr);
        
        if (!price) {
          // Find the most recent price before this date
          const sortedDates = Array.from(symbolPrices.keys()).sort();
          for (const priceDate of sortedDates) {
            if (isBefore(parseISO(priceDate), date) || priceDate === dateStr) {
              price = symbolPrices.get(priceDate);
            }
          }
        }
      }

      // Fallback to purchase price if no historical price available
      if (!price) {
        price = holding.purchase_price;
      }

      totalValue += holding.quantity * price;
      totalInvested += holding.quantity * holding.purchase_price;
    }

    // Only add points where we have holdings
    if (totalInvested > 0) {
      const profitLoss = totalValue - totalInvested;
      history.push({
        date: dateStr,
        value: totalValue,
        invested: totalInvested,
        profitLoss,
        profitLossPct: (profitLoss / totalInvested) * 100,
      });
    }
  }

  return history;
};

export const usePortfolioHistory = (days: number = 90) => {
  const { data: portfolio } = usePortfolio();
  const { data: symbols } = useSymbols();

  return useQuery({
    queryKey: ['portfolioHistory', days, portfolio?.map(h => h.id).join(',')],
    queryFn: async () => {
      if (!portfolio || portfolio.length === 0 || !symbols) {
        return [];
      }

      const symbolIds = [...new Set(portfolio.map(h => h.symbol_id))];
      const priceHistory = await fetchPriceHistoryForSymbols(symbolIds, days);
      
      return calculatePortfolioHistory(portfolio, symbols, priceHistory, days);
    },
    enabled: !!portfolio && portfolio.length > 0 && !!symbols,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};
