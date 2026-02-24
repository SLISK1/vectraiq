// Strategy Engine - Pure functions for candidate evaluation
// Used both client-side (preview) and server-side (edge function)

export interface StrategyConfig {
  portfolio_value: number;
  max_risk_pct: number;
  max_open_pos: number;
  max_sector_pct: number;
  mean_reversion_enabled: boolean;
  total_score_min: number;
  agreement_min: number;
  coverage_min: number;
  vol_risk_max: number;
  max_staleness_h: number;
  execution_policy: 'NEXT_OPEN' | 'NEXT_CLOSE' | 'LIMIT_AT_SIGNAL_PRICE';
  slippage_bps: number;
  commission_per_trade: number;
  commission_bps: number;
}

export interface AnalysisSnapshot {
  totalScore: number;
  confidence: number;
  trendStrength: number;
  trendDuration: number; // days
  reversalRisk: number;
  volatilityRisk: number;
  coverage: number;
  agreement: number; // signal agreement %
  staleness: number; // hours since last update
  stopLossPrice?: number;
  stopLossPct?: number;
  targetPrice?: number;
  entryPrice: number;
  signals: ModuleSignal[];
  hasFundamentalData: boolean;
}

export interface ModuleSignal {
  module: string;
  direction: 'UP' | 'DOWN' | 'NEUTRAL';
  strength: number;
  confidence: number;
  weight: number;
}

export type Regime = 'MOMENTUM' | 'FUNDAMENTAL' | 'MEAN_REVERSION';
export type CandidateStatus = 'candidate' | 'blocked' | 'waiting' | 'active';

export interface EvaluationResult {
  eligible: boolean;
  mode: Regime | null;
  status: CandidateStatus;
  reasons: string[];
  blockReasons: string[];
  suggestedOrder: SuggestedOrder | null;
  fundamentalExitAvailable: boolean;
}

export interface SuggestedOrder {
  side: 'long' | 'short';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number | null;
  rrRatio: number;
  positionSize: number;
  riskAmount: number;
}

// ---- Quality Gate ----
export function qualityGate(
  analysis: AnalysisSnapshot,
  config: StrategyConfig
): { pass: boolean; failures: string[] } {
  const failures: string[] = [];

  if (analysis.totalScore < config.total_score_min)
    failures.push(`TotalScore ${analysis.totalScore} < ${config.total_score_min}`);
  if (analysis.agreement < config.agreement_min)
    failures.push(`SignalEnighet ${analysis.agreement}% < ${config.agreement_min}%`);
  if (analysis.coverage < config.coverage_min)
    failures.push(`Datatäckning ${analysis.coverage}% < ${config.coverage_min}%`);
  if (analysis.volatilityRisk > config.vol_risk_max)
    failures.push(`VolatilitetsRisk ${analysis.volatilityRisk} > ${config.vol_risk_max}`);
  if (analysis.staleness > config.max_staleness_h)
    failures.push(`Data ${analysis.staleness}h gammal > ${config.max_staleness_h}h`);

  return { pass: failures.length === 0, failures };
}

// ---- Regime Classification ----
export function classifyRegime(
  analysis: AnalysisSnapshot,
  config: StrategyConfig
): { regime: Regime | null; reasons: string[] } {
  const reasons: string[] = [];
  const getSignal = (mod: string) =>
    analysis.signals.find((s) => s.module === mod);

  // 1. Fundamental Position (highest priority)
  const fundamental = getSignal('fundamental');
  if (fundamental) {
    const fundamentalWeight = fundamental.weight || 0;
    if (
      fundamental.direction === 'UP' &&
      fundamentalWeight >= 25 &&
      analysis.trendDuration >= 120 &&
      analysis.agreement >= 85
    ) {
      reasons.push('Fundamental signal UP med hög vikt och lång trend');
      return { regime: 'FUNDAMENTAL', reasons };
    }
  }

  // 2. Momentum Swing
  const quant = getSignal('quant');
  const measured = getSignal('measuredmoves');
  if (
    quant?.direction === 'UP' &&
    measured?.direction === 'UP' &&
    analysis.trendStrength >= 50 &&
    analysis.trendDuration >= 14 &&
    analysis.trendDuration <= 42
  ) {
    reasons.push('Kvant + MeasuredMoves UP, trendstyrka ≥50%, duration 2-6v');
    return { regime: 'MOMENTUM', reasons };
  }

  // 3. Mean Reversion (if enabled)
  if (config.mean_reversion_enabled) {
    if (
      quant?.direction === 'UP' &&
      analysis.trendStrength < 45 &&
      analysis.trendDuration <= 7
    ) {
      reasons.push('Kvant UP, låg trendstyrka, kort duration — mean reversion');
      return { regime: 'MEAN_REVERSION', reasons };
    }
  }

  if (!config.mean_reversion_enabled && quant?.direction === 'UP' && analysis.trendStrength < 45) {
    reasons.push('Mean Reversion möjlig men inaktiverad');
  }

  return { regime: null, reasons };
}

