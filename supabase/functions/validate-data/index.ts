import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ---- TUNABLE data-quality thresholds ----
// Read-only sanity checks on price_history before data reaches the signal layer.
// Adjust per desk appetite — defaults are deliberately conservative.

// Trailing calendar days of price_history to scan per symbol.
const LOOKBACK_DAYS = 60;
// abs(daily close-to-close return) above this is flagged as an implausible jump
// (likely an unadjusted split or a bad tick). We warn — we can't confirm a split,
// so we never delete or "fix" the row. 0.40 = 40%.
const JUMP_THRESHOLD = 0.40;
// A symbol whose newest price_history row is older than this many calendar days
// (relative to today, UTC) is flagged as stale. The audit found a stale-price bug —
// this surfaces it. 7 days covers a long weekend + a holiday without false alarms.
const STALE_DAYS = 7;
// How many issue rows to insert per batch (avoid one-row-per-request N+1 writes).
const INSERT_BATCH_SIZE = 200;

interface SymbolRow {
  id: string;
  ticker: string;
}

interface PriceRow {
  date: string;          // YYYY-MM-DD
  close_price: number | null;
}

type Severity = 'info' | 'warning' | 'critical';

interface IssueRow {
  symbol_id: string;
  ticker: string;
  issue_type: string;
  severity: Severity;
  detail: Record<string, unknown>;
  detected_at: string;
  resolved: boolean;
}

// Today as a YYYY-MM-DD string in UTC — the boundary for future_date and staleness.
function todayUTC(): string {
  return new Date().toISOString().split('T')[0];
}

