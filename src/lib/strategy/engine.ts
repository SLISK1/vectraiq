// Strategy Engine - Pure functions for candidate evaluation
// Used both client-side (preview) and server-side (edge function)

export interface StrategyConfig {
  portfolio_value: number;
  max_risk_pct: number;
  max_open_pos: number;
  max_sector_pct: number;
  mean_reversion_enabled: boolean;
  short_selling_enabled: boolean;
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
// For long: totalScore must exceed total_score_min (e.g. 60+)
// For short: totalScore must be below (100 - total_score_min) (e.g. 40-)
// Agreement, coverage, vol, staleness apply symmetrically
export function qualityGate(
  analysis: AnalysisSnapshot,
  config: StrategyConfig
): { pass: boolean; failures: string[]; side: 'long' | 'short' | null } {
  const failures: string[] = [];

  const longThreshold = config.total_score_min;
  const shortThreshold = 100 - config.total_score_min;
  const isLongCandidate = analysis.totalScore >= longThreshold;
  const isShortCandidate = config.short_selling_enabled && analysis.totalScore <= shortThreshold;

  if (!isLongCandidate && !isShortCandidate)
    failures.push(`TotalScore ${analysis.totalScore} — varken long (≥${longThreshold}) eller short (≤${shortThreshold})`);
  if (analysis.agreement < config.agreement_min)
    failures.push(`SignalEnighet ${analysis.agreement}% < ${config.agreement_min}%`);
  if (analysis.coverage < config.coverage_min)
    failures.push(`Datatäckning ${analysis.coverage}% < ${config.coverage_min}%`);
  if (analysis.volatilityRisk > config.vol_risk_max)
    failures.push(`VolatilitetsRisk ${analysis.volatilityRisk} > ${config.vol_risk_max}`);
  if (analysis.staleness > config.max_staleness_h)
    failures.push(`Data ${analysis.staleness}h gammal > ${config.max_staleness_h}h`);

  const side = isLongCandidate ? 'long' : isShortCandidate ? 'short' : null;
  return { pass: failures.length === 0, failures, side };
}

// ---- Regime Classification ----
// Now supports both long (UP) and short (DOWN) signal directions
export function classifyRegime(
  analysis: AnalysisSnapshot,
  config: StrategyConfig,
  side: 'long' | 'short'
): { regime: Regime | null; reasons: string[] } {
  const reasons: string[] = [];
  const getSignal = (mod: string) =>
    analysis.signals.find((s) => s.module === mod);

  const targetDir = side === 'long' ? 'UP' : 'DOWN';
  const dirLabel = side === 'long' ? 'UP' : 'DOWN';

  // 1. Fundamental Position (highest priority)
  const fundamental = getSignal('fundamental');
  if (fundamental) {
    const fundamentalWeight = fundamental.weight || 0;
    if (
      fundamental.direction === targetDir &&
      fundamentalWeight >= 25 &&
      analysis.trendDuration >= 120 &&
      analysis.agreement >= 85
    ) {
      reasons.push(`Fundamental signal ${dirLabel} med hög vikt och lång trend`);
      return { regime: 'FUNDAMENTAL', reasons };
    }
  }

  // 2. Momentum Swing
  const quant = getSignal('quant');
  const measured = getSignal('measuredmoves');
  if (
    quant?.direction === targetDir &&
    measured?.direction === targetDir &&
    analysis.trendStrength >= 50 &&
    analysis.trendDuration >= 14 &&
    analysis.trendDuration <= 42
  ) {
    reasons.push(`Kvant + MeasuredMoves ${dirLabel}, trendstyrka ≥50%, duration 2-6v`);
    return { regime: 'MOMENTUM', reasons };
  }

  // 3. Mean Reversion (if enabled) — only for long side
  if (config.mean_reversion_enabled && side === 'long') {
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

// ---- Volatility-Target Position Sizing ----
// Sizes a position so its *expected volatility contribution* equals a target
// percentage of the portfolio. This is the classic "vol targeting" approach:
// risky (high-vol) names get smaller positions, calm names get larger ones, so
// every position contributes a comparable amount of risk to the book.
//
// We express the instrument's risk as an ANNUALIZED volatility in price terms:
//   annualVol = dailyVolFraction * sqrt(tradingDaysPerYear)
// where dailyVolFraction is the stock's daily return stdev as a fraction
// (e.g. 0.02 = 2%/day). If you only have ATR, pass it via `atr` and we derive
// dailyVolFraction = atr / price (ATR is already a per-day price range proxy).
//
// Target notional is chosen so:
//   notional * annualVol = portfolioValue * (targetVolPct/100)
//   => notional = portfolioValue * (targetVolPct/100) / annualVol
//   => qty = floor(notional / price)
//
// Fail-safe: returns qty 0 / valid:false on any missing or non-positive input
// (price, portfolio, target, or a derivable volatility). Never throws.
export function volatilityTargetSize(params: {
  price: number;
  portfolioValue: number;
  targetVolPct: number; // desired annualized vol contribution, in % (e.g. 10)
  // Provide ONE of these as the risk estimate:
  dailyVolFraction?: number; // daily return stdev as a fraction (0.02 = 2%/day)
  atr?: number; // Average True Range in price units (per-day range proxy)
  tradingDaysPerYear?: number; // default 252
}): { qty: number; targetNotional: number; annualVol: number; valid: boolean } {
  const { price, portfolioValue, targetVolPct, dailyVolFraction, atr } = params;
  const tradingDaysPerYear = params.tradingDaysPerYear ?? 252;

  // Derive a daily volatility fraction from whichever input we were given.
  const dailyVol =
    dailyVolFraction != null && dailyVolFraction > 0
      ? dailyVolFraction
      : atr != null && atr > 0 && price > 0
      ? atr / price
      : 0;

  if (
    !(price > 0) ||
    !(portfolioValue > 0) ||
    !(targetVolPct > 0) ||
    !(dailyVol > 0) ||
    !(tradingDaysPerYear > 0)
  ) {
    return { qty: 0, targetNotional: 0, annualVol: 0, valid: false };
  }

  const annualVol = dailyVol * Math.sqrt(tradingDaysPerYear); // annualized, as a fraction
  const targetRisk = portfolioValue * (targetVolPct / 100);
  const targetNotional = targetRisk / annualVol;
  const qty = Math.floor(targetNotional / price);

  return { qty: Math.max(0, qty), targetNotional, annualVol, valid: qty > 0 };
}

// ---- Quarter-Kelly Position Sizing ----
// Kelly fraction f* = winProb - (1 - winProb) / payoffRatio
//   winProb     : probability the trade is a winner, in [0, 1]
//   payoffRatio : average win size / average loss size (a.k.a. reward/risk, b)
// Full Kelly maximizes long-run geometric growth but is famously TOO AGGRESSIVE
// in practice: its sizing is brutally sensitive to the inputs, and on real
// trading both winProb and payoffRatio are *estimated*, not known.
//
// !!! EDGE-ESTIMATE CAVEAT (READ THIS) !!!
// Kelly is only as trustworthy as the edge estimate fed into it. winProb and
// payoffRatio MUST come from a credible, out-of-sample source — i.e. the
// backtest / calibration layer — NOT from gut feel or a single in-sample fit.
// Overestimating the edge makes Kelly oversize and risk ruin. Therefore we:
//   1. use QUARTER Kelly (0.25 * f*) to blunt estimation error, and
//   2. clamp the result to [0, capFraction] with a hard default cap of 25% of
//      capital, so a bad edge estimate can never blow up the book.
// If you do not have a backtest-derived edge, DO NOT use this — fall back to
// fixed-fractional risk sizing (calculatePositionSize).
export const KELLY_FRACTION = 0.25; // quarter-Kelly multiplier
export const KELLY_MAX_FRACTION = 0.25; // hard cap: never risk >25% of capital

export function quarterKellySize(params: {
  winProb: number; // [0, 1], MUST be a backtest/calibration estimate
  payoffRatio: number; // avg win / avg loss (> 0)
  portfolioValue: number;
  price?: number; // optional: when provided, also returns a share qty
  kellyMultiplier?: number; // default 0.25 (quarter Kelly)
  capFraction?: number; // default 0.25 (max 25% of capital)
}): {
  fullKelly: number; // raw f* (may be negative => no edge)
  fraction: number; // applied fraction after multiplier + clamp, in [0, cap]
  capitalAllocation: number; // portfolioValue * fraction
  qty: number; // floor(capitalAllocation / price) when price given, else 0
  valid: boolean; // true only when there is a positive edge to size
} {
  const { winProb, payoffRatio, portfolioValue, price } = params;
  const kellyMultiplier = params.kellyMultiplier ?? KELLY_FRACTION;
  const capFraction = params.capFraction ?? KELLY_MAX_FRACTION;

  // Guard inputs. A non-positive payoff or out-of-range probability means we
  // cannot compute a meaningful edge — return a zero, invalid allocation.
  if (
    !(payoffRatio > 0) ||
    !(winProb >= 0 && winProb <= 1) ||
    !(portfolioValue > 0)
  ) {
    return { fullKelly: 0, fraction: 0, capitalAllocation: 0, qty: 0, valid: false };
  }

  const fullKelly = winProb - (1 - winProb) / payoffRatio;
  // Apply the quarter-Kelly multiplier, then clamp to [0, capFraction]. A
  // negative full-Kelly (no edge) clamps to 0 => no position.
  const fraction = Math.min(capFraction, Math.max(0, fullKelly * kellyMultiplier));
  const capitalAllocation = portfolioValue * fraction;
  const qty = price && price > 0 ? Math.floor(capitalAllocation / price) : 0;

  return { fullKelly, fraction, capitalAllocation, qty, valid: fraction > 0 };
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

// ---- Transaction-Cost Gate ----
// Safety margin required between expected move and round-trip costs.
// A signal must clear its costs by 1.5x to be worth showing — an edge that
// barely covers frictions is noise once real-world slippage/fees are included.
export const COST_SAFETY_MULT = 1.5;

// Pure helper: does the candidate's expected move beat its round-trip cost?
// Round-trip cost (entry + exit) expressed in basis points of notional:
//   2*slippage_bps          (slippage paid on both legs)
// + 2*commission_bps        (proportional commission on both legs)
// + (2*commission_per_trade / notional) * 10000   (flat fee per leg, as bps)
// The move "survives" only if expectedMoveBps >= roundTripCostBps * COST_SAFETY_MULT.
//
// Fail-open by design: when notional is non-positive (qty/entry unknown) the
// flat-fee term is dropped so the gate cannot reject on missing sizing data.
// Callers should skip the gate entirely when no expected move is available.
export function expectedMoveSurvivesCosts(
  expectedMovePct: number,
  entryPrice: number,
  qty: number,
  config: StrategyConfig
): { passes: boolean; expectedMoveBps: number; roundTripCostBps: number } {
  const expectedMoveBps = Math.abs(expectedMovePct) * 100; // 1% move = 100 bps
  const notional = entryPrice * qty;

  const slippageComponent = 2 * (config.slippage_bps || 0);
  const commissionBpsComponent = 2 * (config.commission_bps || 0);
  // Flat per-trade fee only contributes when we know the notional it spreads over.
  const flatFeeComponent =
    notional > 0 ? ((2 * (config.commission_per_trade || 0)) / notional) * 10000 : 0;
  const roundTripCostBps = slippageComponent + commissionBpsComponent + flatFeeComponent;

  // When costs are zero the threshold is zero, so any non-negative move passes.
  const passes = expectedMoveBps >= roundTripCostBps * COST_SAFETY_MULT;
  return { passes, expectedMoveBps, roundTripCostBps };
}

// ---- Main Evaluation ----
export function evaluateCandidate(
  analysis: AnalysisSnapshot,
  config: StrategyConfig,
  // Optional knobs. Defaults preserve legacy behavior for callers/tests that
  // pass only (analysis, config): the cost gate runs but is fail-open when no
  // expected move (take-profit/target) is available.
  options: { enableCostGate?: boolean } = {}
): EvaluationResult {
  const enableCostGate = options.enableCostGate ?? true;
  // Quality gate (now returns detected side)
  const gate = qualityGate(analysis, config);
  if (!gate.pass || !gate.side) {
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

  const side = gate.side;

  // Regime classification (now side-aware)
  const { regime, reasons } = classifyRegime(analysis, config, side);
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

  // Calculate entry/stop/target based on regime and side
  const entry = analysis.entryPrice;
  let stopLoss: number;
  let takeProfit: number | null = null;
  let rrMultiple = 2.5;

  if (side === 'long') {
    stopLoss = analysis.stopLossPrice || entry * 0.96; // 4% below
    if (regime === 'MOMENTUM') {
      rrMultiple = 2.5;
      takeProfit = entry + Math.abs(entry - stopLoss) * rrMultiple;
    } else if (regime === 'FUNDAMENTAL') {
      takeProfit = null;
    } else if (regime === 'MEAN_REVERSION') {
      rrMultiple = 1.5;
      takeProfit = entry + Math.abs(entry - stopLoss) * rrMultiple;
    }
  } else {
    // Short: stop above entry, target below entry
    // Only use stopLossPrice if it is above entry (i.e. a valid short stop)
    stopLoss =
      analysis.stopLossPrice && analysis.stopLossPrice > entry
        ? analysis.stopLossPrice
        : entry * 1.04; // 4% above
    if (regime === 'MOMENTUM') {
      rrMultiple = 2.5;
      takeProfit = entry - Math.abs(stopLoss - entry) * rrMultiple;
    } else if (regime === 'FUNDAMENTAL') {
      takeProfit = null;
    }
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

  // ---- Transaction-cost gate ----
  // Expected-move proxy: the entry->takeProfit distance. This is the most
  // honest proxy available here — it is the candidate's own declared profit
  // target, so we are asking "does the upside we are promising actually clear
  // the round-trip frictions?". When takeProfit is null (e.g. FUNDAMENTAL
  // regime has no fixed target) there is no honest move to test, so we skip
  // the gate (fail-open) rather than invent one. Same when sizing is invalid
  // (qty == 0) or costs are zero — in those cases the gate cannot reject.
  if (enableCostGate && valid && takeProfit != null && entry > 0) {
    const expectedMovePct = ((takeProfit - entry) / entry) * 100;
    const costCheck = expectedMoveSurvivesCosts(expectedMovePct, entry, qty, config);
    if (!costCheck.passes) {
      return {
        eligible: false,
        mode: regime,
        status: 'blocked',
        reasons,
        blockReasons: [
          `expected_move_below_costs — förväntad rörelse ${costCheck.expectedMoveBps.toFixed(1)}bps < ${(costCheck.roundTripCostBps * COST_SAFETY_MULT).toFixed(1)}bps (${costCheck.roundTripCostBps.toFixed(1)}bps round-trip × ${COST_SAFETY_MULT})`,
        ],
        suggestedOrder: null,
        fundamentalExitAvailable: analysis.hasFundamentalData,
      };
    }
  }

  const suggestedOrder: SuggestedOrder | null = valid
    ? {
        side,
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
