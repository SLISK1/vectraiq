/**
 * score-outcomes: Reads predictions where target_ts <= now and no outcome exists.
 * Fetches exit_price from price_bars, computes return_pct, hit, excess_return.
 * Inserts into outcomes table. Idempotent (skips predictions that already have outcomes).
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HORIZON_DAYS: Record<string, number> = {
  "1d": 1,
  "1w": 7,
  "1mo": 30,
  "1y": 365,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const now = new Date().toISOString();

    // Find predictions that are due (target_ts <= now) and have no outcome yet
    const { data: predictions, error: predErr } = await supabase
      .from("predictions")
      .select("prediction_id, asset_id, horizon, predicted_direction, predicted_prob, entry_price, target_ts, rank_run_id")
      .lte("target_ts", now)
      .not("entry_price", "is", null);

    if (predErr) throw predErr;
    if (!predictions?.length) {
      return new Response(JSON.stringify({ success: true, scored: 0, message: "No due predictions" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Filter out predictions that already have outcomes
    const predIds = predictions.map((p: any) => p.prediction_id);
    const { data: existingOutcomes } = await supabase
      .from("outcomes")
      .select("prediction_id")
      .in("prediction_id", predIds);

    const existingSet = new Set((existingOutcomes || []).map((o: any) => o.prediction_id));
    const toScore = predictions.filter((p: any) => !existingSet.has(p.prediction_id));

    if (toScore.length === 0) {
      return new Response(JSON.stringify({ success: true, scored: 0, message: "All due predictions already scored" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let scored = 0;
    let errors = 0;

    for (const pred of toScore) {
      try {
        const entryPrice = Number(pred.entry_price);
        if (!entryPrice || entryPrice <= 0) { errors++; continue; }

        // Find the closest price bar to the target_ts
        const { data: exitBars } = await supabase
          .from("price_bars")
          .select("close, ts")
          .eq("asset_id", pred.asset_id)
          .eq("interval", "1d")
          .lte("ts", pred.target_ts)
          .order("ts", { ascending: false })
          .limit(1);

        if (!exitBars?.length) { errors++; continue; }

        const exitPrice = Number(exitBars[0].close);
        if (!exitPrice || exitPrice <= 0) { errors++; continue; }

        const returnPct = ((exitPrice - entryPrice) / entryPrice) * 100;
        const roundedReturn = Math.round(returnPct * 100) / 100;

        // Determine hit: did predicted_direction match actual movement?
        const actualDir = exitPrice > entryPrice ? "UP" : exitPrice < entryPrice ? "DOWN" : "NEUTRAL";
        const hit = pred.predicted_direction === actualDir;

        // Baseline return (benchmark — simplified: use 0 if no benchmark available)
        // For a proper implementation, we'd fetch benchmark price bars too
        const baselineReturn = 0;
        const excessReturn = Math.round((roundedReturn - baselineReturn) * 100) / 100;

        const { error: insertErr } = await supabase
          .from("outcomes")
          .insert({
            prediction_id: pred.prediction_id,
            exit_price: exitPrice,
            return_pct: roundedReturn,
            baseline_return_pct: baselineReturn,
            excess_return_pct: excessReturn,
            hit,
          });

        if (insertErr) {
          // Might be duplicate — skip
          if (insertErr.code === "23505") continue;
          errors++;
          console.error(`Outcome insert error for ${pred.prediction_id}:`, insertErr.message);
        } else {
          scored++;
        }
      } catch (e) {
        errors++;
        console.error(`score-outcomes error:`, e);
      }
    }

    return new Response(
      JSON.stringify({ success: true, scored, errors, total_due: toScore.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
