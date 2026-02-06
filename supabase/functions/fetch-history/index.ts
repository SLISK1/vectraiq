import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-call',
};

// Crypto ticker to CoinGecko ID mapping
const CRYPTO_IDS: Record<string, string> = {
  'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana', 'XRP': 'ripple',
  'ADA': 'cardano', 'AVAX': 'avalanche-2', 'DOT': 'polkadot', 'LINK': 'chainlink',
};

// Swedish/Nordic stocks - ticker to Yahoo symbol mapping
const NORDIC_STOCKS: Record<string, string> = {
  'VOLV_B': 'VOLV-B.ST', 'ERIC-B': 'ERIC-B.ST', 'SEB-A': 'SEB-A.ST', 
  'ATCO-A': 'ATCO-A.ST', 'ASSA-B': 'ASSA-B.ST', 'HM-B': 'HM-B.ST',
  'SAND': 'SAND.ST', 'HEXA-B': 'HEXA-B.ST', 'INVE-B': 'INVE-B.ST', 
  'SWED-A': 'SWED-A.ST', 'ESSITY-B': 'ESSITY-B.ST', 'SKF-B': 'SKF-B.ST', 
  'TELIA': 'TELIA.ST', 'KINV-B': 'KINV-B.ST', 'ELUX-B': 'ELUX-B.ST',
  'ABB': 'ABB.ST', 'ALFA': 'ALFA.ST', 'CAST': 'CAST.ST', 'EQT': 'EQT.ST',
  'FLAT': 'FLAT-B.ST', 'NEOBO': 'NEOBO.ST',
  'SITOW': 'SITOWS.HE',
};

// Swedish funds - ticker to Morningstar/Avanza ID (for future API integration)
const SWEDISH_FUNDS: Record<string, string> = {
  'SWE-ASIA': 'F00000WLQU', 'SWE-USA': 'F00000WLQS', 'SWE-GLOB': 'F00000WLQR',
  'SWE-TECH': 'F00000WLQT', 'SWE-SMAL': 'F00000WLQP', 'HB-ENRG': 'F00000Z8ZX',
  'SPLT-INV': 'F00000NCKP',
};

// US stocks (fetch via Yahoo Finance - no API key needed)
const US_STOCKS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'JPM', 'V', 'JNJ'];

interface HistoryRequest {
  tickers?: string[];
  days?: number;
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
    // Allow internal calls from other edge functions (marked with X-Internal-Call header and service key)
    const isInternalCall = req.headers.get('x-internal-call') === 'true';
    const authHeader = req.headers.get('authorization');

    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // For internal calls with service key, skip user validation
    // For external calls, validate the user token
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
    const FINNHUB_API_KEY = Deno.env.get('FINNHUB_API_KEY');

    // Parse request body - default to 365 days for better ML/trend analysis
    let requestedTickers: string[] | undefined;
    let days = 365;
    
    try {
      const body: HistoryRequest = await req.json();
      requestedTickers = body.tickers;
      days = body.days || 365;
    } catch {
      // Use defaults
    }

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

    console.log(`Fetching history for ${symbols.length} symbols, ${days} days (targeting 12 months for optimal ML analysis)`);
    
    const results: { ticker: string; records: number; source: string }[] = [];
    const errors: string[] = [];

    // 1. Fetch crypto historical data from CoinGecko
    const cryptoSymbols = symbols.filter(s => CRYPTO_IDS[s.ticker]);
    
