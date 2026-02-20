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

const HIGH_IMPACT_LEAGUES = ["Premier League", "La Liga", "Champions League", "Europa League"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth: allow internal calls or service-role JWT
    const internalHeader = req.headers.get("x-internal-call");
    const authHeader = req.headers.get("authorization");
    if (!internalHeader && !authHeader?.includes(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "")) {
      // Allow if bearer token present (user triggered)
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
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
      // --- FOOTBALL DATA ---
      if (footballApiKey) {
        const today = new Date();
        const dateFrom = today.toISOString().split("T")[0];
        const dateTo = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

        try {
          const response = await fetch(
            `https://api.football-data.org/v4/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`,
            { headers: { "X-Auth-Token": footballApiKey } }
          );

          if (response.ok) {
            const data = await response.json();
            const matches = data.matches || [];

            // Filter to our target competitions
            const targetCompIds = FOOTBALL_COMPETITIONS.map((c) => c.id);

            for (const match of matches) {
              const compCode = match.competition?.code;
              if (!targetCompIds.includes(compCode)) continue;

              const league = FOOTBALL_COMPETITIONS.find((c) => c.id === compCode)?.name || compCode;
              const homeTeam = match.homeTeam?.name || "Unknown";
              const awayTeam = match.awayTeam?.name || "Unknown";
              const externalId = `football-${match.id}`;
              const matchDate = match.utcDate;

              // Fetch GNews articles for this match
              let newsArticles: any[] = [];
              if (gnewsApiKey) {
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

              // Firecrawl for high-impact matches (with budget control)
              let scrapedContent = null;
              if (firecrawlApiKey && HIGH_IMPACT_LEAGUES.includes(league)) {
                // Check budget before scraping
                const today = new Date().toISOString().split("T")[0];
                const { data: budgetData } = await supabase
                  .from("betting_matches")
                  .select("source_data")
                  .eq("status", "budget_tracker")
                  .eq("external_id", `budget-${today}`)
                  .single();

                const pagesUsed = budgetData?.source_data?.pages_used || 0;
                const DAILY_BUDGET = 15;

                if (pagesUsed < DAILY_BUDGET) {
                  const searchUrl = `https://www.goal.com/en/match/${homeTeam.toLowerCase().replace(/\s/g, "-")}-vs-${awayTeam.toLowerCase().replace(/\s/g, "-")}/preview`;

                  try {
                    const fcRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
                      method: "POST",
                      headers: {
                        Authorization: `Bearer ${firecrawlApiKey}`,
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({
                        url: searchUrl,
                        formats: ["markdown"],
                        onlyMainContent: true,
                      }),
                    });

                    if (fcRes.ok) {
                      const fcData = await fcRes.json();
                      if (fcData.success) {
                        scrapedContent = fcData.markdown || fcData.data?.markdown;

                        // Update budget tracker
                        await supabase.from("betting_matches").upsert(
                          {
                            external_id: `budget-${today}`,
                            sport: "system",
                            home_team: "budget",
                            away_team: "tracker",
                            league: "system",
                            match_date: new Date().toISOString(),
                            status: "budget_tracker",
                            source_data: {
                              pages_used: pagesUsed + 1,
                              last_updated: new Date().toISOString(),
                            },
                          },
                          { onConflict: "external_id" }
                        );
                      }
                    }
                  } catch (e) {
                    console.warn(`Firecrawl failed for ${homeTeam} vs ${awayTeam}:`, e);
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
                news: newsArticles,
                scraped_content: scrapedContent,
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
          } else {
            errors.push(`Football API error: ${response.status}`);
          }
        } catch (e) {
          errors.push(`Football fetch failed: ${e}`);
        }
      }
    }

    if (sport === "ufc" || sport === "all") {
      // --- UFC DATA via GNews ---
      if (gnewsApiKey) {
        try {
          const query = encodeURIComponent(`"UFC" fight card event next week OR upcoming`);
          const gnewsRes = await fetch(
            `https://gnews.io/api/v4/search?q=${query}&max=10&lang=en&apikey=${gnewsApiKey}`
          );

          if (gnewsRes.ok) {
            const gnewsData = await gnewsRes.json();
            const articles = gnewsData.articles || [];

            // Extract fight info from articles
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
      JSON.stringify({
        success: true,
        sport,
        inserted,
        updated,
        errors: errors.length > 0 ? errors : undefined,
      }),
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
  if (lower.includes("tips") || lower.includes("prediction") || lower.includes("expert") || lower.includes("odds on")) {
    return "opinion";
  }
  if (lower.includes("injury") || lower.includes("lineup") || lower.includes("confirmed") || lower.includes("training")) {
    return "confirmed_fact";
  }
  if (lower.includes("statistics") || lower.includes("head to head") || lower.includes("form") || lower.includes("h2h")) {
    return "stats";
  }
  return "news";
}

function mapMatchStatus(status: string): string {
  const map: Record<string, string> = {
    SCHEDULED: "upcoming",
    TIMED: "upcoming",
    IN_PLAY: "live",
    PAUSED: "live",
    FINISHED: "finished",
    SUSPENDED: "upcoming",
    POSTPONED: "upcoming",
    CANCELLED: "upcoming",
    AWARDED: "finished",
  };
  return map[status] || "upcoming";
}

function extractUFCMatches(articles: any[]): any[] {
  const matches: any[] = [];
  const seen = new Set<string>();

  // Pattern: "Fighter1 vs Fighter2"
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
        // Try to extract event name
        const eventMatch = text.match(/UFC\s+(?:Fight Night|[0-9]+|on ESPN)/i);
        matches.push({
          fighter1,
          fighter2,
          event: eventMatch ? eventMatch[0] : "UFC",
          date: article.publishedAt
            ? new Date(new Date(article.publishedAt).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
            : null,
          articles: [
            {
              url: article.url,
              title: article.title,
              date: article.publishedAt,
              type: "news",
            },
          ],
        });
      }
    }
  }

  return matches.slice(0, 5); // Max 5 UFC matches
}
