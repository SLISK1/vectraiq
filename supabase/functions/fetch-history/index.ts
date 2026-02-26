import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Crypto ticker to CoinGecko ID mapping
const CRYPTO_IDS: Record<string, string> = {
  'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana', 'XRP': 'ripple',
  'ADA': 'cardano', 'AVAX': 'avalanche-2', 'DOT': 'polkadot', 'LINK': 'chainlink',
  'DOGE': 'dogecoin', 'MATIC': 'matic-network', 'LTC': 'litecoin', 'UNI': 'uniswap',
  'ATOM': 'cosmos', 'NEAR': 'near', 'APT': 'aptos', 'ARB': 'arbitrum', 'OP': 'optimism',
};

// Metal ticker to Yahoo Finance futures symbol
const METAL_YAHOO: Record<string, string> = {
  'XAU': 'GC=F', 'XAG': 'SI=F', 'XPT': 'PL=F', 'XPD': 'PA=F',
};

// Metal ticker to FMP symbol
const METAL_FMP: Record<string, string> = {
  'XAU': 'XAUUSD', 'XAG': 'XAGUSD', 'XPT': 'XPTUSD', 'XPD': 'XPDUSD',
};

// Fund ticker to proxy ETF for history (base mapping, extended dynamically from metadata)
const FUND_PROXY: Record<string, string> = {
  'SWE-USA': 'SPY', 'SWE-GLOB': 'VT', 'SWE-TECH': 'QQQ',
  'SWE-ASIA': 'VWO', 'SWE-SMAL': 'XACT-OMXS30.ST',
  'HB-ENRG': 'XLE', 'SPLT-INV': 'VT',
};

// Nordic stocks - ticker to exchange symbol mapping
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
  'LATO-B': 'LATO-B.ST', 'INDU-C': 'INDU-C.ST',
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
  // Fixade mappningar
  'ATRLJ-B': 'ATRLJ-B.ST', 'COLL': 'COLL.ST',
  'EMBRACER-B.ST': 'EMBRAC-B.ST', 'BOLIDEN.ST': 'BOL.ST',
  'CALLIDITAS.ST': 'CALT.ST', 'CALTX.ST': 'CALT.ST',
  'FAST.ST': 'BALD-B.ST', 'FORTN.ST': 'FORTUM.HE',
  'LUND-A.ST': 'LUND-B.ST', 'LATOUR-B.ST': 'LATO-B.ST',
  'LOOM-B.ST': 'LOOMIS.ST', 'SAGAX-B.ST': 'SAGA-B.ST',
  'SAGAX-D.ST': 'SAGA-D.ST', 'STILLF.ST': 'SF.ST',
  'MTRS-B.ST': 'MTRS.ST', 'MVIR-B.ST': 'MCOV-B.ST',
  'AF-B.ST': 'AFB.ST', 'RESURS.ST': 'RESURS.ST',
  'PROB.ST': 'PROB.ST', 'KNOWIT.ST': 'KNOW.ST',
  'OX2.ST': 'OX2.ST', 'BIOT.ST': 'BIOT.ST',
  'FENIX.ST': 'FOI-B.ST', 'EWORK.ST': 'EWRK.ST',
  'NPAPER.ST': 'NPAPER.ST',
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

const US_STOCKS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'JPM', 'V', 'JNJ', 'SPOT', 'AMD'];

interface HistoryRequest {
  tickers?: string[];
  days?: number;
}

// ===== FMP HISTORY HELPER =====

async function fetchFmpHistory(fmpTicker: string, days: number, apiKey: string): Promise<{ date: string; open: number; high: number; low: number; close: number; volume: number }[] | null> {
  try {
    const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const toDate = new Date().toISOString().split('T')[0];
    const res = await fetch(
      `https://financialmodelingprep.com/api/v3/historical-price-full/${fmpTicker}?from=${fromDate}&to=${toDate}&apikey=${apiKey}`
    );
    if (!res.ok) { console.log(`FMP history HTTP ${res.status} for ${fmpTicker}`); return null; }
    const data = await res.json();
    const historical = data.historical;
    if (!Array.isArray(historical) || historical.length === 0) return null;
    return historical.map((h: any) => ({
      date: h.date,
      open: h.open || h.close,
      high: h.high || h.close,
      low: h.low || h.close,
      close: h.close,
      volume: h.volume || 0,
    }));
  } catch (e) { console.error(`FMP history error ${fmpTicker}:`, e); return null; }
}

// ===== YAHOO HISTORY HELPER (FALLBACK) =====

