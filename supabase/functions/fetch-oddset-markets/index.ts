// Scrape Svenska Spel "Oddset" market prices for a single match via Firecrawl
// and persist them into public.odds_snapshots with source = 'oddset'.
//
// Auth: service-role only (verify_jwt left at project default; we validate the bearer here).
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FIRECRAWL_V2 = "https://api.firecrawl.dev/v2";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// JSON schema we ask Firecrawl's LLM extraction to fill in.
const ODDSET_SCHEMA = {
  type: "object",
  properties: {
    home_team: { type: "string" },
    away_team: { type: "string" },
    odds_1: { type: "number", description: "Odds for home win (1)" },
    odds_x: { type: "number", description: "Odds for draw (X)" },
    odds_2: { type: "number", description: "Odds for away win (2)" },
    odds_1x: { type: "number" },
    odds_12: { type: "number" },
    odds_x2: { type: "number" },
    odds_btts_yes: { type: "number" },
    odds_btts_no: { type: "number" },
    odds_over_25: { type: "number" },
    odds_under_25: { type: "number" },
    odds_corners_over_95: { type: "number" },
    odds_corners_under_95: { type: "number" },
    odds_cards_over_35: { type: "number" },
    odds_cards_under_35: { type: "number" },
    exact_scores: {
      type: "array",
      items: {
        type: "object",
        properties: {
          score: { type: "string", description: "Format 'H-A', e.g. '2-1'" },
          odds: { type: "number" },
        },
      },
    },
  },
};

// Strip over-round across a list of decimal odds: implied_i = (1/o_i) / Σ(1/o_j)
function normalize(odds: number[]): number[] {
  const inv = odds.map((o) => (o > 1 ? 1 / o : 0));
  const sum = inv.reduce((a, b) => a + b, 0);
  return sum > 0 ? inv.map((x) => x / sum) : odds.map(() => 0);
}

