import { describe, it, expect } from 'vitest';
import {
  classifyMarketRegime,
  tiltWeightsForRegime,
  type MarketRegime,
} from '@/lib/analysis/regime';
import { DEFAULT_WEIGHTS } from '@/types/market';
import type { HorizonWeights } from '@/types/market';

// A crypto-style base with fundamental switched OFF — mirrors CRYPTO_WEIGHTS
// on short horizons. Built inline to keep this test self-contained (no engine import).
const fundamentalOffWeights: HorizonWeights = {
  technical: 35, fundamental: 0, sentiment: 15, measuredMoves: 0, quant: 25,
  macro: 0, volatility: 25, seasonal: 0, orderFlow: 0, ml: 0, events: 0,
  relativeStrength: 0, thesis: 0,
};

// ---- synthetic index-series helpers (mirrors technical-indicators.test.ts) ----

// Smooth uptrend: steadily rising closes (above a rising MA, low realized vol).
const bullSeries = (n = 260, start = 100, dailyGain = 0.4): number[] =>
  Array.from({ length: n }, (_, i) => start + i * dailyGain);

// Smooth downtrend: steadily falling closes (below a falling MA).
const bearSeries = (n = 260, start = 200, dailyLoss = 0.4): number[] =>
  Array.from({ length: n }, (_, i) => Math.max(1, start - i * dailyLoss));

// Range-bound: gentle sine oscillation around a constant level. Trendless with
// genuine-but-stable volatility (NOT perfectly flat, which would read as 0 vol
// → 100th percentile → extreme). Should classify SIDEWAYS.
const sidewaysSeries = (n = 260, level = 100, amp = 2, period = 20): number[] =>
  Array.from({ length: n }, (_, i) => level + amp * Math.sin((2 * Math.PI * i) / period));

const HORIZONS = Object.keys(DEFAULT_WEIGHTS) as (keyof typeof DEFAULT_WEIGHTS)[];
const sumWeights = (w: HorizonWeights): number =>
  (Object.values(w) as number[]).reduce((s, v) => s + v, 0);

describe('classifyMarketRegime', () => {
  it('classifies a steady uptrend as BULL', () => {
    const res = classifyMarketRegime(bullSeries());
    expect(res.regime).toBe('BULL');
    expect(res.trend).toBe('UP');
    expect(res.reasons.length).toBeGreaterThan(0);
  });

  it('classifies a steady downtrend as BEAR', () => {
    const res = classifyMarketRegime(bearSeries());
    expect(res.regime).toBe('BEAR');
    expect(res.trend).toBe('DOWN');
  });

  it('classifies a range-bound market as SIDEWAYS', () => {
    const res = classifyMarketRegime(sidewaysSeries());
    expect(res.regime).toBe('SIDEWAYS');
    expect(res.trend).toBe('FLAT');
  });

  it('flags an extreme volatility spike as BEAR even from a prior uptrend', () => {
    // Calm uptrend, then a violent crash tail → current realized vol is extreme.
    const calm = bullSeries(220, 100, 0.4);
    let last = calm[calm.length - 1];
    const crash: number[] = [];
    for (let i = 0; i < 40; i++) {
      // Large alternating swings push 60d realized vol into its extreme zone.
      last = last * (i % 2 === 0 ? 0.9 : 1.08);
      crash.push(last);
    }
    const res = classifyMarketRegime([...calm, ...crash]);
    expect(res.volPercentile).toBeGreaterThanOrEqual(80);
    expect(res.regime).toBe('BEAR');
  });

  it('returns low-confidence SIDEWAYS when data is too short', () => {
    const res = classifyMarketRegime([100, 101, 102, 103, 104]);
    expect(res.regime).toBe('SIDEWAYS');
    expect(res.confidence).toBeLessThan(25);
    expect(res.reasons.length).toBeGreaterThan(0);
  });

  it('handles empty / invalid input gracefully', () => {
    const res = classifyMarketRegime([]);
    expect(res.regime).toBe('SIDEWAYS');
    expect(res.volPercentile).toBe(50);
  });

  it('always returns a volPercentile within 0–100 and confidence within 25–90', () => {
    for (const series of [bullSeries(), bearSeries(), sidewaysSeries()]) {
      const res = classifyMarketRegime(series);
      expect(res.volPercentile).toBeGreaterThanOrEqual(0);
      expect(res.volPercentile).toBeLessThanOrEqual(100);
      expect(res.confidence).toBeGreaterThanOrEqual(25);
      expect(res.confidence).toBeLessThanOrEqual(90);
    }
  });
});

describe('tiltWeightsForRegime', () => {
  it('BULL is an identity (no change)', () => {
    for (const h of HORIZONS) {
      const base = DEFAULT_WEIGHTS[h];
      const tilted = tiltWeightsForRegime(base, 'BULL');
      expect(tilted).toEqual(base);
    }
  });

  it('does not mutate the input object', () => {
    const base = { ...DEFAULT_WEIGHTS['1d'] };
    const snapshot = { ...base };
    tiltWeightsForRegime(base, 'BEAR');
    expect(base).toEqual(snapshot);
  });

  it('preserves the total weight after tilting (renormalized) for every regime', () => {
    const regimes: MarketRegime[] = ['BULL', 'BEAR', 'SIDEWAYS'];
    for (const h of HORIZONS) {
      const base = DEFAULT_WEIGHTS[h];
      const baseTotal = sumWeights(base);
      for (const regime of regimes) {
        const tilted = tiltWeightsForRegime(base, regime);
        expect(sumWeights(tilted)).toBeCloseTo(baseTotal, 6);
      }
    }
  });

  it('BEAR downweights technical/quant and upweights volatility/fundamental (modest)', () => {
    // Use 1w where technical, quant, volatility AND fundamental are all > 0.
    const base = DEFAULT_WEIGHTS['1w'];
    const tilted = tiltWeightsForRegime(base, 'BEAR');
    expect(tilted.technical).toBeLessThan(base.technical);
    expect(tilted.quant).toBeLessThan(base.quant);
    expect(tilted.volatility).toBeGreaterThan(base.volatility);
    expect(tilted.fundamental).toBeGreaterThan(base.fundamental);
    // Modest: each leg moves only a few points (well under 6 after renorm).
    expect(Math.abs(tilted.technical - base.technical)).toBeLessThan(6);
  });

  it('SIDEWAYS favours mean-reversion-ish (quant/volatility) over trend (technical)', () => {
    const base = DEFAULT_WEIGHTS['1w'];
    const tilted = tiltWeightsForRegime(base, 'SIDEWAYS');
    expect(tilted.quant).toBeGreaterThan(base.quant);
    expect(tilted.volatility).toBeGreaterThan(base.volatility);
    expect(tilted.technical).toBeLessThan(base.technical);
  });

  it('never resurrects a module that is switched off in the base (e.g. crypto fundamental=0)', () => {
    // A crypto-style base has fundamental=0; BEAR would add +3, but the tilt only
    // touches modules already > 0, so it must stay 0.
    const base = fundamentalOffWeights;
    expect(base.fundamental).toBe(0);
    const tilted = tiltWeightsForRegime(base, 'BEAR');
    expect(tilted.fundamental).toBe(0);
  });

  it('keeps all weights non-negative', () => {
    const regimes: MarketRegime[] = ['BULL', 'BEAR', 'SIDEWAYS'];
    for (const h of HORIZONS) {
      for (const regime of regimes) {
        const tilted = tiltWeightsForRegime(DEFAULT_WEIGHTS[h], regime);
        for (const v of Object.values(tilted) as number[]) {
          expect(v).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});
