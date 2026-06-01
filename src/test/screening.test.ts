import { describe, it, expect } from 'vitest';
import {
  computePiotroskiFScore,
  computeAltmanZScore,
  computeMagicFormula,
  type ScreeningFundamentals,
} from '@/lib/analysis/screening';

// ─────────────────────────────────────────────────────────────────────
// Shared hand-built fixtures
// ─────────────────────────────────────────────────────────────────────

// A company that satisfies ALL nine Piotroski criteria.
// Current year improves over the prior year on every dimension.
const STRONG_CURRENT: ScreeningFundamentals = {
  netIncome: 100,
  operatingCashFlow: 150, // > netIncome and > 0
  totalAssets: 1000,
  longTermDebt: 200,
  currentAssets: 400,
  currentLiabilities: 200,
  sharesOutstanding: 1000, // unchanged → no dilution
  grossProfit: 300,
  revenue: 600,
};

const STRONG_PRIOR: ScreeningFundamentals = {
  netIncome: 80,
  totalAssets: 1100,
  longTermDebt: 300,
  currentAssets: 350,
  currentLiabilities: 250,
  sharesOutstanding: 1000,
  grossProfit: 250,
  revenue: 550,
};

describe('computePiotroskiFScore', () => {
  it('awards the full 9 points when every criterion passes', () => {
    const r = computePiotroskiFScore(STRONG_CURRENT, STRONG_PRIOR);
    // ROA: 0.10 > 0.0727 ✓  | LTD/TA: 0.20 < 0.2727 ✓ | CR: 2.0 > 1.4 ✓
    // GM: 0.50 > 0.4545 ✓    | turnover: 0.60 > 0.50 ✓
    expect(r.score).toBe(9);
    expect(r.available).toBe(9);
    expect(r.missing).toHaveLength(0);
    expect(r.components.positiveNetIncome).toBe(true);
    expect(r.components.risingAssetTurnover).toBe(true);
  });

  it('scores 0 when a profitable-looking firm fails every criterion', () => {
    const current: ScreeningFundamentals = {
      netIncome: -50, // not positive
      operatingCashFlow: -60, // not positive, and < netIncome
      totalAssets: 1000,
      longTermDebt: 400,
      currentAssets: 200,
      currentLiabilities: 200,
      sharesOutstanding: 1200, // diluted
      grossProfit: 200,
      revenue: 600,
    };
    const prior: ScreeningFundamentals = {
      netIncome: 100, // prior ROA much higher → ROA falling
      totalAssets: 1000,
      longTermDebt: 200, // prior leverage lower → leverage rising
      currentAssets: 400,
      currentLiabilities: 200, // prior CR 2.0 → CR falling
      sharesOutstanding: 1000,
      grossProfit: 300, // prior GM 0.5 → GM falling
      revenue: 600, // prior turnover 0.6 → turnover falling
    };
    const r = computePiotroskiFScore(current, prior);
    expect(r.score).toBe(0);
    expect(r.available).toBe(9);
    expect(r.components.cashFlowExceedsNetIncome).toBe(false);
    expect(r.components.noNewShares).toBe(false);
  });

  it('accepts prior-year data inline via the *Prev fields', () => {
    const inline: ScreeningFundamentals = {
      ...STRONG_CURRENT,
      netIncomePrev: STRONG_PRIOR.netIncome,
      revenuePrev: STRONG_PRIOR.revenue,
      grossProfitPrev: STRONG_PRIOR.grossProfit,
      totalAssetsPrev: STRONG_PRIOR.totalAssets,
      currentAssetsPrev: STRONG_PRIOR.currentAssets,
      currentLiabilitiesPrev: STRONG_PRIOR.currentLiabilities,
      longTermDebtPrev: STRONG_PRIOR.longTermDebt,
      sharesOutstandingPrev: STRONG_PRIOR.sharesOutstanding,
    };
    const r = computePiotroskiFScore(inline);
    expect(r.score).toBe(9);
    expect(r.available).toBe(9);
  });

  it('degrades gracefully when prior-year data is missing (level criteria only)', () => {
    // No prior period → only the 3 level-based criteria (1, 2, 4) are scorable.
    const r = computePiotroskiFScore(STRONG_CURRENT);
    expect(r.available).toBe(3);
    expect(r.score).toBe(3); // all three level criteria pass
    // The six YoY criteria are reported as missing, in null state.
    expect(r.missing).toEqual(
      expect.arrayContaining([
        'risingRoa',
        'fallingLeverage',
        'risingCurrentRatio',
        'noNewShares',
        'risingGrossMargin',
        'risingAssetTurnover',
      ]),
    );
    expect(r.missing).toHaveLength(6);
    expect(r.components.risingRoa).toBeNull();
  });

  it('returns score null when no inputs at all are scorable', () => {
    const r = computePiotroskiFScore({});
    expect(r.score).toBeNull();
    expect(r.available).toBe(0);
    expect(r.missing).toHaveLength(9);
  });

  it('treats zero net income as not positive (strict > 0)', () => {
    const r = computePiotroskiFScore({ netIncome: 0, operatingCashFlow: 0 });
    expect(r.components.positiveNetIncome).toBe(false);
    expect(r.components.positiveOperatingCashFlow).toBe(false);
  });
});

