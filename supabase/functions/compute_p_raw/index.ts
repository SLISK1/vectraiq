import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const clamp = (v: number, min = 0.01, max = 0.99) => Math.min(max, Math.max(min, v));
const geomean = (a: number, b: number) => Math.sqrt(Math.max(0, a) * Math.max(0, b));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { match_id } = await req.json();
    if (!match_id) {
      return new Response(JSON.stringify({ error: "match_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: match, error: matchError } = await supabase
      .from("betting_matches")
      .select("id,home_team,away_team,source_data")
      .eq("id", match_id)
      .single();

    if (matchError || !match) throw new Error(`Match not found: ${match_id}`);

    const sourceData = (match.source_data || {}) as Record<string, unknown>;
    const rates = {
      home_btts_rate: Number(sourceData.home_btts_rate ?? 0.5),
      away_btts_rate: Number(sourceData.away_btts_rate ?? 0.5),
      home_o25_rate: Number(sourceData.home_o25_rate ?? 0.5),
      away_o25_rate: Number(sourceData.away_o25_rate ?? 0.5),
      home_crn_o95_rate: Number(sourceData.home_crn_o95_rate ?? 0.5),
      away_crn_o95_rate: Number(sourceData.away_crn_o95_rate ?? 0.5),
      home_crd_o35_rate: Number(sourceData.home_crd_o35_rate ?? 0.5),
      away_crd_o35_rate: Number(sourceData.away_crd_o35_rate ?? 0.5),
    };

    const pRaw = {
      p_raw_btts: clamp(geomean(rates.home_btts_rate, rates.away_btts_rate)),
      p_raw_o25: clamp(geomean(rates.home_o25_rate, rates.away_o25_rate)),
      p_raw_crn_o95: clamp(geomean(rates.home_crn_o95_rate, rates.away_crn_o95_rate)),
      p_raw_crd_o35: clamp(geomean(rates.home_crd_o35_rate, rates.away_crd_o35_rate)),
    };

    const { error: upsertError } = await supabase.from("team_rates_cache").upsert({
      match_id,
      home_team: match.home_team,
      away_team: match.away_team,
      ...rates,
      ...pRaw,
      updated_at: new Date().toISOString(),
    });

    if (upsertError) throw upsertError;

    return new Response(JSON.stringify({ success: true, match_id, ...pRaw }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
