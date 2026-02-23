import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HIGH_IMPACT_LEAGUES = ["Premier League", "La Liga", "Champions League", "Europa League", "Bundesliga", "Serie A"];

const SPORT_ODDS_KEY: Record<string, string> = {
  football: "soccer_epl",
  "Premier League": "soccer_epl",
  "La Liga": "soccer_spain_la_liga",
  "Bundesliga": "soccer_germany_bundesliga",
  "Serie A": "soccer_italy_serie_a",
  "Ligue 1": "soccer_france_ligue_one",
  "Champions League": "soccer_uefa_champs_league",
  "Europa League": "soccer_uefa_europa_league",
  "Conference League": "soccer_uefa_europa_conference_league",
  "Allsvenskan": "soccer_sweden_allsvenskan",
  "Superettan": "soccer_sweden_superettan",
  "Eredivisie": "soccer_netherlands_eredivisie",
  "Primeira Liga": "soccer_portugal_primeira_liga",
  "Liga Portugal": "soccer_portugal_primeira_liga",
  "Premiership": "soccer_spl",
  "Scottish Premiership": "soccer_spl",
  "Belgian Pro League": "soccer_belgium_first_div",
  "Jupiler Pro League": "soccer_belgium_first_div",
  "Super Lig": "soccer_turkey_super_league",
  "Süper Lig": "soccer_turkey_super_league",
  "MLS": "soccer_usa_mls",
  "World Cup": "soccer_fifa_world_cup",
  "Copa America": "soccer_conmebol_copa_america",
  "Euro Championship": "soccer_uefa_european_championship",
  "Championship": "soccer_efl_champ",
  "League One": "soccer_england_league1",
  "League Two": "soccer_england_league2",
  "Serie B": "soccer_italy_serie_b",
  "La Liga 2": "soccer_spain_segunda_division",
  "2. Bundesliga": "soccer_germany_bundesliga2",
  "Ligue 2": "soccer_france_ligue_two",
  ufc: "mma_mixed_martial_arts",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const internalHeader = req.headers.get("x-internal-call");
    const authHeader = req.headers.get("authorization");

    // Auth: allow internal calls (cron) or authenticated users
    if (!internalHeader && !authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseService = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Validate user auth if not internal
    if (!internalHeader) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader! } } }
      );
      const token = authHeader!.replace("Bearer ", "");
      const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
      if (claimsError || !claimsData?.claims) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const body = await req.json();
    const { match_id, batch } = body;

    // --- Batch mode: analyze all upcoming matches without predictions ---
    if (batch) {
      const { data: upcomingMatches } = await supabaseService
        .from("betting_matches")
        .select("id")
        .eq("status", "upcoming")
        .neq("sport", "system")
        .order("match_date", { ascending: true })
        .limit(50);

      if (!upcomingMatches || upcomingMatches.length === 0) {
        return new Response(
          JSON.stringify({ success: true, analyzed: 0, message: "No upcoming matches" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Get matches that already have predictions
      const matchIds = upcomingMatches.map((m: any) => m.id);
      const { data: existingPreds } = await supabaseService
        .from("betting_predictions")
        .select("match_id")
        .in("match_id", matchIds);

      const analyzedIds = new Set((existingPreds || []).map((p: any) => p.match_id));
      const toAnalyze = matchIds.filter((id: string) => !analyzedIds.has(id));

      // Analyze up to 5 matches per batch to stay within time limits
      const batchLimit = Math.min(toAnalyze.length, 5);
      let analyzed = 0;
      const errors: string[] = [];

      for (let i = 0; i < batchLimit; i++) {
        try {
          // Call self for each match (reuse the single-match logic below)
          const url = Deno.env.get("SUPABASE_URL") + "/functions/v1/analyze-match";
          const res = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-internal-call": "true",
              "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
            },
            body: JSON.stringify({ match_id: toAnalyze[i] }),
          });
          if (res.ok) analyzed++;
          else errors.push(`Match ${toAnalyze[i]}: ${res.status}`);
        } catch (e) {
          errors.push(`Match ${toAnalyze[i]}: ${e}`);
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          analyzed,
          skipped: analyzedIds.size,
          remaining: toAnalyze.length - batchLimit,
          errors: errors.length > 0 ? errors : undefined,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- Single match mode ---
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
    const newsApiKey = Deno.env.get("NEWSAPI_KEY");

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

    // === SMART CACHING: Check if source_data already has fresh enrichment ===
    const enrichedAt = sourceData._enriched_at ? new Date(sourceData._enriched_at).getTime() : 0;
    const ENRICHMENT_TTL = 12 * 60 * 60 * 1000; // 12 hours
    const isFreshEnrichment = (Date.now() - enrichedAt) < ENRICHMENT_TTL;

    // Fetch live H2H (use cached if fresh)
    let liveH2H: any = sourceData.h2h || null;
    if (!isFreshEnrichment && footballApiKey && fdMatchId) {
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

    // Fetch live standings (use cached if fresh)
    let liveStandings: any = sourceData.standings || null;
    if (!isFreshEnrichment && footballApiKey && compCode) {
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

    // === NEWS: Prefer news_cache, only fallback to live GNews if empty ===
    let liveNewsArticles: any[] = sourceData.news || [];
    if (!isFreshEnrichment) {
      // Try news_cache first (populated by fetch-news cron)
      const teamQuery = `${match.home_team} ${match.away_team}`.toLowerCase();
      const { data: cachedNews } = await supabaseService
        .from("news_cache")
        .select("title, description, source_name, url, published_at")
        .or(`title.ilike.%${match.home_team.split(' ')[0]}%,title.ilike.%${match.away_team.split(' ')[0]}%`)
        .gte("fetched_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order("published_at", { ascending: false })
        .limit(5);

      if (cachedNews && cachedNews.length >= 2) {
        liveNewsArticles = cachedNews.map((a: any) => ({
          url: a.url || "",
          title: a.title,
          date: a.published_at,
          source: a.source_name,
          description: a.description || "",
          type: classifyArticle(a.title + " " + (a.description || "")),
        }));
        console.log(`Using ${cachedNews.length} articles from news_cache (saved GNews API call)`);
      } else if (gnewsApiKey) {
        // Fallback to live GNews only if cache is insufficient
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
    }

    // NewsAPI: Only if we have fewer than 3 news articles already
    let newsApiArticles: any[] = [];
    if (!isFreshEnrichment && liveNewsArticles.length < 3 && newsApiKey) {
      try {
        const q = encodeURIComponent(`${match.home_team} ${match.away_team}`);
        const newsApiRes = await fetch(
          `https://newsapi.org/v2/everything?q=${q}&sortBy=relevancy&pageSize=5&language=en&apiKey=${newsApiKey}`
        );
        if (newsApiRes.ok) {
          const newsApiData = await newsApiRes.json();
          newsApiArticles = (newsApiData.articles || [])
            .filter((a: any) => a.title && a.title !== "[Removed]")
            .map((a: any) => ({
              url: a.url,
              title: a.title,
              date: a.publishedAt,
              source: a.source?.name,
              description: (a.description || "").substring(0, 300),
              content: (a.content || "").substring(0, 500),
              type: classifyArticle(a.title + " " + (a.description || "")),
            }));
        }
      } catch (e) {
        console.warn("NewsAPI fetch failed:", e);
      }
    }

    // Firecrawl Search: ONLY for high-impact leagues to conserve budget
    const isHighImpact = HIGH_IMPACT_LEAGUES.includes(match.league);
    let liveScrapedArticles: any[] = sourceData.scraped_articles || [];
    if (!isFreshEnrichment && isHighImpact && firecrawlApiKey) {
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
            limit: 2,
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
    } else if (!isHighImpact && !isFreshEnrichment) {
      console.log(`Skipping general Firecrawl for non-high-impact league: ${match.league}`);
    }

    // === FORZA FOOTBALL: Scrape match data for ALL leagues (great Nordic coverage) ===
    let forzaData: any = sourceData.forza_football || null;
    if (!isFreshEnrichment && firecrawlApiKey) {
      try {
        const forzaQuery = `site:forzafootball.com ${match.home_team} ${match.away_team}`;
        const forzaRes = await fetch("https://api.firecrawl.dev/v1/search", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${firecrawlApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: forzaQuery,
            limit: 1,
            scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
          }),
        });
        if (forzaRes.ok) {
          const forzaJson = await forzaRes.json();
          if (forzaJson.success && forzaJson.data?.length > 0) {
            const page = forzaJson.data[0];
            forzaData = {
              url: page.url,
              title: page.title || page.metadata?.title || "",
              markdown: page.markdown ? page.markdown.substring(0, 3000) : "",
              source: "forza_football",
            };
            // Also add to scraped articles for the AI prompt
            liveScrapedArticles.push({
              url: page.url,
              title: `[Forza Football] ${page.title || page.metadata?.title || ""}`,
              description: page.description || page.metadata?.description || "",
              markdown: page.markdown ? page.markdown.substring(0, 3000) : "",
              source: "forza_football",
            });
            console.log(`Forza Football data found for ${match.home_team} vs ${match.away_team}`);
          } else {
            console.log(`No Forza Football results for ${match.home_team} vs ${match.away_team}`);
          }
        }
      } catch (e) {
        console.warn("Forza Football scrape failed:", e);
      }
    }

    // Cache enrichment data back to source_data for reuse
    if (!isFreshEnrichment) {
      const enrichedData = {
        ...sourceData,
        h2h: liveH2H,
        standings: liveStandings,
        news: liveNewsArticles,
        scraped_articles: liveScrapedArticles,
        forza_football: forzaData,
        _enriched_at: new Date().toISOString(),
      };
      await supabaseService
        .from("betting_matches")
        .update({ source_data: enrichedData })
        .eq("id", match_id);
    }

    // === BUILD STRUCTURED PROMPT SECTIONS ===
    const h2hSection = buildH2HSection(liveH2H, match.home_team, match.away_team);
    const standingsSection = buildStandingsSection(liveStandings, match.home_team, match.away_team);
    const formSection = buildFormSection(liveStandings);
    const newsSection = buildNewsSection([...liveNewsArticles, ...newsApiArticles]);
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
    for (const article of newsApiArticles) {
      const type = article.type || "news";
      sources.push({ url: article.url || "", title: `[NewsAPI] ${article.title || ""}`, date: article.date || "", type });
      if (type === "confirmed_fact") { hasConfirmedFact = true; hasOnlyOpinion = false; }
      if (type === "stats") { hasStats = true; hasOnlyOpinion = false; }
      if (type === "news") hasOnlyOpinion = false;
      const text = ((article.title || "") + " " + (article.description || "") + " " + (article.content || "")).toLowerCase();
      if (text.includes("injury") || text.includes("injured") || text.includes("fit") || text.includes("doubt") || text.includes("lineup") || text.includes("suspended")) hasInjuryData = true;
    }
    for (const article of liveScrapedArticles) {
      sources.push({ url: article.url || "", title: article.title || "", date: new Date().toISOString().split("T")[0], type: "stats" });
      hasStats = true;
      hasOnlyOpinion = false;
    }

    // === FETCH ODDS (with caching in source_data) ===
    const oddsApiKey = Deno.env.get("ODDS_API_KEY");
    let marketOddsHome: number | null = null;
    let marketOddsDraw: number | null = null;
    let marketOddsAway: number | null = null;
    let marketImpliedProbHome: number | null = null;
    let marketImpliedProbDraw: number | null = null;
    let marketImpliedProbAway: number | null = null;
    let totalsOdds: { line: number; over: number; under: number } | null = null;
    let bttsOdds: { yes: number; no: number } | null = null;

    // Use cached odds if available and fresh (< 12h)
    const cachedOdds = sourceData._odds;
    const oddsFetchedAt = sourceData._odds_fetched_at ? new Date(sourceData._odds_fetched_at).getTime() : 0;
    const ODDS_TTL = 12 * 60 * 60 * 1000;
    const hasFreshOdds = cachedOdds && (Date.now() - oddsFetchedAt) < ODDS_TTL;

    if (hasFreshOdds) {
      marketOddsHome = cachedOdds.home;
      marketOddsDraw = cachedOdds.draw;
      marketOddsAway = cachedOdds.away;
      totalsOdds = cachedOdds.totals || null;
      bttsOdds = cachedOdds.btts || null;
      if (marketOddsHome) {
        const rawHome = 1 / marketOddsHome;
        const rawDraw = marketOddsDraw ? 1 / marketOddsDraw : 0;
        const rawAway = marketOddsAway ? 1 / marketOddsAway : 1;
        const total = rawHome + rawDraw + rawAway;
        marketImpliedProbHome = rawHome / total;
        marketImpliedProbDraw = rawDraw > 0 ? rawDraw / total : null;
        marketImpliedProbAway = rawAway / total;
      }
      console.log(`Using cached odds for ${match.home_team} vs ${match.away_team} (saved Odds API call)`);
    } else if (oddsApiKey && isHighImpact) {
      // Only fetch odds for high-impact leagues to conserve 500 req/month budget
      const sportKey = SPORT_ODDS_KEY[match.league] || SPORT_ODDS_KEY[match.sport] || "soccer_epl";
      try {
        const oddsRes = await fetch(
          `https://api.the-odds-api.com/v4/sports/${sportKey}/odds?apiKey=${oddsApiKey}&regions=eu&markets=h2h,totals,btts&oddsFormat=decimal`
        );
        if (oddsRes.ok) {
          const oddsData = await oddsRes.json();
          const matchedOdds = findMatchInOdds(oddsData, match.home_team, match.away_team);
          if (matchedOdds) {
            marketOddsHome = matchedOdds.home;
            marketOddsDraw = matchedOdds.draw;
            marketOddsAway = matchedOdds.away;
            totalsOdds = matchedOdds.totals || null;
            bttsOdds = matchedOdds.btts || null;
            const rawHome = 1 / matchedOdds.home;
            const rawDraw = matchedOdds.draw ? 1 / matchedOdds.draw : 0;
            const rawAway = 1 / matchedOdds.away;
            const total = rawHome + rawDraw + rawAway;
            marketImpliedProbHome = rawHome / total;
            marketImpliedProbDraw = rawDraw > 0 ? rawDraw / total : null;
            marketImpliedProbAway = rawAway / total;

            // Cache odds in source_data
            await supabaseService
              .from("betting_matches")
              .update({
                source_data: {
                  ...sourceData,
                  _odds: matchedOdds,
                  _odds_fetched_at: new Date().toISOString(),
                },
              })
              .eq("id", match_id);
          }
        }
      } catch (e) {
        console.warn("Odds API fetch failed:", e);
      }
    } else if (!isHighImpact) {
      console.log(`Skipping Odds API for non-high-impact league: ${match.league} (budget conservation)`);
    }

    // === BUILD GEMINI PROMPT ===
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) {
      return new Response(JSON.stringify({ error: "AI API not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let oddsContext = "";
    if (marketOddsHome) {
      oddsContext = `\nMARKET ODDS (1X2): Home ${marketOddsHome} | Draw ${marketOddsDraw || "N/A"} | Away ${marketOddsAway}`;
      oddsContext += `\nImplied probabilities: Home ${marketImpliedProbHome ? (marketImpliedProbHome * 100).toFixed(1) + "%" : "N/A"} | Draw ${marketImpliedProbDraw ? (marketImpliedProbDraw * 100).toFixed(1) + "%" : "N/A"} | Away ${marketImpliedProbAway ? (marketImpliedProbAway * 100).toFixed(1) + "%" : "N/A"}`;
      if (totalsOdds) {
        oddsContext += `\nSIDE MARKET ODDS - Total Goals ${totalsOdds.line}: Over ${totalsOdds.over} | Under ${totalsOdds.under}`;
      }
      if (bttsOdds) {
        oddsContext += `\nSIDE MARKET ODDS - BTTS: Yes ${bttsOdds.yes} | No ${bttsOdds.no}`;
      }
    }

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
        max_tokens: 8000,
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
      console.error("Parse error detail:", String(parseErr));
      console.error("Response length:", rawContent.length, "Last 200 chars:", rawContent.substring(rawContent.length - 200));
      return new Response(JSON.stringify({ error: "AI returned invalid JSON", detail: String(parseErr) }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === GPT-5 DEEP SYNTHESIS ===
    let deepAnalysis: string | null = null;
    try {
      const deepPrompt = `Du är en expertanalytiker inom fotbollsbetting. Du har fått en strukturerad AI-prediktion och all underliggande data. Din uppgift är att ge en DJUPARE analys som hittar nyanser, risker och möjligheter som den första analysen kan ha missat.

MATCH: ${match.home_team} vs ${match.away_team} (${match.league})
DATUM: ${new Date(match.match_date).toLocaleDateString("sv-SE")}

STRUKTURERAD PREDIKTION:
- Vinnare: ${aiResult.predicted_winner} (sannolikhet: ${(aiResult.predicted_prob * 100).toFixed(1)}%)
- Konfidensgrad: ${aiResult.confidence_raw}/100
- Nyckelfaktorer: ${JSON.stringify(aiResult.key_factors?.slice(0, 5) || [])}
- Sidmarknader: ${JSON.stringify(aiResult.side_predictions || {})}

UNDERLIGGANDE DATA:
${h2hSection}
${standingsSection}
${formSection}
${oddsContext}

NYHETSKONTEXT:
${newsSection}

INSTRUKTIONER:
1. Identifiera TAKTISKA faktorer (spelstil, formation, matchtemperament)
2. Hitta VALUE-möjligheter: var skiljer sig modellens sannolikhet mest från marknadsodds?
3. Identifiera RISKER som kan göra prediktionen fel
4. Ge en SAMMANFATTANDE rekommendation med value rating (1-10)
5. Skriv på svenska, max 400 ord
6. Var ärlig om osäkerhet`;

      const deepRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${lovableApiKey}`,
        },
        body: JSON.stringify({
          model: "openai/gpt-5",
          messages: [{ role: "user", content: deepPrompt }],
          temperature: 0.4,
          max_tokens: 2000,
        }),
      });

      if (deepRes.ok) {
        const deepData = await deepRes.json();
        deepAnalysis = deepData.choices?.[0]?.message?.content || null;
        console.log("GPT-5 deep analysis completed successfully");
      } else {
        console.warn("GPT-5 deep analysis failed:", deepRes.status);
      }
    } catch (e) {
      console.warn("GPT-5 deep analysis error:", e);
    }

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
    const predictedWinner = aiResult.predicted_winner || "draw";

    // Calculate market_implied_prob for the predicted winner specifically
    let marketImpliedProb: number | null = null;
    if (predictedWinner === "home" && marketImpliedProbHome !== null) {
      marketImpliedProb = marketImpliedProbHome;
    } else if (predictedWinner === "away" && marketImpliedProbAway !== null) {
      marketImpliedProb = marketImpliedProbAway;
    } else if (predictedWinner === "draw" && marketImpliedProbDraw !== null) {
      marketImpliedProb = marketImpliedProbDraw;
    }
    const modelEdge = marketImpliedProb !== null ? predictedProb - marketImpliedProb : null;

    // Calculate side market edges
    const sidePredictions = aiResult.side_predictions || null;
    let sideEdges: Record<string, number> | null = null;
    if (sidePredictions) {
      sideEdges = {};
      if (sidePredictions.total_goals && totalsOdds) {
        const isOver = sidePredictions.total_goals.prediction === "over";
        const sideOdds = isOver ? totalsOdds.over : totalsOdds.under;
        const impliedProb = 1 / sideOdds;
        sideEdges.total_goals = (sidePredictions.total_goals.prob || 0) - impliedProb;
      }
      if (sidePredictions.btts && bttsOdds) {
        const isYes = sidePredictions.btts.prediction === "yes";
        const sideOdds = isYes ? bttsOdds.yes : bttsOdds.no;
        const impliedProb = 1 / sideOdds;
        sideEdges.btts = (sidePredictions.btts.prob || 0) - impliedProb;
      }
      if (Object.keys(sideEdges).length === 0) sideEdges = null;
    }

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
        predicted_winner: predictedWinner,
        predicted_prob: predictedProb,
        confidence_raw: confidenceRaw,
        confidence_capped: confidenceCapped,
        cap_reason: capReason,
        key_factors: {
          factors: aiResult.key_factors || [],
          side_predictions: sidePredictions,
          side_edges: sideEdges,
          deep_analysis: deepAnalysis,
        },
        ai_reasoning: aiResult.ai_reasoning || "",
        sources_used: sources,
        sources_hash: sourcesHash,
        model_version: "4.0-gpt5",
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

function findMatchInOdds(oddsArray: any[], homeTeam: string, awayTeam: string): {
  home: number; draw: number | null; away: number;
  totals?: { line: number; over: number; under: number };
  btts?: { yes: number; no: number };
} | null {
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

      // H2H market
      const h2hMarket = bookmaker.markets?.find((m: any) => m.key === "h2h");
      if (!h2hMarket) continue;
      const outcomes = h2hMarket.outcomes || [];
      const homeOdds = outcomes.find((o: any) => normalize(o.name) === eHome)?.price;
      const awayOdds = outcomes.find((o: any) => normalize(o.name) === eAway)?.price;
      const drawOdds = outcomes.find((o: any) => o.name.toLowerCase() === "draw")?.price;
      if (!homeOdds || !awayOdds) continue;

      const result: any = { home: homeOdds, draw: drawOdds || null, away: awayOdds };

      // Totals market (Over/Under)
      const totalsMarket = bookmaker.markets?.find((m: any) => m.key === "totals");
      if (totalsMarket) {
        const totalsOutcomes = totalsMarket.outcomes || [];
        const overOutcome = totalsOutcomes.find((o: any) => o.name === "Over");
        const underOutcome = totalsOutcomes.find((o: any) => o.name === "Under");
        if (overOutcome && underOutcome) {
          result.totals = {
            line: overOutcome.point ?? 2.5,
            over: overOutcome.price,
            under: underOutcome.price,
          };
        }
      }

      // BTTS market
      const bttsMarket = bookmaker.markets?.find((m: any) => m.key === "btts");
      if (bttsMarket) {
        const bttsOutcomes = bttsMarket.outcomes || [];
        const yesOutcome = bttsOutcomes.find((o: any) => o.name === "Yes")?.price;
        const noOutcome = bttsOutcomes.find((o: any) => o.name === "No")?.price;
        if (yesOutcome && noOutcome) {
          result.btts = { yes: yesOutcome, no: noOutcome };
        }
      }

      return result;
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
    // Sanitize control characters inside JSON string values only
    // Walk character by character, track if we're inside a string
    let sanitized = '';
    let inString = false;
    let escaped = false;
    for (let i = 0; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (escaped) {
        sanitized += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\' && inString) {
        sanitized += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        sanitized += ch;
        continue;
      }
      if (inString && ch.charCodeAt(0) < 32) {
        // Replace control chars inside strings
        if (ch === '\n') sanitized += '\\n';
        else if (ch === '\r') sanitized += '\\r';
        else if (ch === '\t') sanitized += '\\t';
        // else skip other control chars
        continue;
      }
      sanitized += ch;
    }
    cleaned = sanitized;

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
