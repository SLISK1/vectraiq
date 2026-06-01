// Screener-side glue between a `SymbolWithPrice` and the pure screening models.
//
// Reads raw fundamentals from `symbol.metadata.fundamentals` (the same source
// ScreenerTable uses for P/E) and runs the deterministic models from
// `@/lib/analysis/screening`. Kept tiny and pure so the table/sorting code
// stays readable.

import {
  computePiotroskiFScore,
  computeAltmanZScore,
  computeMagicFormula,
  type ScreeningFundamentals,
  type AltmanZone,
} from '@/lib/analysis/screening';
import type { SymbolWithPrice } from '@/lib/api/database';

/** Pull the raw fundamentals object the edge function stored, untyped. */
const rawFundamentals = (symbol: SymbolWithPrice): Record<string, unknown> => {
  const meta = symbol.metadata as { fundamentals?: Record<string, unknown> } | null;
  return meta?.fundamentals ?? {};
};

/**
 * Map the stored fundamentals onto the screening input shape. The edge
 * function writes the same camelCase keys, so this is mostly a pass-through;
 * `marketCap` falls back to the latest price's market cap when the
 * fundamentals snapshot lacks it.
 */
export const toScreeningFundamentals = (symbol: SymbolWithPrice): ScreeningFundamentals => {
  const f = rawFundamentals(symbol);
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;

  const marketCap =
    num(f.marketCap) ??
    (symbol.latestPrice?.market_cap != null ? Number(symbol.latestPrice.market_cap) : null);

  return {
    netIncome: num(f.netIncome),
    revenue: num(f.revenue),
    grossProfit: num(f.grossProfit),
    operatingIncome: num(f.operatingIncome),
    operatingCashFlow: num(f.operatingCashFlow),
    totalAssets: num(f.totalAssets),
    totalLiabilities: num(f.totalLiabilities),
    currentAssets: num(f.currentAssets),
    currentLiabilities: num(f.currentLiabilities),
    longTermDebt: num(f.longTermDebt),
    retainedEarnings: num(f.retainedEarnings),
    sharesOutstanding: num(f.sharesOutstanding),
    netFixedAssets: num(f.netFixedAssets),
    workingCapital: num(f.workingCapital),
    marketCap,
    enterpriseValue: num(f.enterpriseValue),
    netIncomePrev: num(f.netIncomePrev),
    revenuePrev: num(f.revenuePrev),
    grossProfitPrev: num(f.grossProfitPrev),
    totalAssetsPrev: num(f.totalAssetsPrev),
    currentAssetsPrev: num(f.currentAssetsPrev),
    currentLiabilitiesPrev: num(f.currentLiabilitiesPrev),
    longTermDebtPrev: num(f.longTermDebtPrev),
    sharesOutstandingPrev: num(f.sharesOutstandingPrev),
  };
};

/** Per-symbol screening metrics consumed by the table. */
export interface SymbolScreeningMetrics {
  fScore: number | null;        // Piotroski 0..9
  fAvailable: number;           // how many of the 9 criteria were scorable
  altmanZ: number | null;
  altmanZone: AltmanZone | null;
  earningsYield: number | null; // fraction (×100 → %)
  returnOnCapital: number | null;
}

/** Compute all three models for one symbol. */
export const computeSymbolMetrics = (symbol: SymbolWithPrice): SymbolScreeningMetrics => {
  const f = toScreeningFundamentals(symbol);
  const piotroski = computePiotroskiFScore(f);
  const altman = computeAltmanZScore(f);
  const magic = computeMagicFormula(f);
  return {
    fScore: piotroski.score,
    fAvailable: piotroski.available,
    altmanZ: altman.score,
    altmanZone: altman.zone,
    earningsYield: magic.earningsYield,
    returnOnCapital: magic.returnOnCapital,
  };
};

/**
 * Greenblatt combined rank over a set of symbols.
 *
 * Each metric (earnings yield, return on capital) is ranked descending
 * (rank 1 = best) among the symbols that have that metric. The combined score
 * is the sum of the two ranks; lower is better. Symbols missing BOTH metrics
 * get a null combined rank. Symbols missing one metric are penalised with a
 * worst-possible rank for the missing side so they sort below fully-covered
 * peers (a standard Magic Formula treatment for incomplete data).
 *
 * Returns a Map keyed by symbol id → combined rank (1-based ordinal), or null.
 */
export const computeMagicRanks = (
  metrics: Map<string, SymbolScreeningMetrics>,
): Map<string, number | null> => {
  const ids = [...metrics.keys()];

  // Build descending rank lookups for each metric.
  const rankBy = (selector: (m: SymbolScreeningMetrics) => number | null): Map<string, number> => {
    const withVal = ids
      .map((id) => ({ id, v: selector(metrics.get(id)!) }))
      .filter((x): x is { id: string; v: number } => x.v !== null)
      .sort((a, b) => b.v - a.v); // descending: higher = better = rank 1
    const map = new Map<string, number>();
    withVal.forEach((x, i) => map.set(x.id, i + 1));
    return map;
  };

  const eyRanks = rankBy((m) => m.earningsYield);
  const rocRanks = rankBy((m) => m.returnOnCapital);
  // Worst rank used as the penalty for a missing metric.
  const worstEy = eyRanks.size + 1;
  const worstRoc = rocRanks.size + 1;

  // Combined score per symbol (sum of ranks; missing side penalised).
  const combined: { id: string; score: number }[] = [];
  for (const id of ids) {
    const hasEy = eyRanks.has(id);
    const hasRoc = rocRanks.has(id);
    if (!hasEy && !hasRoc) continue; // no data at all → null later
    const score = (eyRanks.get(id) ?? worstEy) + (rocRanks.get(id) ?? worstRoc);
    combined.push({ id, score });
  }

  // Turn combined scores into a final 1-based ordinal (lower score = better).
  combined.sort((a, b) => a.score - b.score);
  const result = new Map<string, number | null>();
  ids.forEach((id) => result.set(id, null));
  combined.forEach((x, i) => result.set(x.id, i + 1));
  return result;
};
