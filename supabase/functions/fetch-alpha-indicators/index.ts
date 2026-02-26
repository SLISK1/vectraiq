import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Alpha Vantage budget: 25 req/day free tier
// Strategy: fetch 4 indicators + 1 intraday = 5 req per symbol, max 5 symbols = 25 req
const INDICATORS_TO_FETCH = ['RSI', 'MACD', 'ADX', 'VWAP'] as const;
const MAX_SYMBOLS = 5;

// Map our tickers to Alpha Vantage compatible symbols
const TICKER_TO_AV: Record<string, string> = {
  // US stocks work directly
  'AAPL': 'AAPL', 'MSFT': 'MSFT', 'GOOGL': 'GOOGL', 'AMZN': 'AMZN',
  'NVDA': 'NVDA', 'META': 'META', 'TSLA': 'TSLA', 'JPM': 'JPM',
  'V': 'V', 'JNJ': 'JNJ', 'AMD': 'AMD', 'SPOT': 'SPOT',
  // Nordic stocks on AV use Yahoo-style suffixes
  'VOLV_B': 'VOLV-B.ST', 'ERIC-B': 'ERIC-B.ST', 'HM-B': 'HM-B.ST',
  'SEB-A': 'SEB-A.ST', 'ABB': 'ABB.ST', 'EVO': 'EVO.ST',
  'SAAB-B': 'SAAB-B.ST', 'SAND': 'SAND.ST', 'AZN': 'AZN.ST',
  'NDA-SE': 'NDA-SE.ST', 'NOVO-B': 'NOVO-B.CO', 'EQNR': 'EQNR.OL',
};

interface AVResponse {
  [key: string]: any;
}

async function fetchAVIndicator(
  apiKey: string,
  avSymbol: string,
  indicator: string,
  interval: string = '60min'
): Promise<any | null> {
  try {
    let url: string;
    
    if (indicator === 'INTRADAY') {
      url = `https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=${avSymbol}&interval=${interval}&outputsize=compact&apikey=${apiKey}`;
    } else if (indicator === 'VWAP') {
      url = `https://www.alphavantage.co/query?function=VWAP&symbol=${avSymbol}&interval=${interval}&apikey=${apiKey}`;
    } else if (indicator === 'RSI') {
      url = `https://www.alphavantage.co/query?function=RSI&symbol=${avSymbol}&interval=${interval}&time_period=14&series_type=close&apikey=${apiKey}`;
    } else if (indicator === 'MACD') {
      url = `https://www.alphavantage.co/query?function=MACD&symbol=${avSymbol}&interval=${interval}&series_type=close&apikey=${apiKey}`;
    } else if (indicator === 'ADX') {
      url = `https://www.alphavantage.co/query?function=ADX&symbol=${avSymbol}&interval=${interval}&time_period=14&apikey=${apiKey}`;
    } else {
      return null;
    }

    const res = await fetch(url);
    if (!res.ok) {
      console.log(`AV HTTP error for ${avSymbol}/${indicator}: ${res.status}`);
      return null;
    }

    const data: AVResponse = await res.json();

    // Check for rate limit or error
    if (data['Note'] || data['Information']) {
      console.log(`AV rate limit hit: ${data['Note'] || data['Information']}`);
      return null;
    }
    if (data['Error Message']) {
      console.log(`AV error for ${avSymbol}/${indicator}: ${data['Error Message']}`);
      return null;
    }

    return parseAVResponse(indicator, data, interval);
  } catch (e) {
    console.error(`AV fetch error ${avSymbol}/${indicator}:`, e);
    return null;
  }
}

