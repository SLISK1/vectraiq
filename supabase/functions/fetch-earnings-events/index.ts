import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SurpriseRow {
  ticker: string;
  period: string;
  reported_at: string;
  eps_actual: number | null;
  eps_estimate: number | null;
  surprise_pct: number | null;
  revenue_actual: number | null;
  revenue_estimate: number | null;
  source: string;
}

interface RevisionRow {
  ticker: string;
  mean_target: number | null;
  current_price_at_update: number | null;
  num_revisions_up_30d: number;
  num_revisions_down_30d: number;
  num_analysts: number | null;
  consensus: string | null;
  updated_at: string;
}

interface InsiderRow {
  ticker: string;
  transaction_date: string;
  transaction_type: string;
  shares: number | null;
  value_usd: number | null;
  insider_name: string | null;
  insider_role: string | null;
  source: string;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchEarningsSurprises(ticker: string, apiKey: string): Promise<SurpriseRow[]> {
  try {
    const url = `https://financialmodelingprep.com/api/v3/earnings-surprises/${encodeURIComponent(ticker)}?apikey=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    const out: SurpriseRow[] = [];
    // Take last 4 quarters
    for (const row of data.slice(0, 4)) {
      if (!row.date) continue;
      const actual = row.actualEarningResult ?? row.actual ?? null;
      const estimate = row.estimatedEarning ?? row.estimate ?? null;
      let surprise: number | null = null;
      if (actual != null && estimate != null && Math.abs(estimate) > 1e-6) {
        surprise = (Number(actual) - Number(estimate)) / Math.abs(Number(estimate));
      }
      const dt = new Date(row.date);
      const period = `${dt.getUTCFullYear()}-Q${Math.floor(dt.getUTCMonth() / 3) + 1}`;
      out.push({
        ticker,
        period,
        reported_at: dt.toISOString(),
        eps_actual: actual != null ? Number(actual) : null,
        eps_estimate: estimate != null ? Number(estimate) : null,
        surprise_pct: surprise != null ? Math.round(surprise * 10000) / 10000 : null,
        revenue_actual: null,
        revenue_estimate: null,
        source: 'fmp',
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function fetchAnalystRevisions(ticker: string, apiKey: string): Promise<RevisionRow | null> {
  try {
    // Price target consensus
    const ptUrl = `https://financialmodelingprep.com/api/v4/price-target-consensus?symbol=${encodeURIComponent(ticker)}&apikey=${apiKey}`;
    const upgUrl = `https://financialmodelingprep.com/api/v4/upgrades-downgrades?symbol=${encodeURIComponent(ticker)}&apikey=${apiKey}`;
    const [ptRes, upgRes] = await Promise.all([fetch(ptUrl), fetch(upgUrl)]);

    const ptBody = ptRes.ok ? await ptRes.json() : null;
    const upgBody = upgRes.ok ? await upgRes.json() : null;

    const pt = Array.isArray(ptBody) ? ptBody[0] : ptBody;

    let upCount = 0;
    let downCount = 0;
    const since = Date.now() - 30 * 24 * 3600 * 1000;
    if (Array.isArray(upgBody)) {
      for (const r of upgBody) {
        if (!r.publishedDate) continue;
        if (new Date(r.publishedDate).getTime() < since) continue;
        const action = String(r.action || '').toLowerCase();
        if (action.includes('upgrade') || action.includes('buy') || action.includes('outperform')) upCount++;
        else if (action.includes('downgrade') || action.includes('sell') || action.includes('underperform')) downCount++;
      }
    }

    if (!pt && upCount === 0 && downCount === 0) return null;

    // Derive consensus label
    let consensus: string | null = null;
    if (upCount + downCount >= 2) {
      const ratio = upCount / (upCount + downCount);
      if (ratio >= 0.8) consensus = 'strong_buy';
      else if (ratio >= 0.6) consensus = 'buy';
      else if (ratio >= 0.4) consensus = 'hold';
      else if (ratio >= 0.2) consensus = 'sell';
      else consensus = 'strong_sell';
    }

    return {
      ticker,
      mean_target: pt?.targetConsensus != null ? Number(pt.targetConsensus) : null,
      current_price_at_update: null,
      num_revisions_up_30d: upCount,
      num_revisions_down_30d: downCount,
      num_analysts: pt?.numberOfAnalysts != null ? Number(pt.numberOfAnalysts) : null,
      consensus,
      updated_at: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

async function fetchInsiderTrades(ticker: string, apiKey: string): Promise<InsiderRow[]> {
  try {
    const url = `https://financialmodelingprep.com/api/v4/insider-trading?symbol=${encodeURIComponent(ticker)}&page=0&apikey=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    const out: InsiderRow[] = [];
    const since = Date.now() - 90 * 24 * 3600 * 1000;
    for (const row of data) {
      if (!row.transactionDate) continue;
      if (new Date(row.transactionDate).getTime() < since) continue;
      const code = String(row.transactionType || '').toUpperCase();
      // FMP transaction codes: P-Purchase=buy, S-Sale=sell. Ignore option grants/awards.
      let txType: string | null = null;
      if (code.startsWith('P') || code.includes('PURCHASE')) txType = 'buy';
      else if (code.startsWith('S') || code.includes('SALE')) txType = 'sell';
      if (!txType) continue;

      out.push({
        ticker,
        transaction_date: row.transactionDate,
        transaction_type: txType,
        shares: row.securitiesTransacted != null ? Number(row.securitiesTransacted) : null,
        value_usd: row.price != null && row.securitiesTransacted != null
          ? Number(row.price) * Number(row.securitiesTransacted)
          : null,
        insider_name: row.reportingName || null,
        insider_role: row.typeOfOwner || null,
        source: 'fmp',
      });
    }
    return out;
  } catch {
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const fmpKey = Deno.env.get('FMP_API_KEY') || '';

    if (!fmpKey) {
      return new Response(JSON.stringify({ error: 'FMP_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sb = createClient(supabaseUrl, serviceKey);

    let tickers: string[] = [];
    let limit = 25;
    try {
      const body = await req.json();
      if (Array.isArray(body?.tickers)) tickers = body.tickers;
      else if (body?.ticker) tickers = [body.ticker];
      if (body?.limit) limit = Math.min(Number(body.limit), 100);
    } catch { /* no body */ }

    if (tickers.length === 0) {
      // Default: process all active stock symbols (oldest revisions first)
      const { data: revs } = await sb
        .from('analyst_revisions')
        .select('ticker, updated_at')
        .order('updated_at', { ascending: true });
      const stale = new Set((revs || []).map(r => r.ticker));

      const { data: syms } = await sb
        .from('symbols')
        .select('ticker')
        .eq('is_active', true)
        .eq('asset_type', 'stock')
        .limit(limit * 2);

      const all = (syms || []).map(s => s.ticker);
      // Prioritize tickers not in revisions table
      tickers = [...all.filter(t => !stale.has(t)), ...all.filter(t => stale.has(t))].slice(0, limit);
    }

    let surpriseInserts = 0;
    let revisionUpserts = 0;
    let insiderInserts = 0;

    for (const ticker of tickers) {
      const [surprises, revision, insiders] = await Promise.all([
        fetchEarningsSurprises(ticker, fmpKey),
        fetchAnalystRevisions(ticker, fmpKey),
        fetchInsiderTrades(ticker, fmpKey),
      ]);

      if (surprises.length > 0) {
        const { error } = await sb
          .from('earnings_surprises')
          .upsert(surprises, { onConflict: 'ticker,period' });
        if (!error) surpriseInserts += surprises.length;
      }
      if (revision) {
        const { error } = await sb
          .from('analyst_revisions')
          .upsert(revision, { onConflict: 'ticker' });
        if (!error) revisionUpserts++;
      }
      if (insiders.length > 0) {
        // Insert without dedup conflict-handling — duplicates on (ticker, date, name, shares) are tolerated
        // Soft-dedup: delete past 90d for ticker, then insert fresh batch
        await sb
          .from('insider_trades')
          .delete()
          .eq('ticker', ticker)
          .gte('transaction_date', new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().split('T')[0]);
        const { error } = await sb.from('insider_trades').insert(insiders);
        if (!error) insiderInserts += insiders.length;
      }

      // FMP free tier: ~250 calls/day → throttle
      await sleep(400);
    }

    return new Response(JSON.stringify({
      tickers_processed: tickers.length,
      surprise_inserts: surpriseInserts,
      revision_upserts: revisionUpserts,
      insider_inserts: insiderInserts,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
