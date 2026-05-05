// Tests for the signal-quality upgrade (2026-03-06)
//   - Sentiment: no longer a momentum proxy; reads from pre-fetched cache
//   - Events: blackout, PEAD, insider/analyst signals
//   - Relative strength: vs sector & benchmark index

import { describe, it, expect } from 'vitest';
import { analyzeSentimentFromContext, analyzeSentimentSync } from '@/lib/analysis/sentiment';
import { analyzeEvents, detectEventBlackout } from '@/lib/analysis/events';
import { analyzeRelativeStrength } from '@/lib/analysis/relativestrength';
import type { AnalysisContext, PriceData } from '@/lib/analysis/types';

const makePriceHistory = (count: number, startPrice = 100, dailyChange = 0): PriceData[] => {
  const out: PriceData[] = [];
  let p = startPrice;
  for (let i = 0; i < count; i++) {
    p = p * (1 + dailyChange);
    out.push({
      price: p, close: p, open: p, high: p * 1.01, low: p * 0.99, volume: 100_000,
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
  priceHistory: makePriceHistory(60, 90, 0.002),
  ...overrides,
});

describe('Sentiment dubbelräkning fix', () => {
  it('analyzeSentimentSync no longer uses momentum proxy — returns NEUTRAL with low coverage', () => {
    // Deliberately bullish momentum data — old code would have flagged UP
    const bullishHistory = makePriceHistory(30, 100, 0.02);
    const result = analyzeSentimentSync('TEST', 'Test', 'stock', '1w', bullishHistory);
    expect(result.direction).toBe('NEUTRAL');
    expect(result.coverage).toBeLessThan(30);
    expect(result.metadata?.source).toBe('no_data');
  });

  it('analyzeSentimentFromContext returns NEUTRAL when no news data present', () => {
    const ctx = baseContext();
    const result = analyzeSentimentFromContext(ctx);
    expect(result.direction).toBe('NEUTRAL');
    expect(result.coverage).toBeLessThan(30);
  });

  it('analyzeSentimentFromContext maps positive news → UP', () => {
    const ctx = baseContext({
      newsSentiment: {
        score: 0.5, magnitude: 0.7, articleCount: 6,
        positiveCount: 5, negativeCount: 1, topThemes: [],
        updatedAt: new Date().toISOString(),
      },
    });
    const result = analyzeSentimentFromContext(ctx);
    expect(result.direction).toBe('UP');
    expect(result.strength).toBeGreaterThan(50);
    expect(result.coverage).toBeGreaterThan(50);
  });

  it('analyzeSentimentFromContext maps negative news → DOWN', () => {
    const ctx = baseContext({
      newsSentiment: {
        score: -0.4, magnitude: 0.5, articleCount: 4,
        positiveCount: 1, negativeCount: 3, topThemes: [],
        updatedAt: new Date().toISOString(),
      },
    });
    const result = analyzeSentimentFromContext(ctx);
    expect(result.direction).toBe('DOWN');
    expect(result.strength).toBeGreaterThan(50);
  });

  it('stale news (10 days old) drops confidence significantly', () => {
    const fresh = baseContext({
      newsSentiment: {
        score: 0.5, magnitude: 0.7, articleCount: 6,
        positiveCount: 5, negativeCount: 1, topThemes: [],
        updatedAt: new Date().toISOString(),
      },
    });
    const stale = baseContext({
      newsSentiment: {
        score: 0.5, magnitude: 0.7, articleCount: 6,
        positiveCount: 5, negativeCount: 1, topThemes: [],
        updatedAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
      },
    });
    expect(analyzeSentimentFromContext(stale).confidence)
      .toBeLessThan(analyzeSentimentFromContext(fresh).confidence);
  });
});

describe('Event blackout', () => {
  it('detects earnings within 2 days as blackout', () => {
    const ctx = baseContext({
      upcomingEvents: [
        { type: 'earnings', date: new Date(Date.now() + 86_400_000).toISOString(),
          daysAway: 1, importance: 3, isMarketWide: false },
      ],
    });
    const b = detectEventBlackout(ctx);
    expect(b.active).toBe(true);
    expect(b.eventType).toBe('earnings');
  });

  it('does not blackout earnings 5 days away', () => {
    const ctx = baseContext({
      upcomingEvents: [
        { type: 'earnings', date: new Date(Date.now() + 5 * 86_400_000).toISOString(),
          daysAway: 5, importance: 3, isMarketWide: false },
      ],
    });
    expect(detectEventBlackout(ctx).active).toBe(false);
  });

  it('detects FOMC within 1 day as blackout (market-wide)', () => {
    const ctx = baseContext({
      upcomingEvents: [
        { type: 'fed', date: new Date(Date.now() + 86_400_000).toISOString(),
          daysAway: 1, importance: 3, isMarketWide: true },
      ],
    });
    expect(detectEventBlackout(ctx).active).toBe(true);
  });

  it('analyzeEvents returns NEUTRAL when blackout active, regardless of other signals', () => {
    const ctx = baseContext({
      upcomingEvents: [
        { type: 'earnings', date: new Date(Date.now() + 86_400_000).toISOString(),
          daysAway: 1, importance: 3, isMarketWide: false },
      ],
      eventSignals: {
        recentSurprise: { period: '2025-Q4', surprisePct: 0.2, daysSinceReport: 5 },
      },
    });
    const result = analyzeEvents(ctx);
    expect(result.direction).toBe('NEUTRAL');
    expect(result.confidence).toBeLessThanOrEqual(20);
    expect(result.metadata?.blackoutActive).toBe(true);
  });
});

describe('PEAD — post-earnings drift', () => {
  it('positive surprise 10% within 30 days → UP', () => {
    const ctx = baseContext({
      eventSignals: {
        recentSurprise: { period: '2026-Q1', surprisePct: 0.10, daysSinceReport: 7 },
      },
    });
    const result = analyzeEvents(ctx);
    expect(result.direction).toBe('UP');
    expect(result.strength).toBeGreaterThan(50);
  });

  it('negative surprise → DOWN', () => {
    const ctx = baseContext({
      eventSignals: {
        recentSurprise: { period: '2026-Q1', surprisePct: -0.15, daysSinceReport: 5 },
      },
    });
    expect(analyzeEvents(ctx).direction).toBe('DOWN');
  });

  it('small surprise (<5%) does not trigger PEAD', () => {
    const ctx = baseContext({
      eventSignals: {
        recentSurprise: { period: '2026-Q1', surprisePct: 0.03, daysSinceReport: 5 },
      },
    });
    expect(analyzeEvents(ctx).direction).toBe('NEUTRAL');
  });

  it('PEAD effect decays over 60 days', () => {
    const recent = baseContext({
      eventSignals: { recentSurprise: { period: '2026-Q1', surprisePct: 0.20, daysSinceReport: 5 } },
    });
    const old = baseContext({
      eventSignals: { recentSurprise: { period: '2026-Q1', surprisePct: 0.20, daysSinceReport: 50 } },
    });
    expect(analyzeEvents(recent).strength).toBeGreaterThan(analyzeEvents(old).strength);
  });
});

describe('Insider & analyst signals', () => {
  it('strong insider buying → UP', () => {
    const ctx = baseContext({
      eventSignals: {
        insiderActivity: { netBuysLast90d: 5, netValueUsdLast90d: 1_000_000 },
      },
    });
    expect(analyzeEvents(ctx).direction).toBe('UP');
  });

  it('analyst upgrades + insider buying compound the bullish strength', () => {
    const insiderOnly = baseContext({
      eventSignals: { insiderActivity: { netBuysLast90d: 3, netValueUsdLast90d: 500_000 } },
    });
    const both = baseContext({
      eventSignals: {
        insiderActivity: { netBuysLast90d: 3, netValueUsdLast90d: 500_000 },
        analystRevisions: { netRevisions30d: 4, consensus: 'buy' },
      },
    });
    // Both agreeing pushes the directional signal harder
    expect(analyzeEvents(both).strength).toBeGreaterThan(analyzeEvents(insiderOnly).strength);
  });
});

describe('Relative strength', () => {
  it('returns NEUTRAL with low coverage when no baseline', () => {
    const ctx = baseContext();
    const result = analyzeRelativeStrength(ctx);
    expect(result.direction).toBe('NEUTRAL');
    expect(result.coverage).toBeLessThan(30);
  });

  it('outperforming sector → UP', () => {
    // Own +15% over 21 days vs sector +5%
    const ctx = baseContext({
      priceHistory: makePriceHistory(40, 100, 0.007), // ~+15% over 21 days
      relativeStrength: {
        rs1m: null, rs3m: null, rs6m: null, vsIndex1m: null, vsIndex3m: null,
        sectorReturn1m: 0.05,
        indexReturn1m: 0.04,
        benchmark: 'OMXS30',
      },
    });
    const result = analyzeRelativeStrength(ctx);
    expect(result.direction).toBe('UP');
    expect(result.strength).toBeGreaterThan(50);
  });

  it('underperforming sector (own +3% vs sector +10%) → DOWN', () => {
    const ctx = baseContext({
      priceHistory: makePriceHistory(40, 100, 0.0015), // ~+3% over 21 days
      relativeStrength: {
        rs1m: null, rs3m: null, rs6m: null, vsIndex1m: null, vsIndex3m: null,
        sectorReturn1m: 0.10,
        indexReturn1m: 0.08,
        benchmark: 'OMXS30',
      },
    });
    expect(analyzeRelativeStrength(ctx).direction).toBe('DOWN');
  });

  it('matching sector return → NEUTRAL', () => {
    const ctx = baseContext({
      priceHistory: makePriceHistory(40, 100, 0.003),
      relativeStrength: {
        rs1m: null, rs3m: null, rs6m: null, vsIndex1m: null, vsIndex3m: null,
        sectorReturn1m: 0.06,
        indexReturn1m: 0.06,
        benchmark: 'OMXS30',
      },
    });
    expect(analyzeRelativeStrength(ctx).direction).toBe('NEUTRAL');
  });
});
