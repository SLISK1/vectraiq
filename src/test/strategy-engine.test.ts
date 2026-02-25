import { describe, it, expect } from 'vitest';
import {
  qualityGate,
  classifyRegime,
  calculatePositionSize,
  calculateNetPnl,
  evaluateCandidate,
  type StrategyConfig,
  type AnalysisSnapshot,
} from '@/lib/strategy/engine';

const baseConfig: StrategyConfig = {
  portfolio_value: 100000,
  max_risk_pct: 2,
  max_open_pos: 10,
  max_sector_pct: 30,
  mean_reversion_enabled: true,
  short_selling_enabled: false,
  total_score_min: 60,
  agreement_min: 50,
  coverage_min: 40,
  vol_risk_max: 80,
  max_staleness_h: 24,
  execution_policy: 'NEXT_OPEN',
  slippage_bps: 10,
  commission_per_trade: 1,
  commission_bps: 5,
};

const makeSnapshot = (overrides: Partial<AnalysisSnapshot> = {}): AnalysisSnapshot => ({
  totalScore: 70,
  confidence: 65,
  trendStrength: 55,
  trendDuration: 21,
  reversalRisk: 30,
  volatilityRisk: 40,
  coverage: 75,
  agreement: 70,
  staleness: 2,
  entryPrice: 100,
  stopLossPrice: 96,
  signals: [
    { module: 'quant', direction: 'UP', strength: 70, confidence: 60, weight: 20 },
    { module: 'measuredmoves', direction: 'UP', strength: 65, confidence: 55, weight: 15 },
    { module: 'fundamental', direction: 'UP', strength: 60, confidence: 50, weight: 25 },
  ],
  hasFundamentalData: true,
  ...overrides,
});

describe('qualityGate', () => {
  it('passes when all thresholds met (long)', () => {
    const result = qualityGate(makeSnapshot(), baseConfig);
    expect(result.pass).toBe(true);
    expect(result.side).toBe('long');
    expect(result.failures).toHaveLength(0);
  });

  it('fails when totalScore too low for long', () => {
    const result = qualityGate(makeSnapshot({ totalScore: 50 }), baseConfig);
    expect(result.pass).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
  });

  it('fails when agreement below threshold', () => {
    const result = qualityGate(makeSnapshot({ agreement: 30 }), baseConfig);
    expect(result.pass).toBe(false);
  });

  it('fails when data too stale', () => {
    const result = qualityGate(makeSnapshot({ staleness: 48 }), baseConfig);
    expect(result.pass).toBe(false);
  });

  it('detects short candidate when short selling enabled', () => {
    const config = { ...baseConfig, short_selling_enabled: true };
    const result = qualityGate(makeSnapshot({ totalScore: 30 }), config);
    expect(result.pass).toBe(true);
    expect(result.side).toBe('short');
  });

  it('blocks short candidate when short selling disabled', () => {
    const result = qualityGate(makeSnapshot({ totalScore: 30 }), baseConfig);
    expect(result.pass).toBe(false);
  });
});

describe('classifyRegime', () => {
  it('detects MOMENTUM regime for long', () => {
    const snapshot = makeSnapshot({
      trendStrength: 55,
      trendDuration: 21,
    });
    const result = classifyRegime(snapshot, baseConfig, 'long');
    expect(result.regime).toBe('MOMENTUM');
  });

  it('detects FUNDAMENTAL regime for long', () => {
    const snapshot = makeSnapshot({
      trendDuration: 150,
      agreement: 90,
      signals: [
        { module: 'fundamental', direction: 'UP', strength: 80, confidence: 70, weight: 30 },
        { module: 'quant', direction: 'UP', strength: 65, confidence: 60, weight: 20 },
      ],
    });
    const result = classifyRegime(snapshot, baseConfig, 'long');
    expect(result.regime).toBe('FUNDAMENTAL');
  });

  it('detects MEAN_REVERSION when enabled', () => {
    const snapshot = makeSnapshot({
      trendStrength: 30,
      trendDuration: 5,
      signals: [
        { module: 'quant', direction: 'UP', strength: 65, confidence: 60, weight: 20 },
      ],
    });
    const result = classifyRegime(snapshot, baseConfig, 'long');
    expect(result.regime).toBe('MEAN_REVERSION');
  });

  it('blocks MEAN_REVERSION when disabled', () => {
    const config = { ...baseConfig, mean_reversion_enabled: false };
    const snapshot = makeSnapshot({
      trendStrength: 30,
      trendDuration: 5,
      signals: [
        { module: 'quant', direction: 'UP', strength: 65, confidence: 60, weight: 20 },
      ],
    });
    const result = classifyRegime(snapshot, config, 'long');
    expect(result.regime).toBeNull();
  });

  it('detects MOMENTUM for short side', () => {
    const snapshot = makeSnapshot({
      totalScore: 25,
      trendStrength: 60,
      trendDuration: 21,
      signals: [
        { module: 'quant', direction: 'DOWN', strength: 70, confidence: 60, weight: 20 },
        { module: 'measuredmoves', direction: 'DOWN', strength: 65, confidence: 55, weight: 15 },
      ],
    });
    const result = classifyRegime(snapshot, baseConfig, 'short');
    expect(result.regime).toBe('MOMENTUM');
  });

  it('returns null when no regime matches', () => {
    const snapshot = makeSnapshot({
      trendStrength: 10,
      trendDuration: 100,
      signals: [
        { module: 'quant', direction: 'NEUTRAL', strength: 50, confidence: 50, weight: 20 },
      ],
    });
    const result = classifyRegime(snapshot, baseConfig, 'long');
    expect(result.regime).toBeNull();
  });
});

