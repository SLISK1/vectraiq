import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Crypto ticker to CoinGecko ID mapping
const CRYPTO_IDS: Record<string, string> = {
  'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana', 'XRP': 'ripple',
  'ADA': 'cardano', 'AVAX': 'avalanche-2', 'DOT': 'polkadot', 'LINK': 'chainlink',
};

// Metal futures symbols for Yahoo
const METAL_YAHOO: Record<string, string> = {
  'XAU': 'GC=F', 'XAG': 'SI=F', 'XPT': 'PL=F', 'XPD': 'PA=F',
};

// Swedish stock suffixes
const SWEDISH_STOCKS = ['VOLVO-B', 'ERIC-B', 'SEB-A', 'ATCO-A', 'ASSA-B', 'HM-B', 
  'SAND', 'HEXA-B', 'INVE-B', 'SWED-A', 'ESSITY-B', 'SKF-B', 'TELIA', 'KINV-B', 'ELUX-B'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: symbols } = await supabase
      .from('symbols')
      .select('id, ticker, asset_type')
      .eq('is_active', true);

    if (!symbols?.length) {
      return new Response(JSON.stringify({ updated: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const priceRecords: any[] = [];

    // Fetch crypto from CoinGecko
    const cryptoTickers = symbols.filter(s => CRYPTO_IDS[s.ticker]);
    if (cryptoTickers.length) {
      const ids = cryptoTickers.map(s => CRYPTO_IDS[s.ticker]).join(',');
      try {
        const res = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`
        );
        if (res.ok) {
          const data = await res.json();
          for (const s of cryptoTickers) {
            const d = data[CRYPTO_IDS[s.ticker]];
            if (d) {
              priceRecords.push({
                symbol_id: s.id,
                price: d.usd,
                change_percent_24h: d.usd_24h_change,
                change_24h: d.usd * (d.usd_24h_change / 100),
                volume: d.usd_24h_vol,
                market_cap: d.usd_market_cap,
                source: 'coingecko',
              });
            }
          }
        }
      } catch (e) { console.error('CoinGecko error:', e); }
    }

    // Fetch stocks and metals from Yahoo Finance
    const yahooSymbols: { symbol: any; yahoo: string }[] = [];
    for (const s of symbols) {
      if (METAL_YAHOO[s.ticker]) {
        yahooSymbols.push({ symbol: s, yahoo: METAL_YAHOO[s.ticker] });
      } else if (SWEDISH_STOCKS.includes(s.ticker)) {
        yahooSymbols.push({ symbol: s, yahoo: `${s.ticker}.ST` });
      }
    }

    if (yahooSymbols.length) {
      const tickers = yahooSymbols.map(x => x.yahoo).join(',');
      try {
        const res = await fetch(
          `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(tickers)}`,
          { headers: { 'User-Agent': 'Mozilla/5.0' } }
        );
        if (res.ok) {
          const data = await res.json();
          const quotes = data?.quoteResponse?.result || [];
          for (const { symbol, yahoo } of yahooSymbols) {
            const q = quotes.find((x: any) => x.symbol === yahoo);
            if (q?.regularMarketPrice) {
              priceRecords.push({
                symbol_id: symbol.id,
                price: q.regularMarketPrice,
                change_24h: q.regularMarketChange,
                change_percent_24h: q.regularMarketChangePercent,
                volume: q.regularMarketVolume,
                market_cap: q.marketCap,
                high_price: q.regularMarketDayHigh,
                low_price: q.regularMarketDayLow,
                source: METAL_YAHOO[symbol.ticker] ? 'yahoo-metals' : 'yahoo-finance',
              });
            }
          }
        }
      } catch (e) { console.error('Yahoo error:', e); }
    }

    // Insert prices
    if (priceRecords.length) {
      await supabase.from('raw_prices').insert(priceRecords);
    }

    console.log(`Updated ${priceRecords.length} prices`);
    
    return new Response(JSON.stringify({ updated: priceRecords.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: 'Server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