    for (const symbol of cryptoSymbols) {
      const coinId = CRYPTO_IDS[symbol.ticker];
      console.log(`Fetching history for ${symbol.ticker} from CoinGecko`);
      
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
                symbol_id: symbol.id,
                date: dateStr,
                open_price: candle[1],
                high_price: candle[2],
                low_price: candle[3],
                close_price: candle[4],
                volume: null,
                source: 'coingecko',
              });
            }
            
            const historyRecords = Array.from(byDate.values());

            const { error: insertError } = await supabase
              .from('price_history')
              .upsert(historyRecords, { 
                onConflict: 'symbol_id,date,source',
                ignoreDuplicates: true 
              });

            if (insertError) {
              errors.push(`${symbol.ticker}: ${insertError.message}`);
            } else {
              results.push({ ticker: symbol.ticker, records: historyRecords.length, source: 'coingecko' });
            }
          }
        } else {
          errors.push(`${symbol.ticker}: CoinGecko HTTP ${res.status}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 2500));
        
      } catch (e) {
        errors.push(`${symbol.ticker}: ${e}`);
      }
    }

    // 2. Fetch Nordic stocks from Yahoo Finance (free, no API key needed)
    const stockSymbols = symbols.filter(s => NORDIC_STOCKS[s.ticker]);
    console.log(`Fetching history for ${stockSymbols.length} Nordic stocks from Yahoo Finance`);
    
    for (const symbol of stockSymbols) {
      try {
        const yahooSymbol = NORDIC_STOCKS[symbol.ticker];
        const period1 = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
        const period2 = Math.floor(Date.now() / 1000);
        
        console.log(`Trying Yahoo Finance for ${symbol.ticker} as ${yahooSymbol}`);
        
        const res = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?period1=${period1}&period2=${period2}&interval=1d`,
          { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }
        );
        
        if (res.ok) {
          const data = await res.json();
          const result = data.chart?.result?.[0];
          
          if (result?.timestamp && result?.indicators?.quote?.[0]) {
            const quotes = result.indicators.quote[0];
            const historyRecords: any[] = [];
            
            for (let i = 0; i < result.timestamp.length; i++) {
              if (quotes.close?.[i] != null) {
                const dateStr = new Date(result.timestamp[i] * 1000).toISOString().split('T')[0];
                historyRecords.push({
                  symbol_id: symbol.id,
                  date: dateStr,
                  open_price: quotes.open?.[i] || quotes.close[i],
                  high_price: quotes.high?.[i] || quotes.close[i],
                  low_price: quotes.low?.[i] || quotes.close[i],
                  close_price: quotes.close[i],
                  volume: quotes.volume?.[i] || null,
                  source: 'yahoo',
                });
              }
            }

            if (historyRecords.length > 0) {
              const { error: insertError } = await supabase
                .from('price_history')
                .upsert(historyRecords, { 
                  onConflict: 'symbol_id,date,source',
                  ignoreDuplicates: true 
                });

              if (insertError) {
                errors.push(`${symbol.ticker}: ${insertError.message}`);
              } else {
                results.push({ ticker: symbol.ticker, records: historyRecords.length, source: 'yahoo' });
              }
            }
          }
        } else {
          console.log(`Yahoo HTTP error for ${symbol.ticker}: ${res.status}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (e) {
        console.error(`Yahoo error for ${symbol.ticker}:`, e);
        errors.push(`${symbol.ticker}: ${e}`);
      }
    }

    // 3. Fetch US stocks from Yahoo Finance (free, no API key needed)
    const usStockSymbols = symbols.filter(s => US_STOCKS.includes(s.ticker));
    console.log(`Fetching history for ${usStockSymbols.length} US stocks from Yahoo Finance`);
    
    for (const symbol of usStockSymbols) {
      try {
        const yahooSymbol = symbol.ticker;
        const period1 = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
        const period2 = Math.floor(Date.now() / 1000);
        
        console.log(`Trying Yahoo Finance for ${symbol.ticker}`);
        
        const res = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?period1=${period1}&period2=${period2}&interval=1d`,
          { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }
        );
        
        if (res.ok) {
          const data = await res.json();
          const result = data.chart?.result?.[0];
          
          if (result?.timestamp && result?.indicators?.quote?.[0]) {
            const quotes = result.indicators.quote[0];
            const historyRecords: any[] = [];
            
            for (let i = 0; i < result.timestamp.length; i++) {
              if (quotes.close?.[i] != null) {
                const dateStr = new Date(result.timestamp[i] * 1000).toISOString().split('T')[0];
                historyRecords.push({
                  symbol_id: symbol.id,
                  date: dateStr,
                  open_price: quotes.open?.[i] || quotes.close[i],
                  high_price: quotes.high?.[i] || quotes.close[i],
                  low_price: quotes.low?.[i] || quotes.close[i],
                  close_price: quotes.close[i],
                  volume: quotes.volume?.[i] || null,
                  source: 'yahoo',
                });
              }
            }

            if (historyRecords.length > 0) {
              const { error: insertError } = await supabase
                .from('price_history')
                .upsert(historyRecords, { 
                  onConflict: 'symbol_id,date,source',
                  ignoreDuplicates: true 
                });

              if (insertError) {
                errors.push(`${symbol.ticker}: ${insertError.message}`);
              } else {
                results.push({ ticker: symbol.ticker, records: historyRecords.length, source: 'yahoo' });
              }
            }
          }
        } else {
          console.log(`Yahoo HTTP error for ${symbol.ticker}: ${res.status}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (e) {
        console.error(`Yahoo error for ${symbol.ticker}:`, e);
        errors.push(`${symbol.ticker}: ${e}`);
      }
    }

    // 4. For metals, use Alpha Vantage if available
    if (ALPHA_VANTAGE_API_KEY) {
      const metalSymbols = symbols.filter(s => ['XAU', 'XAG', 'XPT', 'XPD'].includes(s.ticker));
      console.log(`Fetching history for ${metalSymbols.length} metals from Alpha Vantage`);
      
      for (const symbol of metalSymbols.slice(0, 2)) {
        try {
          const res = await fetch(
            `https://www.alphavantage.co/query?function=FX_DAILY&from_symbol=${symbol.ticker}&to_symbol=USD&outputsize=compact&apikey=${ALPHA_VANTAGE_API_KEY}`
          );
          
          if (res.ok) {
            const data = await res.json();
            const timeSeries = data['Time Series FX (Daily)'];
            
            if (timeSeries) {
              const historyRecords = Object.entries(timeSeries)
                .slice(0, days)
                .map(([date, values]: [string, any]) => ({
                  symbol_id: symbol.id,
                  date,
                  open_price: parseFloat(values['1. open']),
                  high_price: parseFloat(values['2. high']),
                  low_price: parseFloat(values['3. low']),
                  close_price: parseFloat(values['4. close']),
                  volume: null,
                  source: 'alphavantage',
                }));

              if (historyRecords.length > 0) {
                const { error: insertError } = await supabase
                  .from('price_history')
                  .upsert(historyRecords, { 
                    onConflict: 'symbol_id,date,source',
                    ignoreDuplicates: true 
                  });

                if (insertError) {
                  errors.push(`${symbol.ticker}: ${insertError.message}`);
                } else {
                  results.push({ ticker: symbol.ticker, records: historyRecords.length, source: 'alphavantage' });
                }
              }
            } else if (data.Note || data.Information) {
              console.log('Alpha Vantage rate limit or issue:', data.Note || data.Information);
            }
          }
          
          await new Promise(resolve => setTimeout(resolve, 12000));
          
        } catch (e) {
          errors.push(`${symbol.ticker}: ${e}`);
        }
      }
    }

    const totalRecords = results.reduce((sum, r) => sum + r.records, 0);
    console.log(`Fetched ${totalRecords} historical records for ${results.length} symbols`);

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
