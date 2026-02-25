/**
 * update-calibration: Reads predictions + outcomes, groups by (horizon, confidence decile),
 * computes hit_rate and Brier score. Upserts to calibration_bins.
 * Idempotent — always recomputes from full history.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Fetch all predictions that have outcomes
    const { data: predictions, error: predErr } = await supabase
      .from("predictions")
      .select(`
        prediction_id,
        horizon,
        predicted_prob,
        confidence,
        predicted_direction
      `);

    if (predErr) throw predErr;
    if (!predictions?.length) {
      return new Response(JSON.stringify({ success: true, bins_updated: 0, message: "No predictions" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all outcomes
    const { data: outcomes, error: outErr } = await supabase
      .from("outcomes")
      .select("prediction_id, hit, return_pct");

    if (outErr) throw outErr;

    const outcomeMap = new Map<string, { hit: boolean; return_pct: number }>();
    for (const o of outcomes || []) {
      outcomeMap.set(o.prediction_id, { hit: o.hit, return_pct: Number(o.return_pct ?? 0) });
    }

    // Only keep predictions that have outcomes
    const scored = predictions.filter((p: any) => outcomeMap.has(p.prediction_id));

    if (scored.length === 0) {
      return new Response(JSON.stringify({ success: true, bins_updated: 0, message: "No scored predictions" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Group by (horizon, confidence decile)
    // Decile: confidence 0-9 → bin 0, 10-19 → bin 1, ... 90-100 → bin 9
    interface BinAccum {
      horizon: string;
      scoreBin: number;
      n: number;
      hits: number;
      brierSum: number;
    }

    const binMap = new Map<string, BinAccum>();

    for (const p of scored) {
      const outcome = outcomeMap.get(p.prediction_id)!;
      const conf = Number(p.confidence ?? 50);
      const scoreBin = Math.min(9, Math.floor(conf / 10));
      const key = `${p.horizon}:${scoreBin}`;

      let bin = binMap.get(key);
      if (!bin) {
        bin = { horizon: p.horizon, scoreBin, n: 0, hits: 0, brierSum: 0 };
        binMap.set(key, bin);
      }

      bin.n++;
      if (outcome.hit) bin.hits++;

      // Brier score: (predicted_prob - actual_outcome)^2
      // actual_outcome: 1 if hit, 0 if not
      const prob = Number(p.predicted_prob ?? 0.5);
      const actual = outcome.hit ? 1 : 0;
      bin.brierSum += (prob - actual) ** 2;
    }

    // Upsert calibration bins
    const rows = Array.from(binMap.values()).map((bin) => ({
      horizon: bin.horizon,
      score_bin: bin.scoreBin,
      n: bin.n,
      hit_rate: bin.n > 0 ? Math.round((bin.hits / bin.n) * 10000) / 10000 : null,
      brier: bin.n > 0 ? Math.round((bin.brierSum / bin.n) * 10000) / 10000 : null,
      updated_at: new Date().toISOString(),
    }));

    let binsUpdated = 0;
    for (const row of rows) {
      const { error: upsertErr } = await supabase
        .from("calibration_bins")
        .upsert(row, { onConflict: "horizon,score_bin" });
      if (upsertErr) {
        console.error(`calibration_bins upsert error:`, upsertErr.message);
      } else {
        binsUpdated++;
      }
    }

    return new Response(
      JSON.stringify({ success: true, bins_updated: binsUpdated, total_scored: scored.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
