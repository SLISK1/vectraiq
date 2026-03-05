import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Settle a single prediction row given FT and HT scores
function settlePrediction(
  market: string,
  selection: string | null,
  line: number | null,
  ftHome: number,
  ftAway: number,
  htHome: number | null,
  htAway: number | null,
  matchStats: { corners?: number; cards?: number } | null,
): { bet_outcome: string; actual_value: number | null } {
  switch (market) {
    case "1X2": {
      let outcome: string;
      if (ftHome > ftAway) outcome = "home";
      else if (ftAway > ftHome) outcome = "away";
      else outcome = "draw";
      const win = outcome === selection;
      return { bet_outcome: win ? "win" : "loss", actual_value: null };
    }

    case "OU_GOALS": {
      const total = ftHome + ftAway;
      if (line === null) return { bet_outcome: "void", actual_value: total };
      if (total === line) return { bet_outcome: "push", actual_value: total };
      const over = total > line;
      const win = (selection === "over" && over) || (selection === "under" && !over);
      return { bet_outcome: win ? "win" : "loss", actual_value: total };
    }

    case "BTTS": {
      const both = ftHome > 0 && ftAway > 0;
      const win = (selection === "yes" && both) || (selection === "no" && !both);
      return { bet_outcome: win ? "win" : "loss", actual_value: both ? 1 : 0 };
    }

    case "HT_OU_GOALS": {
      if (htHome === null || htAway === null) {
        return { bet_outcome: "void", actual_value: null };
      }
      const htTotal = htHome + htAway;
      if (line === null) return { bet_outcome: "void", actual_value: htTotal };
      if (htTotal === line) return { bet_outcome: "push", actual_value: htTotal };
      const over = htTotal > line;
      const win = (selection === "over" && over) || (selection === "under" && !over);
      return { bet_outcome: win ? "win" : "loss", actual_value: htTotal };
    }

    case "CORNERS_OU": {
      if (!matchStats || matchStats.corners === undefined) {
        return { bet_outcome: "void", actual_value: null };
      }
      const corners = matchStats.corners;
      const effectiveLine = line ?? 9.5;
      if (corners === effectiveLine) return { bet_outcome: "push", actual_value: corners };
      const over = corners > effectiveLine;
      const win = (selection === "over" && over) || (selection === "under" && !over);
      return { bet_outcome: win ? "win" : "loss", actual_value: corners };
    }

    case "CARDS_OU": {
      if (!matchStats || matchStats.cards === undefined) {
        return { bet_outcome: "void", actual_value: null };
      }
      const cards = matchStats.cards;
      const effectiveLine = line ?? 3.5;
      if (cards === effectiveLine) return { bet_outcome: "push", actual_value: cards };
      const over = cards > effectiveLine;
      const win = (selection === "over" && over) || (selection === "under" && !over);
      return { bet_outcome: win ? "win" : "loss", actual_value: cards };
    }

    case "FIRST_TO_SCORE":
      return { bet_outcome: "void", actual_value: null };

    default:
      return { bet_outcome: "void", actual_value: null };
  }
}

