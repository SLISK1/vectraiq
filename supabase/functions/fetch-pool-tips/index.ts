import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const pool_type = body.pool_type || "stryktipset";
    const max_rows = body.max_rows || 64;
    const budget_sek = body.budget_sek || 64;

    const firecrawlApiKey = Deno.env.get("FIRECRAWL_API_KEY");
    const gnewsApiKey = Deno.env.get("GNEWS_API_KEY");
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

    if (!firecrawlApiKey) {
      return new Response(JSON.stringify({ error: "Firecrawl API key not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Scrape Svenska Spel
    const poolUrl = pool_type === "topptipset"
      ? "https://www.svenskaspel.se/topptipset"
      : "https://www.svenskaspel.se/stryktipset";

    let poolMatches: any[] = [];
    let roundId = `${pool_type}-${new Date().toISOString().split("T")[0]}`;
    let roundName = "";

    try {
      // Try JSON extraction first
      const fcRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${firecrawlApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: poolUrl,
          formats: [
            {
              type: "json",
              schema: {
                type: "object",
                properties: {
                  round_number: { type: "string" },
                  round_name: { type: "string" },
                  deadline: { type: "string" },
                  matches: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        home_team: { type: "string" },
                        away_team: { type: "string" },
                        match_date: { type: "string" },
                        match_number: { type: "number" },
                      },
                    },
                  },
                },
              },
            },
            "markdown",
          ],
          onlyMainContent: true,
        }),
      });

      if (fcRes.ok) {
        const fcData = await fcRes.json();
        const jsonData = fcData.json || fcData.data?.json;
        const markdown = fcData.markdown || fcData.data?.markdown || "";

        if (jsonData?.matches?.length > 0) {
          poolMatches = jsonData.matches;
          roundId = jsonData.round_number || roundId;
          roundName = jsonData.round_name || "";
        } else {
          // Parse from markdown fallback
          poolMatches = parsePoolFromMarkdown(markdown, pool_type);
          const roundMatch = markdown.match(/omgång\s*(\d+)/i) || markdown.match(/rond\s*(\d+)/i);
          if (roundMatch) roundId = `${pool_type}-${roundMatch[1]}`;
        }
      }
    } catch (e) {
      console.warn("Firecrawl pool scrape failed:", e);
      // Return empty state
      poolMatches = [];
    }

    if (poolMatches.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          round_id: roundId,
          round_name: roundName || `Ingen aktiv omgång hittades`,
          pool_type,
          rows: [],
          system_size: 0,
          cost_sek: 0,
          message: "Ingen aktiv omgång hittades. Prova igen närmre kupongsläpp.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Analyze each match with Gemini
    const analyzedRows: any[] = [];

    for (const pm of poolMatches.slice(0, 13)) {
      const homeTeam = pm.home_team || pm.homeTeam || "Hemmalag";
      const awayTeam = pm.away_team || pm.awayTeam || "Bortalag";

      // Fetch news
      let newsContext = "";
      if (gnewsApiKey) {
        try {
          const q = encodeURIComponent(`"${homeTeam}" "${awayTeam}"`);
          const gnRes = await fetch(
            `https://gnews.io/api/v4/search?q=${q}&max=2&lang=sv,en&apikey=${gnewsApiKey}`
          );
          if (gnRes.ok) {
            const gnData = await gnRes.json();
            newsContext = (gnData.articles || []).map((a: any) => `- ${a.title}`).join("\n");
          }
        } catch {
          // ignore
        }
      }

      // Gemini analysis for this match
      let tip = "1";
      let probs = { home: 0.45, draw: 0.28, away: 0.27 };
      let confidence = 45;
      let reasoning = "";

      if (lovableApiKey) {
        try {
          const prompt = `Analyze this pool match and predict the outcome.

MATCH: ${homeTeam} vs ${awayTeam}
NEWS CONTEXT:
${newsContext || "No news available."}

Respond with ONLY valid JSON:
{
  "tip": "1" | "X" | "2",
  "prob_home": <0.0-1.0>,
  "prob_draw": <0.0-1.0>,
  "prob_away": <0.0-1.0>,
  "confidence": <0-100>,
  "reasoning": "<one sentence>"
}

Rules:
- Be conservative. If uncertain, prefer X or lower confidence.
- Probabilities must sum to 1.0.
- Max confidence 65 without confirmed lineup data.`;

          const aiRes = await fetch("https://api.lovable.dev/ai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${lovableApiKey}`,
            },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash-lite",
              messages: [{ role: "user", content: prompt }],
              temperature: 0.2,
              max_tokens: 300,
            }),
          });

          if (aiRes.ok) {
            const aiData = await aiRes.json();
            const rawContent = aiData.choices?.[0]?.message?.content || "{}";
            const cleaned = rawContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
            const parsed = JSON.parse(cleaned);

            tip = parsed.tip || "1";
            probs = {
              home: Math.min(1, Math.max(0, parsed.prob_home || 0.45)),
              draw: Math.min(1, Math.max(0, parsed.prob_draw || 0.28)),
              away: Math.min(1, Math.max(0, parsed.prob_away || 0.27)),
            };
            // Normalize
            const total = probs.home + probs.draw + probs.away;
            if (total > 0) {
              probs.home /= total;
              probs.draw /= total;
              probs.away /= total;
            }
            confidence = Math.min(65, Math.max(30, parsed.confidence || 45));
            reasoning = parsed.reasoning || "";
          }
        } catch (e) {
          console.warn(`Gemini failed for ${homeTeam} vs ${awayTeam}:`, e);
        }
      }

      // Determine system type based on confidence
      let systemType: "spike" | "half" | "full";
      let signs: string[];
      if (confidence > 70) {
        systemType = "spike";
        signs = [tip];
      } else if (confidence >= 50) {
        systemType = "half";
        // Add second most likely outcome
        const sorted = Object.entries(probs).sort((a, b) => b[1] - a[1]);
        const second = sorted[1][0] === "home" ? "1" : sorted[1][0] === "draw" ? "X" : "2";
        signs = [tip, second];
      } else {
        systemType = "full";
        signs = ["1", "X", "2"];
      }

      analyzedRows.push({
        match_number: pm.match_number || analyzedRows.length + 1,
        home_team: homeTeam,
        away_team: awayTeam,
        match_date: pm.match_date || pm.matchDate || null,
        tip,
        prob_home: Math.round(probs.home * 100),
        prob_draw: Math.round(probs.draw * 100),
        prob_away: Math.round(probs.away * 100),
        confidence,
        reasoning,
        system_type: systemType,
        signs,
        signs_count: signs.length,
      });
    }

    // Calculate system size
    const systemSize = analyzedRows.reduce((acc, row) => acc * row.signs_count, 1);
    const ticketPrice = pool_type === "topptipset" ? 1.0 : 0.5;
    const costSek = systemSize * ticketPrice;

    // Reduce system if over max_rows
    let finalRows = [...analyzedRows];
    if (systemSize > max_rows) {
      // Convert lowest-confidence full-garderingar to half-garderingar
      const sorted = [...finalRows]
        .map((r, i) => ({ idx: i, row: r, confidence: r.confidence }))
        .filter((r) => r.row.system_type === "full")
        .sort((a, b) => b.confidence - a.confidence);

      for (const item of sorted) {
        const row = finalRows[item.idx];
        const newSize = systemSize / 3 * 2;
        if (newSize <= max_rows) {
          finalRows[item.idx] = {
            ...row,
            system_type: "half",
            signs: [row.tip, row.tip === "1" ? "X" : "1"],
            signs_count: 2,
          };
          break;
        }
      }
    }

    const finalSystemSize = finalRows.reduce((acc, row) => acc * row.signs_count, 1);
    const finalCost = finalSystemSize * ticketPrice;

    // Generate clipboard string
    const clipboardString = finalRows.map((r) => r.signs.join("")).join("-");

    return new Response(
      JSON.stringify({
        success: true,
        round_id: roundId,
        round_name: roundName,
        pool_type,
        rows: finalRows,
        system_size: finalSystemSize,
        cost_sek: finalCost,
        budget_sek,
        over_budget: finalCost > budget_sek,
        clipboard_string: clipboardString,
        ticket_price_sek: ticketPrice,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("fetch-pool-tips error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function parsePoolFromMarkdown(markdown: string, poolType: string): any[] {
  const matches: any[] = [];
  // Look for lines with "vs" or "-" between team names
  const lines = markdown.split("\n");
  let matchNum = 1;

  for (const line of lines) {
    const vsMatch = line.match(/([A-Za-zÅÄÖåäö\s]+)\s+(?:vs\.?|-)\s+([A-Za-zÅÄÖåäö\s]+)/);
    if (vsMatch && vsMatch[1].trim().length > 2 && vsMatch[2].trim().length > 2) {
      matches.push({
        match_number: matchNum++,
        home_team: vsMatch[1].trim(),
        away_team: vsMatch[2].trim(),
        match_date: null,
      });
    }
    if (matches.length >= 13) break;
  }

  return matches;
}
