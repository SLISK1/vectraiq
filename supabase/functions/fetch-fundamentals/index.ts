import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-call',
};

// Mapping of internal tickers to Finnhub symbols
const FINNHUB_SYMBOL_MAP: Record<string, string> = {
  // US stocks - direct mapping
  'AAPL': 'AAPL', 'MSFT': 'MSFT', 'GOOGL': 'GOOGL', 'AMZN': 'AMZN',
  'NVDA': 'NVDA', 'META': 'META', 'TSLA': 'TSLA', 'JPM': 'JPM', 
  'V': 'V', 'JNJ': 'JNJ',
  // Nordic stocks - convert to Finnhub format
  'VOLV_B': 'VOLV-B.ST', 'ERIC-B': 'ERIC-B.ST', 'SEB-A': 'SEB-A.ST',
  'ATCO-A': 'ATCO-A.ST', 'ASSA-B': 'ASSA-B.ST', 'HM-B': 'HM-B.ST',
  'SAND': 'SAND.ST', 'HEXA-B': 'HEXA-B.ST', 'INVE-B': 'INVE-B.ST',
  'SWED-A': 'SWED-A.ST', 'ESSITY-B': 'ESSITY-B.ST', 'SKF-B': 'SKF-B.ST',
  'TELIA': 'TELIA.ST', 'KINV-B': 'KINV-B.ST', 'ELUX-B': 'ELUX-B.ST',
  'ABB': 'ABB.ST', 'ALFA': 'ALFA.ST', 'CAST': 'CAST.ST', 'EQT': 'EQT.ST',
};

interface FinnhubMetrics {
  peBasicExclExtraTTM?: number;
  peExclExtraAnnual?: number;
  pbQuarterly?: number;
  pbAnnual?: number;
  roeTTM?: number;
  roeAnnual?: number;
  debtEquityQuarterly?: number;
  debtEquityAnnual?: number;
  dividendYieldIndicatedAnnual?: number;
  marketCapitalization?: number;
  revenueGrowthQuarterlyYoy?: number;
  revenueGrowthTTMYoy?: number;
  epsGrowthQuarterlyYoy?: number;
  epsGrowthTTMYoy?: number;
  '52WeekHigh'?: number;
  '52WeekLow'?: number;
}

interface FundamentalData {
  peRatio: number | null;
  pbRatio: number | null;
  roe: number | null;
  debtToEquity: number | null;
  dividendYield: number | null;
  marketCap: number | null;
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  week52High: number | null;
  week52Low: number | null;
  lastUpdated: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const finnhubApiKey = Deno.env.get('FINNHUB_API_KEY');

    if (!finnhubApiKey) {
      return new Response(JSON.stringify({ error: 'FINNHUB_API_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // === AUTHENTICATION CHECK ===
    const isInternalCall = req.headers.get('x-internal-call') === 'true';
    const authHeader = req.headers.get('authorization');

    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // For internal calls with service key, skip user validation
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

    // Parse request body for optional specific ticker
    let requestedTicker: string | undefined;
    try {
      const body = await req.json();
      requestedTicker = body?.ticker;
    } catch {
      // No body, fetch all
    }

    // Get all stock symbols (fundamentals only available for stocks)
    const query = supabase
      .from('symbols')
      .select('id, ticker, asset_type, metadata')
      .eq('is_active', true)
      .eq('asset_type', 'stock');

    if (requestedTicker) {
      query.eq('ticker', requestedTicker);
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
      return new Response(JSON.stringify({ updated: 0, reason: 'no stock symbols found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Fetching fundamentals for ${symbols.length} stock symbols`);
    const results: { ticker: string; success: boolean; error?: string }[] = [];
    let updatedCount = 0;

    // Rate limit: Finnhub free tier = 60 req/min
    // Process with delay to stay within limits
    for (const symbol of symbols) {
      const finnhubSymbol = FINNHUB_SYMBOL_MAP[symbol.ticker];
      
      if (!finnhubSymbol) {
        console.log(`No Finnhub mapping for ${symbol.ticker}, skipping`);
        results.push({ ticker: symbol.ticker, success: false, error: 'No Finnhub mapping' });
        continue;
      }

      try {
        // Fetch basic financials from Finnhub
        const res = await fetch(
          `https://finnhub.io/api/v1/stock/metric?symbol=${finnhubSymbol}&metric=all&token=${finnhubApiKey}`
        );

        if (!res.ok) {
          console.error(`Finnhub API error for ${symbol.ticker}: ${res.status}`);
          results.push({ ticker: symbol.ticker, success: false, error: `API error ${res.status}` });
          continue;
        }

        const data = await res.json();
        const metrics: FinnhubMetrics = data.metric || {};

        // Extract relevant fundamental data
        const fundamentals: FundamentalData = {
          peRatio: metrics.peBasicExclExtraTTM || metrics.peExclExtraAnnual || null,
          pbRatio: metrics.pbQuarterly || metrics.pbAnnual || null,
          roe: metrics.roeTTM || metrics.roeAnnual || null,
          debtToEquity: metrics.debtEquityQuarterly || metrics.debtEquityAnnual || null,
          dividendYield: metrics.dividendYieldIndicatedAnnual || null,
          marketCap: metrics.marketCapitalization || null,
          revenueGrowth: metrics.revenueGrowthTTMYoy || metrics.revenueGrowthQuarterlyYoy || null,
          earningsGrowth: metrics.epsGrowthTTMYoy || metrics.epsGrowthQuarterlyYoy || null,
          week52High: metrics['52WeekHigh'] || null,
          week52Low: metrics['52WeekLow'] || null,
          lastUpdated: new Date().toISOString(),
        };

        // Check if we got any meaningful data
        const hasData = fundamentals.peRatio !== null || 
                        fundamentals.roe !== null || 
                        fundamentals.pbRatio !== null;

        if (!hasData) {
          console.log(`No fundamental data available for ${symbol.ticker}`);
          results.push({ ticker: symbol.ticker, success: false, error: 'No data from Finnhub' });
          continue;
        }

        // Update symbol metadata with fundamentals
        const existingMetadata = (symbol.metadata as Record<string, unknown>) || {};
        const updatedMetadata = {
          ...existingMetadata,
          fundamentals,
        };

        const { error: updateError } = await supabase
          .from('symbols')
          .update({ metadata: updatedMetadata })
          .eq('id', symbol.id);

        if (updateError) {
          console.error(`Update error for ${symbol.ticker}:`, updateError);
          results.push({ ticker: symbol.ticker, success: false, error: updateError.message });
        } else {
          console.log(`Updated fundamentals for ${symbol.ticker}: P/E=${fundamentals.peRatio}, ROE=${fundamentals.roe}`);
          results.push({ ticker: symbol.ticker, success: true });
          updatedCount++;
        }

        // Rate limiting: wait 1 second between requests (60/min limit)
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (e) {
        console.error(`Error processing ${symbol.ticker}:`, e);
        results.push({ ticker: symbol.ticker, success: false, error: String(e) });
      }
    }

    console.log(`Fundamentals update complete: ${updatedCount}/${symbols.length} symbols updated`);

    return new Response(JSON.stringify({
      updated: updatedCount,
      total: symbols.length,
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
