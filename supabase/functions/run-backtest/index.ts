// ============================================================
// run-backtest — honest, point-in-time, cost-aware backtest engine
//
// Strategy (deliberately parameter-free to avoid overfitting):
//   Cross-sectional price MOMENTUM. At each rebalance date t, rank the
//   eligible universe by trailing return over `lookback_months` ending at t
//   (optionally skipping the most recent ~`skip_recent_days` trading days to
//   sidestep short-term reversal). Long the top `top_n`, equal-weight, hold
//   until the next rebalance. Repeat.
//
// ANTI-LOOKAHEAD DISCIPLINE (the whole point — subtle bias ruins a backtest):
//   1. DECISION uses only past data. At decision time t the ranking reads ONLY
//      price_history rows with date <= t. We never peek at a price dated after t.
//   2. REALIZED forward returns. The return earned between t and the next
//      rebalance t+1 uses ACTUAL forward closes (close at t -> close at t+1).
//      That is realized performance, not lookahead — we commit to holdings at t
//      and only later observe how they did.
//   3. ENTRY price == the close at t (the last price we are allowed to see at
//      the decision). The forward close at t+1 is the EXIT/next-entry. There is
//      no gap where a future price informs a past decision.
//   4. The liquidity filter (is_liquid) is OPTIONAL and OFF by default because
//      is_liquid is computed as-of-today; applying it historically is a mild
//      lookahead. Documented below; only applied when use_liquidity_filter=true.
//
// COSTS: on every rebalance, each position entered or exited pays a per-side
//   cost using the SAME formula as src/lib/strategy/engine.ts:
//     per side: slippage_bps (price slip) + commission_bps (proportional)
//               + commission_per_trade (flat).
//   A name held through a rebalance pays nothing; a name fully rotated out and a
//   new name rotated in each pay one side (so a full swap = one round-trip).
//   Costs are deducted from portfolio value so turnover is modeled honestly.
//
// BENCHMARK & DIVIDEND HONESTY: the strategy is a PRICE-return strategy (no
//   dividend reinvestment — we have no per-stock dividend data). So the PRIMARY,
//   apples-to-apples benchmark is the PRICE index ^OMXSPI bought-and-held with
//   the same initial capital over the same dates. We ALSO fetch the
//   gross/total-return index ^OMXSGI when Yahoo serves it and report it as a
//   SECONDARY, stricter bar — explicitly noting it includes dividends the
//   strategy does NOT earn, so beating OMXSGI is a higher hurdle than OMXSPI.
//
// DATA CAVEAT: price_history may hold only ~1 year (fetch-history pulls 365d).
//   We use whatever exists, compute the ACTUAL covered date range, and if fewer
//   than ~6 rebalances are possible we still run but stamp metrics.note with a
//   human-readable warning.
//
// AUTH: mirrors the user-facing pattern in fetch-history — an anon-key client
//   carrying the request's Authorization header verifies the user via
//   auth.getUser(token); a separate service-role client does the heavy
//   reads/writes. Never leaves a row stuck in 'running': any failure flips the
//   row to status='failed' with the error message.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Primary (price) and secondary (gross/total-return) Swedish equity indices.
const OMXSPI = "^OMXSPI"; // price index — PRIMARY, apples-to-apples (no dividends)
const OMXSGI = "^OMXSGI"; // gross/total-return index — SECONDARY, stricter bar (incl. dividends)

const TRADING_DAYS_PER_YEAR = 252;

// ---- Tunable knobs (all defaulted; strategy itself is parameter-free) ----
interface BacktestParams {
  lookback_months: number;       // momentum lookback window (default 6)
  top_n: number;                 // # names held, equal weight (default 10)
  rebalance: "monthly" | "weekly" | "quarterly"; // rebalance cadence (default monthly)
  skip_recent_days: number;      // skip most-recent N trading days in momentum (default 5)
  initial_capital: number;       // starting portfolio value (default 100000)
  min_history_days: number;      // require >= this many prior closes to be eligible (default ~ lookback)
  use_liquidity_filter: boolean; // OFF by default (is_liquid is as-of-today)
  slippage_bps: number;          // per-side price slippage in bps (default 10)
  commission_bps: number;        // per-side proportional commission in bps (default 5)
  commission_per_trade: number;  // per-side flat fee in account currency (default 0)
  start_date: string | null;     // optional ISO date — clamp the rebalance calendar start
  end_date: string | null;       // optional ISO date — clamp the rebalance calendar end
}

