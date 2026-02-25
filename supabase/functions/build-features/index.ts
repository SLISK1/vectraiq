/**
 * build-features: Reads price_bars for active symbols (252 days),
 * computes RSI(14), MACD(12,26,9), SMA20/50, 20d volatility, 20d momentum.
 * Upserts to features + signals tables. Idempotent.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Indicator helpers ──

function sma(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const s = prices.slice(-period);
  return s.reduce((a, b) => a + b, 0) / period;
}

function ema(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const mult = 2 / (period + 1);
  let e = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    e = (prices[i] - e) * mult + e;
  }
  return e;
}

function rsi(prices: number[], period = 14): number | null {
  if (prices.length < period + 1) return null;
  const changes = prices.slice(1).map((p, i) => p - prices[i]);
  const recent = changes.slice(-period);
  const gains = recent.filter((c) => c > 0);
  const losses = recent.filter((c) => c < 0).map((c) => Math.abs(c));
  const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / period : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / period : 0;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function macd(prices: number[]): { value: number; signal: number; histogram: number } | null {
  if (prices.length < 26) return null;
  const ema12 = ema(prices, 12);
  const ema26 = ema(prices, 26);
  if (!ema12 || !ema26) return null;
  const macdLine = ema12 - ema26;
  const hist: number[] = [];
  for (let i = 26; i <= prices.length; i++) {
    const e12 = ema(prices.slice(0, i), 12);
    const e26 = ema(prices.slice(0, i), 26);
    if (e12 && e26) hist.push(e12 - e26);
  }
  const signalLine = hist.length >= 9 ? ema(hist, 9) : macdLine;
  return { value: macdLine, signal: signalLine || macdLine, histogram: macdLine - (signalLine || macdLine) };
}

function volatility20d(prices: number[]): number | null {
  if (prices.length < 21) return null;
  const slice = prices.slice(-21);
  const returns = slice.slice(1).map((p, i) => (p - slice[i]) / slice[i]);
  const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - avg) ** 2, 0) / returns.length;
  return Math.sqrt(variance * 252) * 100; // annualized %
}

function momentum20d(prices: number[]): number | null {
  if (prices.length < 20) return null;
  return ((prices[prices.length - 1] / prices[prices.length - 20]) - 1) * 100;
}

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v));
}

type Direction = "UP" | "DOWN" | "NEUTRAL";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Fetch all active symbols
    const { data: symbols, error: symErr } = await supabase
      .from("symbols")
      .select("id, ticker, asset_type")
      .eq("is_active", true);

    if (symErr) throw symErr;
    if (!symbols?.length) {
      return new Response(JSON.stringify({ success: true, processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const today = new Date().toISOString().split("T")[0];
    const featureTs = `${today}T00:00:00Z`;
    let processed = 0;
    let errors = 0;

    for (const sym of symbols) {
      try {
        // Fetch last 252 price bars
        const { data: bars } = await supabase
          .from("price_bars")
          .select("ts, close, high, low, volume")
          .eq("asset_id", sym.id)
          .eq("interval", "1d")
          .order("ts", { ascending: true })
          .limit(252);

        if (!bars || bars.length < 5) { errors++; continue; }

        const closes = bars.map((b: any) => Number(b.close));
        const currentPrice = closes[closes.length - 1];

        // Compute indicators
        const rsiVal = rsi(closes, 14);
        const macdVal = macd(closes);
        const sma20Val = sma(closes, 20);
        const sma50Val = sma(closes, 50);
        const vol20 = volatility20d(closes);
        const mom20 = momentum20d(closes);

        // Data coverage: how many of 6 indicators computed
        const available = [rsiVal, macdVal, sma20Val, sma50Val, vol20, mom20].filter((v) => v != null).length;
        const coverage = Math.round((available / 6) * 100);

        const values: Record<string, number | null> = {
          rsi_14: rsiVal != null ? Math.round(rsiVal * 100) / 100 : null,
          macd_value: macdVal?.value != null ? Math.round(macdVal.value * 10000) / 10000 : null,
          macd_signal: macdVal?.signal != null ? Math.round(macdVal.signal * 10000) / 10000 : null,
          macd_histogram: macdVal?.histogram != null ? Math.round(macdVal.histogram * 10000) / 10000 : null,
          sma_20: sma20Val != null ? Math.round(sma20Val * 100) / 100 : null,
          sma_50: sma50Val != null ? Math.round(sma50Val * 100) / 100 : null,
          volatility_20d: vol20 != null ? Math.round(vol20 * 100) / 100 : null,
          momentum_20d: mom20 != null ? Math.round(mom20 * 100) / 100 : null,
        };

        // Upsert feature row
        const { error: featErr } = await supabase
          .from("features")
          .upsert({
            asset_id: sym.id,
            ts: featureTs,
            feature_set_version: "v1",
            data_coverage: coverage,
            values,
          }, { onConflict: "asset_id,ts,feature_set_version" });

        if (featErr) { errors++; continue; }

        // Derive signal direction from indicators for upsert into signals
        let bullish = 0, bearish = 0, total = 0;

        if (rsiVal != null) {
          total++;
          if (rsiVal < 30) bullish++;
          else if (rsiVal > 70) bearish++;
        }
        if (macdVal) {
          total++;
          if (macdVal.histogram > 0) bullish++;
          else if (macdVal.histogram < 0) bearish++;
        }
        if (sma20Val && sma50Val) {
          total++;
          if (currentPrice > sma20Val && sma20Val > sma50Val) bullish++;
          else if (currentPrice < sma20Val && sma20Val < sma50Val) bearish++;
        }
        if (vol20 != null) {
          total++;
          if (vol20 < 20) bullish++;
          else if (vol20 > 50) bearish++;
        }
        if (mom20 != null) {
          total++;
          if (mom20 > 5) bullish++;
          else if (mom20 < -5) bearish++;
        }

        const net = bullish - bearish;
        const direction: Direction = net > 0 ? "UP" : net < 0 ? "DOWN" : "NEUTRAL";
        const strength = total > 0 ? clamp(Math.round(50 + (net / total) * 50)) : 50;
        const confidence = total > 0 ? clamp(Math.round(40 + (Math.abs(net) / total) * 50 + (coverage / 100) * 10)) : 30;

        // Upsert signal for module='features', horizon='1d'
        const { error: sigErr } = await supabase
          .from("signals")
          .upsert({
            symbol_id: sym.id,
            ts: featureTs,
            horizon: "1d",
            module: "features",
            direction,
            strength,
            confidence,
            coverage,
            evidence: [
              { type: "computed", description: `RSI=${rsiVal?.toFixed(1) ?? "N/A"}, Mom=${mom20?.toFixed(1) ?? "N/A"}%, Vol=${vol20?.toFixed(1) ?? "N/A"}%` },
            ],
          }, { onConflict: "symbol_id,ts,horizon,module" });

        if (sigErr) console.warn(`Signal upsert failed for ${sym.ticker}:`, sigErr.message);

        processed++;
      } catch (e) {
        errors++;
        console.error(`build-features error for ${sym.ticker}:`, e);
      }
    }

    return new Response(
      JSON.stringify({ success: true, processed, errors, total: symbols.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
