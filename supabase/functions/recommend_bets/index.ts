import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type MarketKey = "BTTS" | "O25" | "CRN_O95" | "CRD_O35";
const MARKETS: MarketKey[] = ["BTTS", "O25", "CRN_O95", "CRD_O35"];
const clamp = (v: number, min = 0.01, max = 0.99) => Math.min(max, Math.max(min, v));

const edgeThresholdByPhase = (phase: number) => (phase === 1 ? 0.07 : phase === 2 ? 0.06 : 0.05);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { match_id } = await req.json();
    if (!match_id) return new Response(JSON.stringify({ error: "match_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    await supabase.functions.invoke("compute_p_raw", { body: { match_id } });
    await supabase.functions.invoke("odds_caching", { body: { match_id } });

    const { data: rates } = await supabase.from("team_rates_cache").select("*").eq("match_id", match_id).single();
    const { data: oddsRows } = await supabase.from("odds_snapshots").select("market,selection,implied_pre_match,odds_pre_match").eq("match_id", match_id);
    if (!rates) throw new Error("team_rates_cache missing");

    const pRawByMarket: Record<MarketKey, number> = {
      BTTS: Number(rates.p_raw_btts ?? 0.5),
      O25: Number(rates.p_raw_o25 ?? 0.5),
      CRN_O95: Number(rates.p_raw_crn_o95 ?? 0.5),
      CRD_O35: Number(rates.p_raw_crd_o35 ?? 0.5),
    };

    const impliedByMarket = MARKETS.reduce((acc, market) => {
      const overOrYes = oddsRows?.find((r: any) => r.market === market && (r.selection === "over" || r.selection === "yes"));
      acc[market] = Number(overOrYes?.implied_pre_match ?? 0.5);
      return acc;
    }, {} as Record<MarketKey, number>);

    const components = {
      goalChaos: Math.round(((pRawByMarket.BTTS + pRawByMarket.O25) / 2) * 100),
      cornerPressure: Math.round(pRawByMarket.CRN_O95 * 100),
      cardHeat: Math.round(pRawByMarket.CRD_O35 * 100),
      volatility: Math.round(Math.abs(pRawByMarket.BTTS - pRawByMarket.O25) * 100),
    };
    const chaosScore = Math.round((components.goalChaos + components.cornerPressure + components.cardHeat + components.volatility) / 4);

    const recommendations: any[] = [];

    for (const market of MARKETS) {
      const { count } = await supabase
        .from("bets_log")
        .select("id", { head: true, count: "exact" })
        .eq("market", market)
        .not("result", "is", null);

      const n = count ?? 0;
      const phase = n < 80 ? 1 : n < 200 ? 2 : 3;
      const pRaw = clamp(pRawByMarket[market]);
      const pProxy = clamp(pRaw * 0.85);
      const bucketIdx = Math.min(9, Math.floor(pRaw * 10));

      const { data: bucket } = await supabase
        .from("calibration_buckets")
        .select("n_samples,n_hits")
        .eq("market", market)
        .eq("bucket_idx", bucketIdx)
        .maybeSingle();

      const pBucket = bucket && bucket.n_samples > 0 ? clamp((bucket.n_hits + 1) / (bucket.n_samples + 2)) : pProxy;
      const w = Math.min(1, Math.max(0, (n - 80) / 120));
      const pCal = phase === 1 ? pProxy : phase === 2 ? clamp((1 - w) * pProxy + w * pBucket) : pBucket;

      const implied = impliedByMarket[market];
      const edge = pCal - implied;
      const threshold = edgeThresholdByPhase(phase);
      const isValid = edge >= threshold;

      recommendations.push({
        match_id,
        market,
        selection: market === "BTTS" ? "yes" : "over",
        phase,
        implied_prob: implied,
        p_raw: pRaw,
        p_proxy: pProxy,
        p_cal: pCal,
        edge,
        chaos_score: chaosScore,
        goal_chaos: components.goalChaos,
        corner_pressure: components.cornerPressure,
        card_heat: components.cardHeat,
        volatility: components.volatility,
        suggested_stake_pct: isValid ? Math.min(1.5, Math.max(0.3, edge * 12 * 100)) : null,
        is_valid: isValid,
        reason: isValid ? "edge_threshold_pass" : `edge_below_${threshold.toFixed(2)}`,
        generated_at: new Date().toISOString(),
      });
    }

    const btts = recommendations.find((r) => r.market === "BTTS");
    const o25 = recommendations.find((r) => r.market === "O25");
    if (btts && o25 && btts.phase === 1 && btts.is_valid && o25.is_valid) {
      if (btts.edge >= o25.edge) {
        o25.is_valid = false;
        o25.reason = "phase1_correlation_gate_btts_vs_o25";
      } else {
        btts.is_valid = false;
        btts.reason = "phase1_correlation_gate_btts_vs_o25";
      }
    }

    const { error: recError } = await supabase.from("coupon_recommendations").upsert(recommendations, { onConflict: "match_id,market" });
    if (recError) throw recError;

    return new Response(JSON.stringify({ success: true, match_id, recommendations }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
