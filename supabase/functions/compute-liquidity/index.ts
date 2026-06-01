import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ---- TUNABLE liquidity thresholds (average daily turnover in the symbol's own currency) ----
// avg_dollar_volume_30d = mean of (close_price * volume) over available days.
// A symbol is liquid when that turnover clears the threshold for its currency.
// These are deliberately conservative so transaction-cost modelling stays honest;
// adjust per desk appetite. Default (unknown currency) falls back to the SEK threshold.
const LIQ_THRESHOLD_SEK = 20_000_000; // 20M SEK/day (~Nordic small/mid-cap floor)
const LIQ_THRESHOLD_USD = 2_000_000;  // 2M USD/day
const LIQ_THRESHOLD_EUR = 2_000_000;  // 2M EUR/day
const LIQ_THRESHOLD_NOK = 20_000_000; // 20M NOK/day
const LIQ_THRESHOLD_DKK = 14_000_000; // 14M DKK/day (≈ 20M SEK)
const LIQ_THRESHOLD_DEFAULT = LIQ_THRESHOLD_SEK;

// Number of trailing calendar days of price_history to consider.
const LOOKBACK_DAYS = 30;
// Minimum usable days (non-null, non-zero turnover) before we trust the verdict.
// Fewer than this → is_liquid stays NULL (unknown) rather than a misleading false.
const MIN_DAYS_FOR_VERDICT = 10;
// How many symbols to update per upsert batch (avoid one-row-per-request N+1 writes).
const UPDATE_BATCH_SIZE = 100;

function thresholdFor(currency?: string | null): number {
  switch ((currency || '').toUpperCase()) {
    case 'SEK': return LIQ_THRESHOLD_SEK;
    case 'USD': return LIQ_THRESHOLD_USD;
    case 'EUR': return LIQ_THRESHOLD_EUR;
    case 'NOK': return LIQ_THRESHOLD_NOK;
    case 'DKK': return LIQ_THRESHOLD_DKK;
    default: return LIQ_THRESHOLD_DEFAULT;
  }
}

interface PriceRow {
  close_price: number | null;
  volume: number | null;
  date: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const sb = createClient(supabaseUrl, serviceKey);

    // Liquidity only makes sense for tradeable equities — stocks & funds.
    const { data: symbols } = await sb
      .from('symbols')
      .select('id, ticker, currency, asset_type')
      .eq('is_active', true)
      .in('asset_type', ['stock', 'fund']);
    if (!symbols || symbols.length === 0) {
      return new Response(JSON.stringify({ processed: 0, reason: 'no symbols' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Last LOOKBACK_DAYS calendar days. A small pad keeps weekends/holidays from
    // starving the window of trading rows.
    const fromDate = new Date(Date.now() - (LOOKBACK_DAYS + 5) * 24 * 3600 * 1000)
      .toISOString().split('T')[0];
    const now = new Date().toISOString();

    let liquid = 0;
    let illiquid = 0;
    let unknown = 0;
    let updates: Array<Record<string, unknown>> = [];

    const flushUpdates = async () => {
      if (updates.length === 0) return;
      // upsert on id keeps existing rows; only the liquidity columns change.
      await sb.from('symbols').upsert(updates, { onConflict: 'id' });
      updates = [];
    };

    for (const sym of symbols) {
      // One query per symbol: its last ~30 calendar days, most recent first.
      const { data: rows } = await sb
        .from('price_history')
        .select('close_price, volume, date')
        .eq('symbol_id', sym.id)
        .gte('date', fromDate)
        .order('date', { ascending: false })
        .limit(LOOKBACK_DAYS);

      // Average daily turnover, skipping null/zero close or volume.
      const turnovers: number[] = [];
      for (const r of (rows || []) as PriceRow[]) {
        const close = Number(r.close_price);
        const vol = Number(r.volume);
        if (!close || close <= 0 || !vol || vol <= 0) continue;
        turnovers.push(close * vol);
      }

      let avgDollarVolume: number | null = null;
      let isLiquid: boolean | null = null;

      if (turnovers.length >= MIN_DAYS_FOR_VERDICT) {
        avgDollarVolume = turnovers.reduce((a, b) => a + b, 0) / turnovers.length;
        isLiquid = avgDollarVolume >= thresholdFor(sym.currency);
        if (isLiquid) liquid++; else illiquid++;
      } else {
        // Still record the partial average (if any) but leave the verdict unknown.
        if (turnovers.length > 0) {
          avgDollarVolume = turnovers.reduce((a, b) => a + b, 0) / turnovers.length;
        }
        unknown++;
      }

      updates.push({
        id: sym.id,
        avg_dollar_volume_30d: avgDollarVolume,
        is_liquid: isLiquid,
        liquidity_updated_at: now,
      });

      if (updates.length >= UPDATE_BATCH_SIZE) await flushUpdates();
    }

    await flushUpdates();

    return new Response(JSON.stringify({
      processed: symbols.length,
      liquid,
      illiquid,
      unknown,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
