import { describe, it, expect } from 'vitest';
import {
  computeDepaGain,
  quoteLoss,
  schablonRate,
  computeSchablonTax,
  compareAccountTypes,
  buildK4Summary,
  CAPITAL_GAINS_TAX_RATE,
  SCHABLON_FLOOR_RATE,
  SCHABLONMETOD_COST_FRACTION,
  ISK_KF_FRIBELOPP_CAPITAL_DEFAULT,
  type TaxTrade,
} from '@/lib/tax';

// ============================================================
// DEPÅ — genomsnittsmetoden vs schablonmetoden
// ============================================================
describe('computeDepaGain — genomsnittsmetoden vs schablonmetoden', () => {
  it('uses genomsnittsmetoden when average cost is high (smaller gain → lower tax)', () => {
    // avg_cost 50 × 100 = 5000 omkostnadsbelopp; schablon = 20% × 10000 = 2000.
    // Genomsnitt gain 5000 (tax 1500) < schablon gain 8000 (tax 2400) → pick genomsnitt.
    const r = computeDepaGain(10000, 50, 100);
    expect(r.method).toBe('genomsnittsmetoden');
    expect(r.costBasisUsed).toBe(5000);
    expect(r.gain).toBe(5000);
    expect(r.tax).toBe(1500);
  });

  it('uses schablonmetoden when average cost is low (caps cost at 20% → lower tax)', () => {
    // avg_cost 10 × 100 = 1000 omkostnadsbelopp; schablon = 20% × 10000 = 2000.
    // Genomsnitt gain 9000 (tax 2700) > schablon gain 8000 (tax 2400) → pick schablon.
    const r = computeDepaGain(10000, 10, 100);
    expect(r.method).toBe('schablonmetoden');
    expect(r.costBasisUsed).toBe(SCHABLONMETOD_COST_FRACTION * 10000);
    expect(r.gain).toBe(8000);
    expect(r.tax).toBe(2400);
  });

  it('schablonmetoden omkostnadsbelopp is exactly 20% of the sale price', () => {
    const r = computeDepaGain(5000, 1, 100); // very low avg cost → schablon wins
    expect(r.costBasisSchablon).toBe(1000);
    expect(r.method).toBe('schablonmetoden');
  });

  it('LOSS case: keeps genomsnittsmetoden and reports a negative gain (never picks schablon)', () => {
    // avg_cost 60 × 100 = 6000; proceeds 4000 → loss -2000 (tax 0).
    // Schablon would invent a +2000 gain (tax 600), so genomsnitt is strictly better.
    const r = computeDepaGain(4000, 60, 100);
    expect(r.method).toBe('genomsnittsmetoden');
    expect(r.gain).toBe(-2000);
    expect(r.tax).toBe(0); // losses are not taxed here (handled via kvittning)
  });

  it('tax on a positive gain is 30% of the gain', () => {
    const r = computeDepaGain(2000, 5, 100); // avg cost 500, gain 1500
    expect(r.tax).toBeCloseTo(r.gain * CAPITAL_GAINS_TAX_RATE, 6);
  });

  it('respects allowSchablon=false (non-listed: genomsnittsmetoden only)', () => {
    // Low avg cost would normally favour schablon, but it's disallowed here.
    const r = computeDepaGain(10000, 10, 100, false);
    expect(r.method).toBe('genomsnittsmetoden');
    expect(r.gain).toBe(9000);
  });
});

describe('quoteLoss — kvotering of capital losses', () => {
  it('matches loss 100% against equity gains', () => {
    const r = quoteLoss(1000, 1000);
    expect(r.matchedAgainstEquityGains).toBe(1000);
    expect(r.spilledToOther).toBe(0);
    expect(r.deductibleAmount).toBe(1000); // 100% deductible
  });

  it('spills unmatched loss to other capital income at 70%', () => {
    const r = quoteLoss(1000, 0);
    expect(r.matchedAgainstEquityGains).toBe(0);
    expect(r.spilledToOther).toBe(1000);
    expect(r.deductibleAmount).toBe(700); // 70% kvotering
  });

  it('blends matched (100%) and spilled (70%) parts', () => {
    const r = quoteLoss(1000, 400);
    // 400 @ 100% + 600 @ 70% = 400 + 420 = 820
    expect(r.deductibleAmount).toBe(820);
  });
});

