import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-call',
};

// Crypto ticker to CoinGecko ID mapping
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

// Nordic stocks - ticker to Yahoo symbol mapping
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

  // --- Fixade/tillagda mappningar för saknade tickers ---
  'ATRLJ-B': 'ATRLJ-B.ST',
  'COLL': 'COLL.ST',
  // Felaktiga .ST-tickers -> rätt Yahoo-symbol
  'EMBRACER-B.ST': 'EMBRAC-B.ST',
  'BOLIDEN.ST': 'BOL.ST',
  'CALLIDITAS.ST': 'CALT.ST',
  'CALTX.ST': 'CALT.ST',
  'FAST.ST': 'BALD-B.ST',
  'FORTN.ST': 'FORTUM.HE',
  'LUND-A.ST': 'LUND-B.ST',
  'LATOUR-B.ST': 'LATO-B.ST',
  'LOOM-B.ST': 'LOOMIS.ST',
  'SAGAX-B.ST': 'SAGA-B.ST',
  'SAGAX-D.ST': 'SAGA-D.ST',
  'STILLF.ST': 'SF.ST',
  'MTRS-B.ST': 'MTRS.ST',
  'MVIR-B.ST': 'MCOV-B.ST',
  'AF-B.ST': 'AFB.ST',
  'RESURS.ST': 'RESURS.ST',
  'PROB.ST': 'PROB.ST',
  'KNOWIT.ST': 'KNOW.ST',
  'OX2.ST': 'OX2.ST',
  'BIOT.ST': 'BIOT.ST',
  'FENIX.ST': 'FOI-B.ST',
  'EWORK.ST': 'EWRK.ST',
  'NPAPER.ST': 'NPAPER.ST',

  // Norway (Oslo Børs)
  'EQNR': 'EQNR.OL', 'DNB': 'DNB.OL', 'TEL': 'TEL.OL',
  'MOWI': 'MOWI.OL', 'SALM': 'SALM.OL', 'YAR': 'YAR.OL',
  'ORK': 'ORK.OL', 'AKRBP': 'AKRBP.OL', 'KAHOT': 'KAHOT.OL', 'AUSS': 'AUSS.OL',
  'TOM': 'TOM.OL', 'BAKKA': 'BAKKA.OL', 'AFG': 'AFG.OL',
  
  // Denmark (OMX Copenhagen)
  'NOVO-B': 'NOVO-B.CO', 'MAERSK-B': 'MAERSK-B.CO', 'CARL-B': 'CARL-B.CO',
  'VWS': 'VWS.CO', 'DSV': 'DSV.CO', 'ORSTED': 'ORSTED.CO',
  'COLO-B': 'COLO-B.CO', 'DEMANT': 'DEMANT.CO', 'PNDORA': 'PNDORA.CO', 'GN': 'GN.CO',
  'JYSK': 'JYSK.CO', 'FLS': 'FLS.CO', 'TRYG': 'TRYG.CO',
  
  // Finland (OMX Helsinki)
  'SITOW': 'SITOWS.HE', 'NOKIA': 'NOKIA.HE', 'FORTUM': 'FORTUM.HE',
  'NESTE': 'NESTE.HE', 'UPM': 'UPM.HE', 'SAMPO': 'SAMPO.HE',
  'KNEBV': 'KNEBV.HE', 'WRT1V': 'WRT1V.HE', 'STERV': 'STERV.HE',
  'KESKOB': 'KESKOB.HE', 'ELISA': 'ELISA.HE', 'ORNBV': 'ORNBV.HE',
  'TYRES': 'TYRES.HE', 'METSB': 'METSB.HE',
};

// US stocks
const US_STOCKS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'JPM', 'V', 'JNJ', 'SPOT', 'AMD'];

interface HistoryRequest {
  tickers?: string[];
  days?: number;
}

// Helper: fetch Yahoo Finance data for a symbol
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

// Helper: convert Yahoo data to price_history records
function yahooToRecords(symbolId: string, data: { timestamp: number[]; quotes: any }): any[] {
  const records: any[] = [];
  for (let i = 0; i < data.timestamp.length; i++) {
    if (data.quotes.close?.[i] != null) {
      const dateStr = new Date(data.timestamp[i] * 1000).toISOString().split('T')[0];
      records.push({
        symbol_id: symbolId,
        date: dateStr,
        open_price: data.quotes.open?.[i] || data.quotes.close[i],
        high_price: data.quotes.high?.[i] || data.quotes.close[i],
        low_price: data.quotes.low?.[i] || data.quotes.close[i],
        close_price: data.quotes.close[i],
        volume: data.quotes.volume?.[i] || null,
        source: 'yahoo',
      });
    }
  }
  return records;
}

