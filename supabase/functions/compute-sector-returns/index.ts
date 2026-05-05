import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PERIODS = [5, 21, 63, 126]; // ~1w, 1mo, 3mo, 6mo trading days

// Map exchange/asset_type → benchmark index ticker for relative strength
function benchmarkFor(assetType: string, exchange?: string | null): string {
  if (assetType === 'crypto') return 'BTC';
  if (assetType === 'metal') return 'XAU';
  if (assetType === 'fund') return 'SPY';
  // Stock benchmarks by exchange
  if (exchange?.includes('Stockholm') || exchange?.includes('OMX')) return 'OMXS30';
  if (exchange?.includes('Oslo')) return 'OBX';
  if (exchange?.includes('Helsinki')) return 'OMXH25';
  if (exchange?.includes('Copenhagen')) return 'OMXC25';
  return 'SPY';
}

interface PriceRow {
  symbol_id: string;
  date: string;
  close_price: number;
}

function periodReturn(prices: number[], days: number): number | null {
  if (prices.length < days + 1) return null;
  const recent = prices[prices.length - 1];
  const past = prices[prices.length - 1 - days];
  if (!past || past <= 0) return null;
  return (recent - past) / past;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const sb = createClient(supabaseUrl, serviceKey);

    // Pull all active symbols + sector + exchange
    const { data: symbols } = await sb
      .from('symbols')
      .select('id, ticker, sector, exchange, asset_type')
      .eq('is_active', true);
    if (!symbols || symbols.length === 0) {
      return new Response(JSON.stringify({ inserted: 0, reason: 'no symbols' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Pull last ~150 days of prices for all symbols (paginated by chunks of 30 ids)
    const fromDate = new Date(Date.now() - 200 * 24 * 3600 * 1000).toISOString().split('T')[0];
    const pricesById = new Map<string, number[]>();
    const ids = symbols.map(s => s.id);

    for (let i = 0; i < ids.length; i += 30) {
      const chunk = ids.slice(i, i + 30);
      const { data: rows } = await sb
        .from('price_history')
        .select('symbol_id, date, close_price')
        .in('symbol_id', chunk)
        .gte('date', fromDate)
        .order('date', { ascending: true });

      for (const r of (rows || []) as PriceRow[]) {
        const arr = pricesById.get(r.symbol_id) || [];
        arr.push(Number(r.close_price));
        pricesById.set(r.symbol_id, arr);
      }
    }

    // Group by sector × asset_type and compute equal-weighted returns
    const sectorBuckets = new Map<string, number[][]>(); // key = "sector|asset_type" → array of price series
    const indexBuckets = new Map<string, number[][]>(); // key = "indexTicker|asset_type"

    for (const sym of symbols) {
      const series = pricesById.get(sym.id);
      if (!series || series.length < 30) continue;

      const sector = sym.sector || 'Unknown';
      const sKey = `${sector}|${sym.asset_type}`;
      if (!sectorBuckets.has(sKey)) sectorBuckets.set(sKey, []);
      sectorBuckets.get(sKey)!.push(series);

      const idx = benchmarkFor(sym.asset_type, sym.exchange);
      const iKey = `${idx}|${sym.asset_type}`;
      if (!indexBuckets.has(iKey)) indexBuckets.set(iKey, []);
      indexBuckets.get(iKey)!.push(series);
    }

    const sectorRows: Array<Record<string, unknown>> = [];
    const indexRows: Array<Record<string, unknown>> = [];

    const computeBucketReturns = (
      buckets: Map<string, number[][]>,
      keyType: 'sector' | 'index'
    ) => {
      for (const [key, seriesList] of buckets) {
        if (seriesList.length < 2) continue; // require ≥2 members for a meaningful aggregate
        const [keyName, assetType] = key.split('|');

        for (const days of PERIODS) {
          const returns = seriesList
            .map(s => periodReturn(s, days))
            .filter((r): r is number => r !== null);

          if (returns.length < 2) continue;
          const avg = returns.reduce((a, b) => a + b, 0) / returns.length;

          const row = keyType === 'sector'
            ? {
                sector: keyName,
                asset_type: assetType,
                period_days: days,
                return_pct: Math.round(avg * 10000) / 10000,
                member_count: returns.length,
                updated_at: new Date().toISOString(),
              }
            : {
                index_ticker: keyName,
                asset_type: assetType,
                period_days: days,
                return_pct: Math.round(avg * 10000) / 10000,
                updated_at: new Date().toISOString(),
              };

          (keyType === 'sector' ? sectorRows : indexRows).push(row);
        }
      }
    };

    computeBucketReturns(sectorBuckets, 'sector');
    computeBucketReturns(indexBuckets, 'index');

    if (sectorRows.length > 0) {
      await sb.from('sector_returns_cache').upsert(sectorRows, {
        onConflict: 'sector,asset_type,period_days',
      });
    }
    if (indexRows.length > 0) {
      await sb.from('index_returns_cache').upsert(indexRows, {
        onConflict: 'index_ticker,asset_type,period_days',
      });
    }

    return new Response(JSON.stringify({
      sectors: sectorRows.length,
      indices: indexRows.length,
      symbols_processed: symbols.length,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
