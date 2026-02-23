// Unit tests for the scoring pipeline (A, D, E, G, H)
import { describe, it, expect } from 'vitest';
import { calculateModuleScore, getReliabilityFactor } from '@/lib/analysis/engine';
import type { ModuleSignal, Horizon, Direction } from '@/types/market';

const makeSignal = (
  module: string,
  direction: Direction,
  strength: number,
  weight: number,
  confidence = 60,
  coverage = 80
): ModuleSignal => ({
  module,
  direction,
  strength,
  horizon: '1d' as Horizon,
  confidence,
  evidence: [],
  coverage,
  weight,
});

describe('Score Scaling (A)', () => {
  it('max bullish signals => score near 100', () => {
    const signals = [
      makeSignal('technical', 'UP', 95, 30),
      makeSignal('quant', 'UP', 90, 20),
      makeSignal('sentiment', 'UP', 85, 15),
      makeSignal('volatility', 'UP', 80, 15),
      makeSignal('macro', 'UP', 80, 20),
    ];
    const totalWeight = signals.reduce((s, sig) => s + sig.weight, 0);
    const totalSigned = signals.reduce((s, sig) => s + calculateModuleScore(sig, totalWeight), 0);
    const normalizedScore = Math.round(50 + totalSigned / 2);
    expect(normalizedScore).toBeGreaterThan(75);
    expect(normalizedScore).toBeLessThanOrEqual(100);
  });

  it('max bearish signals => score near 0', () => {
    const signals = [
      makeSignal('technical', 'DOWN', 95, 30),
      makeSignal('quant', 'DOWN', 90, 20),
      makeSignal('sentiment', 'DOWN', 85, 15),
      makeSignal('volatility', 'DOWN', 80, 15),
      makeSignal('macro', 'DOWN', 80, 20),
    ];
    const totalWeight = signals.reduce((s, sig) => s + sig.weight, 0);
    const totalSigned = signals.reduce((s, sig) => s + calculateModuleScore(sig, totalWeight), 0);
    const normalizedScore = Math.round(50 + totalSigned / 2);
    expect(normalizedScore).toBeLessThan(25);
    expect(normalizedScore).toBeGreaterThanOrEqual(0);
  });

  it('balanced mix => score ~50', () => {
    const signals = [
      makeSignal('technical', 'UP', 70, 25),
      makeSignal('quant', 'DOWN', 70, 25),
      makeSignal('sentiment', 'UP', 60, 25),
      makeSignal('volatility', 'DOWN', 60, 25),
    ];
    const totalWeight = signals.reduce((s, sig) => s + sig.weight, 0);
    const totalSigned = signals.reduce((s, sig) => s + calculateModuleScore(sig, totalWeight), 0);
    const normalizedScore = Math.round(50 + totalSigned / 2);
    expect(normalizedScore).toBeGreaterThan(40);
    expect(normalizedScore).toBeLessThan(60);
  });

  it('direction matches sign of totalSignedScore (G)', () => {
    const signals = [
      makeSignal('technical', 'UP', 80, 50),
      makeSignal('quant', 'DOWN', 60, 50),
    ];
    const totalWeight = signals.reduce((s, sig) => s + sig.weight, 0);
    const totalSigned = signals.reduce((s, sig) => s + calculateModuleScore(sig, totalWeight), 0);
    const direction: Direction = totalSigned > 5 ? 'UP' : totalSigned < -5 ? 'DOWN' : 'NEUTRAL';
    
    // UP strength=80 => signed=(80-50)*2*1=60, weighted=60*0.5=30
    // DOWN strength=60 => signed=(60-50)*2*(-1)=-20, weighted=-20*0.5=-10
    // total=20 => direction should be UP
    expect(direction).toBe('UP');
    expect(totalSigned).toBeGreaterThan(5);
  });

  it('neutral strength (50) contributes zero', () => {
    const signal = makeSignal('technical', 'UP', 50, 100);
    const score = calculateModuleScore(signal, 100);
    expect(score).toBe(0);
  });
});

describe('Bayesian Shrinkage (D)', () => {
  it('no data => factor 1.0', () => {
    expect(getReliabilityFactor(null)).toBe(1.0);
  });

  it('too few predictions => factor 1.0', () => {
    expect(getReliabilityFactor({ hitRate: 0.9, totalPredictions: 2, correctPredictions: 2, reliabilityWeight: 1.2, lastUpdated: Date.now() })).toBe(1.0);
  });

  it('high hit rate with many predictions => factor ~1.2', () => {
    const factor = getReliabilityFactor({ hitRate: 0.7, totalPredictions: 100, correctPredictions: 70, reliabilityWeight: 1.0, lastUpdated: Date.now() });
    // posteriorMean = (70+10)/(100+20) = 80/120 = 0.667
    // factor = 1 + (0.667-0.5)*2 = 1 + 0.334 = 1.334 -> clamped to 1.3
    expect(factor).toBeGreaterThanOrEqual(1.2);
    expect(factor).toBeLessThanOrEqual(1.3);
  });

  it('low hit rate => factor ~0.7', () => {
    const factor = getReliabilityFactor({ hitRate: 0.3, totalPredictions: 100, correctPredictions: 30, reliabilityWeight: 1.0, lastUpdated: Date.now() });
    // posteriorMean = (30+10)/(100+20) = 40/120 = 0.333
    // factor = 1 + (0.333-0.5)*2 = 1 + (-0.334) = 0.666 -> clamped to 0.7
    expect(factor).toBe(0.7);
  });

  it('50% hit rate => factor ~1.0', () => {
    const factor = getReliabilityFactor({ hitRate: 0.5, totalPredictions: 100, correctPredictions: 50, reliabilityWeight: 1.0, lastUpdated: Date.now() });
    expect(factor).toBeCloseTo(1.0, 1);
  });
});

describe('NEUTRAL top contributors (H)', () => {
  it('NEUTRAL direction still shows contributors', () => {
    const signals = [
      makeSignal('technical', 'UP', 55, 25),
      makeSignal('quant', 'DOWN', 55, 25),
      makeSignal('sentiment', 'NEUTRAL', 50, 25),
      makeSignal('volatility', 'NEUTRAL', 50, 25),
    ];
    const totalWeight = signals.reduce((s, sig) => s + sig.weight, 0);
    const weightedScores = signals.map(s => calculateModuleScore(s, totalWeight));
    const totalSigned = weightedScores.reduce((s, v) => s + v, 0);
    
    // Should be ~0 (neutral)
    expect(Math.abs(totalSigned)).toBeLessThan(5);
    
    // Top contributors by absolute value should be non-empty
    const contributions = signals.map((s, i) => ({
      module: s.module,
      contribution: Math.round(weightedScores[i]),
    }));
    contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
    const topContribs = contributions.slice(0, 4);
    
    expect(topContribs.length).toBeGreaterThan(0);
  });
});
