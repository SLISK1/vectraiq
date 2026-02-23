import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-call',
};

// Crypto ticker to CoinGecko ID mapping
const CRYPTO_IDS: Record<string, string> = {
  'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana', 'XRP': 'ripple',
  'ADA': 'cardano', 'AVAX': 'avalanche-2', 'DOT': 'polkadot', 'LINK': 'chainlink',
  'DOGE': 'dogecoin', 'MATIC': 'matic-network', 'LTC': 'litecoin', 'UNI': 'uniswap',
  'ATOM': 'cosmos', 'NEAR': 'near', 'APT': 'aptos', 'ARB': 'arbitrum', 'OP': 'optimism',
};

// Nordic stocks - ticker to exchange symbol mapping (used by both FMP and Yahoo)
const NORDIC_STOCKS: Record<string, string> = {
  // Sweden - Large Cap
  'VOLV_B': 'VOLV-B.ST', 'ERIC-B': 'ERIC-B.ST', 'SEB-A': 'SEB-A.ST',
  'ATCO-A': 'ATCO-A.ST', 'ASSA-B': 'ASSA-B.ST', 'HM-B': 'HM-B.ST',
  'SAND': 'SAND.ST', 'HEXA-B': 'HEXA-B.ST', 'INVE-B': 'INVE-B.ST',
  'SWED-A': 'SWED-A.ST', 'ESSITY-B': 'ESSITY-B.ST', 'SKF-B': 'SKF-B.ST',
  'TELIA': 'TELIA.ST', 'KINV-B': 'KINV-B.ST', 'ELUX-B': 'ELUX-B.ST',
  'ABB': 'ABB.ST', 'ALFA': 'ALFA.ST', 'CAST': 'CAST.ST', 'EQT': 'EQT.ST',
  'NIBE-B': 'NIBE-B.ST', 'EVO': 'EVO.ST', 'BOL': 'BOL.ST',
  'GETI-B': 'GETI-B.ST', 'SAAB-B': 'SAAB-B.ST', 'SHB-A': 'SHB-A.ST',
  'NDA-SE': 'NDA-SE.ST', 'AZN': 'AZN.ST', 'EMBRAC-B': 'EMBRAC-B.ST',
  // Sweden - Mid Cap
  'SINCH': 'SINCH.ST', 'SSAB-A': 'SSAB-A.ST', 'TEL2-B': 'TEL2-B.ST',
  'AXFO': 'AXFO.ST', 'LUND-B': 'LUND-B.ST', 'LIFCO-B': 'LIFCO-B.ST',
  'SWMA': 'SWMA.ST', 'LATO-B': 'LATO-B.ST', 'INDU-C': 'INDU-C.ST',
  'WALL-B': 'WALL-B.ST', 'FABG': 'FABG.ST', 'HUFV-A': 'HUFV-A.ST',
  'BILL': 'BILL.ST', 'LOOMIS': 'LOOMIS.ST', 'SAGA-B': 'SAGA-B.ST',
  'AAK': 'AAK.ST', 'TREL-B': 'TREL-B.ST', 'AF-B': 'AF-B.ST',
  'HPOL-B': 'HUSQ-B.ST', 'SCA-B': 'SCA-B.ST', 'SECU-B': 'SECU-B.ST',
  'THULE': 'THULE.ST', 'BRAV': 'BRAV.ST',
  'FLAT': 'FLAT-B.ST', 'CATE': 'CATE.ST', 'WIHL': 'WIHL.ST',
  // Sweden - Small Cap
  'BALD-B': 'BALD-B.ST', 'MTRS': 'MTRS.ST', 'DUNI': 'DUNI.ST',
  'BETS-B': 'BETS-B.ST', 'KIND-SDB': 'KIND-SDB.ST', 'CLAS-B': 'CLAS-B.ST',
  'BUFAB': 'BUFAB.ST', 'NOLA-B': 'NOLA-B.ST', 'SYSR': 'SYSR.ST',
  'SAVE': 'SAVE.ST', 'AVAZ-B': 'AZA.ST', 'RESURS': 'RESURS.ST', 'NEOBO': 'NEOBO.ST',
  'TROAX': 'TROAX.ST', 'AMBEA': 'AMBEA.ST', 'BULTEN': 'BULTEN.ST',
  'CIBUS': 'CIBUS.ST', 'CLA-B': 'CLA-B.ST', 'BONAV-B': 'BONAV-B.ST',
  'BURE': 'BURE.ST', 'COOR': 'COOR.ST', 'DIOS': 'DIOS.ST',
  'ELAN-B': 'ELAN-B.ST', 'ELTEL': 'ELTEL.ST', 'FM': 'FM.ST',
  'HEMFOSA': 'HEMFOSA.ST', 'HMS': 'HMS.ST', 'HEBA-B': 'HEBA-B.ST',
  'KABE-B': 'KABE-B.ST', 'KARO': 'KARO.ST', 'KFAST-B': 'KFAST-B.ST',
  'LIAB': 'LIAB.ST', 'LIME': 'LIME.ST', 'MEKO': 'MEKO.ST',
  'MIPS': 'MIPS.ST', 'NETI-B': 'NETI-B.ST', 'NP3': 'NP3.ST',
  'OEM-B': 'OEM-B.ST', 'ORTI-B': 'ORTI-B.ST', 'PEAB-B': 'PEAB-B.ST',
  'PRIC-B': 'PRIC-B.ST', 'RATO-B': 'RATO-B.ST', 'RAYSH': 'RAYS.ST',
  'VITR': 'VITR.ST', 'VNV': 'VNV.ST', 'XVIVO': 'XVIVO.ST',
  // Norway
  'EQNR': 'EQNR.OL', 'DNB': 'DNB.OL', 'TEL': 'TEL.OL',
  'MOWI': 'MOWI.OL', 'SALM': 'SALM.OL', 'YAR': 'YAR.OL',
  'ORK': 'ORK.OL', 'AKRBP': 'AKRBP.OL', 'KAHOT': 'KAHOT.OL', 'AUSS': 'AUSS.OL',
  'TOM': 'TOM.OL', 'BAKKA': 'BAKKA.OL', 'AFG': 'AFG.OL',
  // Denmark
  'NOVO-B': 'NOVO-B.CO', 'MAERSK-B': 'MAERSK-B.CO', 'CARL-B': 'CARL-B.CO',
  'VWS': 'VWS.CO', 'DSV': 'DSV.CO', 'ORSTED': 'ORSTED.CO',
  'COLO-B': 'COLO-B.CO', 'DEMANT': 'DEMANT.CO', 'PNDORA': 'PNDORA.CO', 'GN': 'GN.CO',
  'JYSK': 'JYSK.CO', 'FLS': 'FLS.CO', 'TRYG': 'TRYG.CO',
  // Finland
  'SITOW': 'SITOWS.HE', 'NOKIA': 'NOKIA.HE', 'FORTUM': 'FORTUM.HE',
  'NESTE': 'NESTE.HE', 'UPM': 'UPM.HE', 'SAMPO': 'SAMPO.HE',
  'KNEBV': 'KNEBV.HE', 'WRT1V': 'WRT1V.HE', 'STERV': 'STERV.HE',
  'KESKOB': 'KESKOB.HE', 'ELISA': 'ELISA.HE', 'ORNBV': 'ORNBV.HE',
  'TYRES': 'TYRES.HE', 'METSB': 'METSB.HE',
};

