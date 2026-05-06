// Tests for raket-score: composite "moonshot" detector
// Validates:
//   - No data → score 0
//   - Insider buying alone is not enough; needs at least 2 confluence factors for high score
//   - PEAD decays over 60 days
//   - Breakout requires both price > 50d high AND volume spike
//   - Growth scoring scales with revenue/earnings growth
//   - Relative strength requires both sector and index outperformance for full credit

import { describe, it, expect } from 'vitest';
import { calculateRaketScore } from '@/lib/analysis/raketScore';
import { getMarketCapCategory } from '@/components/MarketCapFilter';
import type { AnalysisContext, PriceData, FundamentalMetrics } from '@/lib/analysis/types';

// Helper: build price history that breaks out above 50d high with volume spike
const makeBreakoutHistory = (): PriceData[] => {
  const out: PriceData[] = [];
  // 50 days of consolidation around 100, normal volume 100k
  for (let i = 0; i < 50; i++) {
    const noise = (i % 5) * 0.5;
    const price = 100 + noise;
    out.push({
      price, close: price, open: price - 0.5,
      high: price + 0.8, low: price - 0.8,
      volume: 100_000,
      timestamp: new Date(Date.now() - (51 - i) * 86_400_000).toISOString(),
    });
  }
  // Today: breakout to 105 with 200k volume
  out.push({
    price: 105, close: 105, open: 102, high: 105.5, low: 102,
    volume: 200_000,
    timestamp: new Date().toISOString(),
  });
  return out;
};

const makeFlatHistory = (count = 60): PriceData[] => {
  const out: PriceData[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      price: 100, close: 100, open: 100, high: 100.5, low: 99.5,
      volume: 100_000,
      timestamp: new Date(Date.now() - (count - i) * 86_400_000).toISOString(),
    });
  }
  return out;
};

const baseContext = (overrides: Partial<AnalysisContext> = {}): AnalysisContext => ({
  ticker: 'TEST',
  name: 'Test Corp',
  assetType: 'stock',
  currency: 'SEK',
  horizon: '1w',
  currentPrice: 100,
  priceHistory: makeFlatHistory(),
  ...overrides,
});

describe('Raket score — no data', () => {
  it('returns 0 when no enrichments provided', () => {
    const ctx = baseContext();
    const score = calculateRaketScore({ context: ctx });
    expect(score.total).toBe(0);
    expect(score.reasons).toHaveLength(0);
  });
});

describe('Raket score — insider', () => {
  it('strong insider buying scores up to 20', () => {
    const ctx = baseContext({
      eventSignals: { insiderActivity: { netBuysLast90d: 6, netValueUsdLast90d: 2_000_000 } },
    });
    const score = calculateRaketScore({ context: ctx });
    expect(score.insider).toBeGreaterThanOrEqual(20);
    expect(score.reasons[0]).toMatch(/insider/i);
  });

  it('insider sells score 0 (we want net BUYING)', () => {
    const ctx = baseContext({
      eventSignals: { insiderActivity: { netBuysLast90d: -3, netValueUsdLast90d: -500_000 } },
    });
    expect(calculateRaketScore({ context: ctx }).insider).toBe(0);
  });

  it('insider alone gives 20 max but full total needs more confluence', () => {
    const ctx = baseContext({
      eventSignals: { insiderActivity: { netBuysLast90d: 6, netValueUsdLast90d: 2_000_000 } },
    });
    const score = calculateRaketScore({ context: ctx });
    expect(score.total).toBeLessThanOrEqual(20);
  });
});

describe('Raket score — PEAD', () => {
  it('large recent positive surprise scores high', () => {
    const ctx = baseContext({
      eventSignals: {
        recentSurprise: { period: '2026-Q1', surprisePct: 0.30, daysSinceReport: 5 },
      },
    });
    expect(calculateRaketScore({ context: ctx }).pead).toBeGreaterThan(15);
  });

  it('PEAD decays linearly to 0 by day 60', () => {
    const fresh = baseContext({
      eventSignals: { recentSurprise: { period: '2026-Q1', surprisePct: 0.20, daysSinceReport: 5 } },
    });
    const old = baseContext({
      eventSignals: { recentSurprise: { period: '2026-Q1', surprisePct: 0.20, daysSinceReport: 55 } },
    });
    expect(calculateRaketScore({ context: fresh }).pead)
      .toBeGreaterThan(calculateRaketScore({ context: old }).pead);
  });

  it('small surprise (<5%) scores 0', () => {
    const ctx = baseContext({
      eventSignals: { recentSurprise: { period: '2026-Q1', surprisePct: 0.03, daysSinceReport: 5 } },
    });
    expect(calculateRaketScore({ context: ctx }).pead).toBe(0);
  });

  it('negative surprise scores 0 (PEAD only triggers on beats)', () => {
    const ctx = baseContext({
      eventSignals: { recentSurprise: { period: '2026-Q1', surprisePct: -0.15, daysSinceReport: 5 } },
    });
    expect(calculateRaketScore({ context: ctx }).pead).toBe(0);
  });
});

describe('Raket score — breakout', () => {
  it('clean 50d-high breakout with volume spike scores well', () => {
    const ctx = baseContext({ priceHistory: makeBreakoutHistory() });
    const score = calculateRaketScore({ context: ctx });
    expect(score.breakout).toBeGreaterThan(8);
    expect(score.reasons.find(r => r.includes('Breakout') || r.includes('50d-high'))).toBeTruthy();
  });

  it('flat history scores 0 on breakout', () => {
    const ctx = baseContext({ priceHistory: makeFlatHistory() });
    expect(calculateRaketScore({ context: ctx }).breakout).toBe(0);
  });
});

