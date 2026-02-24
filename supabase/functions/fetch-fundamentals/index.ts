import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === 'None' || v === '-') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
};

const hasAnyMetric = (d: FundamentalData): boolean =>
  d.peRatio !== null || d.pbRatio !== null || d.roe !== null ||
  d.debtToEquity !== null || d.dividendYield !== null || d.marketCap !== null;

// ── FMP (Financial Modeling Prep) ──────────────────────────────────
async function fetchFMP(ticker: string, apiKey: string): Promise<FundamentalData | null> {
  try {
    const [ratiosRes, profileRes] = await Promise.all([
      fetch(`https://financialmodelingprep.com/stable/ratios-ttm?symbol=${encodeURIComponent(ticker)}&apikey=${apiKey}`),
      fetch(`https://financialmodelingprep.com/stable/profile?symbol=${encodeURIComponent(ticker)}&apikey=${apiKey}`),
    ]);

    const ratiosBody = ratiosRes.ok ? await ratiosRes.json() : null;
    const profileBody = profileRes.ok ? await profileRes.json() : null;

    const ratios = Array.isArray(ratiosBody) ? ratiosBody[0] : ratiosBody;
    const profile = Array.isArray(profileBody) ? profileBody[0] : profileBody;

    if (!ratios && !profile) return null;

    const result: FundamentalData = {
      peRatio: num(ratios?.priceToEarningsRatioTTM) ?? num(ratios?.peRatioTTM),
      pbRatio: num(ratios?.priceToBookRatioTTM) ?? num(ratios?.pbRatioTTM),
      roe: num(ratios?.returnOnEquityTTM) != null ? num(ratios.returnOnEquityTTM)! * 100 : null,
      debtToEquity: num(ratios?.debtToEquityRatioTTM) ?? num(ratios?.debtEquityRatioTTM),
      dividendYield: num(ratios?.dividendYieldTTM) != null ? num(ratios.dividendYieldTTM)! * 100 : null,
      marketCap: num(profile?.mktCap) ?? num(profile?.marketCap),
      revenueGrowth: num(profile?.revenueGrowth) != null ? num(profile.revenueGrowth)! * 100 : null,
      earningsGrowth: num(profile?.netIncomeGrowth) != null ? num(profile.netIncomeGrowth)! * 100 : null,
      week52High: num(profile?.range?.split('-')[1]) ?? null,
      week52Low: num(profile?.range?.split('-')[0]) ?? null,
      lastUpdated: new Date().toISOString(),
    };

    if (!hasAnyMetric(result)) return null;
    return result;
  } catch (e) {
    console.error(`FMP error for ${ticker}:`, e);
    return null;
  }
}

