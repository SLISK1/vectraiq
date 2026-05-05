import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EventRow {
  ticker: string | null;
  event_type: string;
  event_date: string;
  importance: number;
  source: string;
  metadata: Record<string, unknown>;
}

// FMP earnings calendar — next 30 days for active tickers
async function fetchFmpEarnings(tickers: string[], apiKey: string): Promise<EventRow[]> {
  if (!apiKey || tickers.length === 0) return [];
  const out: EventRow[] = [];
  const from = new Date().toISOString().split('T')[0];
  const to = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString().split('T')[0];

  // FMP has a global calendar endpoint — pull once and filter locally
  try {
    const url = `https://financialmodelingprep.com/api/v3/earning_calendar?from=${from}&to=${to}&apikey=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`FMP earning_calendar HTTP ${res.status}`);
      return [];
    }
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    const tickerSet = new Set(tickers);
    // Also accept Yahoo-style suffix variants
    const stripSuffix = (t: string) => t.replace(/\.(ST|OL|HE|CO|US|L)$/, '');
    const baseSet = new Set(tickers.map(stripSuffix));

    for (const row of data) {
      const sym = String(row.symbol || '').toUpperCase();
      if (!sym) continue;
      if (!tickerSet.has(sym) && !baseSet.has(stripSuffix(sym))) continue;

      out.push({
        ticker: sym,
        event_type: 'earnings',
        event_date: row.date ? new Date(row.date).toISOString() : new Date().toISOString(),
        importance: 3,
        source: 'fmp',
        metadata: {
          eps_estimate: row.epsEstimated ?? null,
          revenue_estimate: row.revenueEstimated ?? null,
          time: row.time ?? null,
        },
      });
    }
  } catch (e) {
    console.error('FMP earnings fetch failed:', e);
  }
  return out;
}

// FMP economic calendar — next 30 days, high-importance only
async function fetchFmpEconomic(apiKey: string): Promise<EventRow[]> {
  if (!apiKey) return [];
  const out: EventRow[] = [];
  const from = new Date().toISOString().split('T')[0];
  const to = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().split('T')[0];

  try {
    const url = `https://financialmodelingprep.com/api/v3/economic_calendar?from=${from}&to=${to}&apikey=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`FMP economic_calendar HTTP ${res.status}`);
      return [];
    }
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    // Map FMP event names → our event_type, only high-impact
    const typeFor = (name: string, country: string): string | null => {
      const n = (name || '').toLowerCase();
      const c = (country || '').toUpperCase();
      if (n.includes('cpi') || n.includes('inflation rate')) return 'cpi';
      if (n.includes('fomc') || n.includes('fed') || (n.includes('interest rate') && c === 'US')) return 'fed';
      if (n.includes('ecb') || (n.includes('interest rate') && c === 'EU')) return 'ecb';
      if (n.includes('riksbank') || (n.includes('interest rate') && c === 'SE')) return 'riksbank';
      if (n.includes('non farm') || n.includes('nonfarm')) return 'nfp';
      if (n.includes('gdp')) return 'gdp';
      return null;
    };

    for (const row of data) {
      const t = typeFor(row.event || '', row.country || '');
      if (!t) continue;
      const importance = String(row.impact || '').toLowerCase() === 'high' ? 3 : 2;
      if (importance < 2) continue;

      out.push({
        ticker: null,
        event_type: t,
        event_date: row.date ? new Date(row.date).toISOString() : new Date().toISOString(),
        importance,
        source: 'fmp',
        metadata: {
          country: row.country,
          name: row.event,
          consensus: row.estimate ?? null,
          previous: row.previous ?? null,
        },
      });
    }
  } catch (e) {
    console.error('FMP economic fetch failed:', e);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const fmpKey = Deno.env.get('FMP_API_KEY') || '';

    const sb = createClient(supabaseUrl, serviceKey);

    // Get active tickers
    const { data: symbols } = await sb
      .from('symbols')
      .select('ticker')
      .eq('is_active', true)
      .in('asset_type', ['stock', 'fund']);
    const tickers = (symbols || []).map(s => s.ticker);

    // Purge stale events (anything older than yesterday) so the table doesn't bloat
    await sb
      .from('event_calendar')
      .delete()
      .lt('event_date', new Date(Date.now() - 24 * 3600 * 1000).toISOString());

    const [earnings, macro] = await Promise.all([
      fetchFmpEarnings(tickers, fmpKey),
      fetchFmpEconomic(fmpKey),
    ]);

    const all = [...earnings, ...macro];
    if (all.length === 0) {
      return new Response(JSON.stringify({ inserted: 0, reason: 'no events found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Insert in chunks; rely on unique index to avoid duplicates
    let inserted = 0;
    const chunkSize = 200;
    for (let i = 0; i < all.length; i += chunkSize) {
      const chunk = all.slice(i, i + chunkSize);
      const { error } = await sb
        .from('event_calendar')
        .upsert(chunk, { onConflict: 'coalesce(ticker, \'\'),event_type,event_date', ignoreDuplicates: true });

      if (error) {
        // Fallback: per-row insert (some Supabase versions don't accept the expression-based onConflict)
        for (const row of chunk) {
          const { error: rowErr } = await sb.from('event_calendar').insert(row);
          if (!rowErr) inserted++;
        }
      } else {
        inserted += chunk.length;
      }
    }

    return new Response(JSON.stringify({ inserted, earnings: earnings.length, macro: macro.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
