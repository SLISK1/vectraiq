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

// Nordic stocks - ticker to Yahoo/Finnhub symbol mapping
const NORDIC_STOCKS: Record<string, { yahoo: string; finnhub: string }> = {
  'VOLV_B': { yahoo: 'VOLV-B.ST', finnhub: 'VOLV_B.ST' },
  'ERIC-B': { yahoo: 'ERIC-B.ST', finnhub: 'ERIC_B.ST' },
  'SEB-A': { yahoo: 'SEB-A.ST', finnhub: 'SEB_A.ST' },
  'ATCO-A': { yahoo: 'ATCO-A.ST', finnhub: 'ATCO_A.ST' },
  'ASSA-B': { yahoo: 'ASSA-B.ST', finnhub: 'ASSA_B.ST' },
  'HM-B': { yahoo: 'HM-B.ST', finnhub: 'HM_B.ST' },
  'SAND': { yahoo: 'SAND.ST', finnhub: 'SAND.ST' },
  'HEXA-B': { yahoo: 'HEXA-B.ST', finnhub: 'HEXA_B.ST' },
  'INVE-B': { yahoo: 'INVE-B.ST', finnhub: 'INVE_B.ST' },
  'SWED-A': { yahoo: 'SWED-A.ST', finnhub: 'SWED_A.ST' },
  'ESSITY-B': { yahoo: 'ESSITY-B.ST', finnhub: 'ESSITY_B.ST' },
  'SKF-B': { yahoo: 'SKF-B.ST', finnhub: 'SKF_B.ST' },
  'TELIA': { yahoo: 'TELIA.ST', finnhub: 'TELIA.ST' },
  'KINV-B': { yahoo: 'KINV-B.ST', finnhub: 'KINV_B.ST' },
  'ELUX-B': { yahoo: 'ELUX-B.ST', finnhub: 'ELUX_B.ST' },
  // New stocks from user portfolio
  'ABB': { yahoo: 'ABB.ST', finnhub: 'ABB.ST' },
  'ALFA': { yahoo: 'ALFA.ST', finnhub: 'ALFA.ST' },
  'CAST': { yahoo: 'CAST.ST', finnhub: 'CAST.ST' },
  'EQT': { yahoo: 'EQT.ST', finnhub: 'EQT.ST' },
  'FLAT': { yahoo: 'FLAT-B.ST', finnhub: 'FLAT_B.ST' },
  'NEOBO': { yahoo: 'NEOBO.ST', finnhub: 'NEOBO.ST' },
  'SITOW': { yahoo: 'SITOWS.HE', finnhub: 'SITOWS.HE' },
};

// US stocks 
const US_STOCKS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'JPM', 'V', 'JNJ'];

// Metal symbols
const METALS = ['XAU', 'XAG', 'XPT', 'XPD'];

