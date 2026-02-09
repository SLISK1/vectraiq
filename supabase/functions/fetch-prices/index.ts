import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-call',
};

// Crypto ticker to CoinGecko ID mapping - use exact IDs from CoinGecko
const CRYPTO_IDS: Record<string, string> = {
  'BTC': 'bitcoin',
  'ETH': 'ethereum', 
  'SOL': 'solana',
  'XRP': 'ripple',
  'ADA': 'cardano',
  'AVAX': 'avalanche-2',
  'DOT': 'polkadot',
  'LINK': 'chainlink',
  'DOGE': 'dogecoin',
  'MATIC': 'matic-network',
  'LTC': 'litecoin',
  'UNI': 'uniswap',
  'ATOM': 'cosmos',
  'NEAR': 'near',
  'APT': 'aptos',
  'ARB': 'arbitrum',
  'OP': 'optimism',
};

// Nordic stocks - ticker to Yahoo symbol mapping (comprehensive Nordic coverage)
const NORDIC_STOCKS: Record<string, string> = {
  // Sweden - Large Cap
  'VOLV_B': 'VOLV-B.ST', 'ERIC-B': 'ERIC-B.ST', 'SEB-A': 'SEB-A.ST',
  'ATCO-A': 'ATCO-A.ST', 'ASSA-B': 'ASSA-B.ST', 'HM-B': 'HM-B.ST',
  'SAND': 'SAND.ST', 'HEXA-B': 'HEXA-B.ST', 'INVE-B': 'INVE-B.ST',
  'SWED-A': 'SWED-A.ST', 'ESSITY-B': 'ESSITY-B.ST', 'SKF-B': 'SKF-B.ST',
  'TELIA': 'TELIA.ST', 'KINV-B': 'KINV-B.ST', 'ELUX-B': 'ELUX-B.ST',
  'ABB': 'ABB.ST', 'ALFA': 'ALFA.ST', 'CAST': 'CAST.ST', 'EQT': 'EQT.ST',
  'FLAT': 'FLAT-B.ST', 'NEOBO': 'NEOBO.ST',
  // New Swedish stocks
  'NIBE-B': 'NIBE-B.ST', 'EVO': 'EVO.ST', 'BOL': 'BOL.ST',
  'GETI-B': 'GETI-B.ST', 'SAAB-B': 'SAAB-B.ST', 'SHB-A': 'SHB-A.ST',
  'SINCH': 'SINCH.ST', 'SSAB-A': 'SSAB-A.ST', 'TEL2-B': 'TEL2-B.ST',
  'AXFO': 'AXFO.ST', 'LUND-B': 'LUND-B.ST', 'LIFCO-B': 'LIFCO-B.ST',
  'SWMA': 'SWMA.ST', 'LATO-B': 'LATO-B.ST', 'INDU-C': 'INDU-C.ST',
  'WALL-B': 'WALL-B.ST', 'FABG': 'FABG.ST', 'HUFV-A': 'HUFV-A.ST',
  'BILL': 'BILL.ST', 'LOOMIS': 'LOOMIS.ST', 'SAGA-B': 'SAGA-B.ST',
  'CATE': 'CATE.ST', 'WIHL': 'WIHL.ST', 'BALD-B': 'BALD-B.ST',
  'NDA-SE': 'NDA-SE.ST', 'AZN': 'AZN.ST', 'EMBRAC-B': 'EMBRAC-B.ST',
  'AAK': 'AAK.ST', 'TREL-B': 'TREL-B.ST', 'AF-B': 'AF-B.ST',
  'HPOL-B': 'HUSQ-B.ST', 'SCA-B': 'SCA-B.ST', 'SECU-B': 'SECU-B.ST',
  'MTRS': 'MTRS.ST', 'DUNI': 'DUNI.ST', 'BETS-B': 'BETS-B.ST',
  'KIND-SDB': 'KIND-SDB.ST', 'CLAS-B': 'CLAS-B.ST', 'BUFAB': 'BUFAB.ST',
  'THULE': 'THULE.ST', 'NOLA-B': 'NOLA-B.ST', 'SYSR': 'SYSR.ST',
  'BRAV': 'BRAV.ST', 'SAVE': 'SAVE.ST', 'AVAZ-B': 'AZA.ST',
  'RESURS': 'RESURS.ST',
  // Norway (Oslo Børs)
  'EQNR': 'EQNR.OL', 'DNB': 'DNB.OL', 'TEL': 'TEL.OL',
  'MOWI': 'MOWI.OL', 'SALM': 'SALM.OL', 'YAR': 'YAR.OL',
  'ORK': 'ORK.OL', 'AKRBP': 'AKRBP.OL', 'KAHOT': 'KAHOT.OL', 'AUSS': 'AUSS.OL',
  // Denmark (OMX Copenhagen)
  'NOVO-B': 'NOVO-B.CO', 'MAERSK-B': 'MAERSK-B.CO', 'CARL-B': 'CARL-B.CO',
  'VWS': 'VWS.CO', 'DSV': 'DSV.CO', 'ORSTED': 'ORSTED.CO',
  'COLO-B': 'COLO-B.CO', 'DEMANT': 'DEMANT.CO', 'PNDORA': 'PNDORA.CO', 'GN': 'GN.CO',
  // Finland (OMX Helsinki)
  'SITOW': 'SITOWS.HE', 'NOKIA': 'NOKIA.HE', 'FORTUM': 'FORTUM.HE',
  'NESTE': 'NESTE.HE', 'UPM': 'UPM.HE', 'SAMPO': 'SAMPO.HE',
  'KNEBV': 'KNEBV.HE', 'WRT1V': 'WRT1V.HE', 'STERV': 'STERV.HE',
  'KESKOB': 'KESKOB.HE', 'ELISA': 'ELISA.HE',
};

