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

interface HistoryRequest {
  tickers?: string[];
  days?: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Parse request body
    let requestedTickers: string[] | undefined;
    let days = 60;
    
    try {
      const body: HistoryRequest = await req.json();
      requestedTickers = body.tickers;
      days = body.days || 60;
    } catch {
      // Use defaults if no body
    }

    // Get symbols
    let query = supabase.from('symbols').select('id, ticker, asset_type').eq('is_active', true);
    if (requestedTickers?.length) {
      query = query.in('ticker', requestedTickers);
    }
    
    const { data: symbols, error: symError } = await query;

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

    console.log(`Fetching history for ${symbols.length} symbols, ${days} days`);
    
    const results: { ticker: string; records: number; source: string }[] = [];
    const errors: string[] = [];

    // Fetch crypto historical data from CoinGecko
    const cryptoSymbols = symbols.filter(s => CRYPTO_IDS[s.ticker]);
    
    for (const symbol of cryptoSymbols) {
      const coinId = CRYPTO_IDS[symbol.ticker];
      console.log(`Fetching history for ${symbol.ticker} (${coinId})`);
      
      try {
        // CoinGecko market_chart endpoint - returns OHLC data
        const res = await fetch(
          `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`
        );
        
        if (res.ok) {
          const data = await res.json();
          // OHLC format: [[timestamp, open, high, low, close], ...]
          
          if (Array.isArray(data) && data.length > 0) {
            // Deduplicate by date - keep only the last entry for each date
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

            // Upsert to handle duplicates
            const { error: insertError } = await supabase
              .from('price_history')
              .upsert(historyRecords, { 
                onConflict: 'symbol_id,date,source',
                ignoreDuplicates: true 
              });

            if (insertError) {
              console.error(`Insert error for ${symbol.ticker}:`, insertError);
              errors.push(`${symbol.ticker}: ${insertError.message}`);
            } else {
              results.push({ ticker: symbol.ticker, records: historyRecords.length, source: 'coingecko' });
            }
          }
        } else {
          console.error(`CoinGecko error for ${symbol.ticker}: ${res.status}`);
          errors.push(`${symbol.ticker}: HTTP ${res.status}`);
        }
        
        // Rate limiting - CoinGecko free tier is 10-30 calls/minute
        await new Promise(resolve => setTimeout(resolve, 2500));
        
      } catch (e) {
        console.error(`Error fetching ${symbol.ticker}:`, e);
        errors.push(`${symbol.ticker}: ${e}`);
      }
    }

    // For non-crypto symbols, we need an API key (Alpha Vantage, Finnhub, etc.)
    // For now, log which ones we couldn't fetch
    const nonCryptoSymbols = symbols.filter(s => !CRYPTO_IDS[s.ticker]);
    if (nonCryptoSymbols.length > 0) {
      console.log(`Skipped ${nonCryptoSymbols.length} non-crypto symbols (need Alpha Vantage API key)`);
    }

    const totalRecords = results.reduce((sum, r) => sum + r.records, 0);
    console.log(`Fetched ${totalRecords} historical records for ${results.length} symbols`);

    return new Response(JSON.stringify({
      success: true,
      fetched: results,
      totalRecords,
      skipped: nonCryptoSymbols.map(s => s.ticker),
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
