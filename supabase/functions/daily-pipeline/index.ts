import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Max tickers sent to analyze-thesis per pipeline run. LLM thesis is the only
// paid step (~$0.005/call, hard $10/mo cap enforced inside analyze-thesis).
// We never analyze the whole universe — only watchlist names + the top-ranked
// candidates from this run. analyze-thesis also skips tickers cached < 60d, so
// in steady state most of these are no-ops. Keep this small.
const THESIS_MAX_PER_RUN = 15;

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

  // Helper: run a function in offset-based chunks. Each chunk has its own
  // timeout budget so one 504 cannot kill the entire price/history pipeline.
  async function runChunked(
    fnName: string,
    chunkSize: number,
    totalAttempted: number,
    extraBody: Record<string, unknown> = {},
  ) {
    const chunkResults: Array<{ ok: boolean; status: number; duration_ms: number; data: any; offset: number }> = [];
    for (let off = 0; off < totalAttempted; off += chunkSize) {
      const res = await callEdgeFunction(supabaseUrl, serviceKey, fnName, {
        ...extraBody, offset: off, limit: chunkSize,
      });
      chunkResults.push({ ...res, offset: off });
      if (!res.ok) {
        errors.push({ step: `${fnName} chunk@${off}`, error: res.data?.error || `HTTP ${res.status}` });
      }
    }
    return chunkResults;
  }

  try {
    // ==================== STEP 1: FETCH PRICES (chunked) ====================
    console.log('=== Step 1: fetch-prices (chunked) ===');
    const { data: symbols } = await supabase
      .from('symbols')
      .select('ticker')
      .eq('is_active', true);

    let allTickers = (symbols || []).map((s: any) => s.ticker);
    coverage.prices.attempted = allTickers.length;

    const priceChunks = await runChunked('fetch-prices', 100, allTickers.length);
    let priceUpdated = 0;
    let priceDuration = 0;
    for (const c of priceChunks) {
      priceDuration += c.duration_ms;
      if (c.ok) priceUpdated += (c.data?.updated || 0);
    }
    coverage.prices.succeeded = priceUpdated;
    const priceOkChunks = priceChunks.filter(c => c.ok).length;
    stepResults.push({
      step: 'fetch-prices',
      status: priceOkChunks === priceChunks.length ? 'success' : (priceOkChunks > 0 ? 'partial' : 'failed'),
      duration_ms: priceDuration,
      details: { chunks: priceChunks.length, chunks_ok: priceOkChunks, updated: priceUpdated },
    });
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

      await Promise.allSettled([
        callEdgeFunction(supabaseUrl, serviceKey, 'fetch-history', { tickers: pendingTickers, days: 365 }),
        callEdgeFunction(supabaseUrl, serviceKey, 'fetch-prices', { tickers: pendingTickers }),
      ]);

      let activated = 0;
      for (const sym of (pendingSymbols || [])) {
        const { count } = await supabase
          .from('raw_prices')
          .select('*', { count: 'exact', head: true })
          .eq('symbol_id', sym.id);
        if ((count ?? 0) > 0) {
          await supabase.from('symbols').update({ is_active: true }).eq('id', sym.id);
          allTickers.push(sym.ticker);
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

    // ==================== STEP 2: FETCH HISTORY (chunked) ====================
    console.log('=== Step 2: fetch-history (chunked) ===');
    const histChunks = await runChunked('fetch-history', 80, allTickers.length, { days: 365 });
    let histSymbols = 0;
    let histDuration = 0;
    for (const c of histChunks) {
      histDuration += c.duration_ms;
      if (c.ok) histSymbols += (c.data?.fetched?.length || 0);
    }
    coverage.history.attempted = allTickers.length;
    coverage.history.succeeded = histSymbols;
    const histOkChunks = histChunks.filter(c => c.ok).length;
    stepResults.push({
      step: 'fetch-history',
      status: histOkChunks === histChunks.length ? 'success' : (histOkChunks > 0 ? 'partial' : 'failed'),
      duration_ms: histDuration,
      details: { chunks: histChunks.length, chunks_ok: histOkChunks, symbols_updated: histSymbols },
    });
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
    await updateRun('running');

    // ==================== STEP 7: FETCH NEWS ====================
    // Pulls fresh news per ticker into news_cache (GNews API).
    console.log('=== Step 7: fetch-news ===');
    const newsResult = await callEdgeFunction(supabaseUrl, serviceKey, 'fetch-news', { limit: 30 });
    stepResults.push({
      step: 'fetch-news',
      status: newsResult.ok ? 'success' : 'failed',
      duration_ms: newsResult.duration_ms,
      details: newsResult.ok
        ? { inserted: newsResult.data?.inserted || 0, tickers: newsResult.data?.tickers || 0 }
        : { error: newsResult.data?.error || `HTTP ${newsResult.status}` },
    });
    if (!newsResult.ok) errors.push({ step: 'fetch-news', error: newsResult.data?.error || `HTTP ${newsResult.status}` });
    await updateRun('running');

    // ==================== STEP 8: COMPUTE NEWS SENTIMENT ====================
    // Lexicon-based scoring of news_cache → news_sentiment_cache.
    // Replaces the old momentum-proxy that was double-counting technical signals.
    console.log('=== Step 8: compute-news-sentiment ===');
    const sentResult = await callEdgeFunction(supabaseUrl, serviceKey, 'compute-news-sentiment', {});
    stepResults.push({
      step: 'compute-news-sentiment',
      status: sentResult.ok ? 'success' : 'failed',
      duration_ms: sentResult.duration_ms,
      details: sentResult.ok ? sentResult.data : { error: sentResult.data?.error },
    });
    if (!sentResult.ok) errors.push({ step: 'compute-news-sentiment', error: sentResult.data?.error || `HTTP ${sentResult.status}` });
    await updateRun('running');

    // ==================== STEP 9: FETCH EVENT CALENDAR ====================
    // Earnings + macro events (CPI, Fed, ECB, Riksbank, NFP) for blackout module.
    console.log('=== Step 9: fetch-events ===');
    const eventsResult = await callEdgeFunction(supabaseUrl, serviceKey, 'fetch-events', {});
    stepResults.push({
      step: 'fetch-events',
      status: eventsResult.ok ? 'success' : 'failed',
      duration_ms: eventsResult.duration_ms,
      details: eventsResult.ok ? eventsResult.data : { error: eventsResult.data?.error },
    });
    if (!eventsResult.ok) errors.push({ step: 'fetch-events', error: eventsResult.data?.error || `HTTP ${eventsResult.status}` });
    await updateRun('running');

    // ==================== STEP 10: COMPUTE SECTOR RETURNS ====================
    // Aggregates sector & index returns from price_history for relative strength.
    console.log('=== Step 10: compute-sector-returns ===');
    const sectorResult = await callEdgeFunction(supabaseUrl, serviceKey, 'compute-sector-returns', {});
    stepResults.push({
      step: 'compute-sector-returns',
      status: sectorResult.ok ? 'success' : 'failed',
      duration_ms: sectorResult.duration_ms,
      details: sectorResult.ok ? sectorResult.data : { error: sectorResult.data?.error },
    });
    if (!sectorResult.ok) errors.push({ step: 'compute-sector-returns', error: sectorResult.data?.error || `HTTP ${sectorResult.status}` });
    await updateRun('running');

    // ==================== STEP 10.5: COMPUTE LIQUIDITY ====================
    // Computes avg_dollar_volume_30d + is_liquid per equity from price_history.
    // Runs after price/history are fetched so volume exists. Non-fatal.
    console.log('=== Step 10.5: compute-liquidity ===');
    const liquidityResult = await callEdgeFunction(supabaseUrl, serviceKey, 'compute-liquidity', {});
    stepResults.push({
      step: 'compute-liquidity',
      status: liquidityResult.ok ? 'success' : 'failed',
      duration_ms: liquidityResult.duration_ms,
      details: liquidityResult.ok ? liquidityResult.data : { error: liquidityResult.data?.error },
    });
    if (!liquidityResult.ok) errors.push({ step: 'compute-liquidity', error: liquidityResult.data?.error || `HTTP ${liquidityResult.status}` });
    await updateRun('running');

    // ==================== STEP 10.6: VALIDATE DATA (QA) ====================
    // Read-only sanity checks on price_history (future dates, non-positive prices,
    // implausible unadjusted-split jumps, staleness, missing data) → data_quality_issues.
    // Runs after price/history are fetched. Non-fatal — a QA failure never aborts the run.
    console.log('=== Step 10.6: validate-data ===');
    const validateResult = await callEdgeFunction(supabaseUrl, serviceKey, 'validate-data', {});
    stepResults.push({
      step: 'validate-data',
      status: validateResult.ok ? 'success' : 'failed',
      duration_ms: validateResult.duration_ms,
      details: validateResult.ok ? validateResult.data : { error: validateResult.data?.error },
    });
    if (!validateResult.ok) errors.push({ step: 'validate-data', error: validateResult.data?.error || `HTTP ${validateResult.status}` });
    await updateRun('running');

    // ==================== STEP 11: FETCH EARNINGS EVENTS (weekly) ====================
    // Earnings surprises + analyst revisions + insider trades (FMP).
    // Throttled: only run once per week to stay within FMP free-tier limits.
    // Day-of-week 1 = Monday.
    if (new Date().getUTCDay() === 1) {
      console.log('=== Step 11: fetch-earnings-events (weekly) ===');
      const earnResult = await callEdgeFunction(supabaseUrl, serviceKey, 'fetch-earnings-events', { limit: 25 });
      stepResults.push({
        step: 'fetch-earnings-events',
        status: earnResult.ok ? 'success' : 'failed',
        duration_ms: earnResult.duration_ms,
        details: earnResult.ok ? earnResult.data : { error: earnResult.data?.error },
      });
      if (!earnResult.ok) errors.push({ step: 'fetch-earnings-events', error: earnResult.data?.error || `HTTP ${earnResult.status}` });
    } else {
      stepResults.push({
        step: 'fetch-earnings-events', status: 'skipped',
        duration_ms: 0,
        details: { reason: 'runs Mondays only to respect FMP free-tier' },
      });
    }
    await updateRun('running');

    // ==================== STEP 11.5: STRATEGIC THESIS (LLM, budget-gated) ====================
    // Refreshes the qualitative LLM thesis (strategic_thesis_cache) for a SMALL,
    // prioritized set only — never the whole universe. Priority order:
    //   1. Active user watchlist names (watchlist_cases, not yet locked)
    //   2. Top-ranked candidates from this run (asset_predictions.total_score desc)
    // Capped at THESIS_MAX_PER_RUN. analyze-thesis owns the spend: it skips
    // tickers cached < 60d and stops at the $10/mo budget cap. Non-fatal — a
    // failure here must never abort the pipeline.
    console.log('=== Step 11.5: analyze-thesis (budget-gated) ===');
    const thesisStart = Date.now();
    try {
      const thesisTickers: string[] = [];
      const seen = new Set<string>();
      const pushTicker = (t: unknown) => {
        const ticker = typeof t === 'string' ? t : '';
        if (ticker && !seen.has(ticker) && thesisTickers.length < THESIS_MAX_PER_RUN) {
          seen.add(ticker);
          thesisTickers.push(ticker);
        }
      };

      // 1. Active watchlist names (highest priority — these are what users care about)
      const { data: wlCases } = await supabase
        .from('watchlist_cases')
        .select('symbol_id')
        .is('result_locked_at', null);
      const wlSymbolIds = [...new Set((wlCases || []).map((c: any) => c.symbol_id).filter(Boolean))];
      if (wlSymbolIds.length > 0) {
        // Only stocks/funds get a strategic thesis (no "company" behind crypto/metal).
        const { data: wlSymbols } = await supabase
          .from('symbols')
          .select('ticker, asset_type')
          .in('id', wlSymbolIds)
          .in('asset_type', ['stock', 'fund']);
        for (const s of (wlSymbols || [])) pushTicker((s as any).ticker);
      }

      // 2. Fill remaining slots with the top-ranked candidates from this run.
      //    asset_predictions is written by generate-signals (Step 3) with total_score.
      if (thesisTickers.length < THESIS_MAX_PER_RUN) {
        const { data: topPreds } = await supabase
          .from('asset_predictions')
          .select('symbol_id, total_score, created_at')
          .order('total_score', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(THESIS_MAX_PER_RUN * 4); // over-fetch: dedupe + asset-type filter trims this
        const rankedSymbolIds = [...new Set((topPreds || []).map((p: any) => p.symbol_id).filter(Boolean))];
        if (rankedSymbolIds.length > 0) {
          const { data: rankedSymbols } = await supabase
            .from('symbols')
            .select('id, ticker, asset_type')
            .in('id', rankedSymbolIds)
            .in('asset_type', ['stock', 'fund']);
          // Preserve score ordering: map id -> ticker, then walk topPreds in order.
          const idToSym = new Map((rankedSymbols || []).map((s: any) => [s.id, s.ticker]));
          for (const p of (topPreds || [])) {
            if (thesisTickers.length >= THESIS_MAX_PER_RUN) break;
            const ticker = idToSym.get((p as any).symbol_id);
            if (ticker) pushTicker(ticker);
          }
        }
      }

      if (thesisTickers.length === 0) {
        stepResults.push({
          step: 'analyze-thesis', status: 'skipped',
          duration_ms: Date.now() - thesisStart,
          details: { reason: 'no watchlist or ranked candidates to analyze' },
        });
      } else {
        const thesisResult = await callEdgeFunction(supabaseUrl, serviceKey, 'analyze-thesis', {
          tickers: thesisTickers,
          trigger_reason: 'daily_pipeline',
        });
        if (thesisResult.ok) {
          stepResults.push({
            step: 'analyze-thesis', status: 'success',
            duration_ms: thesisResult.duration_ms,
            details: {
              requested: thesisTickers.length,
              analyzed: thesisResult.data?.analyzed ?? 0,
              cached: thesisResult.data?.cached ?? 0,
              errors: thesisResult.data?.errors ?? 0,
            },
          });
        } else {
          // Non-fatal: thesis is an enrichment, not a critical path.
          errors.push({ step: 'analyze-thesis', error: thesisResult.data?.error || `HTTP ${thesisResult.status}` });
          stepResults.push({
            step: 'analyze-thesis', status: 'partial',
            duration_ms: thesisResult.duration_ms,
            details: { requested: thesisTickers.length, error: thesisResult.data?.error },
          });
        }
      }
    } catch (e) {
      // Swallow — never let thesis enrichment abort the pipeline.
      errors.push({ step: 'analyze-thesis', error: String(e) });
      stepResults.push({
        step: 'analyze-thesis', status: 'partial',
        duration_ms: Date.now() - thesisStart,
        details: { error: String(e) },
      });
    }
    await updateRun('running');

    // ==================== STEP 12: PAPER PORTFOLIO SNAPSHOT ====================
    // Records daily marks for paper portfolio so the chart updates.
    console.log('=== Step 12: paper-snapshot ===');
    const paperResult = await callEdgeFunction(supabaseUrl, serviceKey, 'paper-snapshot', {});
    stepResults.push({
      step: 'paper-snapshot',
      status: paperResult.ok ? 'success' : 'failed',
      duration_ms: paperResult.duration_ms,
      details: paperResult.ok ? paperResult.data : { error: paperResult.data?.error },
    });
    if (!paperResult.ok) errors.push({ step: 'paper-snapshot', error: paperResult.data?.error || `HTTP ${paperResult.status}` });

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