describe('calculatePositionSize', () => {
  it('calculates correct qty from risk budget', () => {
    // 100k portfolio, 2% risk = 2000 risk budget
    // Entry 100, StopLoss 96 => risk/share = 4
    // qty = 2000 / 4 = 500
    const result = calculatePositionSize(100000, 2, 100, 96);
    expect(result.qty).toBe(500);
    expect(result.riskAmount).toBe(2000);
    expect(result.valid).toBe(true);
  });

  it('returns invalid when entry equals stop', () => {
    const result = calculatePositionSize(100000, 2, 100, 100);
    expect(result.valid).toBe(false);
  });

  it('works for short positions (stop above entry)', () => {
    // Entry 100, StopLoss 104 => risk/share = 4
    // qty = 2000 / 4 = 500
    const result = calculatePositionSize(100000, 2, 100, 104);
    expect(result.qty).toBe(500);
    expect(result.valid).toBe(true);
  });
});

describe('calculateNetPnl', () => {
  it('calculates net PnL with slippage and commission', () => {
    const result = calculateNetPnl(100, 110, 100, 10, 1, 5);
    expect(result.grossPnl).toBe(1000); // (110-100)*100
    expect(result.netPnl).toBeLessThan(result.grossPnl);
    expect(result.slippageCost).toBeGreaterThan(0);
    expect(result.commissionCost).toBeGreaterThan(0);
  });

  it('net PnL can be negative even with positive gross', () => {
    // Tiny trade with high fees
    const result = calculateNetPnl(100, 100.01, 1, 100, 50, 100);
    expect(result.grossPnl).toBeGreaterThan(0);
    expect(result.netPnl).toBeLessThan(0);
  });
});

describe('evaluateCandidate (full pipeline)', () => {
  it('returns active with suggested order for good long candidate', () => {
    const result = evaluateCandidate(makeSnapshot(), baseConfig);
    expect(result.eligible).toBe(true);
    expect(result.status).toBe('active');
    expect(result.suggestedOrder).not.toBeNull();
    expect(result.suggestedOrder!.side).toBe('long');
    expect(result.suggestedOrder!.stopLoss).toBeLessThan(result.suggestedOrder!.entryPrice);
  });

  it('returns blocked for low-quality candidate', () => {
    const snapshot = makeSnapshot({ totalScore: 40, agreement: 30 });
    const result = evaluateCandidate(snapshot, baseConfig);
    expect(result.eligible).toBe(false);
    expect(result.status).toBe('blocked');
  });

  it('returns short order when short selling enabled with bearish signal', () => {
    const config = { ...baseConfig, short_selling_enabled: true };
    const snapshot = makeSnapshot({
      totalScore: 25,
      trendStrength: 55,
      trendDuration: 21,
      signals: [
        { module: 'quant', direction: 'DOWN', strength: 75, confidence: 60, weight: 20 },
        { module: 'measuredmoves', direction: 'DOWN', strength: 70, confidence: 55, weight: 15 },
      ],
    });
    const result = evaluateCandidate(snapshot, config);
    expect(result.eligible).toBe(true);
    expect(result.suggestedOrder!.side).toBe('short');
    expect(result.suggestedOrder!.stopLoss).toBeGreaterThan(result.suggestedOrder!.entryPrice);
  });
});
