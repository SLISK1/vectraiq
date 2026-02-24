import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-call",
};

// Same league → sport key mapping as analyze-match
const SPORT_ODDS_KEY: Record<string, string> = {
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
  "Championship": "soccer_efl_champ",
  football: "soccer_epl",
  ufc: "mma_mixed_martial_arts",
};

function normalize(s: string) {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const isInternal = req.headers.get("x-internal-call") === "true";
    const authHeader = req.headers.get("authorization");
    if (!isInternal && !authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const oddsApiKey = Deno.env.get("ODDS_API_KEY");
    if (!oddsApiKey) {
      return new Response(
        JSON.stringify({ error: "ODDS_API_KEY not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const now = new Date();
    const threeHoursFromNow = new Date(now.getTime() + 3 * 60 * 60 * 1000);

    // Find upcoming matches within 3 hours that don't have closing odds yet
    const { data: matches, error: matchErr } = await supabase
      .from("betting_matches")
      .select("id, home_team, away_team, league, sport, match_date")
      .eq("status", "upcoming")
      .is("closing_odds_home", null)
      .gt("match_date", now.toISOString())
      .lt("match_date", threeHoursFromNow.toISOString())
      .limit(30);

    if (matchErr) {
      console.error("Error fetching matches:", matchErr);
      return new Response(JSON.stringify({ error: matchErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!matches || matches.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          updated: 0,
          message: "No matches within 3h window needing closing odds",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(
      `fetch-closing-odds: ${matches.length} matches within 3h window`
    );

    // Group matches by league/sport key to minimize API calls
    const leagueGroups = new Map<string, typeof matches>();
    for (const m of matches) {
      const sportKey =
        SPORT_ODDS_KEY[m.league] || SPORT_ODDS_KEY[m.sport] || null;
      if (!sportKey) {
        console.log(`No sport key mapping for league: ${m.league}`);
        continue;
      }
      if (!leagueGroups.has(sportKey)) leagueGroups.set(sportKey, []);
      leagueGroups.get(sportKey)!.push(m);
    }

    let updated = 0;
    const errors: string[] = [];

    for (const [sportKey, groupMatches] of leagueGroups) {
      try {
        const oddsRes = await fetch(
          `https://api.the-odds-api.com/v4/sports/${sportKey}/odds?apiKey=${oddsApiKey}&regions=eu&markets=h2h&oddsFormat=decimal`
        );

        if (!oddsRes.ok) {
          errors.push(`Odds API ${sportKey}: ${oddsRes.status}`);
          continue;
        }

        const oddsData = await oddsRes.json();

        for (const match of groupMatches) {
          const normHome = normalize(match.home_team);
          const normAway = normalize(match.away_team);

          // Find matching event in odds data
          for (const event of oddsData) {
            const eHome = normalize(event.home_team || "");
            const eAway = normalize(event.away_team || "");

            if (
              (eHome.includes(normHome.substring(0, 5)) ||
                normHome.includes(eHome.substring(0, 5))) &&
              (eAway.includes(normAway.substring(0, 5)) ||
                normAway.includes(eAway.substring(0, 5)))
            ) {
              // Prefer Pinnacle (sharpest line), fallback to first bookmaker
              const bookmaker =
                event.bookmakers?.find(
                  (b: any) => b.key === "pinnacle"
                ) || event.bookmakers?.[0];
              if (!bookmaker) continue;

              const h2hMarket = bookmaker.markets?.find(
                (m: any) => m.key === "h2h"
              );
              if (!h2hMarket) continue;

              const outcomes = h2hMarket.outcomes || [];
              const homeOdds = outcomes.find(
                (o: any) => normalize(o.name) === eHome
              )?.price;
              const awayOdds = outcomes.find(
                (o: any) => normalize(o.name) === eAway
              )?.price;
              const drawOdds = outcomes.find(
                (o: any) => o.name.toLowerCase() === "draw"
              )?.price;

              if (!homeOdds || !awayOdds) continue;

              const { error: updateErr } = await supabase
                .from("betting_matches")
                .update({
                  closing_odds_home: homeOdds,
                  closing_odds_draw: drawOdds || null,
                  closing_odds_away: awayOdds,
                  closing_odds_fetched_at: now.toISOString(),
                })
                .eq("id", match.id);

              if (!updateErr) {
                updated++;
                console.log(
                  `Closing odds saved: ${match.home_team} vs ${match.away_team} → H:${homeOdds} D:${drawOdds} A:${awayOdds}`
                );
              } else {
                errors.push(
                  `Update ${match.id}: ${updateErr.message}`
                );
              }
              break; // found match, move to next
            }
          }
        }
      } catch (e) {
        errors.push(`${sportKey}: ${String(e)}`);
      }
    }

    console.log(
      `fetch-closing-odds: updated ${updated}/${matches.length} matches`
    );

    return new Response(
      JSON.stringify({
        success: true,
        updated,
        total_matches: matches.length,
        leagues_queried: leagueGroups.size,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("fetch-closing-odds error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
