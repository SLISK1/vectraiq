/**
 * ingest-prices: Fetches daily OHLCV and upserts into price_bars.
 * Idempotent — ON CONFLICT DO UPDATE.
 * Reuses Yahoo Finance / FMP / CoinGecko patterns from fetch-history.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CRYPTO_IDS: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", XRP: "ripple",
  ADA: "cardano", AVAX: "avalanche-2", DOT: "polkadot", LINK: "chainlink",
  DOGE: "dogecoin", MATIC: "matic-network", LTC: "litecoin", UNI: "uniswap",
  ATOM: "cosmos", NEAR: "near", APT: "aptos", ARB: "arbitrum", OP: "optimism",
};

const METAL_YAHOO: Record<string, string> = {
  XAU: "GC=F", XAG: "SI=F", XPT: "PL=F", XPD: "PA=F",
};

async function fetchYahooOhlcv(
  symbol: string, days: number,
): Promise<{ date: string; o: number; h: number; l: number; c: number; v: number }[] | null> {
  const p1 = Math.floor((Date.now() - days * 86400000) / 1000);
  const p2 = Math.floor(Date.now() / 1000);
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${p1}&period2=${p2}&interval=1d`,
      { headers: { "User-Agent": "Mozilla/5.0 (compatible)" } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const r = data.chart?.result?.[0];
    if (!r?.timestamp || !r?.indicators?.quote?.[0]) return null;
    const q = r.indicators.quote[0];
    return r.timestamp
      .map((ts: number, i: number) => ({
        date: new Date(ts * 1000).toISOString().split("T")[0],
        o: q.open?.[i] ?? q.close?.[i],
        h: q.high?.[i] ?? q.close?.[i],
        l: q.low?.[i] ?? q.close?.[i],
        c: q.close?.[i],
        v: q.volume?.[i] ?? 0,
      }))
      .filter((r: any) => r.c != null);
  } catch {
    return null;
  }
}

async function fetchCoinGeckoOhlcv(
  geckoId: string, days: number,
): Promise<{ date: string; o: number; h: number; l: number; c: number; v: number }[] | null> {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${geckoId}/ohlc?vs_currency=usd&days=${Math.min(days, 365)}`,
    );
    if (!res.ok) return null;
    const data: number[][] = await res.json();
    // CoinGecko OHLC: [timestamp, open, high, low, close]
    return data.map(([ts, o, h, l, c]) => ({
      date: new Date(ts).toISOString().split("T")[0],
      o, h, l, c, v: 0,
    }));
  } catch {
    return null;
  }
}

async function fetchFmpOhlcv(
  fmpSymbol: string, days: number, apiKey: string,
): Promise<{ date: string; o: number; h: number; l: number; c: number; v: number }[] | null> {
  try {
    const from = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];
    const to = new Date().toISOString().split("T")[0];
    const res = await fetch(
      `https://financialmodelingprep.com/api/v3/historical-price-full/${fmpSymbol}?from=${from}&to=${to}&apikey=${apiKey}`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data.historical)) return null;
    return data.historical.map((h: any) => ({
      date: h.date,
      o: h.open ?? h.close,
      h: h.high ?? h.close,
      l: h.low ?? h.close,
      c: h.close,
      v: h.volume ?? 0,
    }));
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const fmpApiKey = Deno.env.get("FMP_API_KEY") ?? "";
    const days = 252; // ~1 trading year

    // Fetch all active symbols
    const { data: symbols, error: symErr } = await supabase
      .from("symbols")
      .select("id, ticker, asset_type, metadata")
      .eq("is_active", true);

    if (symErr) throw symErr;
    if (!symbols?.length) {
      return new Response(JSON.stringify({ success: true, processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let processed = 0;
    let errors = 0;
    const results: string[] = [];

    for (const sym of symbols) {
      const ticker = sym.ticker as string;
      const assetType = sym.asset_type as string;

      let bars: { date: string; o: number; h: number; l: number; c: number; v: number }[] | null = null;
      let provider = "yahoo";

      if (assetType === "crypto") {
        const geckoId = CRYPTO_IDS[ticker];
        if (geckoId) {
          bars = await fetchCoinGeckoOhlcv(geckoId, days);
          provider = "coingecko";
        }
      } else if (assetType === "metal") {
        const yahooSym = METAL_YAHOO[ticker];
        if (yahooSym) {
          bars = await fetchYahooOhlcv(yahooSym, days);
          provider = "yahoo";
        }
        // Fallback to FMP for metals
        if (!bars && fmpApiKey) {
          const fmpSym = ({ XAU: "XAUUSD", XAG: "XAGUSD", XPT: "XPTUSD", XPD: "XPDUSD" } as Record<string, string>)[ticker];
          if (fmpSym) { bars = await fetchFmpOhlcv(fmpSym, days, fmpApiKey); provider = "fmp"; }
        }
      } else {
        // Stock or fund — try Yahoo Finance with .ST / exchange suffixes
        const meta = sym.metadata as any;
        const yahooSym = meta?.yahoo_symbol ?? meta?.proxy_yahoo ?? `${ticker}.ST`;
        bars = await fetchYahooOhlcv(yahooSym, days);
        // Fallback to FMP
        if (!bars && fmpApiKey) {
          bars = await fetchFmpOhlcv(ticker, days, fmpApiKey);
          if (bars) provider = "fmp";
        }
      }

      if (!bars || bars.length === 0) { errors++; continue; }

      // Upsert to price_bars
      const rows = bars.map((b) => ({
        asset_id: sym.id,
        ts: `${b.date}T00:00:00Z`,
        interval: "1d",
        open: b.o,
        high: b.h,
        low: b.l,
        close: b.c,
        volume: b.v,
        source_provider: provider,
        quality_score: 100,
      }));

      const { error: upsertErr } = await supabase
        .from("price_bars")
        .upsert(rows, { onConflict: "asset_id,interval,ts" });

      if (upsertErr) { errors++; results.push(`${ticker}: ${upsertErr.message}`); }
      else { processed++; }

      // Small delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 200));
    }

    return new Response(
      JSON.stringify({ success: true, processed, errors, details: results.slice(0, 10) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
