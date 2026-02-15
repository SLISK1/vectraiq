import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-call',
};

// Mapping of tickers to search-friendly company names
const TICKER_NAME_MAP: Record<string, string> = {
  'AAPL': 'Apple',
  'MSFT': 'Microsoft',
  'GOOGL': 'Google Alphabet',
  'AMZN': 'Amazon',
  'NVDA': 'Nvidia',
  'META': 'Meta Facebook',
  'TSLA': 'Tesla',
  'JPM': 'JPMorgan',
  'V': 'Visa',
  'JNJ': 'Johnson Johnson',
  'AMD': 'AMD',
  'VOLV-B.ST': 'Volvo',
  'HM-B.ST': 'H&M Hennes Mauritz',
  'ERIC-B.ST': 'Ericsson',
  'SEB-A.ST': 'SEB bank',
  'SWED-A.ST': 'Swedbank',
  'SHB-A.ST': 'Handelsbanken',
  'SAND.ST': 'Sandvik',
  'ATCO-A.ST': 'Atlas Copco',
  'HEXA-B.ST': 'Hexagon',
  'ABB.ST': 'ABB',
  'INVE-B.ST': 'Investor AB',
  'TELIA.ST': 'Telia',
  'BOL.ST': 'Boliden',
  'SSAB-A.ST': 'SSAB',
  'EMBRAC-B.ST': 'Embracer Group',
  'bitcoin': 'Bitcoin BTC crypto',
  'ethereum': 'Ethereum ETH crypto',
  'XAU': 'gold price',
  'XAG': 'silver price',
};

function getSearchQuery(ticker: string, symbolName?: string): string {
  if (TICKER_NAME_MAP[ticker]) return TICKER_NAME_MAP[ticker];
  if (symbolName) return symbolName;
  return ticker.replace(/\.(ST|OL|HE|CO)$/, '');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const gnewsApiKey = Deno.env.get('GNEWS_API_KEY');

    if (!gnewsApiKey) {
      return new Response(JSON.stringify({ error: 'GNEWS_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // === AUTH ===
    const isInternalCall = req.headers.get('x-internal-call') === 'true';
    const authHeader = req.headers.get('authorization');
    const isServiceRole = authHeader === `Bearer ${supabaseServiceKey}`;

    if (!authHeader?.startsWith('Bearer ') && !isInternalCall) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!isInternalCall && !isServiceRole) {
      const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader! } },
      });
      const token = authHeader!.replace('Bearer ', '');
      const { error: authError } = await supabaseAuth.auth.getUser(token);
      if (authError) {
        return new Response(JSON.stringify({ error: 'Invalid token' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request body
    let tickers: string[] = [];
    let batchLimit = 10;
    try {
      const body = await req.json();
      if (body?.ticker) tickers = [body.ticker];
      if (body?.tickers) tickers = body.tickers;
      if (body?.limit) batchLimit = Math.min(Number(body.limit), 30);
    } catch { /* no body */ }

    // If no specific tickers, fetch top active symbols
    if (tickers.length === 0) {
      const { data: symbols } = await supabase
        .from('symbols')
        .select('ticker, name')
        .eq('is_active', true)
        .order('ticker', { ascending: true })
        .limit(batchLimit);

      if (symbols) {
        tickers = symbols.map(s => s.ticker);
      }
    }

    if (tickers.length === 0) {
      return new Response(JSON.stringify({ fetched: 0, reason: 'no tickers' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get symbol names for better search queries
    const { data: symbolData } = await supabase
      .from('symbols')
      .select('ticker, name')
      .in('ticker', tickers);

    const nameMap = new Map((symbolData || []).map(s => [s.ticker, s.name]));

    console.log(`Fetching news for ${tickers.length} tickers via GNews`);

    let totalInserted = 0;
    const results: { ticker: string; articles: number; error?: string }[] = [];

    // Clean up old news (> 7 days)
    await supabase
      .from('news_cache')
      .delete()
      .lt('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

    for (const ticker of tickers) {
      try {
        // Check if we already have recent news (< 6 hours old)
        const { data: existing } = await supabase
          .from('news_cache')
          .select('id')
          .eq('ticker', ticker)
          .gte('fetched_at', new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
          .limit(1);

        if (existing && existing.length > 0) {
          results.push({ ticker, articles: 0, error: 'cached' });
          continue;
        }

        const query = getSearchQuery(ticker, nameMap.get(ticker));

        // GNews API: https://gnews.io/api/v4/search
        const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=en&max=5&sortby=relevance&apikey=${gnewsApiKey}`;
        const res = await fetch(url);

        if (!res.ok) {
          const errText = await res.text();
          console.error(`GNews error for ${ticker}:`, res.status, errText);
          results.push({ ticker, articles: 0, error: `HTTP ${res.status}` });
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }

        const data = await res.json();
        const articles = data.articles || [];

        if (articles.length === 0) {
          results.push({ ticker, articles: 0 });
          await new Promise(r => setTimeout(r, 500));
          continue;
        }

        // Delete old news for this ticker before inserting new
        await supabase.from('news_cache').delete().eq('ticker', ticker);

        // Insert new articles (GNews format differs from NewsAPI)
        const rows = articles
          .filter((a: any) => a.title)
          .map((a: any) => ({
            ticker,
            title: (a.title || '').substring(0, 500),
            description: (a.description || '').substring(0, 1000),
            source_name: a.source?.name || 'Unknown',
            url: a.url || null,
            published_at: a.publishedAt || null,
          }));

        if (rows.length > 0) {
          const { error: insertError } = await supabase.from('news_cache').insert(rows);
          if (insertError) {
            console.error(`Insert error for ${ticker}:`, insertError);
            results.push({ ticker, articles: 0, error: insertError.message });
          } else {
            totalInserted += rows.length;
            results.push({ ticker, articles: rows.length });
          }
        } else {
          results.push({ ticker, articles: 0 });
        }

        // GNews free: 100 req/day → ~1 req/sec is safe
        await new Promise(r => setTimeout(r, 1200));
      } catch (e) {
        results.push({ ticker, articles: 0, error: String(e) });
      }
    }

    console.log(`Done: ${totalInserted} articles inserted for ${tickers.length} tickers`);

    return new Response(JSON.stringify({ inserted: totalInserted, tickers: tickers.length, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
