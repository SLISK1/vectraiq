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
    const fmpApiKey = Deno.env.get("FMP_API_KEY") || "";

    // === AUTHENTICATION CHECK ===
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getUser(token);
    
    if (claimsError || !claimsData?.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = claimsData.user.id;

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

    // Allow dots for Nordic stocks (.ST, .OL, .CO, .HE) and longer tickers
    if (!/^[A-Z0-9._-]{1,20}$/.test(cleanTicker)) {
      return new Response(JSON.stringify({ error: "Ogiltigt ticker-format. Använd 1-20 tecken: bokstäver, siffror, punkter, bindestreck eller understreck." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === RATE LIMITING (50 symbols per hour globally) ===
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const { count: recentCount } = await supabase
      .from("symbols")
      .select("*", { count: "exact", head: true })
      .gte("created_at", oneHourAgo);

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

    // === SMART TYPE DETECTION ===
    const cryptos = ["BTC", "ETH", "SOL", "XRP", "ADA", "AVAX", "DOT", "LINK", "DOGE", "MATIC", "SHIB", "UNI", "LTC", "ATOM", "FIL", "APT", "ARB", "OP", "NEAR", "AAVE"];
    const metals = ["XAU", "XAG", "XPT", "XPD"];
    const nordicSuffixes = [".ST", ".OL", ".CO", ".HE"];
    const fundKeywords = ["ETF", "FUND", "INDEX"];
    
    let assetType: "stock" | "crypto" | "metal" | "fund" = "stock";
    let currency = "USD";
    let verified = false;
    let displayName = cleanTicker;

    // === FMP VERIFICATION GATE ===
    if (!fmpApiKey) {
      return new Response(JSON.stringify({ error: "Verifiering ej tillgänglig. Kontakta administratör." }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      const profileRes = await fetch(`https://financialmodelingprep.com/api/v3/profile/${encodeURIComponent(cleanTicker)}?apikey=${fmpApiKey}`);
      if (profileRes.ok) {
        const profileData = await profileRes.json();
        if (Array.isArray(profileData) && profileData.length > 0 && profileData[0].companyName) {
          verified = true;
          displayName = profileData[0].companyName;
          if (profileData[0].isEtf) assetType = "fund";
          if (profileData[0].isFund) assetType = "fund";
          if (profileData[0].currency) currency = profileData[0].currency;
        }
      }
    } catch (e) {
      console.warn("FMP profile lookup failed:", e);
      return new Response(JSON.stringify({ error: "Kunde inte verifiera ticker just nu. Försök igen." }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fallback: known crypto/metals don't need FMP verification
    if (!verified) {
      const cryptoBase = cleanTicker.replace(/-.*$/, "");
      if (cryptos.includes(cryptoBase)) {
        verified = true;
        assetType = "crypto";
      } else if (metals.includes(cleanTicker)) {
        verified = true;
        assetType = "metal";
      }
    }

    if (!verified) {
      return new Response(JSON.stringify({ error: `Kunde inte hitta "${cleanTicker}". Kontrollera att tickern är korrekt.` }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Refine type/currency for non-FMP verified assets
    if (assetType === "stock") {
      if (fundKeywords.some(kw => cleanTicker.includes(kw))) {
        assetType = "fund";
      } else if (nordicSuffixes.some(s => cleanTicker.endsWith(s))) {
        currency = cleanTicker.endsWith(".ST") ? "SEK" 
          : cleanTicker.endsWith(".OL") ? "NOK"
          : cleanTicker.endsWith(".CO") ? "DKK"
          : cleanTicker.endsWith(".HE") ? "EUR"
          : "USD";
      }
    }

    // Insert
    const { data: newSymbol, error } = await supabase
      .from("symbols")
      .insert({
        ticker: cleanTicker,
        name: displayName,
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

    // === SEQUENTIAL AWAIT: fetch-history + fetch-prices, then generate-signals ===
    const internalHeaders = {
      Authorization: `Bearer ${supabaseServiceKey}`,
      "Content-Type": "application/json",
      "X-Internal-Call": "true",
    };

    // 1. Fetch history + prices in parallel (both must complete before signals)
    const [histRes, priceRes] = await Promise.allSettled([
      fetch(`${supabaseUrl}/functions/v1/fetch-history`, {
        method: "POST",
        headers: internalHeaders,
        body: JSON.stringify({ tickers: [cleanTicker], days: 365 }),
      }),
      fetch(`${supabaseUrl}/functions/v1/fetch-prices`, {
        method: "POST",
        headers: internalHeaders,
        body: JSON.stringify({ tickers: [cleanTicker] }),
      }),
    ]);

    console.log(`History: ${histRes.status}, Prices: ${priceRes.status}`);

    // 2. Generate signals AFTER price data is available
    try {
      await fetch(`${supabaseUrl}/functions/v1/generate-signals`, {
        method: "POST",
        headers: internalHeaders,
        body: JSON.stringify({ tickers: [cleanTicker], allHorizons: true }),
      });
    } catch (e) {
      console.warn('generate-signals trigger failed:', e);
    }

    console.log(`User ${userId} added symbol: ${cleanTicker} (${displayName}, ${assetType}, ${currency})`);

    return new Response(JSON.stringify({ 
      success: true, 
      isNew: true, 
      symbol: newSymbol, 
      detectedType: assetType,
      displayName,
    }), {
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
