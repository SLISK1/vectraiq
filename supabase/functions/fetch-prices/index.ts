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

// Swedish stocks mapped to Finnhub format
const SWEDISH_STOCKS = ['VOLVO-B', 'ERIC-B', 'SEB-A', 'ATCO-A', 'ASSA-B', 'HM-B', 
  'SAND', 'HEXA-B', 'INVE-B', 'SWED-A', 'ESSITY-B', 'SKF-B', 'TELIA', 'KINV-B', 'ELUX-B'];

// Metal symbols
const METALS = ['XAU', 'XAG', 'XPT', 'XPD'];

// Alpha Vantage metal mapping
const ALPHA_METALS: Record<string, string> = {
  'XAU': 'XAU', 'XAG': 'XAG', 'XPT': 'XPT', 'XPD': 'XPD',
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

    // 2. Fetch Swedish stocks from Finnhub
    if (FINNHUB_API_KEY) {
      const stockSymbols = symbols.filter(s => SWEDISH_STOCKS.includes(s.ticker));
      console.log(`Fetching ${stockSymbols.length} stocks from Finnhub`);
      
      for (const s of stockSymbols) {
        try {
          // Finnhub format: TICKER.ST for Stockholm
          const finnhubSymbol = `${s.ticker.replace('-', '_')}.ST`;
          const res = await fetch(
            `https://finnhub.io/api/v1/quote?symbol=${finnhubSymbol}&token=${FINNHUB_API_KEY}`
          );
          
          if (res.ok) {
            const data = await res.json();
            if (data.c && data.c > 0) {
              priceRecords.push({
                symbol_id: s.id,
                price: data.c, // current price
                change_24h: data.d || 0, // change
                change_percent_24h: data.dp || 0, // change percent
                high_price: data.h,
                low_price: data.l,
                open_price: data.o,
                volume: 0, // Quote doesn't include volume
                source: 'finnhub',
              });
            }
          }
          // Rate limit: 60 calls/minute
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (e) {
          console.error(`Finnhub error for ${s.ticker}:`, e);
          errors.push(`Finnhub ${s.ticker}: ${e}`);
        }
      }
    } else {
      console.log('FINNHUB_API_KEY not configured, skipping stocks');
    }

    // 3. Fetch metals from Alpha Vantage
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
        'VOLVO-B': 285, 'ERIC-B': 68, 'SEB-A': 142, 'ATCO-A': 178, 'ASSA-B': 312,
        'HM-B': 156, 'SAND': 218, 'HEXA-B': 124, 'INVE-B': 278, 'SWED-A': 215,
        'ESSITY-B': 282, 'SKF-B': 198, 'TELIA': 28, 'KINV-B': 89, 'ELUX-B': 78,
        'XAU': 2680, 'XAG': 31, 'XPT': 980, 'XPD': 1040,
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
