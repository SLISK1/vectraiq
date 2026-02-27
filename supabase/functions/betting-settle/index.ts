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
      // Void if HT score is unavailable
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

    // CORNERS_OU and CARDS_OU: not available from football-data.org → void
    case "CORNERS_OU":
    case "CARDS_OU":
      return { bet_outcome: "void", actual_value: null };

    // FIRST_TO_SCORE: not determinable from score data alone → void
    case "FIRST_TO_SCORE":
      return { bet_outcome: "void", actual_value: null };

    default:
      return { bet_outcome: "void", actual_value: null };
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

    // Find finished matches that have unsettled prediction rows
    // Also fetch predicted_prob so we can update calibration buckets after settlement
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

    // Group by match_id
    const matchIds = [...new Set(unsettledPreds.map((p: any) => p.match_id))];

    // Fetch finished matches for these IDs
    const { data: matches, error: matchErr } = await supabase
      .from("betting_matches")
      .select("id, external_id, home_score, away_score, status, source_data")
      .in("id", matchIds);

    if (matchErr) throw matchErr;

    // Only process matches that are finished and have FT scores
    const finishedMatches = (matches || []).filter((m: any) => {
      const isFinished = m.status === "FINISHED" || m.status === "finished";
      const hasScore = m.home_score !== null && m.away_score !== null;
      return isFinished && hasScore;
    });

    if (finishedMatches.length === 0) {
      return new Response(
        JSON.stringify({ success: true, settled: 0, message: "No finished matches with scores" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // For each finished match, optionally fetch HT score from football-data.org
    const htScores = new Map<string, { home: number; away: number } | null>();

    for (const match of finishedMatches) {
      const externalId = match.external_id || "";
      const fdMatchId = externalId.startsWith("football-")
        ? externalId.replace("football-", "")
        : null;

      // Check if HT score is cached in source_data first
      const sourceData = (match.source_data as any) || {};
      if (
        sourceData.ht_home !== undefined && sourceData.ht_away !== undefined
      ) {
        htScores.set(match.id, {
          home: sourceData.ht_home,
          away: sourceData.ht_away,
        });
        continue;
      }

      // Does this match have HT predictions we need to settle?
      const needsHt = unsettledPreds.some(
        (p: any) => p.match_id === match.id && p.market === "HT_OU_GOALS",
      );

      if (!needsHt || !footballApiKey || !fdMatchId) {
        htScores.set(match.id, null);
        continue;
      }

      // Fetch from football-data.org
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
            // Cache it back to avoid re-fetching
            await supabase
              .from("betting_matches")
              .update({
                source_data: {
                  ...sourceData,
                  ht_home: ht.home,
                  ht_away: ht.away,
                },
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

      // Rate-limit: football-data.org allows 10 req/min
      await new Promise((r) => setTimeout(r, 6500));
    }

    // Settle each prediction row
    const finishedMatchMap = new Map(finishedMatches.map((m: any) => [m.id, m]));
    let settledCount = 0;
    const updates: Array<PromiseLike<unknown>> = [];

    for (const pred of unsettledPreds) {
      const match = finishedMatchMap.get(pred.match_id);
      if (!match) continue; // match not finished yet

      const ftHome = match.home_score as number;
      const ftAway = match.away_score as number;
      const ht = htScores.get(pred.match_id);
      const htHome = ht?.home ?? null;
      const htAway = ht?.away ?? null;

      const { bet_outcome, actual_value } = settlePrediction(
        pred.market,
        pred.selection,
        pred.line,
        ftHome,
        ftAway,
        htHome,
        htAway,
      );

      updates.push(
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

      // Update calibration bucket for markets we track (BTTS and OU_GOALS only,
      // since those are the ones with Poisson p_raw priors in analyze-match).
      // Mirrors calibration/calibrator.py update_buckets().
      if (
        (pred.market === "BTTS" || pred.market === "OU_GOALS") &&
        (bet_outcome === "win" || bet_outcome === "loss") &&
        pred.predicted_prob !== null && pred.predicted_prob !== undefined
      ) {
        const bucketIdx = Math.min(9, Math.floor(Number(pred.predicted_prob) * 10));
        updates.push(
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

    await Promise.all(updates);

    return new Response(
      JSON.stringify({ success: true, settled: settledCount }),
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