// ============================================================
// ISK / KF — schablonskatt
// ============================================================
describe('schablonRate — floor and statslåneränta', () => {
  it('applies the 1.25% floor when statslåneränta + uppräkning is below it', () => {
    // statslåneränta 0 + 1.0pp = 1.0% < 1.25% floor → floor wins.
    expect(schablonRate({ statslaneranta: 0 })).toBe(SCHABLON_FLOOR_RATE);
  });

  it('uses statslåneränta + uppräkning when above the floor', () => {
    // 3% + 1.0pp = 4.0% > 1.25% floor.
    expect(schablonRate({ statslaneranta: 0.03, upprakningPp: 0.01 })).toBeCloseTo(0.04, 6);
  });
});

describe('computeSchablonTax — schablonintäkt and fribelopp', () => {
  it('honours the 1.25% floor on the schablonräntesats', () => {
    // No fribelopp; floor rate; tax = base × 1.25% × 30%.
    const r = computeSchablonTax(100000, { statslaneranta: 0, fribelopp: 0 });
    expect(r.schablonRate).toBe(SCHABLON_FLOOR_RATE);
    expect(r.schablonintakt).toBeCloseTo(100000 * 0.0125, 4); // 1250
    expect(r.tax).toBeCloseTo(1250 * 0.3, 4); // 375
  });

  it('exempts capital up to the fribelopp', () => {
    // base 200k, fribelopp 150k → only 50k taxed; rate 3%.
    const r = computeSchablonTax(200000, { statslaneranta: 0.02, upprakningPp: 0.01, fribelopp: 150000 });
    expect(r.schablonRate).toBeCloseTo(0.03, 6);
    expect(r.taxableCapitalBase).toBe(50000);
    expect(r.schablonintakt).toBeCloseTo(1500, 4);
    expect(r.tax).toBeCloseTo(450, 4);
  });

  it('produces zero tax when the whole base is below the fribelopp', () => {
    const r = computeSchablonTax(100000, { fribelopp: 150000 });
    expect(r.taxableCapitalBase).toBe(0);
    expect(r.schablonintakt).toBe(0);
    expect(r.tax).toBe(0);
  });

  it('KF defaults to no ISK fribelopp', () => {
    // isKf: true → fribelopp defaults to 0, so the whole base is taxed.
    const kf = computeSchablonTax(200000, { statslaneranta: 0.02, isKf: true });
    expect(kf.fribelopp).toBe(0);
    expect(kf.taxableCapitalBase).toBe(200000);
  });

  it('ISK uses the default fribelopp when none is provided', () => {
    const isk = computeSchablonTax(1_000_000, { statslaneranta: 0.02 });
    expect(isk.fribelopp).toBe(ISK_KF_FRIBELOPP_CAPITAL_DEFAULT);
    expect(isk.taxableCapitalBase).toBe(1_000_000 - ISK_KF_FRIBELOPP_CAPITAL_DEFAULT);
  });
});

// ============================================================
// ACCOUNT-TYPE COMPARISON + turnover insight
// ============================================================
describe('compareAccountTypes', () => {
  it('returns one row per account type and computes the turnover ratio', () => {
    const c = compareAccountTypes({
      capitalBase: 500000,
      estimatedAnnualRealizedGains: 50000,
      annualTurnover: 250000,
    });
    expect(c.rows).toHaveLength(3);
    expect(c.rows.map((r) => r.accountType).sort()).toEqual(['depa', 'isk', 'kf']);
    expect(c.turnoverRatio).toBeCloseTo(0.5, 6); // 250k / 500k
    expect(c.highTurnover).toBe(false);
  });

  it('flags high turnover and favours ISK/KF over depå when gains are large', () => {
    // Big realized gains + high turnover → depå tax (30% × gains) dwarfs schablon.
    const c = compareAccountTypes({
      capitalBase: 500000,
      estimatedAnnualRealizedGains: 200000,
      annualTurnover: 2_000_000, // 400% turnover
    });
    expect(c.highTurnover).toBe(true);
    const depa = c.rows.find((r) => r.accountType === 'depa')!;
    const isk = c.rows.find((r) => r.accountType === 'isk')!;
    expect(depa.estimatedTax).toBeGreaterThan(isk.estimatedTax);
    expect(c.recommended).not.toBe('depa');
    expect(c.insight).toMatch(/omsättning/i);
  });

  it('favours depå when returns are negative (loss → negative tax / shield)', () => {
    // A loss makes depå tax negative (a shield), beating the always-positive schablon.
    const c = compareAccountTypes({
      capitalBase: 500000,
      estimatedAnnualRealizedGains: -50000,
      annualTurnover: 50000, // low turnover
    });
    const depa = c.rows.find((r) => r.accountType === 'depa')!;
    expect(depa.estimatedTax).toBeLessThan(0); // negative = skattereduktion
    expect(c.recommended).toBe('depa');
    expect(c.insight).toMatch(/förlust|negativ/i);
  });

  it('depå positive-gain tax equals 30% of the gain', () => {
    const c = compareAccountTypes({
      capitalBase: 1_000_000,
      estimatedAnnualRealizedGains: 100000,
      annualTurnover: 100000,
    });
    const depa = c.rows.find((r) => r.accountType === 'depa')!;
    expect(depa.estimatedTax).toBeCloseTo(100000 * CAPITAL_GAINS_TAX_RATE, 4); // 30000
  });
});

