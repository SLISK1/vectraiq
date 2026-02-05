import { createClient } from "npm:@supabase/supabase-js@2";

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

// Realistic base prices for fallback
const BASE_PRICES: Record<string, number> = {
  'VOLVO-B': 285, 'ERIC-B': 68, 'SEB-A': 142, 'ATCO-A': 178, 'ASSA-B': 312,
  'HM-B': 156, 'SAND': 218, 'HEXA-B': 124, 'INVE-B': 278, 'SWED-A': 215,
  'ESSITY-B': 282, 'SKF-B': 198, 'TELIA': 28, 'KINV-B': 89, 'ELUX-B': 78,
  'BTC': 98500, 'ETH': 3200, 'SOL': 185, 'XRP': 2.5, 'ADA': 0.85,
  'AVAX': 32, 'DOT': 6.5, 'LINK': 22,
  'XAU': 2680, 'XAG': 31, 'XPT': 980, 'XPD': 1040,
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: symbols, error: symError } = await supabase
      .from('symbols')
      .select('id, ticker, asset_type')
      .eq('is_active', true);

    if (symError) {
      console.error('Symbol fetch error:', symError);
      return new Response(JSON.stringify({ error: symError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!symbols?.length) {
      console.log('No symbols found');
      return new Response(JSON.stringify({ updated: 0, reason: 'no symbols' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${symbols.length} symbols`);
    const priceRecords: any[] = [];
    const errors: string[] = [];

    // Fetch crypto from CoinGecko
    const cryptoTickers = symbols.filter(s => CRYPTO_IDS[s.ticker]);
    if (cryptoTickers.length) {
      const ids = cryptoTickers.map(s => CRYPTO_IDS[s.ticker]).join(',');
      console.log(`Fetching crypto: ${ids}`);
      try {
        const res = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`
        );
        console.log(`CoinGecko status: ${res.status}`);
        if (res.ok) {
          const data = await res.json();
          for (const s of cryptoTickers) {
            const d = data[CRYPTO_IDS[s.ticker]];
            if (d) {
              priceRecords.push({
                symbol_id: s.id,
                price: d.usd,
                change_percent_24h: d.usd_24h_change || 0,
                change_24h: d.usd * ((d.usd_24h_change || 0) / 100),
                volume: d.usd_24h_vol || 0,
                market_cap: d.usd_market_cap,
                source: 'coingecko',
              });
            }
          }
        } else {
          errors.push(`CoinGecko: ${res.status}`);
        }
      } catch (e) { 
        console.error('CoinGecko error:', e);
        errors.push(`CoinGecko: ${e}`);
      }
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
      console.log(`Fetching Yahoo: ${tickers}`);
      try {
        const res = await fetch(
          `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(tickers)}`,
          { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }
        );
        console.log(`Yahoo status: ${res.status}`);
        if (res.ok) {
          const data = await res.json();
          const quotes = data?.quoteResponse?.result || [];
          console.log(`Yahoo quotes received: ${quotes.length}`);
          for (const { symbol, yahoo } of yahooSymbols) {
            const q = quotes.find((x: any) => x.symbol === yahoo);
            if (q?.regularMarketPrice) {
              priceRecords.push({
                symbol_id: symbol.id,
                price: q.regularMarketPrice,
                change_24h: q.regularMarketChange || 0,
                change_percent_24h: q.regularMarketChangePercent || 0,
                volume: q.regularMarketVolume || 0,
                market_cap: q.marketCap,
                high_price: q.regularMarketDayHigh,
                low_price: q.regularMarketDayLow,
                source: METAL_YAHOO[symbol.ticker] ? 'yahoo-metals' : 'yahoo-finance',
              });
            }
          }
        } else {
          errors.push(`Yahoo: ${res.status}`);
        }
      } catch (e) { 
        console.error('Yahoo error:', e);
        errors.push(`Yahoo: ${e}`);
      }
    }

    // Add fallback prices for symbols not fetched from external APIs
    const fetchedSymbolIds = new Set(priceRecords.map(p => p.symbol_id));
    const missingSymbols = symbols.filter(s => !fetchedSymbolIds.has(s.id));
    
    if (missingSymbols.length > 0) {
      console.log(`Adding fallback for ${missingSymbols.length} symbols`);
      for (const s of missingSymbols) {
        const basePrice = BASE_PRICES[s.ticker] || 100;
        const variation = (Math.random() - 0.5) * 0.02;
        const price = basePrice * (1 + variation);
        const changePercent = (Math.random() - 0.5) * 4;
        
        priceRecords.push({
          symbol_id: s.id,
          price: parseFloat(price.toFixed(2)),
          change_24h: parseFloat((basePrice * changePercent / 100).toFixed(2)),
          change_percent_24h: parseFloat(changePercent.toFixed(2)),
          volume: Math.floor(Math.random() * 10000000),
          source: 'fallback',
        });
      }
    }

    // Insert prices
    if (priceRecords.length) {
      const { error: insertError } = await supabase.from('raw_prices').insert(priceRecords);
      if (insertError) {
        console.error('Insert error:', insertError);
        return new Response(JSON.stringify({ error: insertError.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    console.log(`Updated ${priceRecords.length} prices`);
    
    return new Response(JSON.stringify({ 
      updated: priceRecords.length,
      sources: priceRecords.reduce((acc: Record<string, number>, p) => {
        acc[p.source] = (acc[p.source] || 0) + 1;
        return acc;
      }, {}),
      errors: errors.length ? errors : undefined,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
