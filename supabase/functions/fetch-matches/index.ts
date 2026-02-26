import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Football-data.org competition IDs
const FOOTBALL_COMPETITIONS = [
  { id: "PL",  name: "Premier League" },
  { id: "PD",  name: "La Liga" },
  { id: "BL1", name: "Bundesliga" },
  { id: "SA",  name: "Serie A" },
  { id: "FL1", name: "Ligue 1" },
  { id: "CL",  name: "Champions League" },
  { id: "EL",  name: "Europa League" },
  { id: "SE",  name: "Allsvenskan" },
];

const HIGH_IMPACT_LEAGUES = [
  "Premier League", "La Liga", "Champions League",
  "Europa League", "Bundesliga", "Serie A",
];

// NOTE: H2H and standings are intentionally NOT fetched here.
// They are fetched (with caching) inside analyze-match when needed.
// Fetching them here caused 4+ minute timeouts (6.5s sleep × 40+ API calls).

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

    const supabaseUrl            = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const isServiceRole          = authHeader === `Bearer ${supabaseServiceKey}`;

    if (!isServiceRole) {
      const supabaseAuth = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { error: authError } = await supabaseAuth.auth.getUser(
        authHeader.replace("Bearer ", "")
      );
      if (authError) {
        return new Response(JSON.stringify({ error: "Invalid token" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const supabase         = createClient(supabaseUrl, supabaseServiceKey);
    const footballApiKey   = Deno.env.get("FOOTBALL_DATA_API_KEY");
    const gnewsApiKey      = Deno.env.get("GNEWS_API_KEY");
    const firecrawlApiKey  = Deno.env.get("FIRECRAWL_API_KEY");

    const body   = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const sport  = body.sport || "football";

    let inserted = 0;
    let updated  = 0;
    const errors: string[] = [];

    // ── FOOTBALL ─────────────────────────────────────────────────────────────
    if (sport === "football" || sport === "all") {
      if (!footballApiKey) {
        // Surface this clearly instead of silently returning 0 matches
        return new Response(
          JSON.stringify({
            success: false,
            error:
              "FOOTBALL_DATA_API_KEY är inte satt i Supabase Secrets. " +
              "Gå till Project Settings → Edge Functions → Secrets och lägg till nyckeln.",
            inserted: 0,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const today    = new Date();
      const daysBack = body.days_back || 7;
      const dateFrom = new Date(today.getTime() - daysBack * 24 * 60 * 60 * 1000)
        .toISOString().split("T")[0];
      // Always fetch at least 8 days ahead so the full coming weekend is visible
      const daysAhead = body.days_ahead || 8;
      const dateTo = new Date(today.getTime() + daysAhead * 24 * 60 * 60 * 1000)
        .toISOString().split("T")[0];

      console.log(`Fetching football matches ${dateFrom} → ${dateTo}`);

      // ── Single API call: all matches for the date range ──────────────────
      let allMatches: any[] = [];
      try {
        const response = await fetch(
          `https://api.football-data.org/v4/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`,
          { headers: { "X-Auth-Token": footballApiKey } }
        );
        if (response.ok) {
          const data = await response.json();
          allMatches = data.matches || [];
          console.log(`API returned ${allMatches.length} total matches`);
        } else {
          const errBody = await response.text();
          errors.push(`Football API HTTP ${response.status}: ${errBody}`);
        }
      } catch (e) {
        errors.push(`Football fetch failed: ${e}`);
      }

      const targetCompIds   = FOOTBALL_COMPETITIONS.map((c) => c.id);
      const filteredMatches = allMatches.filter(
        (m: any) => targetCompIds.includes(m.competition?.code)
      );
      console.log(`${filteredMatches.length} matches in target competitions`);

      // ── Pre-fetch existing source_data for news/scrape caching ───────────
      const externalIds = filteredMatches.map((m: any) => `football-${m.id}`);
      const { data: existingMatches } = await supabase
        .from("betting_matches")
        .select("external_id, source_data")
        .in("external_id", externalIds);
      const existingMap: Record<string, any> = {};
      for (const em of existingMatches || []) {
        existingMap[em.external_id] = em.source_data;
      }

      // ── Process each match (no H2H, no standings — those live in analyze-match) ──
      for (const match of filteredMatches) {
        const compCode   = match.competition?.code;
        const league     = FOOTBALL_COMPETITIONS.find((c) => c.id === compCode)?.name || compCode;
        const homeTeam   = match.homeTeam?.name || "Unknown";
        const awayTeam   = match.awayTeam?.name || "Unknown";
        const externalId = `football-${match.id}`;
        const matchDate  = match.utcDate;

        const cachedSource = existingMap[externalId] as any;

        // ── GNews (cached 6 h) ───────────────────────────────────────────
        let newsArticles: any[] = cachedSource?.news || [];
        const newsFetchedAt     = cachedSource?.fetched_at
          ? new Date(cachedSource.fetched_at).getTime() : 0;
        const newsStale = !newsArticles.length ||
          Date.now() - newsFetchedAt > 6 * 60 * 60 * 1000;

        if (gnewsApiKey && newsStale) {
          try {
            const query    = encodeURIComponent(
              `"${homeTeam}" "${awayTeam}" injury OR lineup OR prediction`
            );
            const gnewsRes = await fetch(
              `https://gnews.io/api/v4/search?q=${query}&max=3&lang=en&apikey=${gnewsApiKey}`
            );
            if (gnewsRes.ok) {
              const gnewsData = await gnewsRes.json();
              newsArticles = (gnewsData.articles || []).map((a: any) => ({
                url:    a.url,
                title:  a.title,
                date:   a.publishedAt,
                source: a.source?.name,
                type:   classifyArticle(a.title + " " + (a.description || "")),
              }));
            }
          } catch (e) {
            console.warn(`GNews failed for ${homeTeam} vs ${awayTeam}:`, e);
          }
        }

        // ── Firecrawl search (cached 12 h, budget-limited) ───────────────
        let scrapedArticles: any[] = cachedSource?.scraped_articles || [];
        const scrapedStale = !scrapedArticles.length ||
          Date.now() - newsFetchedAt > 12 * 60 * 60 * 1000;

        if (firecrawlApiKey && HIGH_IMPACT_LEAGUES.includes(league) && scrapedStale) {
          const todayStr           = new Date().toISOString().split("T")[0];
          const { data: budgetData } = await supabase
            .from("api_usage_tracker")
            .select("searches_used")
            .eq("category", "betting")
            .eq("date_key", todayStr)
            .single();

          const searchesUsed    = budgetData?.searches_used || 0;
          const DAILY_BUDGET    = 15;

          if (searchesUsed < DAILY_BUDGET) {
            const matchYear   = new Date(matchDate).getFullYear();
            const searchQuery = `${homeTeam} vs ${awayTeam} ${league} ${matchYear} preview prediction`;
            try {
              const fcRes = await fetch("https://api.firecrawl.dev/v1/search", {
                method:  "POST",
                headers: {
                  Authorization:  `Bearer ${firecrawlApiKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  query:         searchQuery,
                  limit:         3,
                  scrapeOptions: { formats: ["markdown"] },
                }),
              });
              if (fcRes.ok) {
                const fcData = await fcRes.json();
                if (fcData.success && fcData.data) {
                  scrapedArticles = fcData.data.map((item: any) => ({
                    url:         item.url,
                    title:       item.title || item.metadata?.title || "",
                    description: item.description || item.metadata?.description || "",
                    markdown:    item.markdown ? item.markdown.substring(0, 1500) : "",
                    source:      "firecrawl_search",
                  }));
                  await supabase.from("api_usage_tracker").upsert(
                    {
                      category:      "betting",
                      date_key:      todayStr,
                      searches_used: searchesUsed + 3,
                      last_updated:  new Date().toISOString(),
                    },
                    { onConflict: "category,date_key" }
                  );
                }
              }
            } catch (e) {
              console.warn(`Firecrawl failed for ${homeTeam} vs ${awayTeam}:`, e);
            }
          }
        }

        // ── source_data: basic match info + news (H2H/standings added by analyze-match) ──
        const sourceData = {
          football_data: {
            id:          match.id,
            competition: match.competition,
            stage:       match.stage,
            status:      match.status,
            // Include raw form/score data from the match response
            homeTeam:    match.homeTeam,
            awayTeam:    match.awayTeam,
            odds:        match.odds || null,
          },
          // H2H and standings are fetched lazily by analyze-match
          h2h:              cachedSource?.h2h              || null,
          standings:        cachedSource?.standings        || null,
          news:             newsArticles,
          scraped_articles: scrapedArticles,
          fetched_at:       new Date().toISOString(),
        };

        const { error } = await supabase.from("betting_matches").upsert(
          {
            external_id:  externalId,
            sport:        "football",
            home_team:    homeTeam,
            away_team:    awayTeam,
            league,
            match_date:   matchDate,
            status:       mapMatchStatus(match.status),
            home_score:   match.score?.fullTime?.home ?? null,
            away_score:   match.score?.fullTime?.away ?? null,
            source_data:  sourceData,
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

    // ── UFC ───────────────────────────────────────────────────────────────────
    if (sport === "ufc" || sport === "all") {
      if (gnewsApiKey) {
        try {
          const query    = encodeURIComponent(`"UFC" fight card event next week OR upcoming`);
          const gnewsRes = await fetch(
            `https://gnews.io/api/v4/search?q=${query}&max=10&lang=en&apikey=${gnewsApiKey}`
          );
          if (gnewsRes.ok) {
            const gnewsData = await gnewsRes.json();
            const articles  = gnewsData.articles || [];
            const ufcMatches = extractUFCMatches(articles);

            for (const uMatch of ufcMatches) {
              const externalId = `ufc-${uMatch.fighter1.toLowerCase().replace(/\s/g, "-")}-vs-${uMatch.fighter2.toLowerCase().replace(/\s/g, "-")}`;
              const { error } = await supabase.from("betting_matches").upsert(
                {
                  external_id: externalId,
                  sport:       "ufc",
                  home_team:   uMatch.fighter1,
                  away_team:   uMatch.fighter2,
                  league:      uMatch.event || "UFC",
                  match_date:  uMatch.date ||
                    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                  status:      "upcoming",
                  source_data: {
                    news:       uMatch.articles,
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
  if (lower.includes("tips") || lower.includes("prediction") ||
      lower.includes("expert") || lower.includes("odds on")) return "opinion";
  if (lower.includes("injury") || lower.includes("lineup") ||
      lower.includes("confirmed") || lower.includes("training")) return "confirmed_fact";
  if (lower.includes("statistics") || lower.includes("head to head") ||
      lower.includes("form") || lower.includes("h2h")) return "stats";
  return "news";
}

function mapMatchStatus(status: string): string {
  const map: Record<string, string> = {
    SCHEDULED:  "upcoming",
    TIMED:      "upcoming",
    IN_PLAY:    "live",
    PAUSED:     "live",
    FINISHED:   "finished",
    SUSPENDED:  "upcoming",
    POSTPONED:  "upcoming",
    CANCELLED:  "upcoming",
    AWARDED:    "finished",
  };
  return map[status] || "upcoming";
}

function extractUFCMatches(articles: any[]): any[] {
  const matches: any[] = [];
  const seen            = new Set<string>();
  const vsPattern       = /([A-Z][a-z]+ [A-Z][a-z]+)\s+vs\.?\s+([A-Z][a-z]+ [A-Z][a-z]+)/g;

  for (const article of articles) {
    const text = `${article.title} ${article.description || ""}`;
    let match;
    while ((match = vsPattern.exec(text)) !== null) {
      const fighter1 = match[1];
      const fighter2 = match[2];
      const key      = [fighter1, fighter2].sort().join("-");
      if (!seen.has(key)) {
        seen.add(key);
        const eventMatch = text.match(/UFC\s+(?:Fight Night|[0-9]+|on ESPN)/i);
        matches.push({
          fighter1,
          fighter2,
          event: eventMatch ? eventMatch[0] : "UFC",
          date:  article.publishedAt
            ? new Date(
                new Date(article.publishedAt).getTime() + 7 * 24 * 60 * 60 * 1000
              ).toISOString()
            : null,
          articles: [{ url: article.url, title: article.title, date: article.publishedAt, type: "news" }],
        });
      }
    }
  }
  return matches.slice(0, 5);
}