// Swedish funds (no real-time API, using fallback with base NAV)
const SWEDISH_FUNDS: Record<string, number> = {
  'SWE-ASIA': 145.20, 'SWE-USA': 234.50, 'SWE-GLOB': 189.30,
  'SWE-TECH': 78.40, 'SWE-SMAL': 112.60, 'HB-ENRG': 95.80,
  'SPLT-INV': 298.40,
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

    const FINNHUB_API_KEY = Deno.env.get('FINNHUB_API_KEY');
    const ALPHA_VANTAGE_API_KEY = Deno.env.get('ALPHA_VANTAGE_API_KEY');

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
      return new Response(JSON.stringify({ updated: 0, reason: 'no symbols' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${symbols.length} symbols`);
    const priceRecords: any[] = [];
    const errors: string[] = [];

    // 1. Fetch crypto from CoinGecko (free, no API key)
    const cryptoTickers = symbols.filter(s => CRYPTO_IDS[s.ticker]);
    if (cryptoTickers.length) {
      const ids = cryptoTickers.map(s => CRYPTO_IDS[s.ticker]).join(',');
      console.log(`Fetching crypto from CoinGecko: ${ids}`);
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

    // 2. Fetch Nordic stocks from Finnhub
    if (FINNHUB_API_KEY) {
      const stockSymbols = symbols.filter(s => NORDIC_STOCKS[s.ticker]);
      console.log(`Fetching ${stockSymbols.length} Nordic stocks from Finnhub`);
      
      for (const s of stockSymbols) {
        try {
          const finnhubSymbol = NORDIC_STOCKS[s.ticker].finnhub;
          const res = await fetch(
            `https://finnhub.io/api/v1/quote?symbol=${finnhubSymbol}&token=${FINNHUB_API_KEY}`
          );
          
          if (res.ok) {
            const data = await res.json();
            if (data.c && data.c > 0) {
              priceRecords.push({
                symbol_id: s.id,
                price: data.c,
                change_24h: data.d || 0,
                change_percent_24h: data.dp || 0,
                high_price: data.h,
                low_price: data.l,
                open_price: data.o,
                volume: 0,
                source: 'finnhub',
              });
            }
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (e) {
          console.error(`Finnhub error for ${s.ticker}:`, e);
          errors.push(`Finnhub ${s.ticker}: ${e}`);
        }
      }
    } else {
      console.log('FINNHUB_API_KEY not configured, skipping Nordic stocks');
    }

    // 3. Fetch US stocks from Finnhub (free tier supports US stocks)
    if (FINNHUB_API_KEY) {
      const usStockSymbols = symbols.filter(s => US_STOCKS.includes(s.ticker));
      console.log(`Fetching ${usStockSymbols.length} US stocks from Finnhub`);
      
      for (const s of usStockSymbols) {
        try {
          const res = await fetch(
            `https://finnhub.io/api/v1/quote?symbol=${s.ticker}&token=${FINNHUB_API_KEY}`
          );
          
          if (res.ok) {
            const data = await res.json();
            if (data.c && data.c > 0) {
              priceRecords.push({
                symbol_id: s.id,
                price: data.c,
                change_24h: data.d || 0,
                change_percent_24h: data.dp || 0,
                high_price: data.h,
                low_price: data.l,
                open_price: data.o,
                volume: 0,
                source: 'finnhub',
              });
            }
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (e) {
          console.error(`Finnhub error for ${s.ticker}:`, e);
          errors.push(`Finnhub ${s.ticker}: ${e}`);
        }
      }
    }

    // 4. Fetch metals from Alpha Vantage
    if (ALPHA_VANTAGE_API_KEY) {
      const metalSymbols = symbols.filter(s => METALS.includes(s.ticker));
      console.log(`Fetching ${metalSymbols.length} metals from Alpha Vantage`);
      
      for (const s of metalSymbols) {
        try {
          // Use CURRENCY_EXCHANGE_RATE for metals (XAU/USD, etc.)
          const res = await fetch(
            `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${s.ticker}&to_currency=USD&apikey=${ALPHA_VANTAGE_API_KEY}`
          );
          
          if (res.ok) {
            const data = await res.json();
            const rate = data['Realtime Currency Exchange Rate'];
            if (rate?.['5. Exchange Rate']) {
              const price = parseFloat(rate['5. Exchange Rate']);
              priceRecords.push({
                symbol_id: s.id,
                price,
                change_24h: 0, // Alpha Vantage doesn't provide in this endpoint
                change_percent_24h: 0,
                volume: 0,
                source: 'alphavantage',
              });
            }
          }
          // Rate limit: 25 calls/day for free tier
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (e) {
          console.error(`Alpha Vantage error for ${s.ticker}:`, e);
          errors.push(`AlphaVantage ${s.ticker}: ${e}`);
        }
      }
    } else {
      console.log('ALPHA_VANTAGE_API_KEY not configured, skipping metals');
    }

    // 4. Add fallback for any symbols not fetched
    const fetchedSymbolIds = new Set(priceRecords.map(p => p.symbol_id));
    const missingSymbols = symbols.filter(s => !fetchedSymbolIds.has(s.id));
    
    if (missingSymbols.length > 0) {
      console.log(`Adding fallback for ${missingSymbols.length} missing symbols`);
      const BASE_PRICES: Record<string, number> = {
        // Swedish stocks
        'VOLV_B': 285, 'ERIC-B': 68, 'SEB-A': 142, 'ATCO-A': 178, 'ASSA-B': 312,
        'HM-B': 185, 'SAND': 218, 'HEXA-B': 124, 'INVE-B': 358, 'SWED-A': 215,
        'ESSITY-B': 282, 'SKF-B': 198, 'TELIA': 28, 'KINV-B': 89, 'ELUX-B': 78,
        // New stocks from portfolio
        'ABB': 772, 'ALFA': 506, 'CAST': 109, 'EQT': 284, 'FLAT': 10.8,
        'NEOBO': 18.5, 'SITOW': 2.3,
        // Metals
        'XAU': 2680, 'XAG': 31, 'XPT': 980, 'XPD': 1040,
        // Swedish funds (NAV)
        'SWE-ASIA': 145, 'SWE-USA': 234, 'SWE-GLOB': 189,
        'SWE-TECH': 78, 'SWE-SMAL': 112, 'HB-ENRG': 95, 'SPLT-INV': 298,
      };
      
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
