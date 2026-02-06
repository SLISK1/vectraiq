import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // === AUTHENTICATION CHECK ===
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create client with user's auth context
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Validate the JWT token
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getUser(token);
    
    if (claimsError || !claimsData?.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = claimsData.user.id;

    // Service role client for database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // === INPUT VALIDATION ===
    const body = await req.json();
    const { ticker } = body;
    
    if (!ticker || typeof ticker !== "string") {
      return new Response(JSON.stringify({ error: "Ticker required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cleanTicker = ticker.toUpperCase().trim();

    // Validate ticker format: alphanumeric, hyphens, underscores only, 1-12 chars
    if (!/^[A-Z0-9_-]{1,12}$/.test(cleanTicker)) {
      return new Response(JSON.stringify({ error: "Invalid ticker format. Use 1-12 alphanumeric characters, hyphens or underscores." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === RATE LIMITING (10 symbols per hour per user) ===
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const { count: recentCount } = await supabase
      .from("symbols")
      .select("*", { count: "exact", head: true })
      .gte("created_at", oneHourAgo);

    // Global rate limit (not per user since we don't track who added symbols)
    if (recentCount && recentCount > 50) {
      return new Response(JSON.stringify({ error: "Too many symbols added recently. Please try again later." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if exists
    const { data: existing } = await supabase
      .from("symbols")
      .select("id, ticker")
      .eq("ticker", cleanTicker)
      .single();

    if (existing) {
      return new Response(JSON.stringify({ success: true, isNew: false, symbol: existing }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Detect type
    const cryptos = ["BTC", "ETH", "SOL", "XRP", "ADA", "AVAX", "DOT", "LINK", "DOGE"];
    const metals = ["XAU", "XAG", "XPT", "XPD"];
    let assetType: "stock" | "crypto" | "metal" | "fund" = "stock";
    if (cryptos.includes(cleanTicker)) assetType = "crypto";
    else if (metals.includes(cleanTicker)) assetType = "metal";

    const currency = assetType === "crypto" ? "USD" : "USD";

    // Insert
    const { data: newSymbol, error } = await supabase
      .from("symbols")
      .insert({
        ticker: cleanTicker,
        name: cleanTicker,
        asset_type: assetType,
        currency,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: "Insert failed", details: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Trigger data fetch (fire and forget) using service key
    fetch(`${supabaseUrl}/functions/v1/fetch-history`, {
      method: "POST",
      headers: { 
        Authorization: `Bearer ${supabaseServiceKey}`, 
        "Content-Type": "application/json",
        "X-Internal-Call": "true", // Mark as internal call
      },
      body: JSON.stringify({ tickers: [cleanTicker], days: 365 }),
    }).catch(() => {});

    console.log(`User ${userId} added symbol: ${cleanTicker}`);

    return new Response(JSON.stringify({ success: true, isNew: true, symbol: newSymbol, detectedType: assetType }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("add-symbol error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
