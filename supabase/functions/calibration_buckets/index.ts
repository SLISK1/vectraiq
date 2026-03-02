import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const clamp = (v: number, min = 0.01, max = 0.99) => Math.min(max, Math.max(min, v));

function bucketIdx(prob: number) {
  return Math.max(0, Math.min(9, Math.floor(clamp(prob) * 10)));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { market, p_raw, outcome } = await req.json();
    if (!market || typeof p_raw !== "number" || !["win", "loss"].includes(outcome)) {
      return new Response(JSON.stringify({ error: "market, p_raw and outcome(win|loss) are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const idx = bucketIdx(p_raw);

    const { error } = await supabase
      .from("calibration_buckets")
      .upsert({
        market,
        bucket_idx: idx,
        n_samples: 1,
        n_hits: outcome === "win" ? 1 : 0,
        updated_at: new Date().toISOString(),
      }, { onConflict: "market,bucket_idx" })
      .select();

    if (error) {
      // Fallback atomic path for existing row: increment counters manually.
      const { data: row, error: selectErr } = await supabase
        .from("calibration_buckets")
        .select("n_samples,n_hits")
        .eq("market", market)
        .eq("bucket_idx", idx)
        .maybeSingle();
      if (selectErr) throw selectErr;

      const n_samples = (row?.n_samples ?? 0) + 1;
      const n_hits = (row?.n_hits ?? 0) + (outcome === "win" ? 1 : 0);

      const { error: updateError } = await supabase.from("calibration_buckets").upsert({
        market,
        bucket_idx: idx,
        n_samples,
        n_hits,
        updated_at: new Date().toISOString(),
      });
      if (updateError) throw updateError;
    }

    return new Response(JSON.stringify({ success: true, market, bucket_idx: idx }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
