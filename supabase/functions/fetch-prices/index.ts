import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PriceData {
  ticker: string;
  price: number;
  change24h: number;
  changePercent24h: number;
  volume: number;
  marketCap?: number;
}

// Mock price data (in production, you'd call real APIs)
const getMockPrices = (tickers: string[]): PriceData[] => {
  const basePrices: Record<string, { price: number; volume: number; marketCap?: number }> = {
    'VOLVO-B': { price: 285.40, volume: 4500000, marketCap: 285000000000 },
    'ERIC-B': { price: 68.50, volume: 12000000, marketCap: 228000000000 },
    'SEB-A': { price: 142.80, volume: 3200000, marketCap: 315000000000 },
    'ATCO-A': { price: 178.60, volume: 5800000, marketCap: 654000000000 },
    'ASSA-B': { price: 312.40, volume: 2100000, marketCap: 347000000000 },
    'HM-B': { price: 156.20, volume: 7800000, marketCap: 252000000000 },
    'SAND': { price: 218.90, volume: 3400000, marketCap: 275000000000 },
    'HEXA-B': { price: 124.50, volume: 4200000, marketCap: 324000000000 },
    'INVE-B': { price: 278.30, volume: 2800000, marketCap: 856000000000 },
    'SWED-A': { price: 215.60, volume: 4100000, marketCap: 242000000000 },
    'ESSITY-B': { price: 282.10, volume: 1900000, marketCap: 198000000000 },
    'SKF-B': { price: 198.40, volume: 2600000, marketCap: 89000000000 },
    'TELIA': { price: 28.45, volume: 15000000, marketCap: 116000000000 },
    'KINV-B': { price: 89.20, volume: 1200000, marketCap: 24600000000 },
    'ELUX-B': { price: 78.60, volume: 3800000, marketCap: 22400000000 },
    'BTC': { price: 98450, volume: 45000000000, marketCap: 1920000000000 },
    'ETH': { price: 3420, volume: 18000000000, marketCap: 411000000000 },
    'SOL': { price: 198.50, volume: 4500000000, marketCap: 92000000000 },
    'XRP': { price: 2.45, volume: 8200000000, marketCap: 140000000000 },
    'ADA': { price: 0.98, volume: 1200000000, marketCap: 34500000000 },
    'AVAX': { price: 42.80, volume: 890000000, marketCap: 17200000000 },
    'DOT': { price: 8.45, volume: 420000000, marketCap: 12800000000 },
    'LINK': { price: 18.90, volume: 680000000, marketCap: 11400000000 },
    'XAU': { price: 2680, volume: 180000000000, marketCap: undefined },
    'XAG': { price: 31.20, volume: 5200000000, marketCap: undefined },
    'XPT': { price: 982, volume: 450000000, marketCap: undefined },
    'XPD': { price: 1045, volume: 320000000, marketCap: undefined },
  };

  return tickers.map(ticker => {
    const base = basePrices[ticker] || { price: 100, volume: 1000000 };
    // Add some random variation
    const variation = (Math.random() - 0.5) * 0.02; // ±1%
    const price = base.price * (1 + variation);
    const changePercent = (Math.random() - 0.5) * 6; // ±3%
    const change24h = base.price * (changePercent / 100);
    
    return {
      ticker,
      price: parseFloat(price.toFixed(2)),
      change24h: parseFloat(change24h.toFixed(2)),
      changePercent24h: parseFloat(changePercent.toFixed(2)),
      volume: base.volume * (0.8 + Math.random() * 0.4),
      marketCap: base.marketCap,
    };
  });
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get all active symbols
    const { data: symbols, error: symbolsError } = await supabase
      .from('symbols')
      .select('id, ticker')
      .eq('is_active', true);

    if (symbolsError) {
      console.error('Error fetching symbols:', symbolsError);
      return new Response(JSON.stringify({ error: 'Failed to fetch symbols' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!symbols || symbols.length === 0) {
      return new Response(JSON.stringify({ message: 'No symbols found', updated: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const tickers = symbols.map(s => s.ticker);
    const prices = getMockPrices(tickers);

    // Insert new price records
    const priceRecords = prices.map(p => {
      const symbol = symbols.find(s => s.ticker === p.ticker);
      return {
        symbol_id: symbol!.id,
        price: p.price,
        volume: p.volume,
        market_cap: p.marketCap,
        change_24h: p.change24h,
        change_percent_24h: p.changePercent24h,
        source: 'mock-api',
        recorded_at: new Date().toISOString(),
      };
    });

    const { error: insertError } = await supabase
      .from('raw_prices')
      .insert(priceRecords);

    if (insertError) {
      console.error('Error inserting prices:', insertError);
      return new Response(JSON.stringify({ error: 'Failed to insert prices' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Updated ${prices.length} prices`);
    
    return new Response(JSON.stringify({ 
      message: 'Prices updated', 
      updated: prices.length,
      timestamp: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
