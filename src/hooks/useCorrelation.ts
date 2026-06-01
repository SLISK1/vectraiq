import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, subDays } from 'date-fns';

// ============================================================
// useCorrelation — pairwise return-correlation across a set of tickers.
//
// Answers the plan's "same-bet" question: are several of our candidates/holdings
// really one trade in disguise (e.g. "five defense stocks moving together")?
// We fetch recent daily closes from public.price_history (reusing the exact
// query pattern from usePortfolioHistory — NO edge function), turn them into
// daily returns, and compute a pairwise Pearson correlation matrix.
// ============================================================

export interface CorrelationInput {
  ticker: string;
  symbol_id: string;
}

export interface CorrelationResult {
  tickers: string[]; // tickers that had enough data, in matrix order
  matrix: (number | null)[][]; // [i][j] Pearson corr in [-1, 1]; null = insufficient overlap
  avgPairwise: number | null; // mean of the upper-triangle correlations
  highlyCorrelatedPairs: { a: string; b: string; corr: number }[]; // |corr| above threshold
  cluster: string[]; // largest set of names that are mutually highly correlated
  skipped: string[]; // tickers dropped for too little price history
  highCorrThreshold: number;
  observations: number; // number of overlapping return days used (max across pairs)
}

// ---- Pure: simple daily returns from a close-price series ----
// r_t = (p_t / p_{t-1}) - 1. Needs >= 2 closes; returns [] otherwise.
export function dailyReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    if (prev > 0) out.push(closes[i] / prev - 1);
    else out.push(0);
  }
  return out;
}

// ---- Pure: Pearson correlation of two equal-length series ----
// Returns null when there is too little data (< 2 points) or a series has zero
// variance (a flat line has no defined correlation).
export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i];
    sumB += b[i];
  }
  const meanA = sumA / n;
  const meanB = sumB / n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (varA <= 0 || varB <= 0) return null;
  const r = cov / Math.sqrt(varA * varB);
  // Clamp tiny float overshoots into [-1, 1].
  return Math.max(-1, Math.min(1, r));
}

// ---- Pure: build the correlation matrix + concentration diagnostics ----
// `returnsByTicker` must be date-aligned per ticker (we align on shared dates
// before calling this). `highCorrThreshold` flags "same-bet" pairs.
export function computeCorrelationMatrix(
  tickers: string[],
  returnsByTicker: Map<string, number[]>,
  highCorrThreshold: number,
): Omit<CorrelationResult, 'skipped' | 'highCorrThreshold' | 'observations'> {
  const n = tickers.length;
  const matrix: (number | null)[][] = Array.from({ length: n }, () => Array(n).fill(null));
  const highlyCorrelatedPairs: { a: string; b: string; corr: number }[] = [];

  // Adjacency for clustering: which names are mutually highly correlated.
  const adj: Set<number>[] = Array.from({ length: n }, () => new Set<number>());

  let pairSum = 0;
  let pairCount = 0;

  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const r = pearson(returnsByTicker.get(tickers[i]) || [], returnsByTicker.get(tickers[j]) || []);
      matrix[i][j] = r;
      matrix[j][i] = r;
      if (r != null) {
        pairSum += r;
        pairCount++;
        if (Math.abs(r) >= highCorrThreshold) {
          highlyCorrelatedPairs.push({ a: tickers[i], b: tickers[j], corr: r });
          adj[i].add(j);
          adj[j].add(i);
        }
      }
    }
  }

  // Largest connected component among highly-correlated names (a "cluster" of
  // stocks that all move together). BFS over the high-corr adjacency graph.
  const seen = new Array<boolean>(n).fill(false);
  let cluster: string[] = [];
  for (let i = 0; i < n; i++) {
    if (seen[i]) continue;
    const stack = [i];
    const comp: number[] = [];
    seen[i] = true;
    while (stack.length) {
      const cur = stack.pop()!;
      comp.push(cur);
      for (const nb of adj[cur]) {
        if (!seen[nb]) {
          seen[nb] = true;
          stack.push(nb);
        }
      }
    }
    if (comp.length > cluster.length) cluster = comp.map((idx) => tickers[idx]);
  }
  // A lone node is not a cluster.
  if (cluster.length < 2) cluster = [];

  highlyCorrelatedPairs.sort((x, y) => Math.abs(y.corr) - Math.abs(x.corr));

  return {
    tickers,
    matrix,
    avgPairwise: pairCount > 0 ? pairSum / pairCount : null,
    highlyCorrelatedPairs,
    cluster,
  };
}