// ── Finnhub ────────────────────────────────────────────────────────
async function fetchFinnhub(ticker: string, apiKey: string): Promise<FundamentalData | null> {
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(ticker)}&metric=all&token=${apiKey}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const m = data.metric || {};

    if (!m.peBasicExclExtraTTM && !m.roeTTM && !m.marketCapitalization) return null;

    return {
      peRatio: m.peBasicExclExtraTTM || m.peExclExtraAnnual || null,
      pbRatio: m.pbQuarterly || m.pbAnnual || null,
      roe: m.roeTTM || m.roeAnnual || null,
      debtToEquity: m.debtEquityQuarterly || m.debtEquityAnnual || null,
      dividendYield: m.dividendYieldIndicatedAnnual || null,
      marketCap: m.marketCapitalization ? m.marketCapitalization * 1e6 : null,
      revenueGrowth: m.revenueGrowthTTMYoy || null,
      earningsGrowth: m.epsGrowthTTMYoy || null,
      week52High: m['52WeekHigh'] || null,
      week52Low: m['52WeekLow'] || null,
      lastUpdated: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ── Alpha Vantage ──────────────────────────────────────────────────
async function fetchAlphaVantage(ticker: string, apiKey: string): Promise<FundamentalData | null> {
  try {
    const res = await fetch(
      `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${encodeURIComponent(ticker)}&apikey=${apiKey}`
    );
    if (!res.ok) return null;
    const d = await res.json();
    if (d.Note || d['Error Message'] || !d.Symbol) return null;

    return {
      peRatio: num(d.TrailingPE) ?? num(d.ForwardPE),
      pbRatio: num(d.PriceToBookRatio),
      roe: num(d.ReturnOnEquityTTM) != null ? num(d.ReturnOnEquityTTM)! * 100 : null,
      debtToEquity: null,
      dividendYield: num(d.DividendYield) != null ? num(d.DividendYield)! * 100 : null,
      marketCap: num(d.MarketCapitalization),
      revenueGrowth: num(d.QuarterlyRevenueGrowthYOY) != null ? num(d.QuarterlyRevenueGrowthYOY)! * 100 : null,
      earningsGrowth: num(d.QuarterlyEarningsGrowthYOY) != null ? num(d.QuarterlyEarningsGrowthYOY)! * 100 : null,
      week52High: num(d['52WeekHigh']),
      week52Low: num(d['52WeekLow']),
      lastUpdated: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ── Derive from own price data (last resort) ──────────────────────
async function deriveFromPriceData(symbolId: string, supabase: any): Promise<FundamentalData | null> {
  const { data: rawPrice } = await supabase
    .from('raw_prices')
    .select('price, market_cap, high_price, low_price')
    .eq('symbol_id', symbolId)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .single();

  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const { data: yearPrices } = await supabase
    .from('price_history')
    .select('high_price, low_price')
    .eq('symbol_id', symbolId)
    .gte('date', oneYearAgo.toISOString().split('T')[0]);

  if (!rawPrice && (!yearPrices || yearPrices.length === 0)) return null;

  let week52High: number | null = null;
  let week52Low: number | null = null;
  if (yearPrices && yearPrices.length > 0) {
    week52High = Math.max(...yearPrices.map((p: any) => Number(p.high_price)));
    week52Low = Math.min(...yearPrices.map((p: any) => Number(p.low_price)));
  }

  return {
    peRatio: null, pbRatio: null, roe: null, debtToEquity: null,
    dividendYield: null, revenueGrowth: null, earningsGrowth: null,
    marketCap: rawPrice?.market_cap ? Number(rawPrice.market_cap) : null,
    week52High, week52Low,
    lastUpdated: new Date().toISOString(),
  };
}

// ── Main handler ───────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const fmpApiKey = Deno.env.get('FMP_API_KEY') || '';
    const finnhubApiKey = Deno.env.get('FINNHUB_API_KEY') || '';
    const alphaVantageKey = Deno.env.get('ALPHA_VANTAGE_API_KEY') || '';

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

    let requestedTicker: string | undefined;
    let batchLimit = 15;
    let batchOffset = 0;
    try {
      const body = await req.json();
      requestedTicker = body?.ticker;
      if (body?.limit) batchLimit = Math.min(Number(body.limit), 50);
      if (body?.offset) batchOffset = Number(body.offset);
    } catch { /* no body */ }

    const query = supabase
      .from('symbols')
      .select('id, ticker, asset_type, metadata')
      .eq('is_active', true)
      .eq('asset_type', 'stock')
      .order('ticker', { ascending: true })
      .range(batchOffset, batchOffset + batchLimit - 1);

    if (requestedTicker) query.eq('ticker', requestedTicker);

    const { data: symbols, error: symError } = await query;
    if (symError) {
      return new Response(JSON.stringify({ error: symError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!symbols?.length) {
      return new Response(JSON.stringify({ updated: 0, reason: 'no symbols in range' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Fetching fundamentals for ${symbols.length} stocks (offset ${batchOffset})`);
    const results: { ticker: string; success: boolean; error?: string; source?: string }[] = [];
    let updatedCount = 0;
    let alphaVantageCalls = 0;

    for (const symbol of symbols) {
      try {
        let fundamentals: FundamentalData | null = null;
        let source = '';

        // 1. Try FMP first (works for both Nordic and US)
        if (fmpApiKey) {
          fundamentals = await fetchFMP(symbol.ticker, fmpApiKey);
          source = 'fmp';
          await new Promise(r => setTimeout(r, 300));
        }

        // 2. Fallback: Finnhub
        if (!fundamentals && finnhubApiKey) {
          fundamentals = await fetchFinnhub(symbol.ticker, finnhubApiKey);
          source = 'finnhub';
          await new Promise(r => setTimeout(r, 1100));
        }

        // 3. Fallback: Alpha Vantage (max 5 per run)
        if (!fundamentals && alphaVantageKey && alphaVantageCalls < 5) {
          fundamentals = await fetchAlphaVantage(symbol.ticker, alphaVantageKey);
          source = 'alphavantage';
          alphaVantageCalls++;
          await new Promise(r => setTimeout(r, 12500));
        }

        // 4. Last resort: derive from our own price data
        if (!fundamentals) {
          fundamentals = await deriveFromPriceData(symbol.id, supabase);
          source = 'derived';
        }

        if (!fundamentals) {
          results.push({ ticker: symbol.ticker, success: false, error: 'No data available' });
          continue;
        }

        // Merge with existing fundamentals (don't overwrite good data with nulls)
        const existingMetadata = (symbol.metadata as Record<string, unknown>) || {};
        const existingFundamentals = (existingMetadata.fundamentals as Record<string, unknown>) || {};

        const mergedFundamentals: Record<string, unknown> = { ...existingFundamentals };
        for (const [key, value] of Object.entries(fundamentals)) {
          if (value !== null) {
            mergedFundamentals[key] = value;
          }
        }

        const { error: updateError } = await supabase
          .from('symbols')
          .update({ metadata: { ...existingMetadata, fundamentals: mergedFundamentals } })
          .eq('id', symbol.id);

        if (updateError) {
          results.push({ ticker: symbol.ticker, success: false, error: updateError.message });
        } else {
          results.push({ ticker: symbol.ticker, success: true, source });
          updatedCount++;
        }
      } catch (e) {
        results.push({ ticker: symbol.ticker, success: false, error: String(e) });
      }
    }

    console.log(`Done: ${updatedCount}/${symbols.length} updated`);

    return new Response(JSON.stringify({ updated: updatedCount, total: symbols.length, offset: batchOffset, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
