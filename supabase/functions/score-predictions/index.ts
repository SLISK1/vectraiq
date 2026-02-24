import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
    const authHeader = req.headers.get('authorization');
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (authHeader !== `Bearer ${supabaseServiceKey}`) {
      return new Response(JSON.stringify({ error: 'Service role required' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const now = new Date();
    
    console.log('score-predictions: starting run at', now.toISOString());
    
    let scoredCount = 0;
    let watchlistScored = 0;
    // ==============================
    // 1. Update stale match results from Football-Data.org (fast, do first)
    // ==============================
    const footballApiKey = Deno.env.get('FOOTBALL_DATA_API_KEY');
    
    // Find matches past their date that still lack scores
    const { data: staleMatches } = await supabase
      .from('betting_matches')
      .select('id, external_id, match_date')
      .eq('sport', 'football')
      .is('home_score', null)
      .lt('match_date', now.toISOString())
      .neq('status', 'budget_tracker')
      .limit(60);
    
    let matchesUpdated = 0;
    
    if (staleMatches && staleMatches.length > 0 && footballApiKey) {
      console.log(`score-predictions: ${staleMatches.length} stale matches need result updates`);
      
      // Football-Data.org free tier limits to 10-day date ranges
      // Make multiple requests to cover last 30 days in 10-day chunks
      const apiLookup = new Map<string, any>();
      const chunks = 3; // 3 x 10 days = 30 days
      
      for (let c = 0; c < chunks; c++) {
        const chunkEnd = new Date(now.getTime() - c * 10 * 24 * 60 * 60 * 1000);
        const chunkStart = new Date(chunkEnd.getTime() - 10 * 24 * 60 * 60 * 1000);
        const dateFrom = chunkStart.toISOString().split('T')[0];
        const dateTo = chunkEnd.toISOString().split('T')[0];
        
        try {
          const res = await fetch(
            `https://api.football-data.org/v4/matches?dateFrom=${dateFrom}&dateTo=${dateTo}&status=FINISHED`,
            { headers: { 'X-Auth-Token': footballApiKey } }
          );
          
          if (res.ok) {
            const apiData = await res.json();
            const apiMatches = apiData.matches || [];
            console.log(`Football-Data.org chunk ${c+1}: ${apiMatches.length} finished matches (${dateFrom} to ${dateTo})`);
            for (const m of apiMatches) {
              apiLookup.set(`football-${m.id}`, m);
            }
          } else {
            const errBody = await res.text();
            console.error(`Football-Data.org API error chunk ${c+1}: ${res.status} - ${errBody}`);
          }
        } catch (e) {
          console.error(`Football-Data.org fetch chunk ${c+1} failed:`, e);
        }
      }
      
      console.log(`Total API matches found: ${apiLookup.size}`);
      
      for (const stale of staleMatches) {
        const apiMatch = apiLookup.get(stale.external_id || '');
        if (!apiMatch) continue;
        
        const homeScore = apiMatch.score?.fullTime?.home;
        const awayScore = apiMatch.score?.fullTime?.away;
        if (homeScore == null || awayScore == null) continue;
        
        const { error: updateErr } = await supabase
          .from('betting_matches')
          .update({
            status: 'finished',
            home_score: homeScore,
            away_score: awayScore,
          })
          .eq('id', stale.id);
        
        if (!updateErr) matchesUpdated++;
      }
      
      console.log(`score-predictions: updated ${matchesUpdated} match results from API`);
    }
    
    // ==============================
    // 2. Score betting_predictions + CLV calculation
    // ==============================
    const { data: finishedMatches } = await supabase
      .from('betting_matches')
      .select('id, home_score, away_score, closing_odds_home, closing_odds_draw, closing_odds_away')
      .eq('status', 'finished')
      .not('home_score', 'is', null)
      .not('away_score', 'is', null);
    
    let bettingScored = 0;
    let clvCalculated = 0;
    
    if (finishedMatches && finishedMatches.length > 0) {
      const matchIds = finishedMatches.map((m: any) => m.id);
      const { data: unscoredBets } = await supabase
        .from('betting_predictions')
        .select('id, match_id, predicted_winner, predicted_prob, market_implied_prob')
        .is('outcome', null)
        .in('match_id', matchIds);
      
      for (const pred of (unscoredBets || [])) {
        const match = finishedMatches.find((m: any) => m.id === pred.match_id);
        if (!match) continue;
        
        const outcome = match.home_score > match.away_score ? 'home_win'
          : match.home_score < match.away_score ? 'away_win' : 'draw';
        const normalizedOutcome = outcome === 'home_win' ? 'home' : outcome === 'away_win' ? 'away' : 'draw';
        const hit = normalizedOutcome === pred.predicted_winner;
        
        // CLV calculation: model_implied_prob - closing_implied_prob for predicted winner
        let clv: number | null = null;
        const closingHome = match.closing_odds_home ? Number(match.closing_odds_home) : null;
        const closingDraw = match.closing_odds_draw ? Number(match.closing_odds_draw) : null;
        const closingAway = match.closing_odds_away ? Number(match.closing_odds_away) : null;
        
        if (closingHome && closingAway) {
          // Normalize closing implied probs (remove overround)
          const rawHome = 1 / closingHome;
          const rawDraw = closingDraw ? 1 / closingDraw : 0;
          const rawAway = 1 / closingAway;
          const total = rawHome + rawDraw + rawAway;
          
          let closingImpliedProb: number | null = null;
          if (pred.predicted_winner === 'home') closingImpliedProb = rawHome / total;
          else if (pred.predicted_winner === 'away') closingImpliedProb = rawAway / total;
          else if (pred.predicted_winner === 'draw' && closingDraw) closingImpliedProb = rawDraw / total;
          
          if (closingImpliedProb !== null && pred.predicted_prob) {
            clv = Number(pred.predicted_prob) - closingImpliedProb;
          }
        }
        
        const updateData: any = { outcome, scored_at: now.toISOString() };
        if (clv !== null) {
          updateData.clv = clv;
          clvCalculated++;
        }
        
        const { error: betUpdateErr } = await supabase
          .from('betting_predictions')
          .update(updateData)
          .eq('id', pred.id);
        
        if (!betUpdateErr) bettingScored++;
      }
    }
    
    console.log(`score-predictions: updated ${matchesUpdated} match results, scored ${bettingScored} betting predictions, CLV calculated for ${clvCalculated}`);
    
    // ==============================
    // 3. Score expired asset_predictions (slower — Yahoo Finance calls)
    // ==============================
    const { data: unscored, error: unscoredErr } = await supabase
      .from('asset_predictions')
      .select('id, symbol_id, horizon, predicted_direction, predicted_prob, confidence, entry_price, baseline_ticker, baseline_price, created_at')
      .is('exit_price', null)
      .lt('created_at', now.toISOString());
    
    if (unscoredErr) {
      console.error('Error fetching unscored predictions:', unscoredErr);
    }
    
    const horizonDays: Record<string, number> = { '1d': 1, '1w': 7, '1mo': 30, '1y': 365, '1h': 0.04, '1m': 0.001, '1s': 0 };
    
    for (const pred of (unscored || [])) {
      const daysForHorizon = horizonDays[pred.horizon] || 1;
      const targetDate = new Date(pred.created_at);
      targetDate.setDate(targetDate.getDate() + daysForHorizon);
      if (targetDate > now) continue;
      
      const exitPrice = await fetchCurrentPrice(supabase, pred.symbol_id);
      if (!exitPrice) continue;
      
      const returnPct = ((exitPrice - Number(pred.entry_price)) / Number(pred.entry_price)) * 100;
      const outcome = exitPrice > Number(pred.entry_price) ? 'UP' : exitPrice < Number(pred.entry_price) ? 'DOWN' : 'NEUTRAL';
      const hit = outcome === pred.predicted_direction;
      
      let excessReturn: number | null = null;
      if (pred.baseline_ticker && pred.baseline_price) {
        try {
          const baselineData = await fetchYahooPriceRange(pred.baseline_ticker, new Date(pred.created_at), now);
          if (baselineData) {
            const baselineReturn = ((baselineData.exit - baselineData.entry) / baselineData.entry) * 100;
            excessReturn = returnPct - baselineReturn;
          }
        } catch (e) {
          console.error('Error fetching baseline:', e);
        }
      }
      
      const { error: updateErr } = await supabase
        .from('asset_predictions')
        .update({ exit_price: exitPrice, return_pct: returnPct, excess_return: excessReturn, outcome: outcome as any, hit, scored_at: now.toISOString() })
        .eq('id', pred.id);
      if (!updateErr) scoredCount++;
    }
    
    // ==============================
    // 4. Score expired watchlist_cases
    // ==============================
    const { data: expiredWatchlist } = await supabase
      .from('watchlist_cases')
      .select('id, symbol_id, horizon, prediction_direction, entry_price, target_end_time, baseline_ticker, baseline_entry_price')
      .is('result_locked_at', null)
      .lt('target_end_time', now.toISOString());
    
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
          const baselineData = await fetchYahooPriceRange(wl.baseline_ticker, new Date(wl.target_end_time), now);
          if (baselineData) {
            baselineExitPrice = baselineData.exit;
            const baselineReturn = ((baselineData.exit - Number(wl.baseline_entry_price)) / Number(wl.baseline_entry_price)) * 100;
            excessReturn = returnPct - baselineReturn;
          }
        } catch {}
      }
      
      await supabase.from('watchlist_cases').update({
        exit_price: exitPrice, return_pct: returnPct, excess_return: excessReturn,
        baseline_exit_price: baselineExitPrice, hit, result_locked_at: now.toISOString(),
      }).eq('id', wl.id);
      watchlistScored++;
    }
    
    // ==============================
    // 5. Update module_reliability from signal_snapshots
    // ==============================
    const windowDays = 90;
    const windowStart = new Date(now);
    windowStart.setDate(windowStart.getDate() - windowDays);
    
    // Get scored predictions with outcomes within window
    const { data: scoredPreds } = await supabase
      .from('asset_predictions')
      .select('id, symbol_id, horizon, outcome, created_at')
      .not('outcome', 'is', null)
      .gte('created_at', windowStart.toISOString())
      .limit(1000);
    
    let reliabilityUpdated = 0;

    if (scoredPreds && scoredPreds.length > 0) {
      // Get symbol asset_types
      const symbolIds = [...new Set(scoredPreds.map((p: any) => p.symbol_id))];
      const { data: syms } = await supabase
        .from('symbols')
        .select('id, asset_type')
        .in('id', symbolIds);
      
      const symbolTypeMap = new Map((syms || []).map((s: any) => [s.id, s.asset_type]));

      // Fetch signal_snapshots for these predictions
      const predIds = scoredPreds.map((p: any) => p.id);
      // Batch in chunks of 200 to avoid query limits
      const allSnapshots: any[] = [];
      for (let i = 0; i < predIds.length; i += 200) {
        const chunk = predIds.slice(i, i + 200);
        const { data: snaps } = await supabase
          .from('signal_snapshots')
          .select('prediction_id, module, direction, horizon')
          .in('prediction_id', chunk);
        if (snaps) allSnapshots.push(...snaps);
      }

      console.log(`Module reliability: ${scoredPreds.length} scored predictions, ${allSnapshots.length} snapshots in window`);

      if (allSnapshots.length > 0) {
        // Build prediction outcome lookup
        const outcomeMap = new Map<string, string>();
        const predSymbolMap = new Map<string, string>();
        for (const p of scoredPreds) {
          outcomeMap.set(p.id, p.outcome);
          predSymbolMap.set(p.id, p.symbol_id);
        }

        // Aggregate per (module, horizon, asset_type)
        const agg = new Map<string, { total: number; correct: number }>();

        for (const snap of allSnapshots) {
          if (snap.direction === 'NEUTRAL') continue; // skip neutral predictions
          const outcome = outcomeMap.get(snap.prediction_id);
          if (!outcome || outcome === 'NEUTRAL') continue;
          
          const symbolId = predSymbolMap.get(snap.prediction_id);
          const assetType = symbolTypeMap.get(symbolId) || 'stock';
          const key = `${snap.module}:${snap.horizon}:${assetType}`;

          let entry = agg.get(key);
          if (!entry) { entry = { total: 0, correct: 0 }; agg.set(key, entry); }
          entry.total++;
          if (snap.direction === outcome) entry.correct++;
        }

        // Upsert module_reliability
        for (const [key, stats] of agg.entries()) {
          if (stats.total < 3) continue;
          const [mod, hor, assetType] = key.split(':');
          const hitRate = stats.correct / stats.total;
          // Bayesian shrinkage with Beta(10,10) prior
          const posteriorMean = (stats.correct + 10) / (stats.total + 20);
          const reliabilityWeight = Math.max(0.7, Math.min(1.3, 1 + (posteriorMean - 0.5) * 2));

          const { error: upsertErr } = await supabase
            .from('module_reliability')
            .upsert({
              module: mod,
              horizon: hor,
              asset_type: assetType,
              total_predictions: stats.total,
              correct_predictions: stats.correct,
              hit_rate: hitRate,
              reliability_weight: reliabilityWeight,
              window_days: windowDays,
              last_updated: now.toISOString(),
            }, { onConflict: 'module,horizon,asset_type' });

          if (!upsertErr) reliabilityUpdated++;
          else console.error(`module_reliability upsert error for ${key}:`, upsertErr.message);
        }

        console.log(`Module reliability: updated ${reliabilityUpdated} entries from ${agg.size} aggregations`);
      }
    }
    
    // ==============================
    // 6. Calibration stats (5-bucket, Brier, ECE, Log Loss)
    // ==============================
    let calibrationUpdated = 0;
    const calibrationVersion = 'v1-5bucket-2026-02';
    
    try {
      // Get all scored asset_predictions from last 90 days
      const { data: calPreds } = await supabase
        .from('asset_predictions')
        .select('predicted_prob, p_up, hit, horizon, symbol_id')
        .not('hit', 'is', null)
        .gte('scored_at', windowStart.toISOString())
        .limit(2000);

      if (calPreds && calPreds.length > 0) {
        // Get symbol asset types
        const calSymIds = [...new Set(calPreds.map((p: any) => p.symbol_id))];
        const { data: calSyms } = await supabase
          .from('symbols')
          .select('id, asset_type')
          .in('id', calSymIds);
        const calSymMap = new Map((calSyms || []).map((s: any) => [s.id, s.asset_type]));

        // Bucket definitions: 5 buckets
        const buckets = [
          { center: 0.1, min: 0, max: 0.2 },
          { center: 0.3, min: 0.2, max: 0.4 },
          { center: 0.5, min: 0.4, max: 0.6 },
          { center: 0.7, min: 0.6, max: 0.8 },
          { center: 0.9, min: 0.8, max: 1.0 },
        ];

        // Group by horizon + asset_type
        const groups = new Map<string, typeof calPreds>();
        for (const p of calPreds) {
          const at = calSymMap.get(p.symbol_id) || 'stock';
          const key = `${p.horizon}:${at}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(p);
        }

        for (const [groupKey, preds] of groups.entries()) {
          const [horizon, assetType] = groupKey.split(':');

          for (const bucket of buckets) {
            const inBucket = preds.filter((p: any) => {
              const prob = Number(p.p_up ?? p.predicted_prob ?? 0.5);
              return prob >= bucket.min && prob < bucket.max;
            });

            if (inBucket.length < 5) continue; // need minimum data

            const actualUp = inBucket.filter((p: any) => p.hit === true).length;
            const n = inBucket.length;
            const actualRate = actualUp / n;
            const predictedRate = bucket.center;

            // Brier score for this bucket
            const brier = inBucket.reduce((sum: number, p: any) => {
              const prob = Number(p.p_up ?? p.predicted_prob ?? 0.5);
              const outcome = p.hit ? 1 : 0;
              return sum + Math.pow(prob - outcome, 2);
            }, 0) / n;

            // ECE contribution
            const ece = Math.abs(actualRate - predictedRate);

            // Log loss
            const logLoss = inBucket.reduce((sum: number, p: any) => {
              const prob = Math.max(0.01, Math.min(0.99, Number(p.p_up ?? p.predicted_prob ?? 0.5)));
              const outcome = p.hit ? 1 : 0;
              return sum - (outcome * Math.log(prob) + (1 - outcome) * Math.log(1 - prob));
            }, 0) / n;

            const { error: calErr } = await supabase
              .from('calibration_stats')
              .upsert({
                bucket_center: bucket.center,
                horizon,
                asset_type: assetType,
                predicted_count: n,
                actual_up_count: actualUp,
                brier_score: Math.round(brier * 10000) / 10000,
                ece: Math.round(ece * 10000) / 10000,
                log_loss: Math.round(logLoss * 10000) / 10000,
                calibration_version: calibrationVersion,
                sample_count: n,
                updated_at: now.toISOString(),
              }, { onConflict: 'bucket_center,horizon,asset_type' });

            if (!calErr) calibrationUpdated++;
          }
        }
        console.log(`Calibration stats: updated ${calibrationUpdated} bucket entries from ${calPreds.length} predictions`);
      }
    } catch (calError) {
      console.error('Calibration stats error:', calError);
    }

    return new Response(JSON.stringify({
      success: true,
      scored_predictions: scoredCount,
      scored_watchlist: watchlistScored,
      matches_updated: matchesUpdated,
      scored_betting: bettingScored,
      clv_calculated: clvCalculated,
      module_reliability_updated: reliabilityUpdated,
      calibration_updated: calibrationUpdated,
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