const US_STOCKS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'JPM', 'V', 'JNJ', 'AMD', 'SPOT'];
const METALS = ['XAU', 'XAG', 'XPT', 'XPD'];

// Fund proxy tickers are defined inline in section 5

// ===== FMP HELPERS (PRIMARY SOURCE) =====

interface QuoteResult {
  price: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  open: number;
  volume: number;
  marketCap?: number;
}

async function fetchFmpBatchQuotes(tickers: string[], apiKey: string): Promise<Record<string, QuoteResult>> {
  const results: Record<string, QuoteResult> = {};
  try {
    const res = await fetch(`https://financialmodelingprep.com/api/v3/quote/${tickers.join(',')}?apikey=${apiKey}`);
    if (!res.ok) { console.log(`FMP batch HTTP ${res.status}`); return results; }
    const quotes = await res.json();
    if (!Array.isArray(quotes)) return results;
    for (const q of quotes) {
      if (q.price && q.price > 0) {
        results[q.symbol] = {
          price: q.price,
          change: q.change || 0,
          changePercent: q.changesPercentage || 0,
          high: q.dayHigh || q.price,
          low: q.dayLow || q.price,
          open: q.open || q.previousClose || q.price,
          volume: q.volume || 0,
          marketCap: q.marketCap || undefined,
        };
      }
    }
  } catch (e) { console.error('FMP batch error:', e); }
  return results;
}