// Helper: upsert records and track results
async function upsertAndTrack(
  supabase: any,
  ticker: string,
  records: any[],
  source: string,
  results: { ticker: string; records: number; source: string }[],
  errors: string[]
) {
  if (records.length === 0) return;
  const { error } = await supabase
    .from('price_history')
    .upsert(records, { onConflict: 'symbol_id,date,source', ignoreDuplicates: true });
  if (error) {
    errors.push(`${ticker}: ${error.message}`);
  } else {
    results.push({ ticker, records: records.length, source });
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
    const isServiceRole = authHeader === `Bearer ${supabaseServiceKey}`;

    if (!authHeader?.startsWith('Bearer ') && !isInternalCall) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!isInternalCall && !isServiceRole) {
      if (!authHeader?.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
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

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const ALPHA_VANTAGE_API_KEY = Deno.env.get('ALPHA_VANTAGE_API_KEY');

    // Parse request body
    let requestedTickers: string[] | undefined;
    let days = 365;
    try {
      const body: HistoryRequest = await req.json();
      requestedTickers = body.tickers;
      days = body.days || 365;
    } catch {}

    // Get symbols
    let query = supabase.from('symbols').select('id, ticker, asset_type').eq('is_active', true);
    if (requestedTickers?.length) {
      query = query.in('ticker', requestedTickers);
    }
    const { data: symbols, error: symError } = await query;

    if (symError || !symbols?.length) {
      return new Response(JSON.stringify({ error: symError?.message || 'no symbols' }), {
        status: symError ? 500 : 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Fetching history for ${symbols.length} symbols, ${days} days`);
    
    const results: { ticker: string; records: number; source: string }[] = [];
    const errors: string[] = [];

    // 1. Fetch crypto from CoinGecko (increased delay to 4s)
    const cryptoSymbols = symbols.filter(s => CRYPTO_IDS[s.ticker]);
    for (const symbol of cryptoSymbols) {
      const coinId = CRYPTO_IDS[symbol.ticker];
      console.log(`Fetching crypto: ${symbol.ticker} (${coinId})`);
      try {
        const res = await fetch(
          `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`
        );
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
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
            await upsertAndTrack(supabase, symbol.ticker, Array.from(byDate.values()), 'coingecko', results, errors);
          }
        } else {
          errors.push(`${symbol.ticker}: CoinGecko HTTP ${res.status}`);
        }
        await new Promise(resolve => setTimeout(resolve, 4000)); // 4s delay
      } catch (e) {
        errors.push(`${symbol.ticker}: ${e}`);
      }
    }

    // 2. Fetch Nordic stocks from Yahoo Finance
    // Include symbols with mapping OR ending with Nordic suffixes
    const nordicSuffixes = ['.ST', '.OL', '.CO', '.HE'];
    const stockSymbols = symbols.filter(s => 
      NORDIC_STOCKS[s.ticker] || nordicSuffixes.some(suffix => s.ticker.endsWith(suffix))
    );
    console.log(`Fetching ${stockSymbols.length} Nordic stocks from Yahoo`);
    
    for (const symbol of stockSymbols) {
      try {
        const yahooSymbol = NORDIC_STOCKS[symbol.ticker] || symbol.ticker;
        console.log(`Yahoo: ${symbol.ticker} -> ${yahooSymbol}`);
        
        const data = await fetchYahooHistory(yahooSymbol, days);
        if (data) {
          const records = yahooToRecords(symbol.id, data);
          await upsertAndTrack(supabase, symbol.ticker, records, 'yahoo', results, errors);
        } else {
          console.log(`Yahoo: no data for ${symbol.ticker} (${yahooSymbol})`);
          errors.push(`${symbol.ticker}: Yahoo no data (${yahooSymbol})`);
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (e) {
        console.error(`Yahoo error ${symbol.ticker}:`, e);
        errors.push(`${symbol.ticker}: ${e}`);
      }
    }

    // 3. Fetch US stocks from Yahoo Finance
    const usStockSymbols = symbols.filter(s => US_STOCKS.includes(s.ticker));
    console.log(`Fetching ${usStockSymbols.length} US stocks from Yahoo`);
    
    for (const symbol of usStockSymbols) {
      try {
        console.log(`Yahoo US: ${symbol.ticker}`);
        const data = await fetchYahooHistory(symbol.ticker, days);
        if (data) {
          const records = yahooToRecords(symbol.id, data);
          await upsertAndTrack(supabase, symbol.ticker, records, 'yahoo', results, errors);
        } else {
          errors.push(`${symbol.ticker}: Yahoo no data`);
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (e) {
        errors.push(`${symbol.ticker}: ${e}`);
      }
    }

    // 4. Metals via Alpha Vantage - fetch ALL 4 (no limit)
    if (ALPHA_VANTAGE_API_KEY) {
      const metalSymbols = symbols.filter(s => ['XAU', 'XAG', 'XPT', 'XPD'].includes(s.ticker));
      console.log(`Fetching ${metalSymbols.length} metals from Alpha Vantage`);
      
      for (const symbol of metalSymbols) {
        try {
          const res = await fetch(
            `https://www.alphavantage.co/query?function=FX_DAILY&from_symbol=${symbol.ticker}&to_symbol=USD&outputsize=compact&apikey=${ALPHA_VANTAGE_API_KEY}`
          );
          if (res.ok) {
            const data = await res.json();
            const timeSeries = data['Time Series FX (Daily)'];
            if (timeSeries) {
              const records = Object.entries(timeSeries)
                .slice(0, days)
                .map(([date, values]: [string, any]) => ({
                  symbol_id: symbol.id, date,
                  open_price: parseFloat(values['1. open']),
                  high_price: parseFloat(values['2. high']),
                  low_price: parseFloat(values['3. low']),
                  close_price: parseFloat(values['4. close']),
                  volume: null, source: 'alphavantage',
                }));
              await upsertAndTrack(supabase, symbol.ticker, records, 'alphavantage', results, errors);
            } else if (data.Note || data.Information) {
              console.log('Alpha Vantage rate limit:', data.Note || data.Information);
              errors.push(`${symbol.ticker}: AV rate limit`);
            }
          }
          await new Promise(resolve => setTimeout(resolve, 15000)); // 15s between AV calls
        } catch (e) {
          errors.push(`${symbol.ticker}: ${e}`);
        }
      }
    }

    const totalRecords = results.reduce((sum, r) => sum + r.records, 0);
    console.log(`Done: ${totalRecords} records for ${results.length} symbols. Errors: ${errors.length}`);

    return new Response(JSON.stringify({
      success: true,
      fetched: results,
      totalRecords,
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
