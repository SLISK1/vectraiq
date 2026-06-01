import { describe, it, expect } from 'vitest';
import { dailyReturns, pearson, computeCorrelationMatrix } from '@/hooks/useCorrelation';

describe('dailyReturns', () => {
  it('computes simple period-over-period returns', () => {
    // 100 -> 110 -> 99 => +10%, -10%
    const r = dailyReturns([100, 110, 99]);
    expect(r).toHaveLength(2);
    expect(r[0]).toBeCloseTo(0.1, 10);
    expect(r[1]).toBeCloseTo(-0.1, 10);
  });

  it('returns empty for < 2 closes', () => {
    expect(dailyReturns([])).toEqual([]);
    expect(dailyReturns([100])).toEqual([]);
  });
});

describe('pearson', () => {
  it('returns 1 for perfectly positively correlated series', () => {
    const a = [1, 2, 3, 4, 5];
    const b = [2, 4, 6, 8, 10]; // exact linear transform
    expect(pearson(a, b)).toBeCloseTo(1, 10);
  });

  it('returns -1 for perfectly negatively correlated series', () => {
    const a = [1, 2, 3, 4, 5];
    const b = [5, 4, 3, 2, 1];
    expect(pearson(a, b)).toBeCloseTo(-1, 10);
  });

  it('returns ~0 for uncorrelated series', () => {
    // Symmetric construction => near-zero covariance.
    const a = [1, -1, 1, -1, 1, -1];
    const b = [1, 1, -1, -1, 1, 1];
    const r = pearson(a, b);
    expect(r).not.toBeNull();
    expect(Math.abs(r as number)).toBeLessThan(0.5);
  });

  it('returns null for a flat (zero-variance) series', () => {
    expect(pearson([3, 3, 3, 3], [1, 2, 3, 4])).toBeNull();
  });

  it('returns null for too few points', () => {
    expect(pearson([1], [2])).toBeNull();
  });
});

describe('computeCorrelationMatrix', () => {
  it('builds a symmetric matrix with 1.0 on the diagonal', () => {
    const tickers = ['AAA', 'BBB'];
    const returns = new Map<string, number[]>([
      ['AAA', [0.01, -0.02, 0.03, -0.01, 0.02]],
      ['BBB', [0.02, -0.04, 0.06, -0.02, 0.04]], // 2x AAA => corr 1
    ]);
    const res = computeCorrelationMatrix(tickers, returns, 0.7);
    expect(res.matrix[0][0]).toBe(1);
    expect(res.matrix[1][1]).toBe(1);
    expect(res.matrix[0][1]).toBeCloseTo(1, 10);
    expect(res.matrix[0][1]).toBe(res.matrix[1][0]); // symmetric
    expect(res.avgPairwise).toBeCloseTo(1, 10);
  });

  it('flags highly correlated pairs and forms a cluster', () => {
    // Three names that all move together (the "defense stocks" case).
    const base = [0.01, -0.02, 0.03, -0.01, 0.02, 0.015];
    const tickers = ['DEF1', 'DEF2', 'DEF3', 'TECH'];
    const returns = new Map<string, number[]>([
      ['DEF1', base],
      ['DEF2', base.map((x) => x * 1.1)],
      ['DEF3', base.map((x) => x * 0.9)],
      ['TECH', [0.02, 0.02, -0.02, -0.02, 0.02, 0.02]], // ~uncorrelated (|corr|≈0.10)
    ]);
    const res = computeCorrelationMatrix(tickers, returns, 0.7);
    // The three defense names should cluster together.
    expect(res.cluster.sort()).toEqual(['DEF1', 'DEF2', 'DEF3']);
    // Pairs among the defense names are flagged.
    const pairNames = res.highlyCorrelatedPairs.map((p) => [p.a, p.b].sort().join('-'));
    expect(pairNames).toContain('DEF1-DEF2');
    expect(pairNames).toContain('DEF1-DEF3');
    expect(pairNames).toContain('DEF2-DEF3');
  });

  it('reports no cluster when names are uncorrelated', () => {
    const tickers = ['X', 'Y'];
    const returns = new Map<string, number[]>([
      ['X', [0.01, -0.01, 0.01, -0.01, 0.01, -0.01]],
      ['Y', [0.01, 0.01, -0.01, -0.01, 0.01, 0.01]],
    ]);
    const res = computeCorrelationMatrix(tickers, returns, 0.7);
    expect(res.cluster).toEqual([]);
    expect(res.highlyCorrelatedPairs).toHaveLength(0);
  });
});
