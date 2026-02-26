import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface StepResult {
  step: string;
  status: 'success' | 'partial' | 'failed' | 'skipped';
  duration_ms: number;
  details: Record<string, unknown>;
}

interface CoverageData {
  prices: { attempted: number; succeeded: number; failed_tickers: string[] };
  history: { attempted: number; succeeded: number; skipped: number };
  signals: { attempted: number; succeeded: number; modules_per_symbol: { avg: number; min: number } };
  scoring: { predictions_evaluated: number; watchlist_scored: number; betting_scored: number; matches_updated: number; reliability_updated: number };
  betting: { matches_fetched: number; analyzed: number; skipped: number; remaining: number };
}

async function callEdgeFunction(
  supabaseUrl: string,
  serviceKey: string,
  functionName: string,
  body: Record<string, unknown> = {}
): Promise<{ ok: boolean; data: any; status: number; duration_ms: number }> {
  const start = Date.now();
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data, status: res.status, duration_ms: Date.now() - start };
  } catch (e) {
    return { ok: false, data: { error: String(e) }, status: 0, duration_ms: Date.now() - start };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Auth: require service role key
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ') || authHeader !== `Bearer ${serviceKey}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const pipelineStart = new Date();
  const stepResults: StepResult[] = [];
  const errors: Array<{ step: string; error: string }> = [];
  const coverage: CoverageData = {
    prices: { attempted: 0, succeeded: 0, failed_tickers: [] },
    history: { attempted: 0, succeeded: 0, skipped: 0 },
    signals: { attempted: 0, succeeded: 0, modules_per_symbol: { avg: 0, min: 0 } },
    scoring: { predictions_evaluated: 0, watchlist_scored: 0, betting_scored: 0, matches_updated: 0, reliability_updated: 0 },
    betting: { matches_fetched: 0, analyzed: 0, skipped: 0, remaining: 0 },
  };

  // Insert pipeline run record
  const { data: runRow, error: insertErr } = await supabase
    .from('pipeline_runs')
    .insert({ started_at: pipelineStart.toISOString(), status: 'running' })
    .select('id')
    .single();

  if (insertErr || !runRow) {
    console.error('Failed to create pipeline_runs row:', insertErr);
    return new Response(JSON.stringify({ error: 'Failed to start pipeline' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const runId = runRow.id;
  console.log(`Pipeline run ${runId} started at ${pipelineStart.toISOString()}`);

  // Helper: update run record after each step
  async function updateRun(status: string) {
    await supabase.from('pipeline_runs').update({
      status,
      step_results: stepResults,
      coverage,
      errors,
      ...(status !== 'running' ? { completed_at: new Date().toISOString() } : {}),
    }).eq('id', runId);
  }

  try {
    // ==================== STEP 1: FETCH PRICES ====================
    console.log('=== Step 1: fetch-prices ===');
    const { data: symbols } = await supabase
      .from('symbols')
      .select('ticker')
      .eq('is_active', true);
    
    let allTickers = (symbols || []).map((s: any) => s.ticker);
    coverage.prices.attempted = allTickers.length;

    const priceResult = await callEdgeFunction(supabaseUrl, serviceKey, 'fetch-prices');
    
    if (priceResult.ok) {
      coverage.prices.succeeded = priceResult.data?.updated || 0;
      coverage.prices.failed_tickers = priceResult.data?.errors?.map((e: string) => e.split(':')[0]) || [];
      stepResults.push({
        step: 'fetch-prices', status: 'success',
        duration_ms: priceResult.duration_ms,
        details: { updated: coverage.prices.succeeded, failed: coverage.prices.failed_tickers.length },
      });
    } else {
      errors.push({ step: 'fetch-prices', error: priceResult.data?.error || `HTTP ${priceResult.status}` });
      stepResults.push({
        step: 'fetch-prices', status: 'failed',
        duration_ms: priceResult.duration_ms,
        details: { error: priceResult.data?.error },
      });
    }
    await updateRun('running');

    // ==================== STEP 1.5: ACTIVATE PENDING SYMBOLS ====================
    console.log('=== Step 1.5: activate-pending ===');
    const activateStart = Date.now();
    const { data: pendingSymbols } = await supabase
      .from('symbols')
      .select('id, ticker')
      .eq('is_active', false);

    const pendingTickers = (pendingSymbols || []).map((s: any) => s.ticker);

    if (pendingTickers.length > 0) {
      console.log(`Found ${pendingTickers.length} pending symbols: ${pendingTickers.join(', ')}`);

      // Fetch data — bypasses is_active filter because tickers are explicitly passed
      await Promise.allSettled([
        callEdgeFunction(supabaseUrl, serviceKey, 'fetch-history', { tickers: pendingTickers, days: 365 }),
        callEdgeFunction(supabaseUrl, serviceKey, 'fetch-prices', { tickers: pendingTickers }),
      ]);

      // Activate symbols that now have price data
      let activated = 0;
      for (const sym of (pendingSymbols || [])) {
        const { count } = await supabase
          .from('raw_prices')
          .select('*', { count: 'exact', head: true })
          .eq('symbol_id', sym.id);
        if ((count ?? 0) > 0) {
          await supabase.from('symbols').update({ is_active: true }).eq('id', sym.id);
          allTickers.push(sym.ticker); // Include in signal generation
          activated++;
        }
      }

      console.log(`Activated ${activated}/${pendingTickers.length} pending symbols`);
      stepResults.push({
        step: 'activate-pending', status: activated > 0 ? 'success' : 'partial',
        duration_ms: Date.now() - activateStart,
        details: { pending_found: pendingTickers.length, activated },
      });
    } else {
      stepResults.push({
        step: 'activate-pending', status: 'skipped',
        duration_ms: Date.now() - activateStart,
        details: { pending_found: 0, activated: 0 },
      });
    }
    await updateRun('running');

    // ==================== STEP 2: FETCH HISTORY (symbols missing data) ====================
    console.log('=== Step 2: fetch-history (sparse data) ===');
    
    // Find symbols with < 30 data points
    const histCounts = null; // Placeholder — fetch-history handles dedup via upsert
    // Simpler approach: just call fetch-history for all, it handles dedup via upsert
    const histResult = await callEdgeFunction(supabaseUrl, serviceKey, 'fetch-history', { days: 365 });
    
    if (histResult.ok) {
      const results = histResult.data?.results || [];
      coverage.history.attempted = allTickers.length;
      coverage.history.succeeded = results.length;
      stepResults.push({
        step: 'fetch-history', status: 'success',
        duration_ms: histResult.duration_ms,
        details: { symbols_updated: results.length },
      });
    } else {
      errors.push({ step: 'fetch-history', error: histResult.data?.error || `HTTP ${histResult.status}` });
      stepResults.push({
        step: 'fetch-history', status: 'failed',
        duration_ms: histResult.duration_ms,
        details: { error: histResult.data?.error },
      });
    }
    await updateRun('running');

    // ==================== STEP 3: GENERATE SIGNALS (batched) ====================
    console.log('=== Step 3: generate-signals (batched) ===');
    const batchSize = 20;
    let signalsTotal = 0;
    let signalsSuccess = 0;
    let signalsBatchCount = 0;
    const signalsStart = Date.now();
    const moduleCountsPerSymbol: number[] = [];

    for (let offset = 0; offset < allTickers.length; offset += batchSize) {
      const batchTickers = allTickers.slice(offset, offset + batchSize);
      const sigResult = await callEdgeFunction(supabaseUrl, serviceKey, 'generate-signals', {
        tickers: batchTickers,
        allHorizons: true,
      });

      signalsTotal += batchTickers.length;
      signalsBatchCount++;

      if (sigResult.ok) {
        const results = sigResult.data?.results || [];
        const successful = results.filter((r: any) => r.success);
        signalsSuccess += successful.length;
        for (const r of successful) {
          if (r.modules) moduleCountsPerSymbol.push(r.modules);
        }
      } else {
        errors.push({ step: `generate-signals batch ${signalsBatchCount}`, error: sigResult.data?.error || `HTTP ${sigResult.status}` });
      }
    }

    coverage.signals.attempted = signalsTotal;
    coverage.signals.succeeded = signalsSuccess;
    coverage.signals.modules_per_symbol = {
      avg: moduleCountsPerSymbol.length > 0 ? Math.round((moduleCountsPerSymbol.reduce((a, b) => a + b, 0) / moduleCountsPerSymbol.length) * 10) / 10 : 0,
      min: moduleCountsPerSymbol.length > 0 ? Math.min(...moduleCountsPerSymbol) : 0,
    };

    stepResults.push({
      step: 'generate-signals', status: signalsSuccess > 0 ? 'success' : 'failed',
      duration_ms: Date.now() - signalsStart,
      details: { batches: signalsBatchCount, attempted: signalsTotal, succeeded: signalsSuccess },
    });
    await updateRun('running');

    // ==================== STEP 4: SCORE PREDICTIONS ====================
    console.log('=== Step 4: score-predictions ===');
    const scoreResult = await callEdgeFunction(supabaseUrl, serviceKey, 'score-predictions');

    if (scoreResult.ok) {
      coverage.scoring = {
        predictions_evaluated: scoreResult.data?.scored_predictions || 0,
        watchlist_scored: scoreResult.data?.scored_watchlist || 0,
        betting_scored: scoreResult.data?.scored_betting || 0,
        matches_updated: scoreResult.data?.matches_updated || 0,
        reliability_updated: scoreResult.data?.module_reliability_updated || 0,
      };
      stepResults.push({
        step: 'score-predictions', status: 'success',
        duration_ms: scoreResult.duration_ms,
        details: coverage.scoring,
      });
    } else {
      errors.push({ step: 'score-predictions', error: scoreResult.data?.error || `HTTP ${scoreResult.status}` });
      stepResults.push({
        step: 'score-predictions', status: 'failed',
        duration_ms: scoreResult.duration_ms,
        details: { error: scoreResult.data?.error },
      });
    }
    await updateRun('running');

    // ==================== STEP 4.5: SETTLE BETTING PREDICTIONS ====================
    // Settles finished matches: scores 1X2 outcomes AND side bets (OU_GOALS, BTTS, etc.)
    // Fails gracefully if the A1 migration (market column) has not been applied yet.
    console.log('=== Step 4.5: betting-settle ===');
    const settleResult = await callEdgeFunction(supabaseUrl, serviceKey, 'betting-settle');

    if (settleResult.ok) {
      stepResults.push({
        step: 'betting-settle', status: 'success',
        duration_ms: settleResult.duration_ms,
        details: {
          settled: settleResult.data?.settled || 0,
          matches_updated: settleResult.data?.matches_updated || 0,
        },
      });
    } else {
      // Non-fatal — settle can fail if migration not applied yet
      errors.push({ step: 'betting-settle', error: settleResult.data?.error || `HTTP ${settleResult.status}` });
      stepResults.push({
        step: 'betting-settle', status: 'partial',
        duration_ms: settleResult.duration_ms,
        details: { error: settleResult.data?.error },
      });
    }
    await updateRun('running');

    // ==================== STEP 5: FETCH MATCHES ====================
    console.log('=== Step 5: fetch-matches ===');
    const matchResult = await callEdgeFunction(supabaseUrl, serviceKey, 'fetch-matches', { sport: 'all' });

    if (matchResult.ok) {
      coverage.betting.matches_fetched = matchResult.data?.inserted || 0;
      stepResults.push({
        step: 'fetch-matches', status: 'success',
        duration_ms: matchResult.duration_ms,
        details: { inserted: matchResult.data?.inserted, updated: matchResult.data?.updated },
      });
    } else {
      errors.push({ step: 'fetch-matches', error: matchResult.data?.error || `HTTP ${matchResult.status}` });
      stepResults.push({
        step: 'fetch-matches', status: 'failed',
        duration_ms: matchResult.duration_ms,
        details: { error: matchResult.data?.error },
      });
    }
    await updateRun('running');

    // ==================== STEP 5.5: FETCH CLOSING ODDS ====================
    console.log('=== Step 5.5: fetch-closing-odds ===');
    const closingOddsResult = await callEdgeFunction(supabaseUrl, serviceKey, 'fetch-closing-odds');

    if (closingOddsResult.ok) {
      stepResults.push({
        step: 'fetch-closing-odds', status: 'success',
        duration_ms: closingOddsResult.duration_ms,
        details: { updated: closingOddsResult.data?.updated || 0, total_matches: closingOddsResult.data?.total_matches || 0 },
      });
    } else {
      errors.push({ step: 'fetch-closing-odds', error: closingOddsResult.data?.error || `HTTP ${closingOddsResult.status}` });
      stepResults.push({
        step: 'fetch-closing-odds', status: 'failed',
        duration_ms: closingOddsResult.duration_ms,
        details: { error: closingOddsResult.data?.error },
      });
    }
    await updateRun('running');

    // ==================== STEP 6: ANALYZE MATCHES (batch) ====================
    console.log('=== Step 6: analyze-match (batch) ===');
    const analyzeResult = await callEdgeFunction(supabaseUrl, serviceKey, 'analyze-match', { batch: true });

    if (analyzeResult.ok) {
      coverage.betting.analyzed = analyzeResult.data?.analyzed || 0;
      coverage.betting.skipped = analyzeResult.data?.skipped || 0;
      coverage.betting.remaining = analyzeResult.data?.remaining || 0;
      stepResults.push({
        step: 'analyze-match', status: 'success',
        duration_ms: analyzeResult.duration_ms,
        details: { analyzed: coverage.betting.analyzed, skipped: coverage.betting.skipped, remaining: coverage.betting.remaining },
      });
    } else {
      errors.push({ step: 'analyze-match', error: analyzeResult.data?.error || `HTTP ${analyzeResult.status}` });
      stepResults.push({
        step: 'analyze-match', status: 'failed',
        duration_ms: analyzeResult.duration_ms,
        details: { error: analyzeResult.data?.error },
      });
    }

    // ==================== FINALIZE ====================
    const finalStatus = errors.length === 0 ? 'completed' : (stepResults.some(s => s.status === 'success') ? 'completed' : 'failed');
    await updateRun(finalStatus);

    const totalDuration = Date.now() - pipelineStart.getTime();
    console.log(`Pipeline ${runId} ${finalStatus} in ${(totalDuration / 1000).toFixed(1)}s. Errors: ${errors.length}`);

    return new Response(JSON.stringify({
      success: finalStatus !== 'failed',
      run_id: runId,
      status: finalStatus,
      duration_ms: totalDuration,
      steps: stepResults,
      coverage,
      errors: errors.length > 0 ? errors : undefined,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Pipeline fatal error:', error);
    errors.push({ step: 'pipeline', error: String(error) });
    await updateRun('failed');

    return new Response(JSON.stringify({ error: String(error), run_id: runId }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