async function fetchFmpSingleQuote(fmpTicker: string, apiKey: string): Promise<QuoteResult | null> {
  try {
    const res = await fetch(`https://financialmodelingprep.com/api/v3/quote/${fmpTicker}?apikey=${apiKey}`);
    if (!res.ok) return null;
    const quotes = await res.json();
    const q = Array.isArray(quotes) ? quotes[0] : null;
    if (!q?.price || q.price <= 0) return null;
    return {
      price: q.price,
      change: q.change || 0,
      changePercent: q.changesPercentage || 0,
      high: q.dayHigh || q.price,
      low: q.dayLow || q.price,
      open: q.open || q.previousClose || q.price,
      volume: q.volume || 0,
      marketCap: q.marketCap || undefined,
    };
  } catch (e) { console.error(`FMP single error ${fmpTicker}:`, e); return null; }
}

// ===== YAHOO HELPERS (FALLBACK) =====

async function fetchYahooQuote(yahooSymbol: string): Promise<QuoteResult | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${yahooSymbol}`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }
    );
    if (!res.ok) return fetchYahooChartQuote(yahooSymbol);
    const data = await res.json();
    const quote = data.quoteResponse?.result?.[0];
    if (!quote) return fetchYahooChartQuote(yahooSymbol);

    const price = quote.regularMarketPrice || 0;
    const previousClose = quote.regularMarketPreviousClose || price;
    const change = quote.regularMarketChange || (price - previousClose);
    const changePercent = quote.regularMarketChangePercent || (previousClose > 0 ? (change / previousClose) * 100 : 0);

    return {
      price, change, changePercent,
      high: quote.regularMarketDayHigh || price,
      low: quote.regularMarketDayLow || price,
      open: quote.regularMarketOpen || previousClose,
      volume: quote.regularMarketVolume || 0,
      marketCap: quote.marketCap,
    };
  } catch (e) {
    console.error(`Yahoo quote error ${yahooSymbol}:`, e);
    return fetchYahooChartQuote(yahooSymbol);
  }
}

async function fetchYahooChartQuote(yahooSymbol: string): Promise<QuoteResult | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const result = data.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta;
    const q = result.indicators?.quote?.[0];
    const price = meta.regularMarketPrice || (q?.close?.filter((c: number | null) => c != null).pop()) || 0;
    const previousClose = meta.chartPreviousClose || meta.previousClose || price;
    const change = price - previousClose;
    const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;

    return {
      price, change, changePercent,
      high: q?.high?.filter((h: number | null) => h != null).pop() || price,
      low: q?.low?.filter((l: number | null) => l != null).pop() || price,
      open: q?.open?.filter((o: number | null) => o != null).pop() || previousClose,
      volume: q?.volume?.filter((v: number | null) => v != null).pop() || 0,
    };
  } catch (e) { console.error(`Yahoo chart error ${yahooSymbol}:`, e); return null; }
}

// ===== MAIN =====

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // === AUTH ===
    const isInternalCall = req.headers.get('x-internal-call') === 'true';
    const authHeader = req.headers.get('authorization');

    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const FMP_API_KEY = Deno.env.get('FMP_API_KEY');
    const ALPHA_VANTAGE_API_KEY = Deno.env.get('ALPHA_VANTAGE_API_KEY');
    const FINNHUB_API_KEY = Deno.env.get('FINNHUB_API_KEY');

    const { data: symbols, error: symError } = await supabase
      .from('symbols').select('id, ticker, asset_type, metadata').eq('is_active', true);

    if (symError) {
      return new Response(JSON.stringify({ error: symError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
    const idToTicker = new Map(symbols.map(s => [s.id, s.ticker]));

    // ========== 1. CRYPTO via CoinGecko (unchanged) ==========
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
                symbol_id: s.id, price: d.usd,
                change_percent_24h: d.usd_24h_change || 0,
                change_24h: d.usd * ((d.usd_24h_change || 0) / 100),
                volume: d.usd_24h_vol || 0, market_cap: d.usd_market_cap,
                source: 'coingecko',
              });
            }
          }
        } else { errors.push(`CoinGecko: ${res.status}`); }
      } catch (e) { errors.push(`CoinGecko: ${e}`); }
    }

    // ========== 2. US STOCKS: FMP primary -> Yahoo fallback ==========
    const usStockSymbols = symbols.filter(s => US_STOCKS.includes(s.ticker));
    console.log(`Fetching ${usStockSymbols.length} US stocks — FMP primary`);

    const fmpFailed: typeof usStockSymbols = [];

    if (FMP_API_KEY && usStockSymbols.length > 0) {
      const usTickers = usStockSymbols.map(s => s.ticker);
      const fmpQuotes = await fetchFmpBatchQuotes(usTickers, FMP_API_KEY);

      for (const s of usStockSymbols) {
        const q = fmpQuotes[s.ticker];
        if (q && q.price > 0) {
          priceRecords.push({
            symbol_id: s.id, price: q.price,
            change_24h: q.change, change_percent_24h: q.changePercent,
            high_price: q.high, low_price: q.low, open_price: q.open,
            volume: q.volume, market_cap: q.marketCap,
            source: 'fmp',
          });
          console.log(`✓ FMP ${s.ticker}: $${q.price} (${q.changePercent.toFixed(2)}%)`);
        } else {
          fmpFailed.push(s);
        }
      }
    } else {
      fmpFailed.push(...usStockSymbols);
      if (!FMP_API_KEY) console.log('FMP_API_KEY not set, falling back to Yahoo for US stocks');
    }

    // Yahoo fallback for failed US stocks
    if (fmpFailed.length > 0) {
      console.log(`Yahoo fallback for ${fmpFailed.length} US stocks: ${fmpFailed.map(s => s.ticker).join(',')}`);
      for (const s of fmpFailed) {
        try {
          const q = await fetchYahooQuote(s.ticker);
          if (q && q.price > 0) {
            priceRecords.push({
              symbol_id: s.id, price: q.price,
              change_24h: q.change, change_percent_24h: q.changePercent,
              high_price: q.high, low_price: q.low, open_price: q.open,
              volume: q.volume, market_cap: q.marketCap,
              source: 'yahoo_fallback',
            });
            console.log(`✓ Yahoo fallback ${s.ticker}: $${q.price}`);
          } else {
            errors.push(`${s.ticker}: no data from FMP or Yahoo`);
          }
          await new Promise(r => setTimeout(r, 200));
        } catch (e) { errors.push(`Yahoo fallback ${s.ticker}: ${e}`); }
      }
    }

    // ========== 3. NORDIC STOCKS: FMP primary -> Yahoo fallback ==========
    const nordicStockSymbols = symbols.filter(s => NORDIC_STOCKS[s.ticker]);
    console.log(`Fetching ${nordicStockSymbols.length} Nordic stocks — FMP primary`);

    const nordicFmpFailed: typeof nordicStockSymbols = [];

    if (FMP_API_KEY) {
      for (const s of nordicStockSymbols) {
        const fmpTicker = NORDIC_STOCKS[s.ticker]; // e.g. VOLV-B.ST
        try {
          const q = await fetchFmpSingleQuote(fmpTicker, FMP_API_KEY);
          if (q && q.price > 0) {
            priceRecords.push({
              symbol_id: s.id, price: q.price,
              change_24h: q.change, change_percent_24h: q.changePercent,
              high_price: q.high, low_price: q.low, open_price: q.open,
              volume: q.volume, market_cap: q.marketCap,
              source: 'fmp',
            });
            console.log(`✓ FMP ${s.ticker}: ${q.price} (${q.changePercent.toFixed(2)}%)`);
          } else {
            nordicFmpFailed.push(s);
          }
          await new Promise(r => setTimeout(r, 150)); // FMP rate limit
        } catch (e) {
          nordicFmpFailed.push(s);
          console.error(`FMP Nordic error ${s.ticker}:`, e);
        }
      }
    } else {
      nordicFmpFailed.push(...nordicStockSymbols);
    }

    // Yahoo fallback for failed Nordic stocks
    if (nordicFmpFailed.length > 0) {
      console.log(`Yahoo fallback for ${nordicFmpFailed.length} Nordic stocks`);
      for (const s of nordicFmpFailed) {
        try {
          const yahooSymbol = NORDIC_STOCKS[s.ticker];
          const q = await fetchYahooQuote(yahooSymbol);
          if (q && q.price > 0) {
            priceRecords.push({
              symbol_id: s.id, price: q.price,
              change_24h: q.change, change_percent_24h: q.changePercent,
              high_price: q.high, low_price: q.low, open_price: q.open,
              volume: q.volume, market_cap: q.marketCap,
              source: 'yahoo_fallback',
            });
            console.log(`✓ Yahoo fallback ${s.ticker}: ${q.price}`);
          } else {
            errors.push(`${s.ticker}: no data from FMP or Yahoo`);
          }
          await new Promise(r => setTimeout(r, 200));
        } catch (e) { errors.push(`Yahoo fallback ${s.ticker}: ${e}`); }
      }
    }

    // ========== 4. METALS via FMP primary -> Yahoo futures fallback ==========
    const METAL_YAHOO_PRICES: Record<string, string> = {
      'XAU': 'GC=F', 'XAG': 'SI=F', 'XPT': 'PL=F', 'XPD': 'PA=F',
    };
    const metalSymbols = symbols.filter(s => METALS.includes(s.ticker));
    console.log(`Fetching ${metalSymbols.length} metals — FMP/Yahoo`);

    for (const s of metalSymbols) {
      let metalFetched = false;

      // Try FMP commodity quote
      if (FMP_API_KEY) {
        const fmpTicker = `${s.ticker}USD`;
        try {
          const q = await fetchFmpSingleQuote(fmpTicker, FMP_API_KEY);
          if (q && q.price > 0) {
            priceRecords.push({
              symbol_id: s.id, price: q.price,
              change_24h: q.change, change_percent_24h: q.changePercent,
              high_price: q.high, low_price: q.low, open_price: q.open,
              volume: q.volume, source: 'fmp',
            });
            console.log(`✓ FMP metal ${s.ticker}: $${q.price} (${q.changePercent.toFixed(2)}%)`);
            metalFetched = true;
          }
          await new Promise(r => setTimeout(r, 150));
        } catch (e) { console.error(`FMP metal error ${s.ticker}:`, e); }
      }

      // Yahoo futures fallback
      if (!metalFetched && METAL_YAHOO_PRICES[s.ticker]) {
        try {
          const q = await fetchYahooQuote(METAL_YAHOO_PRICES[s.ticker]);
          if (q && q.price > 0) {
            priceRecords.push({
              symbol_id: s.id, price: q.price,
              change_24h: q.change, change_percent_24h: q.changePercent,
              high_price: q.high, low_price: q.low, open_price: q.open,
              volume: q.volume, source: 'yahoo_metal',
            });
            console.log(`✓ Yahoo metal ${s.ticker}: $${q.price} (${q.changePercent.toFixed(2)}%)`);
            metalFetched = true;
          }
          await new Promise(r => setTimeout(r, 300));
        } catch (e) { errors.push(`Yahoo metal ${s.ticker}: ${e}`); }
      }

      if (!metalFetched) {
        errors.push(`${s.ticker}: no metal price from FMP or Yahoo`);
      }
    }

    // ========== 5. SWEDISH FUNDS via proxy ETF (read from metadata) ==========
    const FUND_PROXY_PRICES: Record<string, string> = {
      'SWE-USA': 'SPY', 'SWE-GLOB': 'VT', 'SWE-TECH': 'QQQ',
      'SWE-ASIA': 'VWO', 'SWE-SMAL': 'XACT-OMXS30.ST',
      'HB-ENRG': 'XLE', 'SPLT-INV': 'VT',
    };
    // Also read proxy_etf from metadata for dynamically added funds
    for (const s of symbols) {
      if (s.asset_type === 'fund' && !FUND_PROXY_PRICES[s.ticker]) {
        const proxy = (s.metadata as any)?.proxy_etf;
        if (proxy) FUND_PROXY_PRICES[s.ticker] = proxy;
      }
    }
    const fundSymbols = symbols.filter(s => FUND_PROXY_PRICES[s.ticker]);
    console.log(`Fetching ${fundSymbols.length} fund proxy prices`);
    for (const s of fundSymbols) {
      const proxyTicker = FUND_PROXY_PRICES[s.ticker];
      let fundFetched = false;

      // Try FMP for proxy ETF quote
      if (FMP_API_KEY) {
        try {
          const q = await fetchFmpSingleQuote(proxyTicker, FMP_API_KEY);
          if (q && q.price > 0) {
            priceRecords.push({
              symbol_id: s.id, price: q.price,
              change_24h: q.change, change_percent_24h: q.changePercent,
              high_price: q.high, low_price: q.low, open_price: q.open,
              volume: q.volume, source: 'fmp_proxy',
            });
            console.log(`✓ FMP proxy fund ${s.ticker} (${proxyTicker}): $${q.price}`);
            fundFetched = true;
          }
          await new Promise(r => setTimeout(r, 150));
        } catch (e) { console.error(`FMP fund proxy error ${s.ticker}:`, e); }
      }

      // Yahoo fallback
      if (!fundFetched) {
        try {
          const q = await fetchYahooQuote(proxyTicker);
          if (q && q.price > 0) {
            priceRecords.push({
              symbol_id: s.id, price: q.price,
              change_24h: q.change, change_percent_24h: q.changePercent,
              high_price: q.high, low_price: q.low, open_price: q.open,
              volume: q.volume, source: 'yahoo_proxy',
            });
            console.log(`✓ Yahoo proxy fund ${s.ticker} (${proxyTicker}): $${q.price}`);
            fundFetched = true;
          }
          await new Promise(r => setTimeout(r, 300));
        } catch (e) { errors.push(`Yahoo fund proxy ${s.ticker}: ${e}`); }
      }

      if (!fundFetched) {
        errors.push(`${s.ticker}: no fund proxy price`);
      }
    }

    // ========== 6. CROSS-VALIDATION: Yahoo validates FMP prices ==========
    const DEVIATION_THRESHOLD = 0.03;
    const REPLACE_THRESHOLD = 0.15;
    const crossValidationResults: { ticker: string; fmp: number; yahoo: number; source: string; deviation: number; action: string }[] = [];

    // Cross-validate FMP-sourced US stocks with Yahoo
    const usFmpRecords = priceRecords.filter(p => {
      const t = idToTicker.get(p.symbol_id);
      return t && US_STOCKS.includes(t) && p.source === 'fmp';
    });

    if (usFmpRecords.length > 0) {
      console.log(`Cross-validating ${usFmpRecords.length} US FMP prices with Yahoo`);
      for (const rec of usFmpRecords) {
        const ticker = idToTicker.get(rec.symbol_id)!;
        try {
          const yq = await fetchYahooQuote(ticker);
          if (yq && yq.price > 0) {
            const deviation = Math.abs(rec.price - yq.price) / yq.price;
            const action = deviation > REPLACE_THRESHOLD ? 'REPLACED' : deviation > DEVIATION_THRESHOLD ? 'WARNING' : 'OK';
            if (deviation > DEVIATION_THRESHOLD) {
              crossValidationResults.push({
                ticker, fmp: rec.price, yahoo: yq.price,
                source: 'yahoo', deviation: parseFloat((deviation * 100).toFixed(2)), action,
              });
            }
            if (deviation > REPLACE_THRESHOLD) {
              console.log(`⚠ PRICE REPLACED ${ticker}: FMP=$${rec.price} -> Yahoo=$${yq.price} (${(deviation*100).toFixed(1)}% off)`);
              rec.price = yq.price;
              rec.change_24h = yq.change;
              rec.change_percent_24h = yq.changePercent;
              rec.market_cap = yq.marketCap || rec.market_cap;
              rec.source = 'yahoo_validated';
            }
          }
          await new Promise(r => setTimeout(r, 200));
        } catch {}
      }
    }

    // Cross-validate FMP-sourced Nordic stocks with Yahoo (sample 15)
    const nordicFmpRecords = priceRecords.filter(p => {
      const t = idToTicker.get(p.symbol_id);
      return t && NORDIC_STOCKS[t] && p.source === 'fmp';
    }).slice(0, 15);

    if (nordicFmpRecords.length > 0) {
      console.log(`Cross-validating ${nordicFmpRecords.length} Nordic FMP prices with Yahoo`);
      for (const rec of nordicFmpRecords) {
        const ticker = idToTicker.get(rec.symbol_id)!;
        const yahooSymbol = NORDIC_STOCKS[ticker];
        try {
          const yq = await fetchYahooQuote(yahooSymbol);
          if (yq && yq.price > 0) {
            const deviation = Math.abs(rec.price - yq.price) / yq.price;
            const action = deviation > REPLACE_THRESHOLD ? 'REPLACED' : deviation > DEVIATION_THRESHOLD ? 'WARNING' : 'OK';
            if (deviation > DEVIATION_THRESHOLD) {
              crossValidationResults.push({
                ticker, fmp: rec.price, yahoo: yq.price,
                source: 'yahoo', deviation: parseFloat((deviation * 100).toFixed(2)), action,
              });
            }
            if (deviation > REPLACE_THRESHOLD) {
              console.log(`⚠ PRICE REPLACED ${ticker}: FMP=${rec.price} -> Yahoo=${yq.price} (${(deviation*100).toFixed(1)}% off)`);
              rec.price = yq.price;
              rec.source = 'yahoo_validated';
            }
          }
          await new Promise(r => setTimeout(r, 200));
        } catch {}
      }
    }

    // Finnhub third-source validation for US stocks (unchanged)
    if (FINNHUB_API_KEY) {
      const usRecords = priceRecords.filter(p => {
        const t = idToTicker.get(p.symbol_id);
        return t && US_STOCKS.includes(t) && (p.source === 'fmp' || p.source === 'yahoo_validated' || p.source === 'yahoo_fallback');
      });
      for (const rec of usRecords) {
        const ticker = idToTicker.get(rec.symbol_id)!;
        try {
          const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_API_KEY}`);
          if (res.ok) {
            const q = await res.json();
            if (q?.c && q.c > 0) {
              const deviation = Math.abs(rec.price - q.c) / q.c;
              if (deviation > DEVIATION_THRESHOLD) {
                crossValidationResults.push({
                  ticker, fmp: rec.price, yahoo: q.c,
                  source: 'finnhub', deviation: parseFloat((deviation * 100).toFixed(2)),
                  action: deviation > REPLACE_THRESHOLD ? 'REPLACED' : 'WARNING',
                });
                if (deviation > REPLACE_THRESHOLD && rec.source !== 'yahoo_validated') {
                  rec.price = q.c;
                  rec.source = 'finnhub_validated';
                }
              }
            }
          }
          await new Promise(r => setTimeout(r, 100));
        } catch {}
      }
    }

    if (crossValidationResults.length > 0) {
      console.log(`Cross-validation: ${crossValidationResults.length} deviations detected`);
      for (const r of crossValidationResults) {
        console.log(`  ${r.action} ${r.ticker}: FMP=${r.fmp} vs ${r.source}=${r.yahoo} (${r.deviation}% off)`);
      }
    } else {
      console.log('Cross-validation: all prices within 3% tolerance ✓');
    }

    // Log missing
    const fetchedSymbolIds = new Set(priceRecords.map(p => p.symbol_id));
    const missingSymbols = symbols.filter(s => !fetchedSymbolIds.has(s.id));
    if (missingSymbols.length > 0) {
      console.log(`⚠ Missing prices for ${missingSymbols.length} symbols: ${missingSymbols.map(s => s.ticker).join(', ')}`);
    }

    // Insert prices
    if (priceRecords.length) {
      const { error: insertError } = await supabase.from('raw_prices').insert(priceRecords);
      if (insertError) {
        console.error('Insert error:', insertError);
        return new Response(JSON.stringify({ error: insertError.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    console.log(`Updated ${priceRecords.length} prices`);

    return new Response(JSON.stringify({
      updated: priceRecords.length,
      sources: priceRecords.reduce((acc: Record<string, number>, p) => {
        acc[p.source] = (acc[p.source] || 0) + 1; return acc;
      }, {}),
      cross_validation: crossValidationResults.length > 0 ? crossValidationResults : undefined,
      missing: missingSymbols.map(s => s.ticker),
      errors: errors.length ? errors : undefined,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
