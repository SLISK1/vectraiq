import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const fmpKey = Deno.env.get("FMP_API_KEY");

    console.log("fetch-sp500: starting, FMP key present:", !!fmpKey);

    // Auth: service role or user JWT
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const isServiceRole = token === serviceKey;

    const supabase = createClient(supabaseUrl, serviceKey);

    if (!isServiceRole) {
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: userData, error: authErr } = await userClient.auth.getUser();
      if (authErr || !userData?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Check cache first
    const { data: cached, error: cacheErr } = await supabase
      .from("universe_cache")
      .select("*")
      .eq("cache_key", "SP500_CONSTITUENTS")
      .maybeSingle();

    console.log("Cache check:", cached ? "found" : "not found", cacheErr ? `error: ${cacheErr.message}` : "");

    const forceRefresh = new URL(req.url).searchParams.get("force") === "true";
    const now = new Date();

    if (cached && !forceRefresh) {
      const expiresAt = cached.expires_at ? new Date(cached.expires_at) : new Date(0);
      if (expiresAt > now && !cached.is_stale) {
        console.log("Returning cached data, expires:", expiresAt.toISOString());
        return new Response(
          JSON.stringify({
            source: cached.source,
            updatedAt: cached.updated_at,
            tickers: (cached.payload as any).tickers,
            count: (cached.payload as any).tickers?.length || 0,
            stale: false,
            disclaimer: "current_constituents_only",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Fetch from FMP
    let tickers: string[] = [];
    let fetchSuccess = false;

    if (fmpKey) {
      try {
        const url = `https://financialmodelingprep.com/api/v3/sp500_constituent?apikey=${fmpKey}`;
        console.log("Fetching FMP SP500...");
        const res = await fetch(url);
        const body = await res.text();
        console.log("FMP response status:", res.status, "body length:", body.length);

        if (res.ok) {
          const data = JSON.parse(body);
          if (Array.isArray(data) && data.length > 0) {
            tickers = data
              .map((c: any) => (c.symbol || "").replace(".", "-"))
              .filter(Boolean);
            fetchSuccess = true;
            console.log("FMP success, tickers:", tickers.length);
          } else {
            console.log("FMP returned non-array or empty:", typeof data, Array.isArray(data) ? data.length : "n/a");
          }
        } else {
          console.error("FMP error response:", body.substring(0, 200));
        }
      } catch (e) {
        console.error("FMP fetch exception:", e);
      }
    } else {
      console.warn("No FMP_API_KEY configured");
    }

    if (fetchSuccess && tickers.length > 0) {
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const payload = { tickers, disclaimer: "current_constituents_only" };

      if (cached) {
        const { error: updateErr } = await supabase
          .from("universe_cache")
          .update({
            payload,
            source: "FMP",
            updated_at: now.toISOString(),
            expires_at: expiresAt.toISOString(),
            is_stale: false,
          })
          .eq("cache_key", "SP500_CONSTITUENTS");
        if (updateErr) console.error("Cache update error:", updateErr.message);
      } else {
        const { error: insertErr } = await supabase.from("universe_cache").insert({
          cache_key: "SP500_CONSTITUENTS",
          payload,
          source: "FMP",
          updated_at: now.toISOString(),
          expires_at: expiresAt.toISOString(),
          is_stale: false,
        });
        if (insertErr) console.error("Cache insert error:", insertErr.message);
      }

      return new Response(
        JSON.stringify({
          source: "FMP",
          updatedAt: now.toISOString(),
          tickers,
          count: tickers.length,
          stale: false,
          disclaimer: "current_constituents_only",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch failed — return stale cache if available
    if (cached) {
      await supabase
        .from("universe_cache")
        .update({ is_stale: true })
        .eq("cache_key", "SP500_CONSTITUENTS");

      return new Response(
        JSON.stringify({
          source: cached.source,
          updatedAt: cached.updated_at,
          tickers: (cached.payload as any).tickers,
          count: (cached.payload as any).tickers?.length || 0,
          stale: true,
          disclaimer: "current_constituents_only",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.error("No FMP data and no cache available");
    return new Response(
      JSON.stringify({
        error: "Could not fetch S&P 500 data and no cache available",
      }),
      {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("fetch-sp500 unhandled error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