function withDefaults(raw: Record<string, unknown> | undefined): BacktestParams {
  const p = raw ?? {};
  const num = (v: unknown, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const lookback = Math.max(1, Math.round(num(p.lookback_months, 6)));
  const isoDate = (v: unknown): string | null =>
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  const rebalance: "weekly" | "monthly" | "quarterly" =
    p.rebalance === "weekly" ? "weekly" : p.rebalance === "quarterly" ? "quarterly" : "monthly";
  return {
    lookback_months: lookback,
    top_n: Math.max(1, Math.round(num(p.top_n, 10))),
    rebalance,
    skip_recent_days: Math.max(0, Math.round(num(p.skip_recent_days, 5))),
    initial_capital: Math.max(1, num(p.initial_capital, 100000)),
    // Default: roughly the lookback window in trading days (~21/mo) so a name
    // must have enough history to even be ranked at t.
    min_history_days: Math.max(2, Math.round(num(p.min_history_days, lookback * 21))),
    use_liquidity_filter: p.use_liquidity_filter === true,
    slippage_bps: Math.max(0, num(p.slippage_bps, 10)),
    commission_bps: Math.max(0, num(p.commission_bps, 5)),
    commission_per_trade: Math.max(0, num(p.commission_per_trade, 0)),
    start_date: isoDate(p.start_date),
    end_date: isoDate(p.end_date),
  };
}

// ---- Yahoo index fetch (same chart endpoint as paper-snapshot / score-predictions) ----
// Returns the full daily close series as { date(YYYY-MM-DD), close }, sorted
// ascending. Returns null on ANY failure (e.g. a 404 for a ticker Yahoo does not
// serve) so callers can skip gracefully without throwing.
async function fetchYahooSeries(
  ticker: string,
  fromDate: Date,
  toDate: Date,
): Promise<{ date: string; close: number }[] | null> {
  try {
    const from = Math.floor(fromDate.getTime() / 1000);
    const to = Math.floor(toDate.getTime() / 1000);
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
      `?interval=1d&period1=${from}&period2=${to}`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null; // 404 / 4xx / 5xx — skip this ticker gracefully
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    const ts: number[] | undefined = result?.timestamp;
    const closes: (number | null)[] | undefined = result?.indicators?.quote?.[0]?.close;
    if (!ts || !closes || ts.length === 0) return null;
    const out: { date: string; close: number }[] = [];
    for (let i = 0; i < ts.length; i++) {
      const c = closes[i];
      if (c == null) continue;
      out.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close: c });
    }
    out.sort((a, b) => (a.date < b.date ? -1 : 1));
    return out.length ? out : null;
  } catch {
    return null; // network/parse error — skip gracefully, never throw
  }
}

// Buy-and-hold value of `capital` invested in an index series at the close
// on/after `startDate`, valued at each rebalance date (last close <= date).
// Returns { entry, valueAt(date), totalReturnPct } or null if unusable.
function buildBenchmark(
  series: { date: string; close: number }[],
  startDate: string,
  capital: number,
) {
  const entryRow = series.find((r) => r.date >= startDate) ?? series[0];
  if (!entryRow || entryRow.close <= 0) return null;
  const entry = entryRow.close;
  // last close on/before a given date (point-in-time consistent with strategy)
  const valueAt = (date: string): number | null => {
    let close: number | null = null;
    for (const r of series) {
      if (r.date <= date) close = r.close;
      else break;
    }
    if (close == null) close = entry;
    return capital * (close / entry);
  };
  const lastClose = series[series.length - 1].close;
  return { entry, valueAt, totalReturnPct: (lastClose / entry - 1) * 100 };
}