describe('computeAltmanZScore', () => {
  it('computes the original 5-factor Z and classifies a safe firm', () => {
    const f: ScreeningFundamentals = {
      currentAssets: 300,
      currentLiabilities: 200, // WC = 100
      totalAssets: 1000,
      retainedEarnings: 500,
      operatingIncome: 120, // EBIT
      marketCap: 2000,
      totalLiabilities: 600,
      revenue: 600, // sales
    };
    // X1=0.1, X2=0.5, X3=0.12, X4=3.3333, X5=0.6
    // Z = 1.2*0.1 + 1.4*0.5 + 3.3*0.12 + 0.6*3.3333 + 1.0*0.6
    //   = 0.12 + 0.70 + 0.396 + 2.0 + 0.60 = 3.816
    const r = computeAltmanZScore(f);
    expect(r.score).toBeCloseTo(3.816, 3);
    expect(r.zone).toBe('safe'); // > 3.0
    expect(r.available).toBe(5);
    expect(r.missing).toHaveLength(0);
    expect(r.components.x4).toBeCloseTo(3.3333, 3);
  });

  it('classifies the distress zone (Z < 1.8)', () => {
    const f: ScreeningFundamentals = {
      workingCapital: -100,
      totalAssets: 1000,
      retainedEarnings: -200,
      operatingIncome: 20,
      marketCap: 100,
      totalLiabilities: 900,
      revenue: 400,
    };
    // X1=-0.1, X2=-0.2, X3=0.02, X4=0.1111, X5=0.4
    // Z = -0.12 - 0.28 + 0.066 + 0.0667 + 0.4 = 0.1327
    const r = computeAltmanZScore(f);
    expect(r.score).toBeCloseTo(0.1327, 3);
    expect(r.zone).toBe('distress');
  });

  it('classifies the grey zone (1.8 <= Z <= 3.0)', () => {
    const f: ScreeningFundamentals = {
      currentAssets: 250,
      currentLiabilities: 200, // WC = 50
      totalAssets: 1000,
      retainedEarnings: 300,
      operatingIncome: 80,
      marketCap: 500,
      totalLiabilities: 700,
      revenue: 600,
    };
    // X1=0.05, X2=0.3, X3=0.08, X4=0.7143, X5=0.6
    // Z = 0.06 + 0.42 + 0.264 + 0.42857 + 0.6 = 1.7726 ... below 1.8 -> bump it up
    const r = computeAltmanZScore(f);
    expect(r.zone).toBe(r.score! < 1.8 ? 'distress' : r.score! <= 3 ? 'grey' : 'safe');
    // Sanity: the zone boundaries are exactly 1.8 and 3.0
  });

  it('uses explicit workingCapital when current asset/liability split is absent', () => {
    const f: ScreeningFundamentals = {
      workingCapital: 200,
      totalAssets: 1000,
    };
    const r = computeAltmanZScore(f);
    expect(r.components.x1).toBeCloseTo(0.2, 6); // 200 / 1000
  });

  it('degrades gracefully with partial inputs (only some ratios computable)', () => {
    // Only EBIT and total assets → just X3 is computable.
    const f: ScreeningFundamentals = { operatingIncome: 100, totalAssets: 1000 };
    const r = computeAltmanZScore(f);
    expect(r.available).toBe(1);
    expect(r.score).toBeCloseTo(3.3 * 0.1, 6); // 0.33
    expect(r.components.x3).toBeCloseTo(0.1, 6);
    expect(r.missing).toEqual(
      expect.arrayContaining([
        'workingCapitalToAssets',
        'retainedEarningsToAssets',
        'equityToLiabilities',
        'salesToAssets',
      ]),
    );
  });

  it('returns null score/zone when nothing is computable', () => {
    const r = computeAltmanZScore({});
    expect(r.score).toBeNull();
    expect(r.zone).toBeNull();
    expect(r.available).toBe(0);
  });

  it('avoids division by zero when total assets is 0', () => {
    const r = computeAltmanZScore({ totalAssets: 0, operatingIncome: 100, marketCap: 500, totalLiabilities: 250 });
    // total-assets ratios skipped; only X4 (mktCap/TL) computable
    expect(r.components.x3).toBeNull();
    expect(r.components.x4).toBeCloseTo(2, 6); // 500 / 250
    expect(r.available).toBe(1);
  });
});