// Whole-day difference (>= 0) between two YYYY-MM-DD strings, in UTC.
function daysBetween(fromDate: string, toDate: string): number {
  const a = Date.parse(`${fromDate}T00:00:00Z`);
  const b = Date.parse(`${toDate}T00:00:00Z`);
  return Math.round((b - a) / (24 * 3600 * 1000));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const sb = createClient(supabaseUrl, serviceKey);

    // Only validate tradeable, data-bearing asset types. (metal prices come from a
    // different path and have sparse OHLCV; skip them to avoid noise.)
    const { data: symbols } = await sb
      .from('symbols')
      .select('id, ticker')
      .eq('is_active', true)
      .in('asset_type', ['stock', 'fund', 'crypto']);

    if (!symbols || symbols.length === 0) {
      return new Response(JSON.stringify({ scanned: 0, reason: 'no symbols' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const today = todayUTC();
    const fromDate = new Date(Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000)
      .toISOString().split('T')[0];

    const issuesByType: Record<string, number> = {};
    let critical = 0;
    let warning = 0;
    let info = 0;

    let pending: IssueRow[] = [];
    const flush = async () => {
      if (pending.length === 0) return;
      await sb.from('data_quality_issues').insert(pending);
      pending = [];
    };

    for (const sym of symbols as SymbolRow[]) {
      const detectedAt = new Date().toISOString();
      const found: IssueRow[] = [];
      const addIssue = (
        issueType: string,
        severity: Severity,
        detail: Record<string, unknown>,
      ) => {
        found.push({
          symbol_id: sym.id,
          ticker: sym.ticker,
          issue_type: issueType,
          severity,
          detail,
          detected_at: detectedAt,
          resolved: false,
        });
        issuesByType[issueType] = (issuesByType[issueType] || 0) + 1;
        if (severity === 'critical') critical++;
        else if (severity === 'warning') warning++;
        else info++;
      };

      // READ-ONLY: pull the trailing window, oldest first. We only read here —
      // price_history is never written or mutated by this function.
      const { data: rows } = await sb
        .from('price_history')
        .select('date, close_price')
        .eq('symbol_id', sym.id)
        .gte('date', fromDate)
        .order('date', { ascending: true });

      const prices = (rows || []) as PriceRow[];

      // ---- no_data (info): active symbol with no rows in the window ----
      if (prices.length === 0) {
        addIssue('no_data', 'info', {
          message: 'Inga prisrader i fönstret',
          lookback_days: LOOKBACK_DAYS,
        });
      } else {
        let prevClose: number | null = null;
        let prevDate: string | null = null;

        for (const row of prices) {
          const close = row.close_price === null ? null : Number(row.close_price);

          // ---- future_date (critical): row dated after today (UTC) ----
          if (row.date > today) {
            addIssue('future_date', 'critical', {
              date: row.date,
              today,
            });
          }

          // ---- nonpositive_price (critical): close <= 0 or null where a row exists ----
          if (close === null || !Number.isFinite(close) || close <= 0) {
            addIssue('nonpositive_price', 'critical', {
              date: row.date,
              close_price: row.close_price,
            });
            // Can't compute a meaningful return off a bad price — reset the anchor.
            prevClose = close !== null && Number.isFinite(close) && close > 0 ? close : null;
            prevDate = row.date;
            continue;
          }

          // ---- implausible_jump (warning): abs(daily return) > JUMP_THRESHOLD ----
          // Likely an unadjusted split or bad tick. We warn, not delete — we can't
          // confirm a split here. Only one jump (the largest) is recorded per symbol.
          if (prevClose !== null && prevClose > 0) {
            const ret = (close - prevClose) / prevClose;
            if (Math.abs(ret) > JUMP_THRESHOLD) {
              const existing = found.find(f => f.issue_type === 'implausible_jump');
              if (!existing || Math.abs(ret) > Math.abs((existing.detail.return as number) ?? 0)) {
                if (existing) {
                  // Replace with the larger jump but keep one row + counters stable.
                  existing.detail = {
                    date: row.date,
                    prev_date: prevDate,
                    prev_close: prevClose,
                    close,
                    return: Math.round(ret * 10000) / 10000,
                    threshold: JUMP_THRESHOLD,
                  };
                } else {
                  addIssue('implausible_jump', 'warning', {
                    date: row.date,
                    prev_date: prevDate,
                    prev_close: prevClose,
                    close,
                    return: Math.round(ret * 10000) / 10000,
                    threshold: JUMP_THRESHOLD,
                  });
                }
              }
            }
          }

          prevClose = close;
          prevDate = row.date;
        }

        // ---- stale_symbol (warning): newest row older than STALE_DAYS ----
        const newestDate = prices[prices.length - 1].date;
        const ageDays = daysBetween(newestDate, today);
        if (ageDays > STALE_DAYS) {
          addIssue('stale_symbol', 'warning', {
            latest_date: newestDate,
            age_days: ageDays,
            stale_days: STALE_DAYS,
          });
        }
      }

      // Idempotent re-scan: clear this symbol's existing unresolved rows, then
      // insert the current findings. Keeps the table from accumulating dupes
      // across daily runs while preserving anything an operator marked resolved.
      await sb
        .from('data_quality_issues')
        .delete()
        .eq('symbol_id', sym.id)
        .eq('resolved', false);

      if (found.length > 0) {
        pending.push(...found);
        if (pending.length >= INSERT_BATCH_SIZE) await flush();
      }
    }

    await flush();

    // ============================================================
    // Coverage-rapport: symbols → raw_prices → price_history → signals
    // Strikt read-only mot analyskedjan. Inga skrivningar utanför
    // data_quality_issues görs här — pipeline/signal-generering
    // triggas INTE av detta test.
    // ============================================================
    const nowIso = new Date().toISOString();
    const fresh7 = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const fresh30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const fresh2d = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
    const fresh30dDate = new Date(Date.now() - 30 * 24 * 3600 * 1000)
      .toISOString().split('T')[0];
    const fresh7dDate = new Date(Date.now() - 7 * 24 * 3600 * 1000)
      .toISOString().split('T')[0];

    const coverage: Record<string, unknown> = {};
    const missingSources: string[] = [];

    try {
      // symbols
      const { count: symTotal } = await sb.from('symbols')
        .select('id', { count: 'exact', head: true });
      const { count: symActive } = await sb.from('symbols')
        .select('id', { count: 'exact', head: true }).eq('is_active', true);
      coverage.symbols = { total: symTotal ?? 0, active: symActive ?? 0 };
      if ((symActive ?? 0) === 0) missingSources.push('symbols');

      // raw_prices (distinkta symboler, färska)
      const { data: rpFresh } = await sb.from('raw_prices')
        .select('symbol_id, updated_at')
        .gte('updated_at', fresh2d)
        .limit(5000);
      const rpFreshIds = new Set((rpFresh || []).map((r: any) => r.symbol_id));
      const { count: rpTotal } = await sb.from('raw_prices')
        .select('symbol_id', { count: 'exact', head: true });
      coverage.raw_prices = {
        rows_total: rpTotal ?? 0,
        symbols_fresh_2d: rpFreshIds.size,
      };
      if (rpFreshIds.size === 0) missingSources.push('raw_prices');

      // price_history (färsk per symbol)
      const { data: phFresh } = await sb.from('price_history')
        .select('symbol_id, date')
        .gte('date', fresh30dDate)
        .limit(20000);
      const phFreshIds = new Set((phFresh || []).map((r: any) => r.symbol_id));
      coverage.price_history = {
        symbols_fresh_30d: phFreshIds.size,
      };
      if (phFreshIds.size === 0) missingSources.push('price_history');

      // signals (färska)
      const { data: sigFresh } = await sb.from('signals')
        .select('symbol_id, ts')
        .gte('ts', fresh7)
        .limit(20000);
      const sigFreshIds = new Set((sigFresh || []).map((r: any) => r.symbol_id));
      coverage.signals = {
        symbols_fresh_7d: sigFreshIds.size,
      };
      if (sigFreshIds.size === 0) missingSources.push('signals');

      // news_cache (frihet att vara tom)
      const { count: newsFresh } = await sb.from('news_cache')
        .select('id', { count: 'exact', head: true })
        .gte('published_at', fresh7);
      coverage.news_cache = { rows_fresh_7d: newsFresh ?? 0 };
      if ((newsFresh ?? 0) === 0) missingSources.push('news_cache');

      // odds_snapshots
      const { count: oddsFresh } = await sb.from('odds_snapshots')
        .select('id', { count: 'exact', head: true })
        .gte('captured_at', fresh7);
      coverage.odds_snapshots = { rows_fresh_7d: oddsFresh ?? 0 };
      if ((oddsFresh ?? 0) === 0) missingSources.push('odds_snapshots');

      // Sätt issues för symboler som saknar dataled (UTAN att starta hämtningar)
      if (symbols && symbols.length > 0) {
        const stuck: IssueRow[] = [];
        for (const s of symbols as SymbolRow[]) {
          if (!phFreshIds.has(s.id)) {
            stuck.push({
              symbol_id: s.id,
              ticker: s.ticker,
              issue_type: 'stale_symbol',
              severity: 'warning',
              detail: { source: 'price_history', threshold_days: 30 },
              detected_at: nowIso,
              resolved: false,
            });
          }
        }
        // Slå inte ihop med tidigare per-symbol-flush; använd dedikerad insert.
        if (stuck.length > 0) {
          for (let i = 0; i < stuck.length; i += INSERT_BATCH_SIZE) {
            await sb.from('data_quality_issues')
              .insert(stuck.slice(i, i + INSERT_BATCH_SIZE));
          }
        }
      }
    } catch (covErr) {
      console.error('coverage computation failed:', covErr);
      coverage.error = String(covErr);
    }

    return new Response(JSON.stringify({
      scanned: symbols.length,
      issues_by_type: issuesByType,
      critical,
      warning,
      info,
      coverage,
      missing_sources: missingSources,
      generated_at: nowIso,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