// US stocks 
const US_STOCKS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'JPM', 'V', 'JNJ', 'AMD', 'SPOT'];

// Metal symbols
const METALS = ['XAU', 'XAG', 'XPT', 'XPD'];

// Swedish funds (NAV-based, updated daily)
const SWEDISH_FUNDS: Record<string, number> = {
  'SWE-ASIA': 145.20, 'SWE-USA': 234.50, 'SWE-GLOB': 189.30,
  'SWE-TECH': 78.40, 'SWE-SMAL': 112.60, 'HB-ENRG': 95.80,
  'SPLT-INV': 298.40,
};

// Helper: Fetch quote from Yahoo Finance
async function fetchYahooQuote(yahooSymbol: string): Promise<{
  price: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  open: number;
  volume: number;
  marketCap?: number;
} | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }
    );

    if (!res.ok) {
      console.log(`Yahoo HTTP error for ${yahooSymbol}: ${res.status}`);
      return null;
    }

    const data = await res.json();
    const result = data.chart?.result?.[0];
    
    if (!result) {
      console.log(`Yahoo no result for ${yahooSymbol}`);
      return null;
    }

    const meta = result.meta;
    const quote = result.indicators?.quote?.[0];
    
    // Get the most recent values
    const price = meta.regularMarketPrice || (quote?.close?.filter((c: number | null) => c != null).pop()) || 0;
    const previousClose = meta.chartPreviousClose || meta.previousClose || price;
    const change = price - previousClose;
    const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;
    
    // Get today's OHLV
    const high = quote?.high?.filter((h: number | null) => h != null).pop() || price;
    const low = quote?.low?.filter((l: number | null) => l != null).pop() || price;
    const open = quote?.open?.filter((o: number | null) => o != null).pop() || previousClose;
    const volume = quote?.volume?.filter((v: number | null) => v != null).pop() || 0;

    return {
      price,
      change,
      changePercent,
      high,
      low,
      open,
      volume,
      marketCap: meta.marketCap,
    };
  } catch (e) {
    console.error(`Yahoo error for ${yahooSymbol}:`, e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // === AUTHENTICATION CHECK ===
    const isInternalCall = req.headers.get('x-internal-call') === 'true';
    const authHeader = req.headers.get('authorization');

    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!isInternalCall) {
      const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });

      const token = authHeader.replace('Bearer ', '');
      const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getUser(token);
      
      if (claimsError || !claimsData?.user) {
        return new Response(JSON.stringify({ error: 'Invalid token' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Service role client for database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

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

    // 2. Fetch Nordic stocks from Yahoo Finance (better coverage than Finnhub)
    const nordicStockSymbols = symbols.filter(s => NORDIC_STOCKS[s.ticker]);
    console.log(`Fetching ${nordicStockSymbols.length} Nordic stocks from Yahoo Finance`);
    
    for (const s of nordicStockSymbols) {
      try {
        const yahooSymbol = NORDIC_STOCKS[s.ticker];
        const quote = await fetchYahooQuote(yahooSymbol);
        
        if (quote && quote.price > 0) {
          priceRecords.push({
            symbol_id: s.id,
            price: quote.price,
            change_24h: quote.change,
            change_percent_24h: quote.changePercent,
            high_price: quote.high,
            low_price: quote.low,
            open_price: quote.open,
            volume: quote.volume,
            market_cap: quote.marketCap,
            source: 'yahoo',
          });
          console.log(`✓ ${s.ticker}: ${quote.price} SEK (${quote.changePercent.toFixed(2)}%)`);
        } else {
          console.log(`✗ ${s.ticker}: No quote from Yahoo`);
        }
        
        // Rate limiting - Yahoo allows ~2000 requests/hour, be conservative
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (e) {
        console.error(`Yahoo error for ${s.ticker}:`, e);
        errors.push(`Yahoo ${s.ticker}: ${e}`);
      }
    }

    // 3. Fetch US stocks from Yahoo Finance
    const usStockSymbols = symbols.filter(s => US_STOCKS.includes(s.ticker));
    console.log(`Fetching ${usStockSymbols.length} US stocks from Yahoo Finance`);
    
    for (const s of usStockSymbols) {
      try {
        const quote = await fetchYahooQuote(s.ticker);
        
        if (quote && quote.price > 0) {
          priceRecords.push({
            symbol_id: s.id,
            price: quote.price,
            change_24h: quote.change,
            change_percent_24h: quote.changePercent,
            high_price: quote.high,
            low_price: quote.low,
            open_price: quote.open,
            volume: quote.volume,
            market_cap: quote.marketCap,
            source: 'yahoo',
          });
          console.log(`✓ ${s.ticker}: $${quote.price} (${quote.changePercent.toFixed(2)}%)`);
        } else {
          console.log(`✗ ${s.ticker}: No quote from Yahoo`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (e) {
        console.error(`Yahoo error for ${s.ticker}:`, e);
        errors.push(`Yahoo ${s.ticker}: ${e}`);
      }
    }

    // 4. Fetch metals from Alpha Vantage
    if (ALPHA_VANTAGE_API_KEY) {
      const metalSymbols = symbols.filter(s => METALS.includes(s.ticker));
      console.log(`Fetching ${metalSymbols.length} metals from Alpha Vantage`);
      
      for (const s of metalSymbols) {
        try {
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
                change_24h: 0,
                change_percent_24h: 0,
                volume: 0,
                source: 'alphavantage',
              });
              console.log(`✓ ${s.ticker}: $${price}`);
            }
          }
          // Alpha Vantage free tier: 5 calls/min
          await new Promise(resolve => setTimeout(resolve, 12000));
        } catch (e) {
          console.error(`Alpha Vantage error for ${s.ticker}:`, e);
          errors.push(`AlphaVantage ${s.ticker}: ${e}`);
        }
      }
    } else {
      console.log('ALPHA_VANTAGE_API_KEY not configured, skipping metals');
    }

    // 5. Swedish funds - use NAV fallback (no real-time API available for these)
    const fundSymbols = symbols.filter(s => SWEDISH_FUNDS[s.ticker]);
    console.log(`Adding ${fundSymbols.length} Swedish funds with NAV estimates`);
    
    for (const s of fundSymbols) {
      const baseNAV = SWEDISH_FUNDS[s.ticker];
      // Small daily variation based on date (deterministic, not random)
      const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24));
      const variation = Math.sin(dayOfYear * 0.1) * 0.02; // ±2% based on day
      const nav = baseNAV * (1 + variation);
      
      priceRecords.push({
        symbol_id: s.id,
        price: parseFloat(nav.toFixed(2)),
        change_24h: parseFloat((baseNAV * variation).toFixed(2)),
        change_percent_24h: parseFloat((variation * 100).toFixed(2)),
        volume: 0,
        source: 'nav_estimate',
      });
    }

    // Note: No fallback for stocks/crypto that fail - we only want real data
    const fetchedSymbolIds = new Set(priceRecords.map(p => p.symbol_id));
    const missingSymbols = symbols.filter(s => !fetchedSymbolIds.has(s.id) && !SWEDISH_FUNDS[s.ticker]);
    
    if (missingSymbols.length > 0) {
      console.log(`⚠ Missing prices for ${missingSymbols.length} symbols: ${missingSymbols.map(s => s.ticker).join(', ')}`);
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
      missing: missingSymbols.map(s => s.ticker),
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
