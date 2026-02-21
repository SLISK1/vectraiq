import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-call",
};

// Football-data.org competition IDs
const FOOTBALL_COMPETITIONS = [
  { id: "PL", name: "Premier League" },
  { id: "PD", name: "La Liga" },
  { id: "BL1", name: "Bundesliga" },
  { id: "SA", name: "Serie A" },
  { id: "FL1", name: "Ligue 1" },
  { id: "CL", name: "Champions League" },
  { id: "EL", name: "Europa League" },
  { id: "SE", name: "Allsvenskan" },
];

const HIGH_IMPACT_LEAGUES = ["Premier League", "La Liga", "Champions League", "Europa League", "Bundesliga", "Serie A"];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const internalHeader = req.headers.get("x-internal-call");
    const authHeader = req.headers.get("authorization");
    if (!internalHeader && !authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const footballApiKey = Deno.env.get("FOOTBALL_DATA_API_KEY");
    const gnewsApiKey = Deno.env.get("GNEWS_API_KEY");
    const firecrawlApiKey = Deno.env.get("FIRECRAWL_API_KEY");

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const sport = body.sport || "football";

    let inserted = 0;
    let updated = 0;
    const errors: string[] = [];

    if (sport === "football" || sport === "all") {
      if (footballApiKey) {
        const today = new Date();
        const daysBack = body.days_back || 14;
        const pastDate = new Date(today.getTime() - daysBack * 24 * 60 * 60 * 1000);
        const dateFrom = pastDate.toISOString().split("T")[0];
        const dateTo = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

        // Fetch all matches for the week
        let allMatches: any[] = [];
        try {
          const response = await fetch(
            `https://api.football-data.org/v4/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`,
            { headers: { "X-Auth-Token": footballApiKey } }
          );
          if (response.ok) {
            const data = await response.json();
            allMatches = data.matches || [];
          } else {
            errors.push(`Football API error: ${response.status}`);
          }
        } catch (e) {
          errors.push(`Football fetch failed: ${e}`);
        }

        const targetCompIds = FOOTBALL_COMPETITIONS.map((c) => c.id);
        const filteredMatches = allMatches.filter((m: any) => targetCompIds.includes(m.competition?.code));

        // Pre-fetch standings per competition (one call per competition, cached)
        const standingsCache: Record<string, any> = {};
        const uniqueComps = [...new Set(filteredMatches.map((m: any) => m.competition?.code))];

        for (const compCode of uniqueComps) {
          try {
            const standRes = await fetch(
              `https://api.football-data.org/v4/competitions/${compCode}/standings`,
              { headers: { "X-Auth-Token": footballApiKey } }
            );
            if (standRes.ok) {
              const standData = await standRes.json();
              standingsCache[compCode] = standData;
            }
            // Rate limit: 10 req/min → 6s between calls
            await sleep(6500);
          } catch (e) {
            console.warn(`Standings fetch failed for ${compCode}:`, e);
          }
        }

        // Pre-fetch existing matches from DB to check for cached H2H data
        const externalIds = filteredMatches.map((m: any) => `football-${m.id}`);
        const { data: existingMatches } = await supabase
          .from("betting_matches")
          .select("external_id, source_data")
          .in("external_id", externalIds);
        const existingMap: Record<string, any> = {};
        for (const em of existingMatches || []) {
          existingMap[em.external_id] = em.source_data;
        }

        // Process each match
        for (const match of filteredMatches) {
          const compCode = match.competition?.code;
          const league = FOOTBALL_COMPETITIONS.find((c) => c.id === compCode)?.name || compCode;
          const homeTeam = match.homeTeam?.name || "Unknown";
          const awayTeam = match.awayTeam?.name || "Unknown";
          const externalId = `football-${match.id}`;
          const matchDate = match.utcDate;
          const matchId = match.id;

          // --- H2H: only fetch if not already cached ---
          const cachedSource = existingMap[externalId] as any;
          let h2hData: any = cachedSource?.h2h || null;

          if (!h2hData) {
            try {
              const h2hRes = await fetch(
                `https://api.football-data.org/v4/matches/${matchId}/head2head?limit=5`,
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
                    score: hg !== null ? `${hg}-${ag}` : null,
                    winner,
                  };
                });
                h2hData = {
                  matches: recentMeetings,
                  homeTeamWins: homeWins,
                  awayTeamWins: awayWins,
                  draws,
                  totalMeetings: h2hMatches.length,
                };
              }
              await sleep(6500);
            } catch (e) {
              console.warn(`H2H fetch failed for match ${matchId}:`, e);
            }
          }

          // --- STANDINGS: extract from cache ---
          let homeStanding: any = null;
          let awayStanding: any = null;
          if (standingsCache[compCode]) {
            const standings = standingsCache[compCode];
            // Usually standings[0] is the total table
            const table = standings.standings?.find((s: any) => s.type === "TOTAL")?.table || [];
            const homeTeamId = match.homeTeam?.id;
            const awayTeamId = match.awayTeam?.id;
            homeStanding = table.find((row: any) => row.team?.id === homeTeamId) || null;
            awayStanding = table.find((row: any) => row.team?.id === awayTeamId) || null;
          }

          // --- GNews articles (use cached if available and < 6h old) ---
          let newsArticles: any[] = cachedSource?.news || [];
          const newsFetchedAt = cachedSource?.fetched_at ? new Date(cachedSource.fetched_at).getTime() : 0;
          const sixHoursMs = 6 * 60 * 60 * 1000;
          const newsStale = !newsArticles.length || (Date.now() - newsFetchedAt > sixHoursMs);

          if (gnewsApiKey && newsStale) {
            try {
              const query = encodeURIComponent(`"${homeTeam}" "${awayTeam}" injury OR lineup OR prediction`);
              const gnewsRes = await fetch(
                `https://gnews.io/api/v4/search?q=${query}&max=3&lang=en&apikey=${gnewsApiKey}`
              );
              if (gnewsRes.ok) {
                const gnewsData = await gnewsRes.json();
                newsArticles = (gnewsData.articles || []).map((a: any) => ({
                  url: a.url,
                  title: a.title,
                  date: a.publishedAt,
                  source: a.source?.name,
                  type: classifyArticle(a.title + " " + (a.description || "")),
                }));
              }
            } catch (e) {
              console.warn(`GNews failed for ${homeTeam} vs ${awayTeam}:`, e);
            }
          }

          // --- Firecrawl Search (use cached if available and < 12h old) ---
          let scrapedArticles: any[] = cachedSource?.scraped_articles || [];
          const scrapedStale = !scrapedArticles.length || (Date.now() - newsFetchedAt > 12 * 60 * 60 * 1000);

          if (firecrawlApiKey && HIGH_IMPACT_LEAGUES.includes(league) && scrapedStale) {
            // Check daily budget
            const todayStr = new Date().toISOString().split("T")[0];
            const { data: budgetData } = await supabase
              .from("betting_matches")
              .select("source_data")
              .eq("status", "budget_tracker")
              .eq("external_id", `budget-fc-${todayStr}`)
              .single();

            const searchesUsed = (budgetData?.source_data as any)?.searches_used || 0;
            const DAILY_SEARCH_BUDGET = 30;

            if (searchesUsed < DAILY_SEARCH_BUDGET) {
              const matchYear = new Date(matchDate).getFullYear();
              const searchQuery = `${homeTeam} vs ${awayTeam} ${league} ${matchYear} preview prediction`;

              try {
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
                  if (fcData.success && fcData.data) {
                    scrapedArticles = fcData.data.map((item: any) => ({
                      url: item.url,
                      title: item.title || item.metadata?.title || "",
                      description: item.description || item.metadata?.description || "",
                      markdown: item.markdown ? item.markdown.substring(0, 1500) : "",
                      source: "firecrawl_search",
                    }));

                    await supabase.from("betting_matches").upsert(
                      {
                        external_id: `budget-fc-${todayStr}`,
                        sport: "system",
                        home_team: "budget",
                        away_team: "tracker",
                        league: "system",
                        match_date: new Date().toISOString(),
                        status: "budget_tracker",
                        source_data: {
                          searches_used: searchesUsed + 3,
                          last_updated: new Date().toISOString(),
                        },
                      },
                      { onConflict: "external_id" }
                    );
                  }
                }
              } catch (e) {
                console.warn(`Firecrawl search failed for ${homeTeam} vs ${awayTeam}:`, e);
              }
            }
          }

          const sourceData = {
            football_data: {
              id: match.id,
              competition: match.competition,
              stage: match.stage,
              status: match.status,
            },
            h2h: h2hData,
            standings: homeStanding || awayStanding ? {
              home: homeStanding ? {
                position: homeStanding.position,
                points: homeStanding.points,
                playedGames: homeStanding.playedGames,
                won: homeStanding.won,
                draw: homeStanding.draw,
                lost: homeStanding.lost,
                goalsFor: homeStanding.goalsFor,
                goalsAgainst: homeStanding.goalsAgainst,
                goalDifference: homeStanding.goalDifference,
                form: homeStanding.form,
              } : null,
              away: awayStanding ? {
                position: awayStanding.position,
                points: awayStanding.points,
                playedGames: awayStanding.playedGames,
                won: awayStanding.won,
                draw: awayStanding.draw,
                lost: awayStanding.lost,
                goalsFor: awayStanding.goalsFor,
                goalsAgainst: awayStanding.goalsAgainst,
                goalDifference: awayStanding.goalDifference,
                form: awayStanding.form,
              } : null,
            } : null,
            news: newsArticles,
            scraped_articles: scrapedArticles,
            fetched_at: new Date().toISOString(),
          };

          const { error } = await supabase.from("betting_matches").upsert(
            {
              external_id: externalId,
              sport: "football",
              home_team: homeTeam,
              away_team: awayTeam,
              league,
              match_date: matchDate,
              status: mapMatchStatus(match.status),
              home_score: match.score?.fullTime?.home ?? null,
              away_score: match.score?.fullTime?.away ?? null,
              source_data: sourceData,
            },
            { onConflict: "external_id" }
          );

          if (error) {
            errors.push(`${homeTeam} vs ${awayTeam}: ${error.message}`);
          } else {
            inserted++;
          }
        }
      }
    }

    if (sport === "ufc" || sport === "all") {
      if (gnewsApiKey) {
        try {
          const query = encodeURIComponent(`"UFC" fight card event next week OR upcoming`);
          const gnewsRes = await fetch(
            `https://gnews.io/api/v4/search?q=${query}&max=10&lang=en&apikey=${gnewsApiKey}`
          );
          if (gnewsRes.ok) {
            const gnewsData = await gnewsRes.json();
            const articles = gnewsData.articles || [];
            const ufcMatches = extractUFCMatches(articles);

            for (const uMatch of ufcMatches) {
              const externalId = `ufc-${uMatch.fighter1.toLowerCase().replace(/\s/g, "-")}-vs-${uMatch.fighter2.toLowerCase().replace(/\s/g, "-")}`;
              const { error } = await supabase.from("betting_matches").upsert(
                {
                  external_id: externalId,
                  sport: "ufc",
                  home_team: uMatch.fighter1,
                  away_team: uMatch.fighter2,
                  league: uMatch.event || "UFC",
                  match_date: uMatch.date || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                  status: "upcoming",
                  source_data: {
                    news: uMatch.articles,
                    fetched_at: new Date().toISOString(),
                  },
                },
                { onConflict: "external_id" }
              );
              if (!error) inserted++;
            }
          }
        } catch (e) {
          errors.push(`UFC GNews failed: ${e}`);
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, sport, inserted, updated, errors: errors.length > 0 ? errors : undefined }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("fetch-matches error:", error);
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

function mapMatchStatus(status: string): string {
  const map: Record<string, string> = {
    SCHEDULED: "upcoming", TIMED: "upcoming", IN_PLAY: "live", PAUSED: "live",
    FINISHED: "finished", SUSPENDED: "upcoming", POSTPONED: "upcoming",
    CANCELLED: "upcoming", AWARDED: "finished",
  };
  return map[status] || "upcoming";
}

function extractUFCMatches(articles: any[]): any[] {
  const matches: any[] = [];
  const seen = new Set<string>();
  const vsPattern = /([A-Z][a-z]+ [A-Z][a-z]+)\s+vs\.?\s+([A-Z][a-z]+ [A-Z][a-z]+)/g;

  for (const article of articles) {
    const text = `${article.title} ${article.description || ""}`;
    let match;
    while ((match = vsPattern.exec(text)) !== null) {
      const fighter1 = match[1];
      const fighter2 = match[2];
      const key = [fighter1, fighter2].sort().join("-");
      if (!seen.has(key)) {
        seen.add(key);
        const eventMatch = text.match(/UFC\s+(?:Fight Night|[0-9]+|on ESPN)/i);
        matches.push({
          fighter1, fighter2,
          event: eventMatch ? eventMatch[0] : "UFC",
          date: article.publishedAt
            ? new Date(new Date(article.publishedAt).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
            : null,
          articles: [{ url: article.url, title: article.title, date: article.publishedAt, type: "news" }],
        });
      }
    }
  }
  return matches.slice(0, 5);
}