async function fetchYahooHistory(yahooSymbol: string, days: number): Promise<{ timestamp: number[]; quotes: any } | null> {
  const period1 = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
  const period2 = Math.floor(Date.now() / 1000);
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?period1=${period1}&period2=${period2}&interval=1d`,
    { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const result = data.chart?.result?.[0];
  if (!result?.timestamp || !result?.indicators?.quote?.[0]) return null;
  return { timestamp: result.timestamp, quotes: result.indicators.quote[0] };
}

function yahooToRecords(symbolId: string, data: { timestamp: number[]; quotes: any }, source = 'yahoo_fallback'): any[] {
  const records: any[] = [];
  for (let i = 0; i < data.timestamp.length; i++) {
    if (data.quotes.close?.[i] != null) {
      const dateStr = new Date(data.timestamp[i] * 1000).toISOString().split('T')[0];
      records.push({
        symbol_id: symbolId, date: dateStr,
        open_price: data.quotes.open?.[i] || data.quotes.close[i],
        high_price: data.quotes.high?.[i] || data.quotes.close[i],
        low_price: data.quotes.low?.[i] || data.quotes.close[i],
        close_price: data.quotes.close[i],
        volume: data.quotes.volume?.[i] || null,
        source,
      });
    }
  }
  return records;
}

function fmpToRecords(symbolId: string, data: { date: string; open: number; high: number; low: number; close: number; volume: number }[]): any[] {
  return data.map(h => ({
    symbol_id: symbolId, date: h.date,
    open_price: h.open, high_price: h.high,
    low_price: h.low, close_price: h.close,
    volume: h.volume || null, source: 'fmp',
  }));
}

// Helper: upsert records and track results
async function upsertAndTrack(
  supabase: any, ticker: string, records: any[], source: string,
  results: { ticker: string; records: number; source: string }[],
  errors: string[]
) {
  if (records.length === 0) return;
  const { error } = await supabase
    .from('price_history')
    .upsert(records, { onConflict: 'symbol_id,date,source', ignoreDuplicates: true });
  if (error) { errors.push(`${ticker}: ${error.message}`); }
  else { results.push({ ticker, records: records.length, source }); }
}

// Helper: retry with exponential backoff
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, baseDelay = 6000): Promise<T | null> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      return result;
    } catch (e) {
      if (attempt === maxRetries) {
        console.error(`All ${maxRetries + 1} attempts failed:`, e);
        return null;
      }
      const delay = baseDelay * Math.pow(2, attempt);
      console.log(`Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // === AUTH ===
    const authHeader = req.headers.get('authorization');
    const isServiceRole = authHeader === `Bearer ${supabaseServiceKey}`;

    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!isServiceRole) {
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

    let requestedTickers: string[] | undefined;
    let days = 365;
    try {
      const body: HistoryRequest = await req.json();
      requestedTickers = body.tickers;
      days = body.days || 365;
    } catch {}

    let query = supabase.from('symbols').select('id, ticker, asset_type, metadata');
    if (requestedTickers?.length) {
      // When specific tickers are requested, bypass is_active filter (allows fetching pending/inactive symbols)
      query = query.in('ticker', requestedTickers);
    } else {
      query = query.eq('is_active', true);
    }
    const { data: symbols, error: symError } = await query;

    if (symError || !symbols?.length) {
      return new Response(JSON.stringify({ error: symError?.message || 'no symbols' }), {
        status: symError ? 500 : 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Fetching history for ${symbols.length} symbols, ${days} days`);
    const results: { ticker: string; records: number; source: string }[] = [];
    const errors: string[] = [];

    // ========== 1. CRYPTO via CoinGecko (with Yahoo fallback) ==========
    const cryptoSymbols = symbols.filter(s => CRYPTO_IDS[s.ticker]);
    const CRYPTO_YAHOO: Record<string, string> = {
      'BTC': 'BTC-USD', 'ETH': 'ETH-USD', 'SOL': 'SOL-USD', 'XRP': 'XRP-USD',
      'ADA': 'ADA-USD', 'AVAX': 'AVAX-USD', 'DOT': 'DOT-USD', 'LINK': 'LINK-USD',
      'DOGE': 'DOGE-USD', 'MATIC': 'MATIC-USD', 'LTC': 'LTC-USD', 'UNI': 'UNI-USD',
      'ATOM': 'ATOM-USD', 'NEAR': 'NEAR-USD', 'APT': 'APT-USD', 'ARB': 'ARB-USD', 'OP': 'OP-USD',
    };

    for (const symbol of cryptoSymbols) {
      const coinId = CRYPTO_IDS[symbol.ticker];
      console.log(`Fetching crypto: ${symbol.ticker} (${coinId})`);
      let fetched = false;

      // Try CoinGecko first
      const fetchCrypto = async () => {
        const res = await fetch(`https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`);
        if (res.status === 429) throw new Error('Rate limited');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) return null;
        const byDate = new Map<string, any>();
        for (const candle of data) {
          const dateStr = new Date(candle[0]).toISOString().split('T')[0];
          byDate.set(dateStr, {
            symbol_id: symbol.id, date: dateStr,
            open_price: candle[1], high_price: candle[2],
            low_price: candle[3], close_price: candle[4],
            volume: null, source: 'coingecko',
          });
        }
        return Array.from(byDate.values());
      };

      const records = await withRetry(fetchCrypto, 1, 8000);
      if (records && records.length > 0) {
        await upsertAndTrack(supabase, symbol.ticker, records, 'coingecko', results, errors);
        console.log(`✓ CoinGecko ${symbol.ticker}: ${records.length} days`);
        fetched = true;
      }

      // Yahoo Finance fallback for crypto
      if (!fetched && CRYPTO_YAHOO[symbol.ticker]) {
        console.log(`Yahoo fallback crypto: ${symbol.ticker} -> ${CRYPTO_YAHOO[symbol.ticker]}`);
        try {
          const data = await fetchYahooHistory(CRYPTO_YAHOO[symbol.ticker], days);
          if (data) {
            const yahooRecords = yahooToRecords(symbol.id, data, 'yahoo_crypto');
            await upsertAndTrack(supabase, symbol.ticker, yahooRecords, 'yahoo_crypto', results, errors);
            console.log(`✓ Yahoo crypto ${symbol.ticker}: ${yahooRecords.length} days`);
            fetched = true;
          }
          await new Promise(r => setTimeout(r, 500));
        } catch (e) { console.error(`Yahoo crypto fallback failed ${symbol.ticker}:`, e); }
      }

      if (!fetched) {
        errors.push(`${symbol.ticker}: CoinGecko + Yahoo both failed`);
      }

      // 6s delay between CoinGecko calls
      await new Promise(r => setTimeout(r, 6000));
    }

    // ========== 2. US STOCKS: FMP primary -> Yahoo fallback ==========
    const usStockSymbols = symbols.filter(s => US_STOCKS.includes(s.ticker));
    console.log(`Fetching ${usStockSymbols.length} US stocks history — FMP primary`);

    for (const symbol of usStockSymbols) {
      let fetched = false;

      if (FMP_API_KEY) {
        const fmpData = await fetchFmpHistory(symbol.ticker, days, FMP_API_KEY);
        if (fmpData && fmpData.length > 0) {
          const records = fmpToRecords(symbol.id, fmpData);
          await upsertAndTrack(supabase, symbol.ticker, records, 'fmp', results, errors);
          console.log(`✓ FMP history ${symbol.ticker}: ${fmpData.length} days`);
          fetched = true;
        }
        await new Promise(r => setTimeout(r, 150));
      }

      if (!fetched) {
        console.log(`Yahoo fallback history: ${symbol.ticker}`);
        try {
          const data = await fetchYahooHistory(symbol.ticker, days);
          if (data) {
            const records = yahooToRecords(symbol.id, data);
            await upsertAndTrack(supabase, symbol.ticker, records, 'yahoo_fallback', results, errors);
          } else { errors.push(`${symbol.ticker}: no history from FMP or Yahoo`); }
          await new Promise(r => setTimeout(r, 500));
        } catch (e) { errors.push(`${symbol.ticker}: ${e}`); }
      }
    }

    // ========== 3. NORDIC STOCKS: FMP primary -> Yahoo fallback ==========
    const nordicSuffixes = ['.ST', '.OL', '.CO', '.HE'];
    const stockSymbols = symbols.filter(s =>
      NORDIC_STOCKS[s.ticker] || nordicSuffixes.some(suffix => s.ticker.endsWith(suffix))
    );
    console.log(`Fetching ${stockSymbols.length} Nordic stocks history — FMP primary`);

    for (const symbol of stockSymbols) {
      const exchangeSymbol = NORDIC_STOCKS[symbol.ticker] || symbol.ticker;
      let fetched = false;

      if (FMP_API_KEY) {
        const fmpData = await fetchFmpHistory(exchangeSymbol, days, FMP_API_KEY);
        if (fmpData && fmpData.length > 0) {
          const records = fmpToRecords(symbol.id, fmpData);
          await upsertAndTrack(supabase, symbol.ticker, records, 'fmp', results, errors);
          console.log(`✓ FMP history ${symbol.ticker}: ${fmpData.length} days`);
          fetched = true;
        }
        await new Promise(r => setTimeout(r, 150));
      }

      if (!fetched) {
        console.log(`Yahoo fallback history: ${symbol.ticker} -> ${exchangeSymbol}`);
        try {
          const data = await fetchYahooHistory(exchangeSymbol, days);
          if (data) {
            const records = yahooToRecords(symbol.id, data);
            await upsertAndTrack(supabase, symbol.ticker, records, 'yahoo_fallback', results, errors);
          } else { errors.push(`${symbol.ticker}: no history from FMP or Yahoo (${exchangeSymbol})`); }
          await new Promise(r => setTimeout(r, 500));
        } catch (e) { errors.push(`${symbol.ticker}: ${e}`); }
      }
    }

    // ========== 4. METALS via FMP primary -> Yahoo futures fallback ==========
    const metalSymbols = symbols.filter(s => METAL_YAHOO[s.ticker]);
    console.log(`Fetching ${metalSymbols.length} metals history — FMP/Yahoo`);

    for (const symbol of metalSymbols) {
      let fetched = false;

      // Try FMP with commodity ticker (XAUUSD etc.)
      if (FMP_API_KEY && METAL_FMP[symbol.ticker]) {
        const fmpData = await fetchFmpHistory(METAL_FMP[symbol.ticker], days, FMP_API_KEY);
        if (fmpData && fmpData.length > 0) {
          const records = fmpToRecords(symbol.id, fmpData);
          await upsertAndTrack(supabase, symbol.ticker, records, 'fmp', results, errors);
          console.log(`✓ FMP metal ${symbol.ticker}: ${fmpData.length} days`);
          fetched = true;
        } else {
          console.log(`FMP metal returned no data for ${METAL_FMP[symbol.ticker]}`);
        }
        await new Promise(r => setTimeout(r, 150));
      }

      // Yahoo futures fallback (GC=F, SI=F, etc.)
      if (!fetched && METAL_YAHOO[symbol.ticker]) {
        const yahooTicker = METAL_YAHOO[symbol.ticker];
        console.log(`Yahoo fallback metal: ${symbol.ticker} -> ${yahooTicker}`);
        try {
          const data = await fetchYahooHistory(yahooTicker, days);
          if (data) {
            const records = yahooToRecords(symbol.id, data, 'yahoo_metal');
            await upsertAndTrack(supabase, symbol.ticker, records, 'yahoo_metal', results, errors);
            console.log(`✓ Yahoo metal ${symbol.ticker}: ${records.length} days`);
            fetched = true;
          } else {
            console.log(`Yahoo metal returned no data for ${yahooTicker}`);
          }
          await new Promise(r => setTimeout(r, 500));
        } catch (e) { errors.push(`${symbol.ticker}: ${e}`); }
      }

      if (!fetched) {
        errors.push(`${symbol.ticker}: no metal history from FMP or Yahoo`);
      }
    }

    // ========== 5. FUNDS via proxy-index (FMP/Yahoo) ==========
    // Extend FUND_PROXY with metadata-based proxies
    for (const s of symbols) {
      if (s.asset_type === 'fund' && !FUND_PROXY[s.ticker]) {
        const proxy = (s.metadata as any)?.proxy_etf;
        if (proxy) FUND_PROXY[s.ticker] = proxy;
      }
    }
    const fundSymbols = symbols.filter(s => FUND_PROXY[s.ticker]);
    console.log(`Fetching ${fundSymbols.length} fund proxies`);

    for (const symbol of fundSymbols) {
      const proxyTicker = FUND_PROXY[symbol.ticker];
      let fetched = false;

      // Try FMP for proxy ETF
      if (FMP_API_KEY) {
        const fmpData = await fetchFmpHistory(proxyTicker, days, FMP_API_KEY);
        if (fmpData && fmpData.length > 0) {
          const records = fmpToRecords(symbol.id, fmpData).map(r => ({ ...r, source: 'fmp_proxy' }));
          await upsertAndTrack(supabase, symbol.ticker, records, 'fmp_proxy', results, errors);
          console.log(`✓ FMP proxy ${symbol.ticker} (${proxyTicker}): ${fmpData.length} days`);
          fetched = true;
        }
        await new Promise(r => setTimeout(r, 150));
      }

      // Yahoo fallback for proxy ETF
      if (!fetched) {
        console.log(`Yahoo fallback proxy: ${symbol.ticker} -> ${proxyTicker}`);
        try {
          const data = await fetchYahooHistory(proxyTicker, days);
          if (data) {
            const records = yahooToRecords(symbol.id, data, 'yahoo_proxy');
            await upsertAndTrack(supabase, symbol.ticker, records, 'yahoo_proxy', results, errors);
            console.log(`✓ Yahoo proxy ${symbol.ticker}: ${records.length} days`);
          } else {
            errors.push(`${symbol.ticker}: no proxy history (${proxyTicker})`);
          }
          await new Promise(r => setTimeout(r, 500));
        } catch (e) { errors.push(`${symbol.ticker}: ${e}`); }
      }
    }

    const totalRecords = results.reduce((sum, r) => sum + r.records, 0);
    console.log(`Done: ${totalRecords} records for ${results.length} symbols. Errors: ${errors.length}`);

    return new Response(JSON.stringify({
      success: true, fetched: results, totalRecords,
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