// Minimum overlapping return days required to trust a pair's correlation.
const MIN_OBSERVATIONS = 10;

// Fetch recent closes for many symbols (same pattern as usePortfolioHistory).
async function fetchCloses(symbolIds: string[], days: number): Promise<Map<string, Map<string, number>>> {
  const startDateStr = format(subDays(new Date(), days), 'yyyy-MM-dd');
  const { data, error } = await supabase
    .from('price_history')
    .select('symbol_id, date, close_price')
    .in('symbol_id', symbolIds)
    .gte('date', startDateStr)
    .order('date', { ascending: true });

  if (error) {
    console.error('useCorrelation: error fetching price history:', error);
    return new Map();
  }

  const bySymbol = new Map<string, Map<string, number>>();
  for (const row of data || []) {
    if (!bySymbol.has(row.symbol_id)) bySymbol.set(row.symbol_id, new Map());
    bySymbol.get(row.symbol_id)!.set(row.date, Number(row.close_price));
  }
  return bySymbol;
}

export interface UseCorrelationOptions {
  days?: number; // lookback window for price history (default 90)
  highCorrThreshold?: number; // |corr| flagged as "same bet" (default 0.7)
}

export function useCorrelation(items: CorrelationInput[], options: UseCorrelationOptions = {}) {
  const days = options.days ?? 90;
  const highCorrThreshold = options.highCorrThreshold ?? 0.7;

  // De-duplicate by ticker (a ticker may appear in several sources) and keep
  // a stable order for the matrix + a stable query key.
  const seen = new Set<string>();
  const unique: CorrelationInput[] = [];
  for (const it of items) {
    if (!it?.ticker || !it?.symbol_id) continue;
    if (seen.has(it.ticker)) continue;
    seen.add(it.ticker);
    unique.push({ ticker: it.ticker, symbol_id: it.symbol_id });
  }

  const keyPart = unique.map((u) => u.ticker).sort().join(',');

  return useQuery<CorrelationResult>({
    queryKey: ['correlation', days, highCorrThreshold, keyPart],
    queryFn: async () => {
      const empty: CorrelationResult = {
        tickers: [], matrix: [], avgPairwise: null, highlyCorrelatedPairs: [],
        cluster: [], skipped: [], highCorrThreshold, observations: 0,
      };
      if (unique.length < 2) return empty;

      const symbolIds = unique.map((u) => u.symbol_id);
      const closesBySymbol = await fetchCloses(symbolIds, days);

      // Build a date-aligned return series per ticker. We align on the
      // intersection of dates across each pair implicitly by computing returns
      // on each symbol's own dense series, then truncating to the common date
      // set so day i means the same day for every name.
      const datesBySymbol = new Map<string, string[]>();
      for (const u of unique) {
        const m = closesBySymbol.get(u.symbol_id);
        if (m) datesBySymbol.set(u.ticker, Array.from(m.keys()).sort());
      }

      // Common dates = intersection across all tickers that have data.
      let commonDates: string[] | null = null;
      for (const u of unique) {
        const ds = datesBySymbol.get(u.ticker);
        if (!ds || ds.length === 0) continue;
        const set = new Set(ds);
        commonDates = commonDates == null ? ds.slice() : commonDates.filter((d) => set.has(d));
      }
      commonDates = (commonDates || []).sort();

      const returnsByTicker = new Map<string, number[]>();
      const kept: string[] = [];
      const skipped: string[] = [];
      let observations = 0;

      for (const u of unique) {
        const m = closesBySymbol.get(u.symbol_id);
        if (!m || commonDates.length < MIN_OBSERVATIONS + 1) {
          skipped.push(u.ticker);
          continue;
        }
        const closes = commonDates.map((d) => m.get(d)).filter((v): v is number => v != null && v > 0);
        if (closes.length < MIN_OBSERVATIONS + 1) {
          skipped.push(u.ticker);
          continue;
        }
        const rets = dailyReturns(closes);
        returnsByTicker.set(u.ticker, rets);
        observations = Math.max(observations, rets.length);
        kept.push(u.ticker);
      }

      if (kept.length < 2) {
        return { ...empty, skipped };
      }

      const core = computeCorrelationMatrix(kept, returnsByTicker, highCorrThreshold);
      return { ...core, skipped, highCorrThreshold, observations };
    },
    enabled: unique.length >= 2,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
