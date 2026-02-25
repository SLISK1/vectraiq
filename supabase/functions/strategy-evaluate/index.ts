import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ============================================================
// Inline normalizer (edge functions can't import from src/)
// ============================================================

interface NormalizedModuleSignal {
  dir: "UP" | "DOWN" | "NEUTRAL";
  strength: number;
  weight: number;
  confidence: number;
}

interface NormalizedSnapshot {
  totalScore: number;
  confidence: number;
  agreement: number;
  coverage: number;
  volRisk: number;
  dataAgeHours: number;
  direction: "UP" | "DOWN" | "NEUTRAL";
  modules: Record<string, NormalizedModuleSignal>;
  trend: {
    durationLikelyDays: number | null;
    durationMinDays: number | null;
    durationMaxDays: number | null;
    trendStrength: number | null;
    reversalRisk: number | null;
    stopLossPrice: number | null;
    stopLossPct: number | null;
    takeProfit: {
      conservativePrice?: number;
      moderatePrice?: number;
      aggressivePrice?: number;
    };
    riskRewardRatio: number | null;
  };
  lastUpdatedISO: string;
  entryPrice: number;
  _debug: {
    missingFields: string[];
    scaleAdjusted: string[];
    moduleKeysSeen: string[];
  };
}

const MODULE_KEY_MAP: Record<string, string> = {
  technical: "technical",
  quant: "quant",
  volatility: "volatility",
  seasonal: "seasonal",
  fundamental: "fundamental",
  macro: "macro",
  orderflow: "orderFlow",
  orderFlow: "orderFlow",
  measuredmoves: "measuredMoves",
  measuredMoves: "measuredMoves",
  sentiment: "sentiment",
  ml: "ml",
};

function canonicalKey(raw: string): string {
  return MODULE_KEY_MAP[raw] || raw;
}

function normalizeFromDB(
  prediction: any,
  signals: any[],
  _analysisData?: any
): NormalizedSnapshot {
  const debug = { missingFields: [] as string[], scaleAdjusted: [] as string[], moduleKeysSeen: [] as string[] };

  const modules: Record<string, NormalizedModuleSignal> = {};
  for (const sig of signals) {
    const key = canonicalKey(sig.module || "");
    if (!key) continue;
    debug.moduleKeysSeen.push(key);
    modules[key] = {
      dir: sig.direction || "NEUTRAL",
      strength: sig.strength ?? 50,
      weight: 0,
      confidence: sig.confidence ?? 50,
    };
  }

  const moduleCount = Object.keys(modules).length;
  if (moduleCount > 0) {
    const eq = Math.round(100 / moduleCount);
    for (const k of Object.keys(modules)) modules[k].weight = eq;
  }

  const predDir = prediction?.predicted_direction || "NEUTRAL";
  const dirSignals = signals.filter((s: any) => s.direction === predDir);
  const nonNeutralSignals = signals.filter((s: any) => s.direction !== "NEUTRAL");
  const agreement = nonNeutralSignals.length > 0
    ? Math.round((dirSignals.length / nonNeutralSignals.length) * 100)
    : 50;

  const expectedModules = 8;
  const coverage = Math.min(100, Math.round((moduleCount / expectedModules) * 100));

  const volMod = modules["volatility"];
  const volRisk = volMod
    ? volMod.dir === "DOWN" ? 70 : volMod.dir === "UP" ? 30 : 50
    : 50;

  const createdAt = prediction?.created_at || new Date().toISOString();
  const dataAgeHours = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);

  const ad = _analysisData || {};
  const trend = {
    durationLikelyDays: ad.durationLikelyDays ?? null,
    durationMinDays: ad.durationMinDays ?? null,
    durationMaxDays: ad.durationMaxDays ?? null,
    trendStrength: ad.trendStrength ?? null,
    reversalRisk: ad.reversalRisk ?? null,
    stopLossPrice: ad.stopLossPrice ?? null,
    stopLossPct: ad.stopLossPct ?? null,
    takeProfit: {
      conservativePrice: ad.takeProfitConservative,
      moderatePrice: ad.takeProfitModerate,
      aggressivePrice: ad.takeProfitAggressive,
    },
    riskRewardRatio: ad.riskRewardRatio ?? null,
  };

  if (trend.durationLikelyDays == null) debug.missingFields.push("durationLikelyDays");
  if (trend.trendStrength == null) debug.missingFields.push("trendStrength");

  return {
    totalScore: prediction?.total_score ?? 50,
    confidence: prediction?.confidence ?? 50,
    agreement,
    coverage,
    volRisk,
    dataAgeHours: Math.max(0, dataAgeHours),
    direction: predDir,
    modules,
    trend,
    lastUpdatedISO: createdAt,
    entryPrice: prediction?.entry_price || 0,
    _debug: debug,
  };
}