// Fetch match stats (corners/cards) via fetch-match-stats edge function, with caching
async function getMatchStats(
  supabase: any,
  match: any,
  firecrawlCallsUsed: { count: number },
  maxFirecrawlCalls: number,
): Promise<{ corners?: number; cards?: number } | null> {
  const cacheKey = `match_stats:${match.id}`;

  // Check api_cache first
  const { data: cached } = await supabase
    .from("api_cache")
    .select("payload, fetched_at, ttl_seconds")
    .eq("cache_key", cacheKey)
    .maybeSingle();

  if (cached) {
    const expiresAt = new Date(cached.fetched_at).getTime() + (cached.ttl_seconds * 1000);
    if (Date.now() < expiresAt) {
      return cached.payload as { corners?: number; cards?: number };
    }
  }

  // Check source_data for cached stats
  const sourceData = (match.source_data || {}) as Record<string, any>;
  if (sourceData.ft_corners !== undefined || sourceData.ft_cards !== undefined) {
    const stats = {
      corners: sourceData.ft_corners !== undefined ? Number(sourceData.ft_corners) : undefined,
      cards: sourceData.ft_cards !== undefined ? Number(sourceData.ft_cards) : undefined,
    };
    // Cache it
    await supabase.from("api_cache").upsert({
      cache_key: cacheKey,
      payload: stats,
      ttl_seconds: 86400,
      provider: "source_data",
    }, { onConflict: "cache_key" });
    return stats;
  }

  // Rate limit Firecrawl calls
  if (firecrawlCallsUsed.count >= maxFirecrawlCalls) return null;

  const firecrawlApiKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!firecrawlApiKey) return null;

  firecrawlCallsUsed.count++;

  try {
    const query = `${match.home_team} vs ${match.away_team} match statistics corners cards yellow red`;
    const res = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${firecrawlApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, limit: 2 }),
    });

    if (!res.ok) {
      console.warn(`Firecrawl search failed: ${res.status}`);
      return null;
    }

    const searchData = await res.json();
    const results = searchData.data || searchData.results || [];

    let corners: number | undefined;
    let cards: number | undefined;

    for (const result of results) {
      const text = (result.markdown || result.description || result.content || "").toLowerCase();

      // Parse corners: look for "corners" followed by numbers
      if (corners === undefined) {
        const cornerMatch = text.match(/corners?\s*[:\-–]\s*(\d+)\s*[:\-–]\s*(\d+)/i) ||
          text.match(/(\d+)\s*corners?\s*(?:total|$)/i);
        if (cornerMatch) {
          if (cornerMatch[2]) {
            corners = parseInt(cornerMatch[1]) + parseInt(cornerMatch[2]);
          } else {
            corners = parseInt(cornerMatch[1]);
          }
        }
      }

      // Parse cards: look for yellow/red cards
      if (cards === undefined) {
        const cardMatch = text.match(/(?:yellow|red)\s*cards?\s*[:\-–]\s*(\d+)\s*[:\-–]\s*(\d+)/i) ||
          text.match(/cards?\s*(?:total)?\s*[:\-–]\s*(\d+)/i);
        if (cardMatch) {
          if (cardMatch[2]) {
            cards = parseInt(cardMatch[1]) + parseInt(cardMatch[2]);
          } else {
            cards = parseInt(cardMatch[1]);
          }
        }
      }
    }

    const stats: { corners?: number; cards?: number } = {};
    if (corners !== undefined) stats.corners = corners;
    if (cards !== undefined) stats.cards = cards;

    // Cache results (even empty — avoid re-scraping)
    await supabase.from("api_cache").upsert({
      cache_key: cacheKey,
      payload: stats,
      ttl_seconds: 86400,
      provider: "firecrawl",
    }, { onConflict: "cache_key" });

    // Also store in source_data for future runs
    if (Object.keys(stats).length > 0) {
      await supabase
        .from("betting_matches")
        .update({
          source_data: {
            ...sourceData,
            ...(stats.corners !== undefined ? { ft_corners: stats.corners } : {}),
            ...(stats.cards !== undefined ? { ft_cards: stats.cards } : {}),
          },
        })
        .eq("id", match.id);
    }

    return Object.keys(stats).length > 0 ? stats : null;
  } catch (e) {
    console.warn(`Firecrawl match stats failed for ${match.id}:`, e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const footballApiKey = Deno.env.get("FOOTBALL_DATA_API_KEY");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find unsettled prediction rows
    const { data: unsettledPreds, error: predsErr } = await supabase
      .from("betting_predictions")
      .select("id, match_id, market, selection, line, predicted_prob")
      .is("bet_outcome", null)
      .order("match_id");

    if (predsErr) throw predsErr;
    if (!unsettledPreds || unsettledPreds.length === 0) {
      return new Response(
        JSON.stringify({ success: true, settled: 0, message: "No unsettled predictions" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const matchIds = [...new Set(unsettledPreds.map((p: any) => p.match_id))];

    const { data: matches, error: matchErr } = await supabase
      .from("betting_matches")
      .select("id, external_id, home_score, away_score, status, source_data, home_team, away_team")
      .in("id", matchIds);

    if (matchErr) throw matchErr;

    const finishedMatches = (matches || []).filter((m: any) => {
      return m.home_score !== null && m.away_score !== null;
    });

    if (finishedMatches.length === 0) {
      return new Response(
        JSON.stringify({ success: true, settled: 0, message: "No finished matches with scores" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // HT scores — limit to 5 API calls per execution
    const htScores = new Map<string, { home: number; away: number } | null>();
    let htCallCount = 0;
    const MAX_HT_CALLS = 5;

    for (const match of finishedMatches) {
      const sourceData = (match.source_data as any) || {};
      if (sourceData.ht_home !== undefined && sourceData.ht_away !== undefined) {
        htScores.set(match.id, { home: sourceData.ht_home, away: sourceData.ht_away });
        continue;
      }

      const needsHt = unsettledPreds.some(
        (p: any) => p.match_id === match.id && p.market === "HT_OU_GOALS",
      );

      const externalId = match.external_id || "";
      const fdMatchId = externalId.startsWith("football-")
        ? externalId.replace("football-", "")
        : null;

      if (!needsHt || !footballApiKey || !fdMatchId || htCallCount >= MAX_HT_CALLS) {
        htScores.set(match.id, null);
        continue;
      }

      htCallCount++;
      try {
        const res = await fetch(
          `https://api.football-data.org/v4/matches/${fdMatchId}`,
          { headers: { "X-Auth-Token": footballApiKey } },
        );
        if (res.ok) {
          const data = await res.json();
          const ht = data.score?.halfTime;
          if (ht && ht.home !== null && ht.away !== null) {
            htScores.set(match.id, { home: ht.home, away: ht.away });
            await supabase
              .from("betting_matches")
              .update({
                source_data: { ...sourceData, ht_home: ht.home, ht_away: ht.away },
              })
              .eq("id", match.id);
          } else {
            htScores.set(match.id, null);
          }
        } else {
          htScores.set(match.id, null);
        }
      } catch (e) {
        console.warn(`HT fetch failed for match ${match.id}:`, e);
        htScores.set(match.id, null);
      }
      await new Promise((r) => setTimeout(r, 6500));
    }

    // Fetch match stats (corners/cards) for matches that need them
    const matchStatsCache = new Map<string, { corners?: number; cards?: number } | null>();
    const firecrawlCallsUsed = { count: 0 };
    const MAX_FIRECRAWL_CALLS = 5;

    for (const match of finishedMatches) {
      const needsStats = unsettledPreds.some(
        (p: any) => p.match_id === match.id && (p.market === "CORNERS_OU" || p.market === "CARDS_OU"),
      );

      if (!needsStats) {
        matchStatsCache.set(match.id, null);
        continue;
      }

      const stats = await getMatchStats(supabase, match, firecrawlCallsUsed, MAX_FIRECRAWL_CALLS);
      matchStatsCache.set(match.id, stats);
    }

    // Settle predictions — separated from calibration updates
    const finishedMatchMap = new Map(finishedMatches.map((m: any) => [m.id, m]));
    let settledCount = 0;
    const settlementUpdates: Array<PromiseLike<unknown>> = [];
    const calibrationUpdates: Array<PromiseLike<unknown>> = [];

    for (const pred of unsettledPreds) {
      const match = finishedMatchMap.get(pred.match_id);
      if (!match) continue;

      const ftHome = match.home_score as number;
      const ftAway = match.away_score as number;
      const ht = htScores.get(pred.match_id);
      const htHome = ht?.home ?? null;
      const htAway = ht?.away ?? null;
      const matchStats = matchStatsCache.get(pred.match_id) ?? null;

      const { bet_outcome, actual_value } = settlePrediction(
        pred.market,
        pred.selection,
        pred.line,
        ftHome,
        ftAway,
        htHome,
        htAway,
        matchStats,
      );

      settlementUpdates.push(
        supabase
          .from("betting_predictions")
          .update({
            bet_outcome,
            actual_value,
            settled_at: new Date().toISOString(),
          } as any)
          .eq("id", pred.id)
          .then(),
      );

      // Queue calibration update (non-blocking)
      if (
        (pred.market === "BTTS" || pred.market === "OU_GOALS" || pred.market === "CORNERS_OU" || pred.market === "CARDS_OU") &&
        (bet_outcome === "win" || bet_outcome === "loss") &&
        pred.predicted_prob !== null && pred.predicted_prob !== undefined
      ) {
        const bucketIdx = Math.min(9, Math.floor(Number(pred.predicted_prob) * 10));
        calibrationUpdates.push(
          supabase.rpc("upsert_betting_cal_bucket", {
            p_market: pred.market,
            p_bucket_idx: bucketIdx,
            p_n_bets_delta: 1,
            p_n_wins_delta: bet_outcome === "win" ? 1 : 0,
          }),
        );
      }

      settledCount++;
    }

    // Step 1: Settle all predictions
    await Promise.all(settlementUpdates);

    // Step 2: Update calibration (non-blocking — don't crash if RPC fails)
    if (calibrationUpdates.length > 0) {
      try {
        await Promise.all(calibrationUpdates);
      } catch (e) {
        console.warn("Calibration update failed (non-blocking):", e);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        settled: settledCount,
        firecrawl_calls: firecrawlCallsUsed.count,
        ht_calls: htCallCount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("betting-settle error:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