// ============================================================
// K4 — per-security summary (Avsnitt A)
// ============================================================
describe('buildK4Summary', () => {
  const trades: TaxTrade[] = [
    { ticker: 'VOLV-B', side: 'buy', qty: 100, price: 200, realized_gain: null },
    // Sold 50 @ 260, fee 0 → proceeds 13000, realized +3000 → omkostnad 10000.
    { ticker: 'VOLV-B', side: 'sell', qty: 50, price: 260, fee: 0, realized_gain: 3000 },
    // Sold 50 @ 180, fee 0 → proceeds 9000, realized -1000 → omkostnad 10000.
    { ticker: 'VOLV-B', side: 'sell', qty: 50, price: 180, fee: 0, realized_gain: -1000 },
    { ticker: 'ERIC-B', side: 'sell', qty: 10, price: 100, fee: 0, realized_gain: 200 },
  ];

  it('ignores buys and aggregates sells per security', () => {
    const k4 = buildK4Summary(trades);
    expect(k4.rows).toHaveLength(2); // VOLV-B + ERIC-B (buy excluded)
    const volvo = k4.rows.find((r) => r.beteckning === 'VOLV-B')!;
    expect(volvo.antal).toBe(100); // 50 + 50
    expect(volvo.forsaljningspris).toBe(13000 + 9000); // 22000
    expect(volvo.vinst).toBe(3000); // only positive part
    expect(volvo.forlust).toBe(1000); // absolute value of the negative part
  });

  it('derives omkostnadsbelopp as proceeds minus realized gain (genomsnittsmetoden)', () => {
    const k4 = buildK4Summary(trades);
    const volvo = k4.rows.find((r) => r.beteckning === 'VOLV-B')!;
    // (13000 - 3000) + (9000 - (-1000)) = 10000 + 10000 = 20000
    expect(volvo.omkostnadsbelopp).toBe(20000);
  });

  it('computes correct totals and net result', () => {
    const k4 = buildK4Summary(trades);
    expect(k4.totalVinst).toBe(3200); // 3000 + 200
    expect(k4.totalForlust).toBe(1000);
    expect(k4.nettoResultat).toBe(2200); // 3200 - 1000
  });

  it('subtracts fees from proceeds', () => {
    const withFee: TaxTrade[] = [
      { ticker: 'ABB', side: 'sell', qty: 10, price: 100, fee: 50, realized_gain: 100 },
    ];
    const k4 = buildK4Summary(withFee);
    expect(k4.rows[0].forsaljningspris).toBe(950); // 10*100 - 50
    expect(k4.rows[0].omkostnadsbelopp).toBe(850); // 950 - 100
  });

  it('skips sells with a missing realized_gain', () => {
    const noGain: TaxTrade[] = [
      { ticker: 'XYZ', side: 'sell', qty: 5, price: 50, realized_gain: null },
    ];
    expect(buildK4Summary(noGain).rows).toHaveLength(0);
  });

  it('returns an empty summary for no trades', () => {
    const k4 = buildK4Summary([]);
    expect(k4.rows).toHaveLength(0);
    expect(k4.nettoResultat).toBe(0);
  });
});
