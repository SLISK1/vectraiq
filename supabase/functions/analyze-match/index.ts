import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    const footballApiKey = Deno.env.get("FOOTBALL_DATA_API_KEY");
    const gnewsApiKey = Deno.env.get("GNEWS_API_KEY");
    const firecrawlApiKey = Deno.env.get("FIRECRAWL_API_KEY");

    // === LIVE DATA ENRICHMENT ===
    // Extract football-data match ID from external_id (format: "football-{id}")
    const externalId = match.external_id || "";
    const fdMatchId = externalId.startsWith("football-") ? externalId.replace("football-", "") : null;

    // Determine competition code from league name
    const LEAGUE_TO_COMP: Record<string, string> = {
      "Premier League": "PL", "La Liga": "PD", "Bundesliga": "BL1",
      "Serie A": "SA", "Ligue 1": "FL1", "Champions League": "CL",
      "Europa League": "EL", "Allsvenskan": "SE",
    };
    const compCode = LEAGUE_TO_COMP[match.league] || null;

    // Fetch live H2H (always fresh)
    let liveH2H: any = sourceData.h2h || null;
    if (footballApiKey && fdMatchId) {
      try {
        const h2hRes = await fetch(
          `https://api.football-data.org/v4/matches/${fdMatchId}/head2head?limit=10`,
          { headers: { "X-Auth-Token": footballApiKey } }
        );
        if (h2hRes.ok) {
          const h2hJson = await h2hRes.json();
          const h2hMatches = h2hJson.matches || [];
          let homeWins = 0, awayWins = 0, draws = 0;
          const recentMeetings = h2hMatches.map((m: any) => {
            const hg = m.score?.fullTime?.home ?? null;
            const ag = m.score?.fullTime?.away ?? null;
            const winner = m.score?.winner;
            if (winner === "HOME_TEAM") homeWins++;
            else if (winner === "AWAY_TEAM") awayWins++;
            else if (winner === "DRAW") draws++;
            return {
              date: m.utcDate?.split("T")[0],
              home: m.homeTeam?.name,
              away: m.awayTeam?.name,
              score: hg !== null ? `${hg}-${ag}` : "N/A",
              winner,
            };
          });
          liveH2H = { matches: recentMeetings, homeTeamWins: homeWins, awayTeamWins: awayWins, draws, totalMeetings: h2hMatches.length };
        }
      } catch (e) {
        console.warn("Live H2H fetch failed:", e);
      }
    }

    // Fetch live standings
    let liveStandings: any = sourceData.standings || null;
    if (footballApiKey && compCode) {
      try {
        const standRes = await fetch(
          `https://api.football-data.org/v4/competitions/${compCode}/standings`,
          { headers: { "X-Auth-Token": footballApiKey } }
        );
        if (standRes.ok) {
          const standData = await standRes.json();
          const table = standData.standings?.find((s: any) => s.type === "TOTAL")?.table || [];
          const normalizeTeam = (name: string) => name.toLowerCase().replace(/\s+/g, "").replace(/[^a-z]/g, "");
          const normHome = normalizeTeam(match.home_team);
          const normAway = normalizeTeam(match.away_team);

          const homeRow = table.find((r: any) => {
            const rn = normalizeTeam(r.team?.name || "");
            return rn.includes(normHome.substring(0, 6)) || normHome.includes(rn.substring(0, 6));
          });
          const awayRow = table.find((r: any) => {
            const rn = normalizeTeam(r.team?.name || "");
            return rn.includes(normAway.substring(0, 6)) || normAway.includes(rn.substring(0, 6));
          });

          if (homeRow || awayRow) {
            liveStandings = {
              home: homeRow ? {
                position: homeRow.position, points: homeRow.points,
                playedGames: homeRow.playedGames, won: homeRow.won,
                draw: homeRow.draw, lost: homeRow.lost,
                goalsFor: homeRow.goalsFor, goalsAgainst: homeRow.goalsAgainst,
                goalDifference: homeRow.goalDifference, form: homeRow.form,
              } : null,
              away: awayRow ? {
                position: awayRow.position, points: awayRow.points,
                playedGames: awayRow.playedGames, won: awayRow.won,
                draw: awayRow.draw, lost: awayRow.lost,
                goalsFor: awayRow.goalsFor, goalsAgainst: awayRow.goalsAgainst,
                goalDifference: awayRow.goalDifference, form: awayRow.form,
              } : null,
            };
          }
        }
      } catch (e) {
        console.warn("Live standings fetch failed:", e);
      }
    }

    // Live GNews search
    let liveNewsArticles: any[] = sourceData.news || [];
    if (gnewsApiKey) {
      try {
        const query = encodeURIComponent(`"${match.home_team}" "${match.away_team}" preview prediction ${new Date().getFullYear()}`);
        const gnewsRes = await fetch(
          `https://gnews.io/api/v4/search?q=${query}&max=5&lang=en&apikey=${gnewsApiKey}`
        );
        if (gnewsRes.ok) {
          const gnewsData = await gnewsRes.json();
          liveNewsArticles = (gnewsData.articles || []).map((a: any) => ({
            url: a.url,
            title: a.title,
            date: a.publishedAt,
            source: a.source?.name,
            description: a.description || "",
            type: classifyArticle(a.title + " " + (a.description || "")),
          }));
        }
      } catch (e) {
        console.warn("Live GNews search failed:", e);
      }
    }

    // Live Firecrawl Search
    let liveScrapedArticles: any[] = sourceData.scraped_articles || [];
    if (firecrawlApiKey) {
      try {
        const matchYear = new Date(match.match_date).getFullYear();
        const searchQuery = `${match.home_team} vs ${match.away_team} ${match.league} ${matchYear} preview prediction analysis`;
        const fcRes = await fetch("https://api.firecrawl.dev/v1/search", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${firecrawlApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: searchQuery,
            limit: 3,
            scrapeOptions: { formats: ["markdown"] },
          }),
        });
        if (fcRes.ok) {
          const fcData = await fcRes.json();
          if (fcData.success && fcData.data?.length > 0) {
            liveScrapedArticles = fcData.data.map((item: any) => ({
              url: item.url,
              title: item.title || item.metadata?.title || "",
              description: item.description || item.metadata?.description || "",
              markdown: item.markdown ? item.markdown.substring(0, 2000) : "",
              source: "firecrawl_search",
            }));
          }
        }
      } catch (e) {
        console.warn("Live Firecrawl search failed:", e);
      }
    }

    // === BUILD STRUCTURED PROMPT SECTIONS ===
    const h2hSection = buildH2HSection(liveH2H, match.home_team, match.away_team);
    const standingsSection = buildStandingsSection(liveStandings, match.home_team, match.away_team);
    const formSection = buildFormSection(liveStandings);
    const newsSection = buildNewsSection(liveNewsArticles);
    const scrapedSection = buildScrapedSection(liveScrapedArticles);

    // === EVIDENCE GATING ===
    const sources: Array<{ url: string; title: string; date: string; type: string }> = [];
    let hasConfirmedFact = false;
    let hasStats = false;
    let hasOnlyOpinion = true;
    let hasInjuryData = false;
    const h2hCount = liveH2H?.totalMeetings || 0;
    const hasStandings = !!(liveStandings?.home || liveStandings?.away);

    if (sourceData.football_data || fdMatchId) {
      hasConfirmedFact = true;
      hasOnlyOpinion = false;
      sources.push({ url: "https://www.football-data.org", title: "Football-Data.org API (live)", date: new Date().toISOString().split("T")[0], type: "confirmed_fact" });
    }
    if (h2hCount > 0) {
      hasStats = true;
      hasOnlyOpinion = false;
      sources.push({ url: "https://www.football-data.org/v4/matches/head2head", title: `H2H: ${h2hCount} historiska möten`, date: new Date().toISOString().split("T")[0], type: "stats" });
    }
    if (hasStandings) {
      hasStats = true;
      hasOnlyOpinion = false;
      sources.push({ url: `https://www.football-data.org/v4/competitions/${compCode}/standings`, title: "Ligatabell & form", date: new Date().toISOString().split("T")[0], type: "stats" });
    }

    for (const article of liveNewsArticles) {
      const type = article.type || "news";
      sources.push({ url: article.url || "", title: article.title || "", date: article.date || "", type });
      if (type === "confirmed_fact") { hasConfirmedFact = true; hasOnlyOpinion = false; }
      if (type === "stats") { hasStats = true; hasOnlyOpinion = false; }
      if (type === "news") hasOnlyOpinion = false;
      const text = ((article.title || "") + " " + (article.description || "")).toLowerCase();
      if (text.includes("injury") || text.includes("injured") || text.includes("fit") || text.includes("doubt")) hasInjuryData = true;
    }
    for (const article of liveScrapedArticles) {
      sources.push({ url: article.url || "", title: article.title || "", date: new Date().toISOString().split("T")[0], type: "stats" });
      hasStats = true;
      hasOnlyOpinion = false;
    }

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

    // === BUILD GEMINI PROMPT ===
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) {
      return new Response(JSON.stringify({ error: "AI API not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const oddsContext = marketOddsHome
      ? `\nMARKET ODDS: Home ${marketOddsHome} | Draw ${marketOddsDraw || "N/A"} | Away ${marketOddsAway}\nMarket implied home win probability: ${marketImpliedProb ? (marketImpliedProb * 100).toFixed(1) + "%" : "N/A"}`
      : "";

    const prompt = `You are an evidence-based football prediction AI. Use the provided statistical data to calculate probabilities using Poisson distribution logic. Weight table position, form, and H2H history.

MATCH: ${match.home_team} vs ${match.away_team}
COMPETITION: ${match.league}
DATE: ${new Date(match.match_date).toLocaleDateString("sv-SE")}
${oddsContext}

${h2hSection}

${standingsSection}

${formSection}

${newsSection}

${scrapedSection}

INSTRUCTIONS:
1. Use goals scored/conceded per game to estimate Poisson-based goal expectation for each team.
2. Weight: table position (30%) + recent form (30%) + H2H record (25%) + home advantage (15%).
3. If standings data is missing for a team, rely on H2H and news context.
4. NEVER invent statistics not shown above.
5. Base confidence on data quality: more data = higher confidence allowed.
6. Set predicted_prob to your calculated probability for the predicted_winner outcome (0.0-1.0).
7. Respond with the analysis in Swedish (ai_reasoning) but keep JSON keys in English.
8. Also predict these side markets based on the statistical data:
   - Total goals: Over/Under 2.5 (use Poisson with the calculated goal expectations)
   - BTTS (Both Teams To Score): based on goals scored/conceded per game
   - Corners: Over/Under 9.5 (estimate from league averages and team attacking style)
   - Cards: Over/Under 3.5 (estimate from league discipline stats and match importance)
   - First half goals: Over/Under 1.5 (estimate ~45% of total goals in first half)
   - First team to score: "home", "away", or "none" with probability
   - Exact score prediction: the single most likely scoreline

Respond with ONLY valid JSON (no markdown, no code blocks):
{
  "predicted_winner": "home" | "away" | "draw",
  "predicted_prob": <0.0-1.0>,
  "confidence_raw": <0-100>,
  "key_factors": [
    {
      "factor": "<concise factor in Swedish>",
      "direction": "positive" | "negative" | "neutral",
      "source": { "url": "<url>", "date": "<YYYY-MM-DD>", "type": "confirmed_fact"|"stats"|"opinion"|"news" }
    }
  ],
  "side_predictions": {
    "total_goals": { "line": 2.5, "prediction": "over"|"under", "prob": <float>, "reasoning": "<short Swedish>" },
    "btts": { "prediction": "yes"|"no", "prob": <float>, "reasoning": "<short Swedish>" },
    "corners": { "line": 9.5, "prediction": "over"|"under", "prob": <float>, "reasoning": "<short Swedish>" },
    "cards": { "line": 3.5, "prediction": "over"|"under", "prob": <float>, "reasoning": "<short Swedish>" },
    "first_half_goals": { "line": 1.5, "prediction": "over"|"under", "prob": <float>, "reasoning": "<short Swedish>" },
    "first_to_score": { "prediction": "home"|"away"|"none", "prob": <float>, "reasoning": "<short Swedish>" },
    "exact_score": { "home": <int>, "away": <int>, "prob": <float>, "reasoning": "<short Swedish>" }
  },
  "ai_reasoning": "<3-4 paragraphs in Swedish citing specific statistics from the data above>"
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
        temperature: 0.2,
        max_tokens: 4000,
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
      aiResult = extractJsonFromResponse(rawContent);
    } catch (parseErr) {
      console.error("Failed to parse AI response:", rawContent.substring(0, 500));
      return new Response(JSON.stringify({ error: "AI returned invalid JSON", detail: String(parseErr) }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === CONFIDENCE CAPPING (data-driven) ===
    let confidenceRaw = Math.min(100, Math.max(0, Math.round(aiResult.confidence_raw || 50)));
    let cap = 45; // default: no sources
    const capReasons: string[] = [];

    if (h2hCount >= 5 && hasStandings) {
      cap = 80;
    } else if (h2hCount >= 3 && hasStandings) {
      cap = 70;
    } else if (hasStandings && h2hCount < 3) {
      cap = 65;
      capReasons.push(`Begränsad H2H-data (${h2hCount} möten)`);
    } else if (hasConfirmedFact) {
      cap = 55;
      capReasons.push("Standings saknas");
    } else {
      cap = 45;
      capReasons.push("Inga statistikkällor tillgängliga");
    }

    if (!hasInjuryData) {
      capReasons.push("Inga skaderapporter tillgängliga");
    }
    if (hasOnlyOpinion) {
      cap = Math.min(cap, 52);
      capReasons.push("Endast opinion-källor");
    }

    const MIN_CAP = 40;
    cap = Math.max(MIN_CAP, cap);
    const confidenceCapped = Math.min(confidenceRaw, cap);
    const capReason = capReasons.length > 0 ? capReasons.join("; ") : null;

    const predictedProb = Math.min(1, Math.max(0, aiResult.predicted_prob || 0.5));
    const modelEdge = marketImpliedProb !== null ? predictedProb - marketImpliedProb : null;

    const sourcesStr = JSON.stringify(sources);
    const encoder = new TextEncoder();
    const encData = encoder.encode(sourcesStr);
    const hashBuffer = await crypto.subtle.digest("SHA-256", encData);
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
        key_factors: {
          factors: aiResult.key_factors || [],
          side_predictions: aiResult.side_predictions || null,
        },
        ai_reasoning: aiResult.ai_reasoning || "",
        sources_used: sources,
        sources_hash: sourcesHash,
        model_version: "3.0",
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

// === PROMPT SECTION BUILDERS ===

function buildH2HSection(h2h: any, homeTeam: string, awayTeam: string): string {
  if (!h2h || h2h.totalMeetings === 0) return "H2H DATA: Inga historiska möten tillgängliga.";
  const lines = [
    `H2H (senaste ${h2h.totalMeetings} möten):`,
    `${homeTeam}: ${h2h.homeTeamWins}V | Oavgjort: ${h2h.draws} | ${awayTeam}: ${h2h.awayTeamWins}V`,
    "",
    ...(h2h.matches || []).slice(0, 5).map((m: any) =>
      `  ${m.date || "?"}: ${m.home} ${m.score || "?-?"} ${m.away} (${
        m.winner === "HOME_TEAM" ? m.home + " vann" :
        m.winner === "AWAY_TEAM" ? m.away + " vann" : "Oavgjort"
      })`
    ),
  ];
  return lines.join("\n");
}

function buildStandingsSection(standings: any, homeTeam: string, awayTeam: string): string {
  if (!standings) return "LIGATABELL: Ej tillgänglig.";
  const formatRow = (team: string, row: any) => {
    if (!row) return `  ${team}: Ej i tabellen`;
    return `  ${team}: Plats ${row.position}, ${row.points}p (${row.playedGames} matcher), ` +
           `${row.won}V-${row.draw}O-${row.lost}F, ` +
           `Mål: ${row.goalsFor}-${row.goalsAgainst} (${row.goalDifference > 0 ? "+" : ""}${row.goalDifference}), ` +
           `Snittmål/match: ${row.playedGames > 0 ? (row.goalsFor / row.playedGames).toFixed(2) : "?"} insläppta: ${row.playedGames > 0 ? (row.goalsAgainst / row.playedGames).toFixed(2) : "?"}`;
  };
  return [
    "LIGATABELL:",
    formatRow(homeTeam, standings.home),
    formatRow(awayTeam, standings.away),
  ].join("\n");
}

function buildFormSection(standings: any): string {
  if (!standings) return "SENASTE FORM: Ej tillgänglig.";
  const lines = ["SENASTE FORM (senaste 5 matcher, W=Vinst D=Oavgjort L=Förlust):"];
  if (standings.home?.form) lines.push(`  Hemmalag: ${standings.home.form}`);
  if (standings.away?.form) lines.push(`  Bortalag: ${standings.away.form}`);
  if (lines.length === 1) return "SENASTE FORM: Ej tillgänglig.";
  return lines.join("\n");
}

function buildNewsSection(articles: any[]): string {
  if (!articles || articles.length === 0) return "NYHETER: Inga tillgängliga nyheter.";
  const lines = ["NYHETER & FÖRHANDSVISNING:"];
  for (const a of articles.slice(0, 4)) {
    lines.push(`  [${(a.type || "news").toUpperCase()}] ${a.title || ""}`);
    if (a.description) lines.push(`    ${a.description.substring(0, 200)}`);
  }
  return lines.join("\n");
}

function buildScrapedSection(articles: any[]): string {
  if (!articles || articles.length === 0) return "";
  const lines = ["WEBBANALYS (Firecrawl Search):"];
  for (const a of articles.slice(0, 3)) {
    if (a.title) lines.push(`\n  KÄLLA: ${a.title} (${a.url})`);
    if (a.markdown) lines.push(`  INNEHÅLL: ${a.markdown.substring(0, 800)}...`);
  }
  return lines.join("\n");
}

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
    if (
      (eHome.includes(normHome.substring(0, 5)) || normHome.includes(eHome.substring(0, 5))) &&
      (eAway.includes(normAway.substring(0, 5)) || normAway.includes(eAway.substring(0, 5)))
    ) {
      const bookmaker = event.bookmakers?.find((b: any) => b.key === "pinnacle") || event.bookmakers?.[0];
      if (!bookmaker) continue;
      const h2hMarket = bookmaker.markets?.find((m: any) => m.key === "h2h");
      if (!h2hMarket) continue;
      const outcomes = h2hMarket.outcomes || [];
      const homeOdds = outcomes.find((o: any) => normalize(o.name) === eHome)?.price;
      const awayOdds = outcomes.find((o: any) => normalize(o.name) === eAway)?.price;
      const drawOdds = outcomes.find((o: any) => o.name.toLowerCase() === "draw")?.price;
      if (homeOdds && awayOdds) return { home: homeOdds, draw: drawOdds || null, away: awayOdds };
    }
  }
  return null;
}

function extractJsonFromResponse(response: string): any {
  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  let cleaned = response
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  // Find outermost JSON object boundaries
  const jsonStart = cleaned.search(/[{[]/);
  if (jsonStart === -1) throw new Error("No JSON found in response");

  const openChar = cleaned[jsonStart];
  const closeChar = openChar === "{" ? "}" : "]";
  const jsonEnd = cleaned.lastIndexOf(closeChar);
  if (jsonEnd === -1) throw new Error("No closing bracket found");

  cleaned = cleaned.substring(jsonStart, jsonEnd + 1);

  // First attempt: direct parse
  try {
    return JSON.parse(cleaned);
  } catch (_e) {
    // Fix common LLM JSON issues
    cleaned = cleaned
      .replace(/,\s*}/g, "}")     // trailing commas before }
      .replace(/,\s*]/g, "]");    // trailing commas before ]

    // Balance braces/brackets if truncated
    let braces = 0, brackets = 0;
    for (const char of cleaned) {
      if (char === "{") braces++;
      else if (char === "}") braces--;
      else if (char === "[") brackets++;
      else if (char === "]") brackets--;
    }
    while (brackets > 0) { cleaned += "]"; brackets--; }
    while (braces > 0) { cleaned += "}"; braces--; }

    return JSON.parse(cleaned);
  }
}