function parseAVResponse(indicator: string, data: AVResponse, interval: string): any | null {
  if (indicator === 'INTRADAY') {
    const seriesKey = `Time Series (${interval})`;
    const series = data[seriesKey];
    if (!series) return null;

    const entries = Object.entries(series).slice(0, 30); // Last 30 candles
    return {
      candles: entries.map(([timestamp, values]: [string, any]) => ({
        timestamp,
        open: parseFloat(values['1. open']),
        high: parseFloat(values['2. high']),
        low: parseFloat(values['3. low']),
        close: parseFloat(values['4. close']),
        volume: parseInt(values['5. volume']),
      })),
    };
  }

  if (indicator === 'RSI') {
    const rsiData = data['Technical Analysis: RSI'];
    if (!rsiData) return null;
    const entries = Object.entries(rsiData).slice(0, 20);
    return {
      values: entries.map(([timestamp, v]: [string, any]) => ({
        timestamp,
        rsi: parseFloat(v['RSI']),
      })),
      latest: parseFloat((Object.values(rsiData) as any[])[0]?.['RSI'] ?? '0'),
    };
  }

  if (indicator === 'MACD') {
    const macdData = data['Technical Analysis: MACD'];
    if (!macdData) return null;
    const entries = Object.entries(macdData).slice(0, 20);
    return {
      values: entries.map(([timestamp, v]: [string, any]) => ({
        timestamp,
        macd: parseFloat(v['MACD']),
        signal: parseFloat(v['MACD_Signal']),
        histogram: parseFloat(v['MACD_Hist']),
      })),
      latest: {
        macd: parseFloat((Object.values(macdData) as any[])[0]?.['MACD'] ?? '0'),
        signal: parseFloat((Object.values(macdData) as any[])[0]?.['MACD_Signal'] ?? '0'),
        histogram: parseFloat((Object.values(macdData) as any[])[0]?.['MACD_Hist'] ?? '0'),
      },
    };
  }

  if (indicator === 'ADX') {
    const adxData = data['Technical Analysis: ADX'];
    if (!adxData) return null;
    const entries = Object.entries(adxData).slice(0, 20);
    return {
      values: entries.map(([timestamp, v]: [string, any]) => ({
        timestamp,
        adx: parseFloat(v['ADX']),
      })),
      latest: parseFloat((Object.values(adxData) as any[])[0]?.['ADX'] ?? '0'),
    };
  }

  if (indicator === 'VWAP') {
    const vwapData = data['Technical Analysis: VWAP'];
    if (!vwapData) return null;
    const entries = Object.entries(vwapData).slice(0, 20);
    return {
      values: entries.map(([timestamp, v]: [string, any]) => ({
        timestamp,
        vwap: parseFloat(v['VWAP']),
      })),
      latest: parseFloat((Object.values(vwapData) as any[])[0]?.['VWAP'] ?? '0'),
    };
  }

  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const ALPHA_VANTAGE_API_KEY = Deno.env.get('ALPHA_VANTAGE_API_KEY');

    if (!ALPHA_VANTAGE_API_KEY) {
      return new Response(JSON.stringify({ error: 'ALPHA_VANTAGE_API_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Auth check
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const isServiceRole = authHeader === `Bearer ${supabaseServiceKey}`;
    if (!isServiceRole) {
      const supabaseAuth = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } },
      });
      const token = authHeader.replace('Bearer ', '');
      const { error: authError } = await supabaseAuth.auth.getUser(token);
      if (authError) {
        return new Response(JSON.stringify({ error: 'Invalid token' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request body for optional symbol filter
    let targetTickers: string[] | null = null;
    try {
      const body = await req.json();
      if (body?.tickers && Array.isArray(body.tickers)) {
        targetTickers = body.tickers;
      }
    } catch { /* no body, use defaults */ }

    // Get symbols that have AV mappings
    const { data: symbols, error: symError } = await supabase
      .from('symbols')
      .select('id, ticker, asset_type')
      .eq('is_active', true);

    if (symError || !symbols) {
      return new Response(JSON.stringify({ error: symError?.message || 'No symbols' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Filter to symbols with AV mappings, prioritize by request or default to US large caps
    let eligibleSymbols = symbols.filter(s => TICKER_TO_AV[s.ticker]);
    
    if (targetTickers) {
      eligibleSymbols = eligibleSymbols.filter(s => targetTickers!.includes(s.ticker));
    }

    // Limit to MAX_SYMBOLS to stay within budget
    const selectedSymbols = eligibleSymbols.slice(0, MAX_SYMBOLS);
    console.log(`Fetching AV indicators for ${selectedSymbols.length} symbols: ${selectedSymbols.map(s => s.ticker).join(', ')}`);

    // Check which symbols already have fresh cache (valid_until > now)
    const { data: existingCache } = await supabase
      .from('alpha_indicators_cache')
      .select('symbol_id, indicator_type')
      .in('symbol_id', selectedSymbols.map(s => s.id))
      .gt('valid_until', new Date().toISOString());

    const cachedSet = new Set(
      (existingCache || []).map(c => `${c.symbol_id}:${c.indicator_type}`)
    );

    const results: { ticker: string; indicator: string; status: string }[] = [];
    let requestCount = 0;

    for (const symbol of selectedSymbols) {
      const avSymbol = TICKER_TO_AV[symbol.ticker];
      
      // Fetch indicators
      for (const indicator of INDICATORS_TO_FETCH) {
        const cacheKey = `${symbol.id}:${indicator}`;
        if (cachedSet.has(cacheKey)) {
          results.push({ ticker: symbol.ticker, indicator, status: 'cached' });
          continue;
        }

        if (requestCount >= 25) {
          results.push({ ticker: symbol.ticker, indicator, status: 'budget_exhausted' });
          continue;
        }

        const data = await fetchAVIndicator(ALPHA_VANTAGE_API_KEY, avSymbol, indicator);
        requestCount++;

        if (data) {
          const validUntil = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(); // 6h
          await supabase.from('alpha_indicators_cache').upsert({
            symbol_id: symbol.id,
            indicator_type: indicator,
            timeframe: '60min',
            data,
            fetched_at: new Date().toISOString(),
            valid_until: validUntil,
          }, { onConflict: 'symbol_id,indicator_type,timeframe' });

          results.push({ ticker: symbol.ticker, indicator, status: 'fetched' });
          console.log(`✓ ${symbol.ticker} ${indicator}: OK`);
        } else {
          results.push({ ticker: symbol.ticker, indicator, status: 'failed' });
          console.log(`✗ ${symbol.ticker} ${indicator}: failed`);
        }

        // Rate limit: 5 req/min on free tier = 12s between calls
        await new Promise(r => setTimeout(r, 12500));
      }

      // Fetch intraday (1 req per symbol)
      const intradayCacheKey = `${symbol.id}:INTRADAY`;
      if (!cachedSet.has(intradayCacheKey) && requestCount < 25) {
        const intradayData = await fetchAVIndicator(ALPHA_VANTAGE_API_KEY, avSymbol, 'INTRADAY');
        requestCount++;

        if (intradayData) {
          const validUntil = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2h for intraday
          await supabase.from('alpha_indicators_cache').upsert({
            symbol_id: symbol.id,
            indicator_type: 'INTRADAY',
            timeframe: '60min',
            data: intradayData,
            fetched_at: new Date().toISOString(),
            valid_until: validUntil,
          }, { onConflict: 'symbol_id,indicator_type,timeframe' });

          results.push({ ticker: symbol.ticker, indicator: 'INTRADAY', status: 'fetched' });
          console.log(`✓ ${symbol.ticker} INTRADAY: ${intradayData.candles?.length} candles`);
        } else {
          results.push({ ticker: symbol.ticker, indicator: 'INTRADAY', status: 'failed' });
        }

        await new Promise(r => setTimeout(r, 12500));
      } else if (cachedSet.has(intradayCacheKey)) {
        results.push({ ticker: symbol.ticker, indicator: 'INTRADAY', status: 'cached' });
      }
    }

    console.log(`Done. ${requestCount} API requests used.`);

    return new Response(JSON.stringify({
      symbols_processed: selectedSymbols.length,
      requests_used: requestCount,
      budget_remaining: 25 - requestCount,
      results,
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
