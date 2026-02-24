import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Auth
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const isServiceRole = token === serviceKey;

    let userId: string;
    const adminClient = createClient(supabaseUrl, serviceKey);

    if (isServiceRole) {
      const body = await req.json();
      userId = body.user_id;
      if (!userId) {
        return new Response(JSON.stringify({ error: "user_id required for service role" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: userData, error: authErr } = await userClient.auth.getUser();
      if (authErr || !userData?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = userData.user.id;
    }

    // Get config
    const { data: config, error: cfgErr } = await adminClient
      .from("strategy_configs")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (cfgErr || !config) {
      return new Response(JSON.stringify({ error: "No strategy config found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create job record
    const { data: job } = await adminClient.from("strategy_automation_jobs").insert({
      user_id: userId,
      config_id: config.id,
      status: "running",
    }).select().single();

    const jobId = job?.id;

    // Build universe
    const sources = Array.isArray(config.universe_sources) ? config.universe_sources : [];
    let tickers: string[] = [];

    // Watchlist source
    if (sources.includes("watchlist")) {
      const { data: wl } = await adminClient
        .from("watchlist_cases")
        .select("symbol_id, symbols(ticker)")
        .eq("user_id", userId);
      if (wl) {
        for (const w of wl) {
          const t = (w as any).symbols?.ticker;
          if (t) tickers.push(t);
        }
      }
    }

    // Screener source (active symbols)
    if (sources.includes("screener")) {
      const { data: syms } = await adminClient
        .from("symbols")
        .select("ticker")
        .eq("is_active", true)
        .limit(500);
      if (syms) tickers.push(...syms.map((s: any) => s.ticker));
    }

    // S&P 500 source
    if (sources.includes("sp500")) {
      const { data: cached } = await adminClient
        .from("universe_cache")
        .select("payload")
        .eq("cache_key", "SP500_CONSTITUENTS")
        .single();
      if (cached?.payload && (cached.payload as any).tickers) {
        tickers.push(...(cached.payload as any).tickers);
      }
    }

    // Deduplicate
    tickers = [...new Set(tickers)];
    const limit = config.candidate_limit || 200;
    if (tickers.length > limit) tickers = tickers.slice(0, limit);

    // Get latest predictions for these tickers
    const { data: symbols } = await adminClient
      .from("symbols")
      .select("id, ticker, sector")
      .in("ticker", tickers);

    const symbolMap = new Map((symbols || []).map((s: any) => [s.ticker, s]));

    // Get latest predictions
    const symbolIds = (symbols || []).map((s: any) => s.id);
    const { data: predictions } = await adminClient
      .from("asset_predictions")
      .select("*")
      .in("symbol_id", symbolIds)
      .order("created_at", { ascending: false });

    // Get latest signals
    const { data: signals } = await adminClient
      .from("signals")
      .select("*")
      .in("symbol_id", symbolIds)
      .order("created_at", { ascending: false });

    // Group by symbol
    const predBySymbol = new Map<string, any>();
    for (const p of predictions || []) {
      if (!predBySymbol.has(p.symbol_id)) predBySymbol.set(p.symbol_id, p);
    }

    const sigBySymbol = new Map<string, any[]>();
    for (const s of signals || []) {
      if (!sigBySymbol.has(s.symbol_id)) sigBySymbol.set(s.symbol_id, []);
      sigBySymbol.get(s.symbol_id)!.push(s);
    }

    // Delete old candidates
    await adminClient
      .from("strategy_candidates")
      .delete()
      .eq("config_id", config.id);

    // Evaluate each ticker
    const candidateRows: any[] = [];
    const logRows: any[] = [];

    for (const ticker of tickers) {
      const sym = symbolMap.get(ticker);
      if (!sym) continue;

      const pred = predBySymbol.get(sym.id);
      const sigs = sigBySymbol.get(sym.id) || [];

      if (!pred) {
        logRows.push({
          user_id: userId, config_id: config.id, run_id: jobId,
          action: "skip", ticker, details: { reason: "No prediction data" },
        });
        continue;
      }

      // Build analysis snapshot
      const totalScore = pred.total_score || 0;
      const confidence = pred.confidence || 0;
      const agreement = sigs.length > 0
        ? Math.round((sigs.filter((s: any) => s.direction === pred.predicted_direction).length / sigs.length) * 100)
        : 0;
      const coverage = sigs.length > 0 ? Math.min(100, Math.round((sigs.length / 8) * 100)) : 0;
      const staleness = (Date.now() - new Date(pred.created_at).getTime()) / (1000 * 60 * 60);

      // Quality gate
      const blockReasons: string[] = [];
      if (totalScore < config.total_score_min) blockReasons.push(`Score ${totalScore} < ${config.total_score_min}`);
      if (agreement < config.agreement_min) blockReasons.push(`Enighet ${agreement}% < ${config.agreement_min}%`);
      if (coverage < config.coverage_min) blockReasons.push(`Täckning ${coverage}% < ${config.coverage_min}%`);
      if (staleness > config.max_staleness_h) blockReasons.push(`Data ${Math.round(staleness)}h gammal`);

      if (blockReasons.length > 0) {
        candidateRows.push({
          user_id: userId, config_id: config.id, symbol_id: sym.id, ticker,
          source: sources.join(","), status: "blocked",
          block_reasons: blockReasons, total_score: totalScore, confidence,
        });
        continue;
      }

      // Simple regime classification
      const fundamentalSig = sigs.find((s: any) => s.module === "fundamental");
      const quantSig = sigs.find((s: any) => s.module === "quant");
      const mmSig = sigs.find((s: any) => s.module === "measuredmoves");

      let regime: string | null = null;
      if (fundamentalSig?.direction === "UP" && agreement >= 85) {
        regime = "FUNDAMENTAL";
      } else if (quantSig?.direction === "UP" && mmSig?.direction === "UP") {
        regime = "MOMENTUM";
      } else if (config.mean_reversion_enabled && quantSig?.direction === "UP") {
        regime = "MEAN_REVERSION";
      }

      const entryPrice = pred.entry_price || 0;
      const stopLossPct = regime === "FUNDAMENTAL" ? 4 : 3;
      const stopLossPrice = entryPrice * (1 - stopLossPct / 100);
      const rrMultiple = regime === "MEAN_REVERSION" ? 1.5 : regime === "MOMENTUM" ? 2.5 : 0;
      const targetPrice = rrMultiple > 0 ? entryPrice + (entryPrice - stopLossPrice) * rrMultiple : null;
      const rrRatio = rrMultiple || null;

      // Position size
      const riskAmount = (config.portfolio_value || 100000) * ((config.max_risk_pct || 1) / 100);
      const riskPerShare = Math.abs(entryPrice - stopLossPrice);
      const positionSize = riskPerShare > 0 ? Math.floor(riskAmount / riskPerShare) : 0;

      candidateRows.push({
        user_id: userId, config_id: config.id, symbol_id: sym.id, ticker,
        source: sources.join(","),
        regime, status: regime ? "active" : "waiting",
        total_score: totalScore, confidence,
        stop_loss_price: stopLossPrice, stop_loss_pct: stopLossPct,
        target_price: targetPrice, rr_ratio: rrRatio,
        position_size: positionSize, entry_price: entryPrice,
        signal_price: entryPrice,
        fundamental_exit_available: !!fundamentalSig,
        analysis_data: { agreement, coverage, staleness: Math.round(staleness) },
      });

      logRows.push({
        user_id: userId, config_id: config.id, run_id: jobId,
        action: "evaluate", ticker,
        details: { regime, totalScore, confidence, agreement, coverage },
      });
    }

    // Insert candidates
    if (candidateRows.length > 0) {
      await adminClient.from("strategy_candidates").insert(candidateRows);
    }

    // Insert logs
    if (logRows.length > 0) {
      await adminClient.from("strategy_trade_log").insert(logRows);
    }

    // Update job
    if (jobId) {
      await adminClient.from("strategy_automation_jobs").update({
        completed_at: new Date().toISOString(),
        status: "completed",
        universe_size: tickers.length,
        candidates_found: candidateRows.filter(c => c.status !== "blocked").length,
        positions_opened: 0,
        positions_closed: 0,
      }).eq("id", jobId);
    }

    return new Response(JSON.stringify({
      universeSize: tickers.length,
      candidatesTotal: candidateRows.length,
      candidatesPassing: candidateRows.filter(c => c.status !== "blocked").length,
      jobId,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Strategy evaluate error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