// ---- Per-symbol close series, deduped to one close per date ----
// price_history allows multiple sources per (symbol_id,date); we keep the most
// recent close per date. The whole series is kept; the point-in-time slicing
// (date <= t) happens at decision time, never here.
interface SymbolSeries {
  id: string;
  ticker: string;
  // ascending [date, close]; one entry per calendar date
  closes: { date: string; close: number }[];
}

// Linear scan helpers — series are small (~250 rows / symbol / year).
function lastIndexAtOrBefore(closes: { date: string }[], date: string): number {
  let idx = -1;
  for (let i = 0; i < closes.length; i++) {
    if (closes[i].date <= date) idx = i;
    else break;
  }
  return idx;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // ---- Auth: verify the user with an anon-key client carrying their token ----
  // (Same shape as the user-facing branch of fetch-history.) Heavy reads/writes
  // below use the service-role client.
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const token = authHeader.replace("Bearer ", "");
  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: claims, error: authError } = await supabaseAuth.auth.getUser(token);
  if (authError || !claims?.user) {
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userId = claims.user.id;

  // Service-role client for the heavy reads/writes.
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // ---- Parse request ----
  let name: string | null = null;
  let params: BacktestParams;
  try {
    const body = await req.json();
    name = typeof body?.name === "string" ? body.name : null;
    params = withDefaults(body?.params);
  } catch {
    params = withDefaults(undefined);
  }

  // ---- Insert the run row (status 'running') BEFORE doing the work ----
  let runId: string | null = null;
  try {
    const { data: inserted, error: insErr } = await supabase
      .from("backtest_runs")
      .insert({
        user_id: userId,
        name,
        params,
        status: "running",
        benchmark_ticker: OMXSPI,
      })
      .select("id")
      .single();
    if (insErr) throw insErr;
    runId = inserted.id;
  } catch (err) {
    console.error("run-backtest: failed to create run row:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message || "Failed to create run" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ---- Run the replay synchronously; on ANY error flip status to 'failed' ----
  try {
    const result = await runBacktest(supabase, params);

    const { data: completed, error: updErr } = await supabase
      .from("backtest_runs")
      .update({
        status: "completed",
        metrics: result.metrics,
        equity_curve: result.equityCurve,
        trades: result.trades,
        benchmark_ticker: OMXSPI,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId)
      .select("*")
      .single();
    if (updErr) throw updErr;

    return new Response(JSON.stringify(completed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("run-backtest error:", err);
    const message = (err as Error).message || "Backtest failed";
    // Never leave a row stuck in 'running'.
    if (runId) {
      await supabase
        .from("backtest_runs")
        .update({ status: "failed", error: message, completed_at: new Date().toISOString() })
        .eq("id", runId);
    }
    return new Response(JSON.stringify({ error: message, run_id: runId }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ============================================================
// Core replay
// ============================================================
interface BacktestOutput {
  metrics: Record<string, unknown>;
  equityCurve: { date: string; strategy: number; benchmark: number | null }[];
  trades: {
    date: string;
    held: string[];        // tickers held into the next period
    entered: string[];     // newly bought this rebalance
    exited: string[];      // sold this rebalance
    cost: number;          // total transaction cost charged this rebalance
    period_return_pct: number | null; // realized strategy return over the *prior* period
  }[];
}

async function runBacktest(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  params: BacktestParams,
): Promise<BacktestOutput> {
  // ---- 1. Eligible universe: stocks + funds, active ----
  const { data: symbols, error: symErr } = await supabase
    .from("symbols")
    .select("id, ticker, asset_type, is_active, is_liquid")
    .in("asset_type", ["stock", "fund"])
    .eq("is_active", true);
  if (symErr) throw symErr;

  let universe = (symbols ?? []) as {
    id: string;
    ticker: string;
    asset_type: string;
    is_active: boolean;
    is_liquid: boolean | null;
  }[];

  // OPTIONAL liquidity filter — OFF by default (is_liquid is as-of-today, so
  // applying it across history is a mild lookahead). When enabled we exclude
  // names explicitly flagged illiquid (is_liquid === false); NULL (unknown) is
  // kept rather than silently dropped.
  if (params.use_liquidity_filter) {
    universe = universe.filter((s) => s.is_liquid !== false);
  }

  if (universe.length === 0) {
    throw new Error("Empty universe (no active stocks/funds found)");
  }

  // ---- 2. Load each symbol's full close series, deduped to one close/date ----
  // We fetch the whole history (point-in-time slicing happens per decision via
  // date <= t). Multiple sources per date collapse to the last close seen.
  const seriesById = new Map<string, SymbolSeries>();
  const ids = universe.map((s) => s.id);

  // Page through price_history in symbol_id batches to stay within row limits.
  const BATCH = 40;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batchIds = ids.slice(i, i + BATCH);
    // Pull this batch fully, paging on a stable order.
    let from = 0;
    const PAGE = 1000;
    const rowsByDate = new Map<string, Map<string, number>>(); // symbol_id -> date -> close
    while (true) {
      const { data: rows, error: phErr } = await supabase
        .from("price_history")
        .select("symbol_id, date, close_price")
        .in("symbol_id", batchIds)
        .order("symbol_id", { ascending: true })
        .order("date", { ascending: true })
        .range(from, from + PAGE - 1);
      if (phErr) throw phErr;
      if (!rows || rows.length === 0) break;
      for (const r of rows) {
        const close = Number(r.close_price);
        if (!Number.isFinite(close) || close <= 0) continue;
        let m = rowsByDate.get(r.symbol_id);
        if (!m) {
          m = new Map<string, number>();
          rowsByDate.set(r.symbol_id, m);
        }
        m.set(r.date, close); // last source per date wins
      }
      if (rows.length < PAGE) break;
      from += PAGE;
    }
    for (const symId of batchIds) {
      const m = rowsByDate.get(symId);
      if (!m || m.size === 0) continue;
      const closes = Array.from(m.entries())
        .map(([date, close]) => ({ date, close }))
        .sort((a, b) => (a.date < b.date ? -1 : 1));
      const meta = universe.find((s) => s.id === symId)!;
      seriesById.set(symId, { id: symId, ticker: meta.ticker, closes });
    }
  }

  if (seriesById.size === 0) {
    throw new Error("No price_history available for the eligible universe");
  }

  // ---- 3. Build the master trading calendar from union of all dates ----
  const dateSet = new Set<string>();
  for (const s of seriesById.values()) {
    for (const c of s.closes) dateSet.add(c.date);
  }
  let allDates = Array.from(dateSet).sort();
  // Honor optional start_date/end_date window (clamp the rebalance calendar).
  // Momentum still reads each symbol's FULL series (data before start_date was
  // already known at start_date), so windowing stays point-in-time correct.
  if (params.start_date) allDates = allDates.filter((d) => d >= params.start_date!);
  if (params.end_date) allDates = allDates.filter((d) => d <= params.end_date!);
  if (allDates.length === 0) {
    throw new Error("No price_history in the requested date range");
  }
  const minDate = allDates[0];
  const maxDate = allDates[allDates.length - 1];

  // ---- 4. Determine rebalance dates on the actual calendar ----
  // We require `min_history_days` of prior closes before the FIRST rebalance so
  // momentum is computable. Then step monthly (~21 trading days) or weekly (~5).
  const step = params.rebalance === "weekly" ? 5 : params.rebalance === "quarterly" ? 63 : 21;
  // With an explicit start_date, history exists before the window, so start
  // rebalancing at the window's first date (momentumAt filters names that still
  // lack enough history). Otherwise delay until min_history_days of prior closes
  // exist so momentum is computable from inception.
  const firstIdx = params.start_date ? 0 : Math.min(params.min_history_days, allDates.length - 1);
  const rebalanceDates: string[] = [];
  for (let i = firstIdx; i < allDates.length; i += step) {
    rebalanceDates.push(allDates[i]);
  }
  // Ensure the final date is a valuation point so the curve ends at maxDate.
  if (rebalanceDates.length === 0 || rebalanceDates[rebalanceDates.length - 1] !== maxDate) {
    rebalanceDates.push(maxDate);
  }

  // ---- 5. Replay ----
  const equityCurve: { date: string; strategy: number; benchmark: number | null }[] = [];
  const trades: BacktestOutput["trades"] = [];
  const periodReturns: number[] = []; // realized strategy return per holding period

  let portfolioValue = params.initial_capital;
  let currentHoldings: string[] = []; // symbol_ids held going into the period
  let totalCost = 0;
  let totalTurnoverNotional = 0; // sum of |traded notional| for turnover ratio

  // Per-side cost on a given notional, mirroring engine.ts:
  //   slippage_bps + commission_bps proportional + flat commission_per_trade.
  const sideCost = (notional: number): number =>
    notional * (params.slippage_bps / 10000) +
    notional * (params.commission_bps / 10000) +
    params.commission_per_trade;

  // momentum at decision date t for a symbol: trailing return over lookback,
  // skipping the most-recent skip_recent_days, using ONLY closes with date <= t.
  const lookbackDays = params.lookback_months * 21;
  const momentumAt = (s: SymbolSeries, t: string): number | null => {
    const endIdx = lastIndexAtOrBefore(s.closes, t); // last close we are allowed to see
    if (endIdx < 0) return null;
    // Rank on the close `skip_recent_days` back from t (dodging short-term
    // reversal in the very latest bars). NOTE: we still ENTER at the close at t
    // (priceAt uses endIdx) — ranking just ignores the freshest few days.
    const rankIdx = endIdx - params.skip_recent_days;
    if (rankIdx < 0) return null;
    const startIdx = rankIdx - lookbackDays;
    if (startIdx < 0) return null; // not enough history at t — ineligible
    const startClose = s.closes[startIdx].close;
    const rankClose = s.closes[rankIdx].close;
    if (startClose <= 0) return null;
    return rankClose / startClose - 1;
  };

  // entry/exit price for a symbol at date t = last close <= t (the price we can
  // actually transact at without peeking ahead).
  const priceAt = (s: SymbolSeries, t: string): number | null => {
    const idx = lastIndexAtOrBefore(s.closes, t);
    return idx >= 0 ? s.closes[idx].close : null;
  };

  for (let r = 0; r < rebalanceDates.length; r++) {
    const t = rebalanceDates[r];

    // (a) Realize the prior period's return on the holdings we entered last time,
    //     using ACTUAL forward closes (entry close at prior t -> close at this t).
    if (r > 0 && currentHoldings.length > 0) {
      const prevT = rebalanceDates[r - 1];
      let gross = 0;
      let counted = 0;
      for (const id of currentHoldings) {
        const s = seriesById.get(id);
        if (!s) continue;
        const p0 = priceAt(s, prevT);
        const p1 = priceAt(s, t);
        if (p0 == null || p1 == null || p0 <= 0) continue;
        gross += p1 / p0 - 1;
        counted++;
      }
      const periodReturn = counted > 0 ? gross / counted : 0; // equal weight
      portfolioValue *= 1 + periodReturn;
      periodReturns.push(periodReturn);
      // attach realized return to the trade record we created at prevT
      if (trades.length > 0) trades[trades.length - 1].period_return_pct = periodReturn * 100;
    }

    // (b) Rank the universe by point-in-time momentum at t and pick top_n.
    const scored: { id: string; mom: number }[] = [];
    for (const s of seriesById.values()) {
      const mom = momentumAt(s, t);
      if (mom != null) scored.push({ id: s.id, mom });
    }
    scored.sort((a, b) => b.mom - a.mom);
    const targetHoldings = scored.slice(0, params.top_n).map((x) => x.id);

    // (c) Cost the rotation. Each exited and each entered name pays one side on
    //     its equal-weight slice of portfolio value (turnover modeled honestly).
    const held = new Set(currentHoldings);
    const target = new Set(targetHoldings);
    const exited = currentHoldings.filter((id) => !target.has(id));
    const entered = targetHoldings.filter((id) => !held.has(id));

    let rebalanceCost = 0;
    // exits priced on the OLD equal-weight slice, entries on the NEW slice.
    const oldSlice = currentHoldings.length > 0 ? portfolioValue / currentHoldings.length : 0;
    const newSlice = targetHoldings.length > 0 ? portfolioValue / targetHoldings.length : 0;
    for (let k = 0; k < exited.length; k++) {
      rebalanceCost += sideCost(oldSlice);
      totalTurnoverNotional += oldSlice;
    }
    for (let k = 0; k < entered.length; k++) {
      rebalanceCost += sideCost(newSlice);
      totalTurnoverNotional += newSlice;
    }
    portfolioValue -= rebalanceCost;
    totalCost += rebalanceCost;

    // (d) Record equity point + trade. Benchmark column filled after the loop.
    equityCurve.push({ date: t, strategy: round2(portfolioValue), benchmark: null });
    trades.push({
      date: t,
      held: targetHoldings.map((id) => seriesById.get(id)?.ticker ?? id),
      entered: entered.map((id) => seriesById.get(id)?.ticker ?? id),
      exited: exited.map((id) => seriesById.get(id)?.ticker ?? id),
      cost: round2(rebalanceCost),
      period_return_pct: null,
    });

    currentHoldings = targetHoldings;
  }

  // ---- 6. Benchmarks (PRIMARY ^OMXSPI price, SECONDARY ^OMXSGI total-return) ----
  const startDate = equityCurve.length ? equityCurve[0].date : minDate;
  const endDate = equityCurve.length ? equityCurve[equityCurve.length - 1].date : maxDate;
  const fetchFrom = new Date(new Date(startDate).getTime() - 7 * 86400000); // pad a week
  const fetchTo = new Date(new Date(endDate).getTime() + 86400000);

  let benchmarkTotalReturnPct: number | null = null;
  let omxsgiReturnPct: number | null = null;

  const spiSeries = await fetchYahooSeries(OMXSPI, fetchFrom, fetchTo);
  if (spiSeries) {
    const bench = buildBenchmark(spiSeries, startDate, params.initial_capital);
    if (bench) {
      benchmarkTotalReturnPct = round2(bench.totalReturnPct);
      // fill the benchmark column on the equity curve, point-in-time aligned
      for (const pt of equityCurve) {
        const v = bench.valueAt(pt.date);
        pt.benchmark = v == null ? null : round2(v);
      }
    }
  }
  // SECONDARY, stricter bar — gross/total-return index (includes dividends the
  // PRICE-return strategy does not earn). Skipped gracefully if Yahoo 404s.
  const sgiSeries = await fetchYahooSeries(OMXSGI, fetchFrom, fetchTo);
  if (sgiSeries) {
    const benchG = buildBenchmark(sgiSeries, startDate, params.initial_capital);
    if (benchG) omxsgiReturnPct = round2(benchG.totalReturnPct);
  }

  // ---- 7. Metrics ----
  const nRebalances = periodReturns.length; // # of *realized* holding periods
  const totalReturnPct = (portfolioValue / params.initial_capital - 1) * 100;

  // CAGR from actual elapsed calendar time.
  const elapsedYears =
    (new Date(endDate).getTime() - new Date(startDate).getTime()) / (365.25 * 86400000);
  const cagrPct = elapsedYears > 0
    ? (Math.pow(portfolioValue / params.initial_capital, 1 / elapsedYears) - 1) * 100
    : 0;

  // Annualize vol/Sharpe from per-period returns. periods/year derived from cadence.
  const periodsPerYear = params.rebalance === "weekly" ? 52 : params.rebalance === "quarterly" ? 4 : 12;
  const meanRet = nRebalances > 0 ? periodReturns.reduce((a, b) => a + b, 0) / nRebalances : 0;
  let variance = 0;
  for (const x of periodReturns) variance += (x - meanRet) ** 2;
  variance = nRebalances > 1 ? variance / (nRebalances - 1) : 0;
  const stdRet = Math.sqrt(variance);
  const annVolPct = stdRet * Math.sqrt(periodsPerYear) * 100;
  // Sharpe with risk-free rate = 0 (noted in metrics). Per-period Sharpe scaled.
  const sharpe = stdRet > 0 ? (meanRet / stdRet) * Math.sqrt(periodsPerYear) : 0;

  // Max drawdown on the strategy equity curve.
  let peak = -Infinity;
  let maxDD = 0;
  for (const pt of equityCurve) {
    if (pt.strategy > peak) peak = pt.strategy;
    if (peak > 0) {
      const dd = (pt.strategy - peak) / peak;
      if (dd < maxDD) maxDD = dd;
    }
  }
  const maxDrawdownPct = maxDD * 100;

  const hits = periodReturns.filter((x) => x > 0).length;
  const hitRatePct = nRebalances > 0 ? (hits / nRebalances) * 100 : 0;

  // Turnover ratio: total traded notional / initial capital, per year.
  const turnover = elapsedYears > 0
    ? totalTurnoverNotional / params.initial_capital / elapsedYears
    : totalTurnoverNotional / params.initial_capital;

  const excessReturnPct = benchmarkTotalReturnPct != null
    ? totalReturnPct - benchmarkTotalReturnPct
    : null;

  // Information ratio: annualized mean active return / tracking error, computed
  // per holding period against OMXSPI step returns aligned to rebalance dates.
  let informationRatio: number | null = null;
  if (spiSeries && nRebalances > 0) {
    const bench = buildBenchmark(spiSeries, startDate, params.initial_capital);
    if (bench) {
      const active: number[] = [];
      for (let r = 1; r < rebalanceDates.length; r++) {
        const v0 = bench.valueAt(rebalanceDates[r - 1]);
        const v1 = bench.valueAt(rebalanceDates[r]);
        if (v0 == null || v1 == null || v0 <= 0) continue;
        const benchRet = v1 / v0 - 1;
        const stratRet = periodReturns[r - 1];
        if (stratRet == null) continue;
        active.push(stratRet - benchRet);
      }
      if (active.length > 1) {
        const am = active.reduce((a, b) => a + b, 0) / active.length;
        let av = 0;
        for (const x of active) av += (x - am) ** 2;
        av = av / (active.length - 1);
        const aStd = Math.sqrt(av);
        informationRatio = aStd > 0 ? round3((am / aStd) * Math.sqrt(periodsPerYear)) : null;
      }
    }
  }

  const beatBenchmark = benchmarkTotalReturnPct != null
    ? totalReturnPct > benchmarkTotalReturnPct
    : false;

  // ---- Human-readable caveats ----
  const notes: string[] = [];
  if (nRebalances < 6) {
    notes.push(
      `Only ${nRebalances} realized rebalance period(s) — likely because price_history holds a short window (covered ${startDate}..${endDate}). Treat results as directional, not statistically robust.`,
    );
  }
  if (benchmarkTotalReturnPct == null) {
    notes.push(`Primary benchmark ${OMXSPI} unavailable from Yahoo for this range; benchmark metrics are null.`);
  }
  if (omxsgiReturnPct != null) {
    notes.push(
      `Secondary benchmark ${OMXSGI} (gross/total-return, incl. dividends) returned ${omxsgiReturnPct}% — a STRICTER bar than ${OMXSPI} because the price-return strategy earns no dividends.`,
    );
  } else {
    notes.push(`Secondary benchmark ${OMXSGI} (total-return) unavailable from Yahoo; omxsgi_return_pct is null.`);
  }
  notes.push("Sharpe uses risk-free rate = 0. Strategy is price-return (no dividend reinvestment); primary benchmark is the price index OMXSPI for an apples-to-apples comparison.");
  if (params.use_liquidity_filter) {
    notes.push("Liquidity filter applied (is_liquid). Note: is_liquid is computed as-of-today, so historical application is a mild lookahead.");
  }

  const metrics = {
    total_return_pct: round2(totalReturnPct),
    cagr_pct: round2(cagrPct),
    ann_vol_pct: round2(annVolPct),
    sharpe: round3(sharpe),
    max_drawdown_pct: round2(maxDrawdownPct),
    hit_rate_pct: round2(hitRatePct),
    turnover: round3(turnover),
    total_cost: round2(totalCost),
    n_rebalances: nRebalances,
    start_date: startDate,
    end_date: endDate,
    benchmark_ticker: OMXSPI,
    benchmark_total_return_pct: benchmarkTotalReturnPct,
    excess_return_pct: excessReturnPct == null ? null : round2(excessReturnPct),
    information_ratio: informationRatio,
    beat_benchmark: beatBenchmark,
    omxsgi_return_pct: omxsgiReturnPct,
    note: notes.join(" "),
  };

  return { metrics, equityCurve, trades };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
