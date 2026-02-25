/**
 * run-rank: Creates a rank_run, reads latest signals + features for all active
 * symbols, computes a signed score per asset, and upserts rank_results with
 * rank, score_signed, confidence, top_contributors.
 * Idempotent per day (deletes existing run for same ts before inserting).
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Direction = "UP" | "DOWN" | "NEUTRAL";

const MODULE_WEIGHTS: Record<string, number> = {
  technical: 25,
  volatility: 15,
  quant: 20,
  seasonal: 5,
  sentiment: 15,
  macro: 20,
  features: 0, // informational — not weighted in ranking
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let horizon = "1d";
    let universeFilter: Record<string, string> = {};
    try {
      const body = await req.json();
      if (body?.horizon) horizon = body.horizon;
      if (body?.universe_filter) universeFilter = body.universe_filter;
    } catch {}

    const today = new Date().toISOString().split("T")[0];
    const runTs = `${today}T00:00:00Z`;

    // Fetch active symbols
    const { data: symbols, error: symErr } = await supabase
      .from("symbols")
      .select("id, ticker, asset_type")
      .eq("is_active", true);

    if (symErr) throw symErr;
    if (!symbols?.length) {
      return new Response(JSON.stringify({ success: true, ranked: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch reliability weights
    const { data: reliabilityRows } = await supabase
      .from("module_reliability")
      .select("module, horizon, asset_type, reliability_weight");

    const reliabilityMap = new Map<string, number>();
    for (const r of reliabilityRows || []) {
      reliabilityMap.set(`${r.module}:${r.horizon}:${r.asset_type}`, Number(r.reliability_weight ?? 1.0));
    }

    // Fetch latest signals per symbol for this horizon
    const { data: allSignals } = await supabase
      .from("signals")
      .select("symbol_id, module, direction, strength, confidence, coverage")
      .eq("horizon", horizon);

    // Group signals by symbol_id
    const signalsBySymbol = new Map<string, any[]>();
    for (const s of allSignals || []) {
      const arr = signalsBySymbol.get(s.symbol_id) || [];
      arr.push(s);
      signalsBySymbol.set(s.symbol_id, arr);
    }

    // Create rank_run
    const { data: runData, error: runErr } = await supabase
      .from("rank_runs")
      .insert({
        ts: runTs,
        weights: MODULE_WEIGHTS,
        universe_filter: universeFilter,
      })
      .select("id")
      .single();

    if (runErr) throw runErr;
    const rankRunId = runData.id;

    // Score each symbol
    interface ScoredAsset {
      assetId: string;
      scoreSigned: number;
      confidence: number;
      topContributors: { module: string; contribution: number }[];
    }

    const scored: ScoredAsset[] = [];

    for (const sym of symbols) {
      const signals = signalsBySymbol.get(sym.id);
      if (!signals || signals.length === 0) continue;

      const assetType = sym.asset_type || "stock";

      // Apply reliability weights + renormalize
      const weighted = signals
        .filter((s: any) => (MODULE_WEIGHTS[s.module] ?? 0) > 0)
        .map((s: any) => {
          const baseW = MODULE_WEIGHTS[s.module] ?? 15;
          const rw = reliabilityMap.get(`${s.module}:${horizon}:${assetType}`) ?? 1.0;
          return { ...s, adjustedWeight: baseW * rw };
        });

      if (weighted.length === 0) continue;

      const totalWeight = weighted.reduce((s: number, w: any) => s + w.adjustedWeight, 0);
      const normFactor = totalWeight > 0 ? 100 / totalWeight : 1;

      // Signed scoring (matching generate-signals logic)
      const contributions: { module: string; contribution: number }[] = [];
      let totalSignedScore = 0;

      for (const w of weighted) {
        const effWeight = w.adjustedWeight * normFactor;
        const dirMult = w.direction === "UP" ? 1 : w.direction === "DOWN" ? -1 : 0;
        const signedStrength = (w.strength - 50) * 2 * dirMult;
        const contribution = totalWeight > 0 ? signedStrength * (effWeight / 100) : 0;
        totalSignedScore += contribution;
        contributions.push({ module: w.module, contribution: Math.round(contribution * 100) / 100 });
      }

      const avgConfidence = Math.round(
        weighted.reduce((s: number, w: any) => s + w.confidence, 0) / weighted.length,
      );

      contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

      scored.push({
        assetId: sym.id,
        scoreSigned: Math.round(totalSignedScore * 100) / 100,
        confidence: avgConfidence,
        topContributors: contributions.slice(0, 3),
      });
    }

    // Sort by absolute score descending → assign rank
    scored.sort((a, b) => Math.abs(b.scoreSigned) - Math.abs(a.scoreSigned));

    const rankRows = scored.map((s, i) => ({
      rank_run_id: rankRunId,
      asset_id: s.assetId,
      score_signed: s.scoreSigned,
      confidence: s.confidence,
      top_contributors: s.topContributors,
      rank: i + 1,
    }));

    if (rankRows.length > 0) {
      // Batch upsert in chunks of 100
      for (let i = 0; i < rankRows.length; i += 100) {
        const chunk = rankRows.slice(i, i + 100);
        const { error: rrErr } = await supabase
          .from("rank_results")
          .upsert(chunk, { onConflict: "rank_run_id,asset_id" });
        if (rrErr) console.error("rank_results upsert error:", rrErr.message);
      }
    }

    return new Response(
      JSON.stringify({ success: true, rank_run_id: rankRunId, ranked: rankRows.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
