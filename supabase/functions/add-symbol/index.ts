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

    // Check if exists (including inactive rows)
    const { data: existing } = await supabase
      .from("symbols")
      .select("id, ticker, is_active, name, asset_type, currency")
      .eq("ticker", cleanTicker)
      .single();

    if (existing) {
      const internalHeaders = {
        Authorization: `Bearer ${supabaseServiceKey}`,
        "Content-Type": "application/json",
      };

      // Re-activate if inactive
      if (!existing.is_active) {
        await supabase
          .from("symbols")
          .update({ is_active: true })
          .eq("id", existing.id);
      }

      // Check if there is any price data for this symbol
      const { count: priceCount } = await supabase
        .from("raw_prices")
        .select("*", { count: "exact", head: true })
        .eq("symbol_id", existing.id);

      const hasData = (priceCount ?? 0) > 0;

      // If inactive or has no data: re-fetch history + prices + signals
      if (!existing.is_active || !hasData) {
        await Promise.allSettled([
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
        fetch(`${supabaseUrl}/functions/v1/generate-signals`, {
          method: "POST",
          headers: internalHeaders,
          body: JSON.stringify({ tickers: [cleanTicker], allHorizons: true }),
        }).catch(() => {});

        return new Response(JSON.stringify({
          success: true,
          isNew: false,
          reactivated: true,
          symbol: existing,
          displayName: existing.name,
          detectedType: existing.asset_type,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Symbol exists and is active with data — nothing to do
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

    // === FUND PROXY: auto-identify proxy ETF ===
    let proxyEtf: string | null = null;
    if (assetType === 'fund' && fmpApiKey) {
      // Common fund-to-ETF proxy mappings
      const knownProxies: Record<string, string> = {
        'SPY': 'SPY', 'VOO': 'VOO', 'QQQ': 'QQQ', 'IWM': 'IWM',
        'VTI': 'VTI', 'VXUS': 'VXUS', 'BND': 'BND', 'VEA': 'VEA',
      };
      // If the fund ticker itself is a known ETF, skip proxy
      if (!knownProxies[cleanTicker]) {
        // Try to find an ETF proxy via FMP ETF search
        try {
          const etfRes = await fetch(
            `https://financialmodelingprep.com/api/v3/etf/list?apikey=${fmpApiKey}`
          );
          // Simplified: use sector/name matching for Nordic funds
          // For now, use broad market proxies based on detected characteristics
          if (cleanTicker.endsWith('.ST') || currency === 'SEK') {
            proxyEtf = 'EWD'; // iShares MSCI Sweden ETF
          } else if (currency === 'EUR') {
            proxyEtf = 'VGK'; // Vanguard FTSE Europe ETF
          } else {
            proxyEtf = 'SPY'; // Default to S&P 500
          }
          console.log(`Fund proxy for ${cleanTicker}: ${proxyEtf}`);
        } catch (e) {
          console.warn('Fund proxy lookup failed:', e);
        }
      }
    }

    // Build metadata
    const metadata: Record<string, unknown> = {};
    if (proxyEtf) metadata.proxy_etf = proxyEtf;

    // Insert as pending (is_active=false) — activate only after data is confirmed
    const { data: newSymbol, error } = await supabase
      .from("symbols")
      .insert({
        ticker: cleanTicker,
        name: displayName,
        asset_type: assetType,
        currency,
        is_active: false,
        metadata: Object.keys(metadata).length > 0 ? metadata : null,
      })
      .select()
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: "Insert failed", details: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === TRY TO FETCH DATA IMMEDIATELY ===
    const internalHeaders = {
      Authorization: `Bearer ${supabaseServiceKey}`,
      "Content-Type": "application/json",
    };

    // Fetch history + prices in parallel (bypass is_active filter since tickers are explicit)
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

    const histOk = histRes.status === "fulfilled" && histRes.value.ok;
    const priceOk = priceRes.status === "fulfilled" && priceRes.value.ok;
    const dataFetched = histOk || priceOk;

    console.log(`History: ${histRes.status}/${histOk}, Prices: ${priceRes.status}/${priceOk}`);

    if (dataFetched) {
      // Data arrived — activate the symbol now
      await supabase.from("symbols").update({ is_active: true }).eq("id", newSymbol.id);

      // Fire generate-signals async (non-blocking)
      fetch(`${supabaseUrl}/functions/v1/generate-signals`, {
        method: "POST",
        headers: internalHeaders,
        body: JSON.stringify({ tickers: [cleanTicker], allHorizons: true }),
      }).catch(() => {});

      console.log(`User ${userId} added symbol: ${cleanTicker} (${displayName}, ${assetType}, ${currency}) — ACTIVATED`);

      return new Response(JSON.stringify({
        success: true,
        isNew: true,
        pending: false,
        symbol: { ...newSymbol, is_active: true },
        detectedType: assetType,
        displayName,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else {
      // Data fetch failed (likely API rate limit) — symbol stays pending (is_active=false)
      // Daily pipeline will pick it up via activate-pending step
      console.log(`User ${userId} added symbol: ${cleanTicker} (${displayName}) — PENDING (data fetch failed, will retry in daily pipeline)`);

      return new Response(JSON.stringify({
        success: true,
        isNew: true,
        pending: true,
        symbol: newSymbol,
        detectedType: assetType,
        displayName,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (e) {
    console.error("add-symbol error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