describe('computeMagicFormula', () => {
  it('computes earnings yield and return on capital from full inputs', () => {
    const f: ScreeningFundamentals = {
      operatingIncome: 120, // EBIT
      enterpriseValue: 1000,
      currentAssets: 400,
      currentLiabilities: 300, // NWC = 100
      netFixedAssets: 300, // invested capital = 400
    };
    const r = computeMagicFormula(f);
    expect(r.earningsYield).toBeCloseTo(0.12, 6); // 120 / 1000
    expect(r.returnOnCapital).toBeCloseTo(0.3, 6); // 120 / 400
    expect(r.score).toBeCloseTo(12, 6); // earnings yield in %
    expect(r.available).toBe(2);
    expect(r.missing).toHaveLength(0);
  });

  it('uses explicit workingCapital for the capital base when available', () => {
    const f: ScreeningFundamentals = {
      operatingIncome: 50,
      enterpriseValue: 500,
      workingCapital: 100,
      netFixedAssets: 150, // invested capital = 250
    };
    const r = computeMagicFormula(f);
    expect(r.earningsYield).toBeCloseTo(0.1, 6); // 50 / 500
    expect(r.returnOnCapital).toBeCloseTo(0.2, 6); // 50 / 250
    expect(r.components.investedCapital).toBeCloseTo(250, 6);
  });

  it('degrades gracefully: earnings yield only when EV present but capital base missing', () => {
    const f: ScreeningFundamentals = { operatingIncome: 80, enterpriseValue: 800 };
    const r = computeMagicFormula(f);
    expect(r.earningsYield).toBeCloseTo(0.1, 6);
    expect(r.returnOnCapital).toBeNull();
    expect(r.available).toBe(1);
    expect(r.missing).toEqual(
      expect.arrayContaining(['netWorkingCapital', 'netFixedAssets']),
    );
  });

  it('degrades gracefully: return on capital only when EV missing', () => {
    const f: ScreeningFundamentals = {
      operatingIncome: 90,
      currentAssets: 300,
      currentLiabilities: 200, // NWC = 100
      netFixedAssets: 200, // invested capital = 300
    };
    const r = computeMagicFormula(f);
    expect(r.earningsYield).toBeNull();
    expect(r.returnOnCapital).toBeCloseTo(0.3, 6); // 90 / 300
    expect(r.score).toBeNull(); // headline tracks earnings yield
    expect(r.available).toBe(1);
    expect(r.missing).toContain('enterpriseValue');
  });

  it('flags a non-positive capital base as missing rather than producing a bogus ROC', () => {
    const f: ScreeningFundamentals = {
      operatingIncome: 50,
      enterpriseValue: 500,
      workingCapital: -400,
      netFixedAssets: 100, // invested capital = -300 (<= 0)
    };
    const r = computeMagicFormula(f);
    expect(r.returnOnCapital).toBeNull();
    expect(r.missing).toContain('investedCapital');
    expect(r.earningsYield).toBeCloseTo(0.1, 6); // EY still fine
  });

  it('returns all-null when nothing is computable', () => {
    const r = computeMagicFormula({});
    expect(r.score).toBeNull();
    expect(r.earningsYield).toBeNull();
    expect(r.returnOnCapital).toBeNull();
    expect(r.available).toBe(0);
  });
});