// ---- Quality Gate ----
function passesQualityGate(
  n: NormalizedSnapshot,
  config: any
): { passed: boolean; failed: string[]; metrics: Record<string, number> } {
  const failed: string[] = [];
  if (n.totalScore < config.total_score_min) failed.push(`TotalScore ${n.totalScore} < ${config.total_score_min}`);
  if (n.agreement < config.agreement_min) failed.push(`Enighet ${n.agreement}% < ${config.agreement_min}%`);
  if (n.coverage < config.coverage_min) failed.push(`Täckning ${n.coverage}% < ${config.coverage_min}%`);
  if (n.volRisk > config.vol_risk_max) failed.push(`VolRisk ${n.volRisk} > ${config.vol_risk_max}`);
  if (n.dataAgeHours > config.max_staleness_h) failed.push(`Data ${Math.round(n.dataAgeHours)}h > ${config.max_staleness_h}h`);

  return {
    passed: failed.length === 0,
    failed,
    metrics: {
      totalScore: n.totalScore,
      agreement: n.agreement,
      coverage: n.coverage,
      volRisk: n.volRisk,
      dataAgeHours: Math.round(n.dataAgeHours * 10) / 10,
    },
  };
}

// ---- Regime Classification ----
type Regime = "MOMENTUM" | "FUNDAMENTAL" | "MEAN_REVERSION" | "NONE";

function classifyRegime(n: NormalizedSnapshot, config: any): { regime: Regime; reasons: string[] } {
  const reasons: string[] = [];
  const fund = n.modules["fundamental"];
  const quant = n.modules["quant"];
  const mm = n.modules["measuredMoves"];
  const duration = n.trend.durationLikelyDays;
  const strength = n.trend.trendStrength;

  // 1. FUNDAMENTAL
  const fundMinDays = 90;
  const fundMinAgreement = Math.max(config.agreement_min || 70, 70);
  if (fund) {
    if (fund.dir === "UP" && fund.weight >= 20) {
      if (duration != null && duration >= fundMinDays && n.agreement >= fundMinAgreement) {
        reasons.push(`Fundamental UP, vikt=${fund.weight}, duration=${duration}d, enighet=${n.agreement}%`);
        return { regime: "FUNDAMENTAL", reasons };
      } else {
        const parts: string[] = [];
        if (duration == null) parts.push("duration saknas");
        else if (duration < fundMinDays) parts.push(`duration ${duration}d < ${fundMinDays}`);
        if (n.agreement < fundMinAgreement) parts.push(`enighet ${n.agreement}% < ${fundMinAgreement}%`);
        reasons.push(`Fundamental möjlig men: ${parts.join(", ")}`);
      }
    }
  } else {
    reasons.push("Fundamental-modul saknas");
  }

  // 2. MOMENTUM
  if (quant && mm) {
    if (quant.dir === "UP" && mm.dir === "UP") {
      if (strength != null && strength >= 40 && duration != null && duration >= 7 && duration <= 60) {
        reasons.push(`Quant+MM UP, styrka=${strength}, duration=${duration}d`);
        return { regime: "MOMENTUM", reasons };
      } else {
        const parts: string[] = [];
        if (strength == null) parts.push("trendStrength saknas");
        else if (strength < 40) parts.push(`styrka ${strength} < 40`);
        if (duration == null) parts.push("duration saknas");
        else if (duration < 7) parts.push(`duration ${duration}d < 7`);
        else if (duration > 60) parts.push(`duration ${duration}d > 60`);
        reasons.push(`Momentum möjlig men: ${parts.join(", ")}`);
      }
    } else {
      if (quant.dir !== "UP") reasons.push(`Quant dir=${quant.dir} (behöver UP)`);
      if (mm.dir !== "UP") reasons.push(`MM dir=${mm.dir} (behöver UP)`);
    }
  } else {
    if (!quant) reasons.push("Quant-modul saknas");
    if (!mm) reasons.push("MeasuredMoves-modul saknas");
  }

  // 3. MEAN_REVERSION
  if (config.mean_reversion_enabled) {
    if (quant && quant.dir === "UP") {
      if ((strength == null || strength < 50) && (duration == null || duration <= 7)) {
        reasons.push(`Mean Reversion: quant UP, styrka=${strength ?? "?"}, duration=${duration ?? "?"}`);
        return { regime: "MEAN_REVERSION", reasons };
      }
    }
  } else {
    if (quant?.dir === "UP" && (strength == null || strength < 50)) {
      reasons.push("Mean Reversion möjlig men inaktiverad");
    }
  }

  return { regime: "NONE", reasons };
}