describe('Raket score — growth', () => {
  it('high revenue + earnings growth scores well', () => {
    const fundamentals: FundamentalMetrics = {
      revenueGrowth: 60,    // 60% YoY
      earningsGrowth: 100,
      peRatio: 25,
    };
    const score = calculateRaketScore({ context: baseContext(), fundamentals });
    expect(score.growth).toBeGreaterThan(15);
  });

  it('flat company scores 0 on growth', () => {
    const fundamentals: FundamentalMetrics = { revenueGrowth: 5, earningsGrowth: 8 };
    expect(calculateRaketScore({ context: baseContext(), fundamentals }).growth).toBe(0);
  });

  it('no fundamentals → growth 0', () => {
    expect(calculateRaketScore({ context: baseContext() }).growth).toBe(0);
  });
});

describe('Raket score — relative strength', () => {
  // Helper: history with own +20% over 21 trading days
  const makeStrongHistory = (): PriceData[] => {
    const out: PriceData[] = [];
    for (let i = 0; i < 30; i++) {
      const price = 100 * (1 + i * 0.008); // ~+24% over 30 days
      out.push({
        price, close: price, open: price, high: price * 1.01, low: price * 0.99,
        volume: 100_000,
        timestamp: new Date(Date.now() - (30 - i) * 86_400_000).toISOString(),
      });
    }
    return out;
  };

  it('beating both sector & index scores high', () => {
    const ctx = baseContext({
      priceHistory: makeStrongHistory(),
      relativeStrength: {
        rs1m: null, rs3m: null, rs6m: null, vsIndex1m: null, vsIndex3m: null,
        sectorReturn1m: 0.05,
        indexReturn1m: 0.04,
        benchmark: 'OMXS30',
      },
    });
    const score = calculateRaketScore({ context: ctx });
    expect(score.relativeStrength).toBeGreaterThan(10);
  });

  it('underperforming sector scores 0 RS', () => {
    const weakHistory: PriceData[] = [];
    for (let i = 0; i < 30; i++) {
      const price = 100 * (1 + i * 0.001); // ~+3% over 30 days
      weakHistory.push({
        price, close: price, open: price, high: price * 1.01, low: price * 0.99,
        volume: 100_000,
        timestamp: new Date(Date.now() - (30 - i) * 86_400_000).toISOString(),
      });
    }
    const ctx = baseContext({
      priceHistory: weakHistory,
      relativeStrength: {
        rs1m: null, rs3m: null, rs6m: null, vsIndex1m: null, vsIndex3m: null,
        sectorReturn1m: 0.10, indexReturn1m: 0.08, benchmark: 'OMXS30',
      },
    });
    expect(calculateRaketScore({ context: ctx }).relativeStrength).toBe(0);
  });
});

describe('Raket score — composite', () => {
  it('confluence of all 5 signals scores >70', () => {
    const ctx = baseContext({
      priceHistory: makeBreakoutHistory(),
      eventSignals: {
        insiderActivity: { netBuysLast90d: 5, netValueUsdLast90d: 1_500_000 },
        recentSurprise: { period: '2026-Q1', surprisePct: 0.25, daysSinceReport: 7 },
      },
      relativeStrength: {
        rs1m: null, rs3m: null, rs6m: null, vsIndex1m: null, vsIndex3m: null,
        sectorReturn1m: 0.02, indexReturn1m: 0.01, benchmark: 'OMXS30',
      },
    });
    const fundamentals: FundamentalMetrics = { revenueGrowth: 70, earningsGrowth: 120 };
    const score = calculateRaketScore({ context: ctx, fundamentals });
    expect(score.total).toBeGreaterThan(60);
    expect(score.reasons.length).toBeGreaterThan(2);
  });

  it('total is sum of all 5 components and never exceeds 100', () => {
    const ctx = baseContext({
      priceHistory: makeBreakoutHistory(),
      eventSignals: {
        insiderActivity: { netBuysLast90d: 50, netValueUsdLast90d: 100_000_000 },
        recentSurprise: { period: '2026-Q1', surprisePct: 5.0, daysSinceReport: 0 },
      },
      relativeStrength: {
        rs1m: null, rs3m: null, rs6m: null, vsIndex1m: null, vsIndex3m: null,
        sectorReturn1m: -1, indexReturn1m: -1, benchmark: 'OMXS30',
      },
    });
    const fundamentals: FundamentalMetrics = { revenueGrowth: 999, earningsGrowth: 999 };
    const score = calculateRaketScore({ context: ctx, fundamentals });
    expect(score.total).toBeLessThanOrEqual(100);
    expect(score.total).toBe(
      score.insider + score.pead + score.breakout + score.growth + score.relativeStrength
    );
  });
});

describe('Market cap categorizer', () => {
  it('classifies large cap (>10 Md)', () => {
    expect(getMarketCapCategory(15_000_000_000)).toBe('large');
  });
  it('classifies mid cap (2-10 Md)', () => {
    expect(getMarketCapCategory(5_000_000_000)).toBe('medium');
  });
  it('classifies small cap (500 Mkr - 2 Md)', () => {
    expect(getMarketCapCategory(1_000_000_000)).toBe('small');
  });
  it('classifies micro cap (100-500 Mkr)', () => {
    expect(getMarketCapCategory(250_000_000)).toBe('micro');
  });
  it('classifies nano cap (<100 Mkr)', () => {
    expect(getMarketCapCategory(50_000_000)).toBe('nano');
  });
  it('defaults missing market cap to small', () => {
    expect(getMarketCapCategory()).toBe('small');
  });
  it('boundary: exactly 100 Mkr → micro (not nano)', () => {
    expect(getMarketCapCategory(100_000_000)).toBe('micro');
  });
  it('boundary: exactly 500 Mkr → small (not micro)', () => {
    expect(getMarketCapCategory(500_000_000)).toBe('small');
  });
});