type Snapshot = {
  match_id: string;
  market: string;
  selection: string;
  odds_pre_match: number;
  implied_pre_match: number;
  overround_pre_match: number | null;
  source: string;
  fetched_at: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (authHeader !== `Bearer ${supabaseServiceKey}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { match_id } = await req.json();
    if (!match_id) {
      return new Response(JSON.stringify({ error: "match_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, supabaseServiceKey);

    // Cache check — skip scrape if any oddset snapshot is fresh enough
    const { data: existing } = await supabase
      .from("odds_snapshots")
      .select("fetched_at")
      .eq("match_id", match_id)
      .eq("source", "oddset")
      .order("fetched_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing && Date.now() - new Date(existing.fetched_at).getTime() < CACHE_TTL_MS) {
      return new Response(JSON.stringify({ success: true, cached: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!firecrawlKey) {
      return new Response(JSON.stringify({ error: "FIRECRAWL_API_KEY missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: match, error: matchErr } = await supabase
      .from("betting_matches")
      .select("id, home_team, away_team, league, match_date")
      .eq("id", match_id)
      .single();
    if (matchErr || !match) throw new Error(`Match not found: ${match_id}`);

    // Use Firecrawl /search scoped to spela.svenskaspel.se to find the match page.
    const query = `${match.home_team} ${match.away_team} oddset spela.svenskaspel.se`;
    const searchRes = await fetch(`${FIRECRAWL_V2}/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit: 3 }),
    });
    if (!searchRes.ok) throw new Error(`Firecrawl search ${searchRes.status}`);
    const searchData = await searchRes.json();
    const results: Array<{ url?: string }> = searchData?.data?.web || searchData?.data || [];
    const oddsetUrl =
      results.find((r) => (r.url || "").includes("spela.svenskaspel.se"))?.url ||
      results[0]?.url;
    if (!oddsetUrl) throw new Error("Oddset URL not found in Firecrawl search");

    // Scrape with LLM JSON extraction
    const scrapeRes = await fetch(`${FIRECRAWL_V2}/scrape`, {
      method: "POST",
      headers: { Authorization: `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        url: oddsetUrl,
        formats: [
          {
            type: "json",
            schema: ODDSET_SCHEMA,
            prompt:
              "Extract pre-match decimal odds for the listed markets from this Svenska Spel Oddset page. Use the page values verbatim. If a market is missing, omit the field.",
          },
        ],
        onlyMainContent: true,
        waitFor: 1500,
      }),
    });
    if (!scrapeRes.ok) throw new Error(`Firecrawl scrape ${scrapeRes.status}`);
    const scrapeData = await scrapeRes.json();
    const extracted = scrapeData?.data?.json || scrapeData?.json || {};

    const now = new Date().toISOString();
    const snapshots: Snapshot[] = [];

    const addMarket = (market: string, selections: Array<{ selection: string; odds: number | undefined }>) => {
      const valid = selections.filter((s) => typeof s.odds === "number" && s.odds > 1) as Array<{ selection: string; odds: number }>;
      if (valid.length === 0) return;
      const oddsArr = valid.map((s) => s.odds);
      const implied = normalize(oddsArr);
      const overround = oddsArr.reduce((a, o) => a + 1 / o, 0) - 1;
      valid.forEach((s, i) => {
        snapshots.push({
          match_id,
          market,
          selection: s.selection,
          odds_pre_match: s.odds,
          implied_pre_match: implied[i],
          overround_pre_match: overround,
          source: "oddset",
          fetched_at: now,
        });
      });
    };

    addMarket("1X2", [
      { selection: "home", odds: extracted.odds_1 },
      { selection: "draw", odds: extracted.odds_x },
      { selection: "away", odds: extracted.odds_2 },
    ]);
    addMarket("DC", [
      { selection: "1X", odds: extracted.odds_1x },
      { selection: "12", odds: extracted.odds_12 },
      { selection: "X2", odds: extracted.odds_x2 },
    ]);
    addMarket("BTTS", [
      { selection: "yes", odds: extracted.odds_btts_yes },
      { selection: "no", odds: extracted.odds_btts_no },
    ]);
    addMarket("O25", [
      { selection: "over", odds: extracted.odds_over_25 },
      { selection: "under", odds: extracted.odds_under_25 },
    ]);
    addMarket("CRN_O95", [
      { selection: "over", odds: extracted.odds_corners_over_95 },
      { selection: "under", odds: extracted.odds_corners_under_95 },
    ]);
    addMarket("CRD_O35", [
      { selection: "over", odds: extracted.odds_cards_over_35 },
      { selection: "under", odds: extracted.odds_cards_under_35 },
    ]);

    if (Array.isArray(extracted.exact_scores)) {
      const exactValid = extracted.exact_scores.filter(
        (e: any) => typeof e?.odds === "number" && e.odds > 1 && typeof e?.score === "string",
      );
      if (exactValid.length > 0) {
        const oddsArr = exactValid.map((e: any) => e.odds);
        const implied = normalize(oddsArr);
        const overround = oddsArr.reduce((a: number, o: number) => a + 1 / o, 0) - 1;
        exactValid.forEach((e: any, i: number) => {
          snapshots.push({
            match_id,
            market: "EXACT",
            selection: e.score,
            odds_pre_match: e.odds,
            implied_pre_match: implied[i],
            overround_pre_match: overround,
            source: "oddset",
            fetched_at: now,
          });
        });
      }
    }

    if (snapshots.length === 0) {
      return new Response(JSON.stringify({ success: false, error: "No markets extracted", oddsetUrl }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: upErr } = await supabase
      .from("odds_snapshots")
      .upsert(snapshots, { onConflict: "match_id,market,selection" });
    if (upErr) throw upErr;

    return new Response(
      JSON.stringify({ success: true, match_id, oddsetUrl, snapshots: snapshots.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("fetch-oddset-markets error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
