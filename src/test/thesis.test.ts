// Tests for the strategic thesis module + risk-class confidence capping.
// Validates:
//   - No data → NEUTRAL with low coverage (model doesn't fake confidence)
//   - High thesis score → UP signal with proportional strength
//   - Safety valve: thesis disagreeing with relative strength dampens confidence
//   - Stale thesis (>60d) reduces confidence
//   - Risk class multiplier returns expected values

import { describe, it, expect } from 'vitest';
import { analyzeThesis, getRiskClassMultiplier, RISK_CLASS_CONFIDENCE_MULTIPLIER } from '@/lib/analysis/thesis';
import type { AnalysisContext, PriceData, StrategicThesisData } from '@/lib/analysis/types';

const flatHistory = (count = 30): PriceData[] => {
  const out: PriceData[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      price: 100, close: 100, open: 100, high: 100.5, low: 99.5, volume: 100_000,
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
  horizon: '1mo',
  currentPrice: 100,
  priceHistory: flatHistory(),
  ...overrides,
});

const buildThesis = (overrides: Partial<StrategicThesisData> = {}): StrategicThesisData => ({
  thesisScore: 70,
  uniquenessScore: 7,
  moatScore: 7,
  marketSize: 'large',
  themes: ['ai'],
  thesisSummary: 'Sample thesis with sufficient detail to score reasonable coverage.',
  keyRisks: ['execution', 'competition'],
  catalysts: ['new product launch', 'expanding TAM'],
  modelUsed: 'gemini-3-flash-preview',
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe('Thesis — no data', () => {
  it('returns NEUTRAL with low coverage when no thesis present', () => {
    const result = analyzeThesis(baseContext());
    expect(result.direction).toBe('NEUTRAL');
    expect(result.coverage).toBeLessThan(20);
    expect(result.confidence).toBeLessThan(35);
    expect(result.metadata?.source).toBe('no_data');
  });
});

describe('Thesis — direction mapping', () => {
  it('high thesis score (>=65) → UP', () => {
    const ctx = baseContext({ strategicThesis: buildThesis({ thesisScore: 78 }) });
    const result = analyzeThesis(ctx);
    expect(result.direction).toBe('UP');
    expect(result.strength).toBeGreaterThan(50);
  });

  it('low thesis score (<=35) → DOWN', () => {
    const ctx = baseContext({ strategicThesis: buildThesis({ thesisScore: 25 }) });
    expect(analyzeThesis(ctx).direction).toBe('DOWN');
  });

  it('moderate score (50) → NEUTRAL (wide deadband)', () => {
    const ctx = baseContext({ strategicThesis: buildThesis({ thesisScore: 50 }) });
    expect(analyzeThesis(ctx).direction).toBe('NEUTRAL');
  });
});

describe('Thesis — confidence factors', () => {
  it('massive market + strong moat boosts confidence', () => {
    const small = baseContext({ strategicThesis: buildThesis({ marketSize: 'small', moatScore: 3, uniquenessScore: 3 }) });
    const massive = baseContext({ strategicThesis: buildThesis({ marketSize: 'massive', moatScore: 9, uniquenessScore: 9 }) });
    expect(analyzeThesis(massive).confidence).toBeGreaterThan(analyzeThesis(small).confidence);
  });

  it('stale thesis (>90d) reduces confidence', () => {
    const fresh = baseContext({ strategicThesis: buildThesis() });
    const stale = baseContext({
      strategicThesis: buildThesis({
        updatedAt: new Date(Date.now() - 100 * 86_400_000).toISOString(),
      }),
    });
    expect(analyzeThesis(stale).confidence).toBeLessThan(analyzeThesis(fresh).confidence);
  });
});

describe('Thesis — safety valve (RS divergence)', () => {
  it('halves confidence when thesis is UP but stock underperforms sector', () => {
    // Build history showing -8% over 21 days
    const weakHistory: PriceData[] = [];
    for (let i = 0; i < 30; i++) {
      const price = 100 * (1 - i * 0.003);
      weakHistory.push({
        price, close: price, open: price, high: price * 1.01, low: price * 0.99, volume: 100_000,
        timestamp: new Date(Date.now() - (30 - i) * 86_400_000).toISOString(),
      });
    }
    const noRs = baseContext({
      strategicThesis: buildThesis({ thesisScore: 80 }),
      priceHistory: weakHistory,
    });
    const withRsDivergence = baseContext({
      strategicThesis: buildThesis({ thesisScore: 80 }),
      priceHistory: weakHistory,
      relativeStrength: {
        rs1m: null, rs3m: null, rs6m: null, vsIndex1m: null, vsIndex3m: null,
        sectorReturn1m: 0.05, // sector +5% while stock -8%
        indexReturn1m: 0.04,
        benchmark: 'OMXS30',
      },
    });
    expect(analyzeThesis(withRsDivergence).confidence)
      .toBeLessThan(analyzeThesis(noRs).confidence);
  });
});

describe('Risk class multipliers', () => {
  it('main = 1.0 (no cap)', () => {
    expect(getRiskClassMultiplier('main')).toBe(1.0);
  });
  it('first_north = 0.85', () => {
    expect(getRiskClassMultiplier('first_north')).toBe(0.85);
  });
  it('growth = 0.85', () => {
    expect(getRiskClassMultiplier('growth')).toBe(0.85);
  });
  it('spotlight = 0.65', () => {
    expect(getRiskClassMultiplier('spotlight')).toBe(0.65);
  });
  it('pre_revenue = 0.55 (most aggressive cap)', () => {
    expect(getRiskClassMultiplier('pre_revenue')).toBe(0.55);
  });
  it('high_risk = 0.70', () => {
    expect(getRiskClassMultiplier('high_risk')).toBe(0.70);
  });
  it('unknown class defaults to 1.0', () => {
    expect(getRiskClassMultiplier('unknown_class')).toBe(1.0);
    expect(getRiskClassMultiplier(undefined)).toBe(1.0);
  });
  it('all configured classes have multipliers in [0.5, 1.0]', () => {
    for (const [, mul] of Object.entries(RISK_CLASS_CONFIDENCE_MULTIPLIER)) {
      expect(mul).toBeGreaterThanOrEqual(0.5);
      expect(mul).toBeLessThanOrEqual(1.0);
    }
  });
  it('pre_revenue is more aggressive than first_north', () => {
    expect(RISK_CLASS_CONFIDENCE_MULTIPLIER.pre_revenue)
      .toBeLessThan(RISK_CLASS_CONFIDENCE_MULTIPLIER.first_north);
  });
});
