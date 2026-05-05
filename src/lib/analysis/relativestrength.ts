// Relative Strength Module
//
// Compares the asset's own return to its sector and benchmark index over
// 1m / 3m / 6m windows. Cross-sectional momentum (beating peers) is one of the
// most robust empirical risk premia (Carhart 1997, Asness 2013).
//
// Inputs come pre-fetched in AnalysisContext.relativeStrength, populated by
// useMarketData from sector_returns_cache + index_returns_cache.

import { AnalysisResult, AnalysisContext } from './types';
import { Direction, Evidence } from '@/types/market';

// Compute the asset's own return over a number of trading days.
function ownReturn(prices: { close?: number; price: number }[], days: number): number | null {
  if (prices.length < days + 1) return null;
  const recent = prices[prices.length - 1];
  const past = prices[prices.length - 1 - days];
  const r = recent?.close ?? recent?.price;
  const p = past?.close ?? past?.price;
  if (!r || !p || p <= 0) return null;
  return (r - p) / p;
}

export const analyzeRelativeStrength = (context: AnalysisContext): AnalysisResult => {
  const evidence: Evidence[] = [];
  const rs = context.relativeStrength;
  const prices = context.priceHistory;

  // Compute own returns
  const own1m = ownReturn(prices, 21);
  const own3m = ownReturn(prices, 63);

  // Without sector/index baseline OR own returns we can't form an RS view
  if (!rs || (own1m === null && own3m === null)) {
    return {
      module: 'relativeStrength',
      direction: 'NEUTRAL',
      strength: 50,
      confidence: 25,
      coverage: 15,
      evidence: [{
        type: 'no_data',
        description: 'Sektor/index-baseline saknas',
        value: 'Behöver sector_returns_cache + 21d historik',
        timestamp: new Date().toISOString(),
        source: 'System',
      }],
      metadata: { source: 'no_data' },
    };
  }

  // Compute RS scores
  const rs1m = (own1m !== null && rs.sectorReturn1m !== null)
    ? own1m - (rs.sectorReturn1m ?? 0)
    : null;
  const vsIdx1m = (own1m !== null && rs.indexReturn1m !== null)
    ? own1m - (rs.indexReturn1m ?? 0)
    : null;

  // Combine: sector RS gets 60% weight, index RS gets 40% (sector matters more
  // for stock selection within a peer group; index for absolute regime).
  const components: Array<{ value: number; weight: number; label: string }> = [];
  if (rs1m !== null) components.push({ value: rs1m, weight: 0.6, label: 'vs sektor 1m' });
  if (vsIdx1m !== null) components.push({ value: vsIdx1m, weight: 0.4, label: 'vs index 1m' });

  if (components.length === 0) {
    return {
      module: 'relativeStrength',
      direction: 'NEUTRAL',
      strength: 50,
      confidence: 25,
      coverage: 20,
      evidence: [{
        type: 'no_data',
        description: 'Ingen jämförbar avkastning',
        value: 'Sektor/index-data saknas helt',
        timestamp: new Date().toISOString(),
        source: 'System',
      }],
      metadata: { source: 'partial' },
    };
  }

  const wSum = components.reduce((s, c) => s + c.weight, 0);
  const combinedRs = components.reduce((s, c) => s + c.value * c.weight, 0) / wSum;

  // Direction & strength: 5pp of RS = neutral threshold, 20pp = full strength
  let direction: Direction = 'NEUTRAL';
  if (combinedRs > 0.02) direction = 'UP';
  else if (combinedRs < -0.02) direction = 'DOWN';

  const magnitude = Math.min(1, Math.abs(combinedRs) / 0.20);
  const strength = Math.round(50 + magnitude * 40);

  // Build evidence
  if (rs1m !== null) {
    evidence.push({
      type: 'rs_sector',
      description: 'Relativ styrka vs sektor (1m)',
      value: `${rs1m >= 0 ? '+' : ''}${(rs1m * 100).toFixed(1)}pp`,
      timestamp: new Date().toISOString(),
      source: 'Sector Returns Cache',
    });
  }
  if (vsIdx1m !== null) {
    evidence.push({
      type: 'rs_index',
      description: `Relativ styrka vs ${rs.benchmark} (1m)`,
      value: `${vsIdx1m >= 0 ? '+' : ''}${(vsIdx1m * 100).toFixed(1)}pp`,
      timestamp: new Date().toISOString(),
      source: 'Index Returns Cache',
    });
  }
  if (own1m !== null) {
    evidence.push({
      type: 'own_return',
      description: 'Egen avkastning 1m',
      value: `${own1m >= 0 ? '+' : ''}${(own1m * 100).toFixed(1)}%`,
      timestamp: new Date().toISOString(),
      source: 'Price History',
    });
  }

  // Look for confirmation across timeframes (3m if available)
  if (own3m !== null && rs.sectorReturn1m !== null) {
    // Approximate 3m sector return: weight 1m by 3 (rough proxy when 3m cache not exposed here)
    const rs3mApprox = own3m - (rs.sectorReturn1m ?? 0) * 3;
    if (Math.sign(rs3mApprox) === Math.sign(combinedRs) && Math.abs(rs3mApprox) > 0.03) {
      evidence.push({
        type: 'multi_timeframe',
        description: 'RS-konsistent 1m & 3m',
        value: `${rs3mApprox >= 0 ? '+' : ''}${(rs3mApprox * 100).toFixed(1)}pp 3m`,
        timestamp: new Date().toISOString(),
        source: 'Multi-Timeframe',
      });
    }
  }

  // Confidence: more components agreeing = higher confidence
  const componentBonus = (rs1m !== null ? 15 : 0) + (vsIdx1m !== null ? 15 : 0);
  const magnitudeBonus = Math.round(magnitude * 20);
  const confidence = 35 + componentBonus + magnitudeBonus;

  return {
    module: 'relativeStrength',
    direction,
    strength: Math.max(35, Math.min(90, strength)),
    confidence: Math.max(30, Math.min(85, confidence)),
    coverage: Math.min(80, 30 + components.length * 25),
    evidence,
    metadata: {
      source: 'sector_index_cache',
      rs1m,
      vsIdx1m,
      benchmark: rs.benchmark,
      components: components.length,
    },
  };
};
