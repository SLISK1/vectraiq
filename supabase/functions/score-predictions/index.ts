import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-call',
};

// Benchmark mapping by asset type + currency
function getBenchmarkTicker(assetType: string, currency: string): string {
  if (assetType === 'crypto') return 'BTC-USD';
  if (assetType === 'metal') return 'GLD';
  if (assetType === 'stock' && currency === 'SEK') return '^OMXSPI';
  if (assetType === 'stock' && currency === 'USD') return '^GSPC';
  return '^OMXSPI'; // default
}

// Fetch price from Yahoo Finance for a given date range
async function fetchYahooPriceRange(ticker: string, fromDate: Date, toDate: Date): Promise<{ entry: number; exit: number } | null> {
  try {
    const from = Math.floor(fromDate.getTime() / 1000);
    const to = Math.floor(toDate.getTime() / 1000);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&period1=${from}&period2=${to}`;
    
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    if (!res.ok) return null;
    const json = await res.json();
    const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    if (!closes || closes.length < 2) return null;
    
    const validCloses = closes.filter((c: number | null) => c != null);
    return { entry: validCloses[0], exit: validCloses[validCloses.length - 1] };
  } catch {
    return null;
  }
}

// Fetch current price from raw_prices table
async function fetchCurrentPrice(supabase: any, symbolId: string): Promise<number | null> {
  const { data } = await supabase
    .from('raw_prices')
    .select('price')
    .eq('symbol_id', symbolId)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .single();
  
  return data ? Number(data.price) : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const isInternalCall = req.headers.get('x-internal-call') === 'true';
    const authHeader = req.headers.get('authorization');
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    if (!isInternalCall) {
      if (!authHeader?.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (authHeader !== `Bearer ${supabaseServiceKey}`) {
        return new Response(JSON.stringify({ error: 'Service role required' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const now = new Date();
    
    console.log('score-predictions: starting run at', now.toISOString());
    
    // ==============================
    // 1. Score expired asset_predictions
    // ==============================
    const { data: unscored, error: unscoredErr } = await supabase
      .from('asset_predictions')
      .select('id, symbol_id, horizon, predicted_direction, predicted_prob, confidence, entry_price, baseline_ticker, baseline_price, created_at')
      .is('exit_price', null)
      .lt('created_at', now.toISOString());
    
    if (unscoredErr) {
      console.error('Error fetching unscored predictions:', unscoredErr);
    }
    
    let scoredCount = 0;
    const modulesToUpdate: Record<string, { module: string; horizon: string; assetType: string; hit: boolean }[]> = {};
    
    // Get horizon durations
    const horizonDays: Record<string, number> = { '1d': 1, '1w': 7, '1mo': 30, '1y': 365, '1h': 0.04, '1m': 0.001, '1s': 0 };
    
    for (const pred of (unscored || [])) {
      const daysForHorizon = horizonDays[pred.horizon] || 1;
      const targetDate = new Date(pred.created_at);
      targetDate.setDate(targetDate.getDate() + daysForHorizon);
      
      // Only score if horizon has passed
      if (targetDate > now) continue;
      
      // Get current price for symbol
      const exitPrice = await fetchCurrentPrice(supabase, pred.symbol_id);
      if (!exitPrice) continue;
      
      const returnPct = ((exitPrice - Number(pred.entry_price)) / Number(pred.entry_price)) * 100;
      const outcome = exitPrice > Number(pred.entry_price) ? 'UP' : exitPrice < Number(pred.entry_price) ? 'DOWN' : 'NEUTRAL';
      const hit = outcome === pred.predicted_direction;
      
      // Calculate excess return vs benchmark
      let excessReturn: number | null = null;
      if (pred.baseline_ticker && pred.baseline_price) {
        try {
          const baselineData = await fetchYahooPriceRange(
            pred.baseline_ticker,
            new Date(pred.created_at),
            now
          );
          if (baselineData) {
            const baselineReturn = ((baselineData.exit - baselineData.entry) / baselineData.entry) * 100;
            excessReturn = returnPct - baselineReturn;
          }
        } catch (e) {
          console.error('Error fetching baseline:', e);
        }
      }
      
      // Update the prediction
      const { error: updateErr } = await supabase
        .from('asset_predictions')
        .update({
          exit_price: exitPrice,
          return_pct: returnPct,
          excess_return: excessReturn,
          outcome: outcome as any,
          hit,
          scored_at: now.toISOString(),
        })
        .eq('id', pred.id);
      
      if (!updateErr) {
        scoredCount++;
      }
    }
    
    // ==============================
    // 2. Score expired watchlist_cases
    // ==============================
    const { data: expiredWatchlist } = await supabase
      .from('watchlist_cases')
      .select('id, symbol_id, horizon, prediction_direction, entry_price, target_end_time, baseline_ticker, baseline_entry_price')
      .is('result_locked_at', null)
      .lt('target_end_time', now.toISOString());
    
    let watchlistScored = 0;
    
    for (const wl of (expiredWatchlist || [])) {
      const exitPrice = await fetchCurrentPrice(supabase, wl.symbol_id);
      if (!exitPrice) continue;
      
      const returnPct = ((exitPrice - Number(wl.entry_price)) / Number(wl.entry_price)) * 100;
      const outcome = exitPrice > Number(wl.entry_price) ? 'UP' : 'DOWN';
      const hit = outcome === wl.prediction_direction;
      
      let excessReturn: number | null = null;
      let baselineExitPrice: number | null = null;
      
      if (wl.baseline_ticker && wl.baseline_entry_price) {
        try {
          const baselineData = await fetchYahooPriceRange(
            wl.baseline_ticker,
            new Date(wl.target_end_time),
            now
          );
          if (baselineData) {
            baselineExitPrice = baselineData.exit;
            const baselineReturn = ((baselineData.exit - Number(wl.baseline_entry_price)) / Number(wl.baseline_entry_price)) * 100;
            excessReturn = returnPct - baselineReturn;
          }
        } catch {}
      }
      
      await supabase
        .from('watchlist_cases')
        .update({
          exit_price: exitPrice,
          return_pct: returnPct,
          excess_return: excessReturn,
          baseline_exit_price: baselineExitPrice,
          hit,
          result_locked_at: now.toISOString(),
        })
        .eq('id', wl.id);
      
      watchlistScored++;
    }
    
    // ==============================
    // 3. Update module_reliability
    // ==============================
    const windowDays = 90;
    const windowStart = new Date(now);
    windowStart.setDate(windowStart.getDate() - windowDays);
    
    // Get all scored predictions within window
    const { data: scoredPreds } = await supabase
      .from('asset_predictions')
      .select('symbol_id, horizon, hit, predicted_direction, created_at')
      .not('hit', 'is', null)
      .gte('created_at', windowStart.toISOString());
    
    if (scoredPreds && scoredPreds.length > 0) {
      // Get symbol asset_types
      const symbolIds = [...new Set(scoredPreds.map((p: any) => p.symbol_id))];
      const { data: symbols } = await supabase
        .from('symbols')
        .select('id, asset_type')
        .in('id', symbolIds);
      
      const symbolTypeMap = new Map((symbols || []).map((s: any) => [s.id, s.asset_type]));
      
      // This would require module-level predictions which aren't stored per module yet
      // For now, aggregate at prediction level (overall model hit rate)
      // Future: store per-module signals and cross-reference
      console.log(`Module reliability: ${scoredPreds.length} scored predictions in window`);
    }
    
    return new Response(JSON.stringify({
      success: true,
      scored_predictions: scoredCount,
      scored_watchlist: watchlistScored,
      timestamp: now.toISOString(),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    
  } catch (error) {
    console.error('score-predictions error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
