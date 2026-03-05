import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { match_id } = await req.json();
    if (!match_id) {
      return new Response(JSON.stringify({ error: "match_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const cacheKey = `match_stats:${match_id}`;

    // Check cache
    const { data: cached } = await supabase
      .from("api_cache")
      .select("payload, fetched_at, ttl_seconds")
      .eq("cache_key", cacheKey)
      .maybeSingle();

    if (cached) {
      const expiresAt = new Date(cached.fetched_at).getTime() + (cached.ttl_seconds * 1000);
      if (Date.now() < expiresAt) {
        return new Response(JSON.stringify({ success: true, source: "cache", stats: cached.payload }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { data: match } = await supabase
      .from("betting_matches")
      .select("home_team, away_team, source_data")
      .eq("id", match_id)
      .single();

    if (!match) throw new Error("Match not found");

    const firecrawlApiKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!firecrawlApiKey) throw new Error("FIRECRAWL_API_KEY missing");

    const query = `${match.home_team} vs ${match.away_team} match statistics corners cards yellow red`;
    const res = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${firecrawlApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, limit: 2 }),
    });

    if (!res.ok) throw new Error(`Firecrawl failed: ${res.status}`);

    const searchData = await res.json();
    const results = searchData.data || searchData.results || [];

    let corners: number | undefined;
    let cards: number | undefined;

    for (const result of results) {
      const text = (result.markdown || result.description || result.content || "").toLowerCase();

      if (corners === undefined) {
        const m = text.match(/corners?\s*[:\-–]\s*(\d+)\s*[:\-–]\s*(\d+)/i) ||
          text.match(/(\d+)\s*corners?\s*(?:total|$)/i);
        if (m) {
          corners = m[2] ? parseInt(m[1]) + parseInt(m[2]) : parseInt(m[1]);
        }
      }

      if (cards === undefined) {
        const m = text.match(/(?:yellow|red)\s*cards?\s*[:\-–]\s*(\d+)\s*[:\-–]\s*(\d+)/i) ||
          text.match(/cards?\s*(?:total)?\s*[:\-–]\s*(\d+)/i);
        if (m) {
          cards = m[2] ? parseInt(m[1]) + parseInt(m[2]) : parseInt(m[1]);
        }
      }
    }

    const stats: Record<string, number> = {};
    if (corners !== undefined) stats.corners = corners;
    if (cards !== undefined) stats.cards = cards;

    // Cache
    await supabase.from("api_cache").upsert({
      cache_key: cacheKey,
      payload: stats,
      ttl_seconds: 86400,
      provider: "firecrawl",
    }, { onConflict: "cache_key" });

    return new Response(JSON.stringify({ success: true, source: "firecrawl", stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