// ============================================================
// Helper: paginated fetch (Supabase default limit is 1000)
// ============================================================
async function fetchAll(client: any, table: string, query: any) {
  const PAGE = 1000;
  let all: any[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await query.range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

// ============================================================
// Edge Function
// ============================================================
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const isServiceRole = token === serviceKey;

    let userId: string;
    let requestBody: any = {};
    const adminClient = createClient(supabaseUrl, serviceKey);

    if (isServiceRole) {
      requestBody = await req.json();
      userId = requestBody.user_id;
      if (!userId) {
        return new Response(JSON.stringify({ error: "user_id required for service role" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      try { requestBody = await req.json(); } catch { requestBody = {}; }
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

    // ---- Get config ----
    const configId = requestBody.config_id;
    let configQuery = adminClient.from("strategy_configs").select("*").eq("user_id", userId);
    if (configId) {
      configQuery = configQuery.eq("id", configId);
    }
    const { data: config, error: cfgErr } = await configQuery.single();

    if (cfgErr || !config) {
      return new Response(JSON.stringify({ error: "No strategy config found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- Create job record ----
    const { data: job } = await adminClient.from("strategy_automation_jobs").insert({
      user_id: userId,
      config_id: config.id,
      status: "running",
    }).select().single();
    const jobId = job?.id;

    // ---- Log run_start ----
    await adminClient.from("strategy_trade_log").insert({
      user_id: userId,
      config_id: config.id,
      run_id: jobId,
      action: "run_start",
      details: {
        configUsed: {
          total_score_min: config.total_score_min,
          agreement_min: config.agreement_min,
          coverage_min: config.coverage_min,
          vol_risk_max: config.vol_risk_max,
          max_staleness_h: config.max_staleness_h,
          mean_reversion_enabled: config.mean_reversion_enabled,
          portfolio_value: config.portfolio_value,
          max_risk_pct: config.max_risk_pct,
          execution_policy: config.execution_policy,
          debug_force_one_candidate: config.debug_force_one_candidate || false,
        },
        startedAt: new Date().toISOString(),
      },
    });

    // ---- Build universe ----
    const sources = Array.isArray(config.universe_sources) ? config.universe_sources : [];
    let tickers: string[] = [];

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

    if (sources.includes("screener")) {
      const { data: syms } = await adminClient
        .from("symbols")
        .select("ticker")
        .eq("is_active", true)
        .limit(500);
      if (syms) tickers.push(...syms.map((s: any) => s.ticker));
    }

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

    tickers = [...new Set(tickers)];
    const limit = config.candidate_limit || 200;
    if (tickers.length > limit) tickers = tickers.slice(0, limit);

    // ---- Get symbols ----
    const { data: symbols } = await adminClient
      .from("symbols")
      .select("id, ticker, sector")
      .in("ticker", tickers.length > 0 ? tickers : ["__NONE__"]);

    const symbolMap = new Map((symbols || []).map((s: any) => [s.ticker, s]));
    const symbolIds = (symbols || []).map((s: any) => s.id);

    // ---- FIX: Fetch predictions PER SYMBOL (latest only, with proper horizon) ----
    // Use '1w' horizon for swing strategy, fall back to any horizon
    const STRATEGY_HORIZON = "1w";

    // Fetch predictions in batches to avoid the 1000-row limit
    const predBySymbol = new Map<string, any>();

    // Fetch in chunks of 50 symbol IDs to stay well within limits
    const CHUNK = 50;
    for (let i = 0; i < symbolIds.length; i += CHUNK) {
      const chunk = symbolIds.slice(i, i + CHUNK);

      // Try preferred horizon first
      const { data: preds } = await adminClient
        .from("asset_predictions")
        .select("*")
        .in("symbol_id", chunk)
        .eq("horizon", STRATEGY_HORIZON)
        .order("created_at", { ascending: false })
        .limit(chunk.length);

      for (const p of preds || []) {
        if (!predBySymbol.has(p.symbol_id)) predBySymbol.set(p.symbol_id, p);
      }

      // For symbols without the preferred horizon, try any horizon
      const missing = chunk.filter((id: string) => !predBySymbol.has(id));
      if (missing.length > 0) {
        const { data: fallback } = await adminClient
          .from("asset_predictions")
          .select("*")
          .in("symbol_id", missing)
          .order("created_at", { ascending: false })
          .limit(missing.length * 4); // up to 4 horizons

        for (const p of fallback || []) {
          if (!predBySymbol.has(p.symbol_id)) predBySymbol.set(p.symbol_id, p);
        }
      }
    }

    // ---- FIX: Fetch signals PER SYMBOL in batches, filtered by horizon ----
    const sigBySymbol = new Map<string, any[]>();

    for (let i = 0; i < symbolIds.length; i += CHUNK) {
      const chunk = symbolIds.slice(i, i + CHUNK);

      // Try preferred horizon
      const { data: sigs } = await adminClient
        .from("signals")
        .select("*")
        .in("symbol_id", chunk)
        .eq("horizon", STRATEGY_HORIZON)
        .order("created_at", { ascending: false })
        .limit(chunk.length * 10); // ~10 modules per symbol

      for (const s of sigs || []) {
        if (!sigBySymbol.has(s.symbol_id)) sigBySymbol.set(s.symbol_id, []);
        // Only keep one signal per module per symbol (latest)
        const existing = sigBySymbol.get(s.symbol_id)!;
        if (!existing.find((e: any) => e.module === s.module)) {
          existing.push(s);
        }
      }

      // For symbols without signals at preferred horizon, try any
      const missingSigs = chunk.filter((id: string) => !sigBySymbol.has(id) || sigBySymbol.get(id)!.length === 0);
      if (missingSigs.length > 0) {
        const { data: fallback } = await adminClient
          .from("signals")
          .select("*")
          .in("symbol_id", missingSigs)
          .order("created_at", { ascending: false })
          .limit(missingSigs.length * 10);

        for (const s of fallback || []) {
          if (!sigBySymbol.has(s.symbol_id)) sigBySymbol.set(s.symbol_id, []);
          const existing = sigBySymbol.get(s.symbol_id)!;
          if (!existing.find((e: any) => e.module === s.module)) {
            existing.push(s);
          }
        }
      }
    }

    // Delete old candidates
    await adminClient.from("strategy_candidates").delete().eq("config_id", config.id);

    // ---- Pipeline counters ----
    let analysisRowsFetched = 0;
    let passedGateCount = 0;
    let matchedRegimeCount = 0;
    let candidatesUpsertedCount = 0;

    const candidateRows: any[] = [];
    const logRows: any[] = [];

    for (const ticker of tickers) {
      const sym = symbolMap.get(ticker);
      if (!sym) continue;

      const pred = predBySymbol.get(sym.id);
      const sigs = sigBySymbol.get(sym.id) || [];

      if (!pred) {
        candidateRows.push({
          user_id: userId, config_id: config.id, symbol_id: sym.id, ticker,
          source: sources.join(","), status: "blocked",
          block_reasons: {
            gate: { passed: false, failed: ["Ingen prediktion/analysdata tillgänglig"] },
            regime: { picked: "NONE", failed: [] },
            metrics: {},
            moduleKeysSeen: [],
          },
          total_score: 0, confidence: 0,
          fundamental_exit_available: false,
          analysis_data: {},
        });
        continue;
      }

      analysisRowsFetched++;

      const n = normalizeFromDB(pred, sigs);

      // Quality Gate
      const gate = passesQualityGate(n, config);

      if (!gate.passed) {
        candidateRows.push({
          user_id: userId, config_id: config.id, symbol_id: sym.id, ticker,
          source: sources.join(","), status: "blocked",
          block_reasons: {
            gate: { passed: false, failed: gate.failed },
            regime: { picked: "NONE", failed: [] },
            metrics: gate.metrics,
            moduleKeysSeen: n._debug.moduleKeysSeen,
          },
          total_score: n.totalScore, confidence: n.confidence,
          fundamental_exit_available: false,
          analysis_data: {
            agreement: n.agreement, coverage: n.coverage,
            volRisk: n.volRisk, dataAgeHours: Math.round(n.dataAgeHours),
          },
        });
        continue;
      }

      passedGateCount++;

      // Regime classification
      const { regime, reasons: regimeReasons } = classifyRegime(n, config);

      if (regime !== "NONE") matchedRegimeCount++;

      const status = regime !== "NONE" ? "candidate" : "waiting";

      // Position sizing
      const entryPrice = n.entryPrice;
      const stopLossPct = regime === "FUNDAMENTAL" ? 4 : 3;
      const stopLossPrice = n.trend.stopLossPrice || entryPrice * (1 - stopLossPct / 100);
      const rrMultiple = regime === "MEAN_REVERSION" ? 1.5 : regime === "MOMENTUM" ? 2.5 : 0;
      const targetPrice = rrMultiple > 0 ? entryPrice + Math.abs(entryPrice - stopLossPrice) * rrMultiple : null;
      const rrRatio = n.trend.riskRewardRatio || rrMultiple || null;
      const riskAmount = (config.portfolio_value || 100000) * ((config.max_risk_pct || 1) / 100);
      const riskPerShare = Math.abs(entryPrice - stopLossPrice);
      const positionSize = riskPerShare > 0 ? Math.floor(riskAmount / riskPerShare) : 0;

      candidateRows.push({
        user_id: userId, config_id: config.id, symbol_id: sym.id, ticker,
        source: sources.join(","),
        regime: regime !== "NONE" ? regime : null,
        status,
        total_score: n.totalScore, confidence: n.confidence,
        stop_loss_price: stopLossPrice, stop_loss_pct: stopLossPct,
        target_price: targetPrice, rr_ratio: rrRatio,
        position_size: positionSize, entry_price: entryPrice,
        signal_price: entryPrice,
        trend_strength: n.trend.trendStrength,
        trend_duration: n.trend.durationLikelyDays,
        fundamental_exit_available: !!n.modules["fundamental"],
        block_reasons: {
          gate: { passed: true, failed: [] },
          regime: { picked: regime, failed: regime === "NONE" ? regimeReasons : [] },
          metrics: {
            totalScore: n.totalScore, agreement: n.agreement,
            coverage: n.coverage, volRisk: n.volRisk,
            dataAgeHours: Math.round(n.dataAgeHours),
            durationLikelyDays: n.trend.durationLikelyDays,
            trendStrength: n.trend.trendStrength,
          },
          moduleKeysSeen: n._debug.moduleKeysSeen,
        },
        analysis_data: {
          agreement: n.agreement, coverage: n.coverage,
          volRisk: n.volRisk, dataAgeHours: Math.round(n.dataAgeHours),
          durationLikelyDays: n.trend.durationLikelyDays,
          trendStrength: n.trend.trendStrength,
          regimeReasons,
        },
      });

      logRows.push({
        user_id: userId, config_id: config.id, run_id: jobId,
        action: "evaluate", ticker,
        details: {
          regime, status, totalScore: n.totalScore,
          agreement: n.agreement, coverage: n.coverage,
          regimeReasons,
        },
      });
    }

    // ---- Sanity override (debug_force_one_candidate) ----
    if (config.debug_force_one_candidate && tickers.length > 0 && matchedRegimeCount === 0) {
      const firstTicker = tickers[0];
      const sym = symbolMap.get(firstTicker);
      if (sym) {
        const pred = predBySymbol.get(sym.id);
        candidateRows.push({
          user_id: userId, config_id: config.id, symbol_id: sym.id, ticker: firstTicker,
          source: "debug_override",
          regime: "MOMENTUM", status: "candidate",
          total_score: pred?.total_score ?? 50, confidence: pred?.confidence ?? 50,
          entry_price: pred?.entry_price || 100,
          stop_loss_price: (pred?.entry_price || 100) * 0.97,
          stop_loss_pct: 3,
          rr_ratio: 2.5,
          position_size: 10,
          signal_price: pred?.entry_price || 100,
          fundamental_exit_available: false,
          block_reasons: {
            gate: { passed: true, failed: [] },
            regime: { picked: "MOMENTUM", failed: ["DEBUG OVERRIDE — forcerad kandidat"] },
            metrics: {},
            moduleKeysSeen: [],
          },
          analysis_data: { debugForced: true },
        });
        matchedRegimeCount++;
        logRows.push({
          user_id: userId, config_id: config.id, run_id: jobId,
          action: "debug_override", ticker: firstTicker,
          details: { reason: "debug_force_one_candidate enabled, no regime matched" },
        });
      }
    }

    candidatesUpsertedCount = candidateRows.length;

    // Insert candidates in batches
    if (candidateRows.length > 0) {
      const batchSize = 50;
      for (let i = 0; i < candidateRows.length; i += batchSize) {
        const { error: insertErr } = await adminClient.from("strategy_candidates").insert(candidateRows.slice(i, i + batchSize));
        if (insertErr) console.error("Insert candidates error:", insertErr);
      }
    }

    // Insert logs
    if (logRows.length > 0) {
      await adminClient.from("strategy_trade_log").insert(logRows);
    }

    // run_summary log
    const summary = {
      universeSize: tickers.length,
      analysisRowsFetched,
      passedGateCount,
      matchedRegimeCount,
      candidatesUpsertedCount,
      blockedCount: candidateRows.filter(c => c.status === "blocked").length,
      waitingCount: candidateRows.filter(c => c.status === "waiting").length,
      candidateCount: candidateRows.filter(c => c.status === "candidate").length,
    };

    await adminClient.from("strategy_trade_log").insert({
      user_id: userId, config_id: config.id, run_id: jobId,
      action: "run_summary", details: summary,
    });

    // Update job
    if (jobId) {
      await adminClient.from("strategy_automation_jobs").update({
        completed_at: new Date().toISOString(),
        status: "completed",
        universe_size: tickers.length,
        candidates_found: matchedRegimeCount,
        analysis_rows_fetched: analysisRowsFetched,
        passed_gate_count: passedGateCount,
        matched_regime_count: matchedRegimeCount,
        candidates_upserted_count: candidatesUpsertedCount,
        positions_opened: 0,
        positions_closed: 0,
      }).eq("id", jobId);
    }

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Strategy evaluate error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
