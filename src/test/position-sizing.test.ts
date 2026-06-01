import { describe, it, expect } from 'vitest';
import {
  volatilityTargetSize,
  quarterKellySize,
  KELLY_FRACTION,
  KELLY_MAX_FRACTION,
} from '@/lib/strategy/engine';

describe('volatilityTargetSize', () => {
  it('sizes from a daily volatility fraction (known inputs)', () => {
    // price=100, portfolio=1,000,000, target=10% annualized vol contribution.
    // dailyVol=2%/day => annualVol = 0.02 * sqrt(252) ≈ 0.31749
    // targetRisk = 1_000_000 * 0.10 = 100_000
    // targetNotional = 100_000 / 0.31749 ≈ 314_980
    // qty = floor(314_980 / 100) = 3149
    const r = volatilityTargetSize({
      price: 100,
      portfolioValue: 1_000_000,
      targetVolPct: 10,
      dailyVolFraction: 0.02,
    });
    expect(r.valid).toBe(true);
    expect(r.annualVol).toBeCloseTo(0.02 * Math.sqrt(252), 5);
    expect(r.targetNotional).toBeCloseTo(100_000 / (0.02 * Math.sqrt(252)), 0);
    expect(r.qty).toBe(3149);
  });

  it('derives daily vol from ATR when no fraction is supplied', () => {
    // ATR=2 on price=100 => dailyVol fraction = 0.02 — same as the case above.
    const fromAtr = volatilityTargetSize({
      price: 100,
      portfolioValue: 1_000_000,
      targetVolPct: 10,
      atr: 2,
    });
    const fromFraction = volatilityTargetSize({
      price: 100,
      portfolioValue: 1_000_000,
      targetVolPct: 10,
      dailyVolFraction: 0.02,
    });
    expect(fromAtr.qty).toBe(fromFraction.qty);
    expect(fromAtr.annualVol).toBeCloseTo(fromFraction.annualVol, 6);
  });

  it('higher volatility => smaller position', () => {
    const calm = volatilityTargetSize({ price: 100, portfolioValue: 1_000_000, targetVolPct: 10, dailyVolFraction: 0.01 });
    const wild = volatilityTargetSize({ price: 100, portfolioValue: 1_000_000, targetVolPct: 10, dailyVolFraction: 0.04 });
    expect(wild.qty).toBeLessThan(calm.qty);
    // 4x the daily vol => ~1/4 the size.
    expect(wild.qty).toBeCloseTo(calm.qty / 4, -1);
  });

  it('respects a custom tradingDaysPerYear', () => {
    const r = volatilityTargetSize({
      price: 100,
      portfolioValue: 1_000_000,
      targetVolPct: 10,
      dailyVolFraction: 0.02,
      tradingDaysPerYear: 100,
    });
    expect(r.annualVol).toBeCloseTo(0.02 * Math.sqrt(100), 6);
  });

  it('returns invalid on missing/non-positive inputs', () => {
    expect(volatilityTargetSize({ price: 0, portfolioValue: 1_000_000, targetVolPct: 10, dailyVolFraction: 0.02 }).valid).toBe(false);
    expect(volatilityTargetSize({ price: 100, portfolioValue: 0, targetVolPct: 10, dailyVolFraction: 0.02 }).valid).toBe(false);
    expect(volatilityTargetSize({ price: 100, portfolioValue: 1_000_000, targetVolPct: 0, dailyVolFraction: 0.02 }).valid).toBe(false);
    // No vol estimate at all (neither fraction nor ATR).
    expect(volatilityTargetSize({ price: 100, portfolioValue: 1_000_000, targetVolPct: 10 }).valid).toBe(false);
  });
});

describe('quarterKellySize', () => {
  it('computes full Kelly and quarter-Kelly fraction from known edge', () => {
    // winProb=0.6, payoff=2 => fullKelly = 0.6 - 0.4/2 = 0.6 - 0.2 = 0.4
    // quarter Kelly = 0.4 * 0.25 = 0.10 (10% of capital)
    const r = quarterKellySize({ winProb: 0.6, payoffRatio: 2, portfolioValue: 100_000, price: 50 });
    expect(r.fullKelly).toBeCloseTo(0.4, 10);
    expect(r.fraction).toBeCloseTo(0.1, 10);
    expect(r.capitalAllocation).toBeCloseTo(10_000, 6);
    // qty = floor(10_000 / 50) = 200
    expect(r.qty).toBe(200);
    expect(r.valid).toBe(true);
  });

  it('uses default quarter-Kelly multiplier of 0.25', () => {
    expect(KELLY_FRACTION).toBe(0.25);
    const r = quarterKellySize({ winProb: 0.6, payoffRatio: 2, portfolioValue: 100_000 });
    // Without price, qty is 0 but the fraction is still computed.
    expect(r.fraction).toBeCloseTo(0.4 * KELLY_FRACTION, 10);
    expect(r.qty).toBe(0);
  });

  it('clamps to the 25% capital cap even with a huge edge', () => {
    expect(KELLY_MAX_FRACTION).toBe(0.25);
    // winProb=0.95, payoff=5 => fullKelly = 0.95 - 0.05/5 = 0.94
    // quarter Kelly = 0.235 < cap (0.25) -> not capped yet.
    const moderate = quarterKellySize({ winProb: 0.95, payoffRatio: 5, portfolioValue: 100_000 });
    expect(moderate.fraction).toBeCloseTo(0.235, 6);
    // Force the multiplier high so the raw value exceeds the cap, prove the clamp.
    const capped = quarterKellySize({ winProb: 0.95, payoffRatio: 5, portfolioValue: 100_000, kellyMultiplier: 1 });
    expect(capped.fullKelly).toBeCloseTo(0.94, 10);
    expect(capped.fraction).toBe(0.25); // clamped to KELLY_MAX_FRACTION
  });

  it('returns zero fraction (no position) when there is no edge', () => {
    // winProb=0.4, payoff=1 => fullKelly = 0.4 - 0.6/1 = -0.2 (negative edge)
    const r = quarterKellySize({ winProb: 0.4, payoffRatio: 1, portfolioValue: 100_000, price: 50 });
    expect(r.fullKelly).toBeCloseTo(-0.2, 10);
    expect(r.fraction).toBe(0);
    expect(r.capitalAllocation).toBe(0);
    expect(r.qty).toBe(0);
    expect(r.valid).toBe(false);
  });

  it('honors a custom cap fraction', () => {
    // fullKelly=0.4, multiplier=1 => 0.4, capped to a custom 0.05.
    const r = quarterKellySize({ winProb: 0.6, payoffRatio: 2, portfolioValue: 100_000, kellyMultiplier: 1, capFraction: 0.05 });
    expect(r.fraction).toBe(0.05);
  });

  it('returns invalid on bad inputs (non-positive payoff, out-of-range prob)', () => {
    expect(quarterKellySize({ winProb: 0.6, payoffRatio: 0, portfolioValue: 100_000 }).valid).toBe(false);
    expect(quarterKellySize({ winProb: 1.5, payoffRatio: 2, portfolioValue: 100_000 }).valid).toBe(false);
    expect(quarterKellySize({ winProb: 0.6, payoffRatio: 2, portfolioValue: 0 }).valid).toBe(false);
  });
});
