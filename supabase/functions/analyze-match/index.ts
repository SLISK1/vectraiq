import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Sport → The Odds API sport key mapping
const SPORT_ODDS_KEY: Record<string, string> = {
  football: "soccer_epl",
  "Premier League": "soccer_epl",
  "La Liga": "soccer_spain_la_liga",
  "Bundesliga": "soccer_germany_bundesliga",
  "Serie A": "soccer_italy_serie_a",
  "Ligue 1": "soccer_france_ligue_one",
  "Champions League": "soccer_uefa_champs_league",
  "Europa League": "soccer_uefa_europa_league",
  ufc: "mma_mixed_martial_arts",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const supabaseService = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify user
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
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

    // Fetch match data
    const { data: match, error: matchError } = await supabaseService
      .from("betting_matches")
      .select("*")
      .eq("id", match_id)
      .single();

    if (matchError || !match) {
      return new Response(JSON.stringify({ error: "Match not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sourceData = (match.source_data as any) || {};

    // === EVIDENCE GATING ===
    const sources: Array<{ url: string; title: string; date: string; type: string }> = [];
    let hasConfirmedFact = false;
    let hasStats = false;
    let hasOnlyOpinion = true;
    let hasInjuryData = false;
    let h2hCount = 0;

    // Classify news articles
    const newsItems = sourceData.news || [];
    for (const article of newsItems) {
      const type = article.type || classifyArticle(article.title || "");
      sources.push({
        url: article.url || "",
        title: article.title || "",
        date: article.date || "",
        type,
      });
      if (type === "confirmed_fact") { hasConfirmedFact = true; hasOnlyOpinion = false; }
      if (type === "stats") { hasStats = true; hasOnlyOpinion = false; }
      if (type === "news") hasOnlyOpinion = false;
      const text = (article.title + " " + (article.description || "")).toLowerCase();
      if (text.includes("injury") || text.includes("injured") || text.includes("fit") || text.includes("doubt")) {
        hasInjuryData = true;
      }
    }

    // Football-data.org is a confirmed_fact source
    if (sourceData.football_data) {
      hasConfirmedFact = true;
      hasOnlyOpinion = false;
      sources.push({
        url: "https://www.football-data.org",
        title: "Football-Data.org API",
        date: new Date().toISOString().split("T")[0],
        type: "confirmed_fact",
      });
    }

    // Scraped content counts as stats
    if (sourceData.scraped_content) {
      hasStats = true;
      hasOnlyOpinion = false;
    }

    // H2H from football-data
    const h2hData = sourceData.h2h || {};
    h2hCount = h2hData.matches?.length || 0;

    // === FETCH ODDS ===
    const oddsApiKey = Deno.env.get("ODDS_API_KEY");
    let marketOddsHome: number | null = null;
    let marketOddsDraw: number | null = null;
    let marketOddsAway: number | null = null;
    let marketImpliedProb: number | null = null;

    if (oddsApiKey) {
      const sportKey = SPORT_ODDS_KEY[match.league] || SPORT_ODDS_KEY[match.sport] || "soccer_epl";
      try {
        const oddsRes = await fetch(
          `https://api.the-odds-api.com/v4/sports/${sportKey}/odds?apiKey=${oddsApiKey}&regions=eu&markets=h2h&oddsFormat=decimal`
        );

        if (oddsRes.ok) {
          const oddsData = await oddsRes.json();
          const matchedOdds = findMatchInOdds(oddsData, match.home_team, match.away_team);

          if (matchedOdds) {
            marketOddsHome = matchedOdds.home;
            marketOddsDraw = matchedOdds.draw;
            marketOddsAway = matchedOdds.away;

            // Calculate vig-normalized implied probability
            const rawHome = 1 / matchedOdds.home;
            const rawDraw = matchedOdds.draw ? 1 / matchedOdds.draw : 0;
            const rawAway = 1 / matchedOdds.away;
            const total = rawHome + rawDraw + rawAway;
            marketImpliedProb = rawHome / total;
          }
        }
      } catch (e) {
        console.warn("Odds API fetch failed:", e);
      }
    }

    // === GEMINI ANALYSIS WITH EVIDENCE GATING ===
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) {
      return new Response(JSON.stringify({ error: "AI API not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sourcesSummary = sources
      .map((s) => `[${s.type.toUpperCase()}] "${s.title}" (${s.date}) — ${s.url}`)
      .join("\n");

    const scrapedSummary = sourceData.scraped_content
      ? `\n\nSCRAPED CONTENT (goal.com/mmafighting.com):\n${sourceData.scraped_content.substring(0, 2000)}`
      : "\n\nNo scraped content available.";

    const prompt = `You are an evidence-based sports prediction AI. You MUST only state facts that exist in the provided source data. Never invent statistics.

MATCH: ${match.home_team} vs ${match.away_team}
LEAGUE: ${match.league}
DATE: ${match.match_date}
SPORT: ${match.sport}

AVAILABLE SOURCES:
${sourcesSummary || "No sources available."}
${scrapedSummary}

STRICT RULES:
1. Only reference facts explicitly found in the sources above.
2. For each key_factor, cite the exact source (url, date, type).
3. If injury data is unavailable, write "Inga skaderapporter tillgängliga."
4. If lineup data is unavailable, write "Inga bekräftade lineups."
5. NEVER invent H2H stats, goals, or player information.
6. Base confidence on data quality, not speculation.

Respond with ONLY valid JSON (no markdown, no code blocks):
{
  "predicted_winner": "home" | "away" | "draw",
  "predicted_prob": <0.0-1.0>,
  "confidence_raw": <0-100>,
  "key_factors": [
    {
      "factor": "<concise factor description>",
      "direction": "positive" | "negative" | "neutral",
      "source": { "url": "<url>", "date": "<YYYY-MM-DD>", "type": "confirmed_fact"|"stats"|"opinion"|"news" }
    }
  ],
  "ai_reasoning": "<2-3 paragraph analysis citing sources by title/URL>"
}`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lovableApiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      return new Response(JSON.stringify({ error: `AI API error: ${errText}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiRes.json();
    const rawContent = aiData.choices?.[0]?.message?.content || "{}";

    let aiResult: any = {};
    try {
      // Strip potential markdown code blocks
      const cleaned = rawContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      aiResult = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse AI response:", rawContent);
      return new Response(JSON.stringify({ error: "AI returned invalid JSON" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === CONFIDENCE CAPPING ===
    let confidenceRaw = Math.min(100, Math.max(0, Math.round(aiResult.confidence_raw || 50)));
    let cap = 100;
    const capReasons: string[] = [];

    if (!hasConfirmedFact && !hasStats) {
      cap = Math.min(cap, 55);
      capReasons.push("Inga bekräftade fakta eller statistik");
    }
    if (hasOnlyOpinion) {
      cap = Math.min(cap, 52);
      capReasons.push("Endast opinion-källor tillgängliga");
    }
    if (!hasInjuryData) {
      cap = Math.min(cap, cap - 5);
      capReasons.push("Inga skaderapporter tillgängliga");
    }
    if (h2hCount < 3) {
      cap = Math.min(cap, cap - 5);
      capReasons.push(`Begränsad H2H-data (${h2hCount} möten)`);
    }

    const MIN_CAP = 40;
    cap = Math.max(MIN_CAP, cap);
    const confidenceCapped = Math.min(confidenceRaw, cap);
    const capReason = capReasons.length > 0 ? capReasons.join("; ") : null;

    // Compute model edge
    const predictedProb = Math.min(1, Math.max(0, aiResult.predicted_prob || 0.5));
    const modelEdge = marketImpliedProb !== null ? predictedProb - marketImpliedProb : null;

    // Compute sources hash
    const sourcesStr = JSON.stringify(sources);
    const encoder = new TextEncoder();
    const data = encoder.encode(sourcesStr);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const sourcesHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    // Save prediction
    const { data: prediction, error: predError } = await supabaseService
      .from("betting_predictions")
      .insert({
        match_id,
        predicted_winner: aiResult.predicted_winner || "draw",
        predicted_prob: predictedProb,
        confidence_raw: confidenceRaw,
        confidence_capped: confidenceCapped,
        cap_reason: capReason,
        key_factors: aiResult.key_factors || [],
        ai_reasoning: aiResult.ai_reasoning || "",
        sources_used: sources,
        sources_hash: sourcesHash,
        model_version: "2.0",
        market_odds_home: marketOddsHome,
        market_odds_draw: marketOddsDraw,
        market_odds_away: marketOddsAway,
        market_implied_prob: marketImpliedProb,
        model_edge: modelEdge,
      })
      .select()
      .single();

    if (predError) {
      return new Response(JSON.stringify({ error: predError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, prediction }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("analyze-match error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function classifyArticle(text: string): "confirmed_fact" | "stats" | "opinion" | "news" {
  const lower = text.toLowerCase();
  if (lower.includes("tips") || lower.includes("prediction") || lower.includes("expert") || lower.includes("odds on")) return "opinion";
  if (lower.includes("injury") || lower.includes("lineup") || lower.includes("confirmed") || lower.includes("training")) return "confirmed_fact";
  if (lower.includes("statistics") || lower.includes("head to head") || lower.includes("form") || lower.includes("h2h")) return "stats";
  return "news";
}

function findMatchInOdds(oddsArray: any[], homeTeam: string, awayTeam: string) {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const normHome = normalize(homeTeam);
  const normAway = normalize(awayTeam);

  for (const event of oddsArray) {
    const eHome = normalize(event.home_team || "");
    const eAway = normalize(event.away_team || "");

    // Fuzzy match: at least 5 chars overlap
    if (
      (eHome.includes(normHome.substring(0, 5)) || normHome.includes(eHome.substring(0, 5))) &&
      (eAway.includes(normAway.substring(0, 5)) || normAway.includes(eAway.substring(0, 5)))
    ) {
      // Find best bookmaker odds (use Pinnacle or first available)
      const bookmaker = event.bookmakers?.find((b: any) => b.key === "pinnacle") || event.bookmakers?.[0];
      if (!bookmaker) continue;

      const h2hMarket = bookmaker.markets?.find((m: any) => m.key === "h2h");
      if (!h2hMarket) continue;

      const outcomes = h2hMarket.outcomes || [];
      const homeOdds = outcomes.find((o: any) => normalize(o.name) === eHome)?.price;
      const awayOdds = outcomes.find((o: any) => normalize(o.name) === eAway)?.price;
      const drawOdds = outcomes.find((o: any) => o.name.toLowerCase() === "draw")?.price;

      if (homeOdds && awayOdds) {
        return { home: homeOdds, draw: drawOdds || null, away: awayOdds };
      }
    }
  }
  return null;
}