// ---- Position Sizing ----
export function calculatePositionSize(
  portfolioValue: number,
  riskPct: number,
  entryPrice: number,
  stopLoss: number
): { qty: number; riskAmount: number; valid: boolean } {
  if (!entryPrice || !stopLoss || entryPrice === stopLoss) {
    return { qty: 0, riskAmount: 0, valid: false };
  }
  const riskAmount = portfolioValue * (riskPct / 100);
  const riskPerShare = Math.abs(entryPrice - stopLoss);
  const qty = Math.floor(riskAmount / riskPerShare);
  return { qty: Math.max(0, qty), riskAmount, valid: qty > 0 };
}

// ---- Net PnL Calculation ----
export function calculateNetPnl(
  entryPrice: number,
  exitPrice: number,
  qty: number,
  slippageBps: number,
  commissionPerTrade: number,
  commissionBps: number
): {
  grossPnl: number;
  netPnl: number;
  effectiveEntry: number;
  effectiveExit: number;
  slippageCost: number;
  commissionCost: number;
} {
  const effectiveEntry = entryPrice * (1 + slippageBps / 10000);
  const effectiveExit = exitPrice * (1 - slippageBps / 10000);
  const grossPnl = (exitPrice - entryPrice) * qty;
  const notional = entryPrice * qty;
  const slippageCost = (effectiveEntry - entryPrice) * qty + (exitPrice - effectiveExit) * qty;
  const commissionCost = 2 * commissionPerTrade + notional * (2 * commissionBps / 10000);
  const netPnl = grossPnl - slippageCost - commissionCost;

  return { grossPnl, netPnl, effectiveEntry, effectiveExit, slippageCost, commissionCost };
}

// ---- Main Evaluation ----
export function evaluateCandidate(
  analysis: AnalysisSnapshot,
  config: StrategyConfig
): EvaluationResult {
  // Quality gate
  const gate = qualityGate(analysis, config);
  if (!gate.pass) {
    return {
      eligible: false,
      mode: null,
      status: 'blocked',
      reasons: [],
      blockReasons: gate.failures,
      suggestedOrder: null,
      fundamentalExitAvailable: false,
    };
  }

  // Regime classification
  const { regime, reasons } = classifyRegime(analysis, config);
  if (!regime) {
    return {
      eligible: false,
      mode: null,
      status: 'waiting',
      reasons: reasons.length > 0 ? reasons : ['Ingen regim matchade'],
      blockReasons: [],
      suggestedOrder: null,
      fundamentalExitAvailable: false,
    };
  }

  // Calculate entry/stop/target based on regime
  const entry = analysis.entryPrice;
  let stopLoss = analysis.stopLossPrice || entry * 0.96; // fallback 4%
  let takeProfit: number | null = null;
  let rrMultiple = 2.5;

  if (regime === 'MOMENTUM') {
    rrMultiple = 2.5;
    const risk = Math.abs(entry - stopLoss);
    takeProfit = entry + risk * rrMultiple;
  } else if (regime === 'FUNDAMENTAL') {
    stopLoss = analysis.stopLossPrice || entry * 0.96;
    takeProfit = null; // no fixed target
  } else if (regime === 'MEAN_REVERSION') {
    rrMultiple = 1.5;
    const risk = Math.abs(entry - stopLoss);
    takeProfit = entry + risk * rrMultiple;
  }

  const rrRatio = takeProfit
    ? Math.abs(takeProfit - entry) / Math.abs(entry - stopLoss)
    : 0;

  // Position size
  const { qty, riskAmount, valid } = calculatePositionSize(
    config.portfolio_value,
    config.max_risk_pct,
    entry,
    stopLoss
  );

  const suggestedOrder: SuggestedOrder | null = valid
    ? {
        side: 'long',
        entryPrice: entry,
        stopLoss,
        takeProfit,
        rrRatio,
        positionSize: qty,
        riskAmount,
      }
    : null;

  return {
    eligible: true,
    mode: regime,
    status: suggestedOrder ? 'active' : 'waiting',
    reasons,
    blockReasons: [],
    suggestedOrder,
    fundamentalExitAvailable: analysis.hasFundamentalData,
  };
}
