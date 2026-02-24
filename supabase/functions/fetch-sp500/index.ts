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
    const fmpKey = Deno.env.get("FMP_API_KEY")!;

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
    const { data: cached } = await supabase
      .from("universe_cache")
      .select("*")
      .eq("cache_key", "SP500_CONSTITUENTS")
      .single();

    const forceRefresh = new URL(req.url).searchParams.get("force") === "true";
    const now = new Date();

    if (cached && !forceRefresh) {
      const expiresAt = new Date(cached.expires_at);
      if (expiresAt > now && !cached.is_stale) {
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

    try {
      const res = await fetch(
        `https://financialmodelingprep.com/api/v3/sp500_constituent?apikey=${fmpKey}`
      );
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          tickers = data
            .map((c: any) => (c.symbol || "").replace(".", "-"))
            .filter(Boolean);
          fetchSuccess = true;
        }
      }
    } catch (e) {
      console.error("FMP fetch failed:", e);
    }

    if (fetchSuccess && tickers.length > 0) {
      // Upsert cache via service role (bypasses RLS)
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      if (cached) {
        await supabase.rpc("exec_sql", {}).catch(() => {}); // ignore
        // Direct update via service role
        await supabase
          .from("universe_cache")
          .update({
            payload: { tickers, disclaimer: "current_constituents_only" },
            source: "FMP",
            updated_at: now.toISOString(),
            expires_at: expiresAt.toISOString(),
            is_stale: false,
          })
          .eq("cache_key", "SP500_CONSTITUENTS");
      } else {
        await supabase.from("universe_cache").insert({
          cache_key: "SP500_CONSTITUENTS",
          payload: { tickers, disclaimer: "current_constituents_only" },
          source: "FMP",
          updated_at: now.toISOString(),
          expires_at: expiresAt.toISOString(),
          is_stale: false,
        });
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
      // Mark as stale
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
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
