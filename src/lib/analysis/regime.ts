// Market-Regime Detection (bull / bear / sideways)
// ------------------------------------------------------------------
// Classifies the overall MARKET STATE from a benchmark index series
// (e.g. OMXS30 / OMXSPI closes) and exposes a pure helper that can
// MODESTLY tilt the per-horizon signal weights toward defensive or
// mean-reversion-ish modules depending on that state.
//
// This is intentionally SEPARATE from:
//   • the per-asset volatility regime (lib/analysis/volatility.ts), and
//   • the per-candidate strategy mode classifyRegime (lib/strategy/engine.ts).
// It answers a different question: "what is the broad market doing?".
//
// ===================== OVERFITTING CAVEAT =========================
// These rules are deliberately SIMPLE and use round, widely-published
// thresholds (200-day MA for trend, a 60-day realized-vol percentile
// for stress). We do NOT tune cut-offs to maximise in-sample hit rate,
// because a regime classifier fit too tightly to one history tends to
// flip-flop and fail out-of-sample (OOS). The goal is a robust, honest
// "weather report", not an optimised trading signal. Treat the output
// as a soft prior — hence the tilts in tiltWeightsForRegime are small
// (a few points) and never zero out a module.
// ==================================================================

import { HorizonWeights } from '@/types/market';

export type MarketRegime = 'BULL' | 'BEAR' | 'SIDEWAYS';

export interface MarketRegimeResult {
  regime: MarketRegime;
  /** Trend reading derived from price vs the long moving average. */
  trend: 'UP' | 'DOWN' | 'FLAT';
  /**
   * Where current realized volatility sits within its own trailing
   * distribution, 0–100. ~50 = typical, >~80 = stressed/extreme.
   */
  volPercentile: number;
  /** 0–100 — how cleanly the rules agree (distance from the borderline). */
  confidence: number;
  /** Human-readable Swedish explanations for the badge tooltip. */
  reasons: string[];
}

// -------------------- thresholds (documented) --------------------
// Long-trend MA window. 200 trading days ≈ 1 year — the canonical
// "is the market in a long-term uptrend?" line used across finance.
const LONG_MA_PERIOD = 200;
// Slope is measured over ~21 trading days (≈1 month) of the MA so a
// single noisy day cannot flip "rising" vs "falling".
const MA_SLOPE_LOOKBACK = 21;
// A flat band around the MA: price within ±2% of the MA is treated as
// "at the MA" (neither clearly above nor below) to avoid whipsaws.
const PRICE_MA_FLAT_BAND = 0.02;
// Realized-vol window (≈3 trading months). Long enough to be stable,
// short enough to react to a genuine stress event.
const VOL_WINDOW = 60;
// Vol-percentile cut-offs. >80th pct = "extreme" (risk-off / bear-ish);
// <70th pct counts as "non-extreme" for the bull condition.
const VOL_EXTREME_PCT = 80;
const VOL_CALM_PCT = 70;

// -------------------- small pure helpers --------------------

/** Simple moving average of the LAST `period` values (undefined if too short). */
const sma = (values: number[], period: number): number | undefined => {
  if (values.length < period) return undefined;
  const slice = values.slice(-period);
  return slice.reduce((sum, v) => sum + v, 0) / period;
};

/** Sample standard deviation of an array (population variance; 0 for <2 pts). */
const stdev = (values: number[]): number => {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
};

/** Rolling N-day realized volatility (stdev of daily log returns) at each point. */
const rollingRealizedVol = (closes: number[], window: number): number[] => {
  const logReturns = closes.slice(1).map((p, i) => Math.log(p / closes[i]));
  const out: number[] = [];
  for (let i = window; i <= logReturns.length; i++) {
    out.push(stdev(logReturns.slice(i - window, i)));
  }
  return out;
};

/** Percentile rank (0–100) of `value` within `sample` (≤ comparison). */
const percentileRank = (value: number, sample: number[]): number => {
  if (sample.length === 0) return 50;
  const below = sample.filter(v => v <= value).length;
  return Math.round((below / sample.length) * 100);
};

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/**
 * Classify the broad market regime from a benchmark index close series.
 *
 * Rules (simple, OOS-honest — see overfitting caveat at top of file):
 *   • Trend: price vs the ~200-day SMA, plus the SMA slope over the last
 *     ~month. ABOVE a RISING MA = uptrend; BELOW a FALLING MA = downtrend;
 *     anything mixed / inside the ±2% flat band = flat.
 *   • Stress: 60-day realized volatility expressed as a percentile of its
 *     own trailing distribution. >80th pct = extreme.
 *
 *   BULL      = above a rising 200d MA AND volatility not extreme (<70th pct)
 *   BEAR      = below a falling 200d MA  OR  volatility extreme (>80th pct)
 *   SIDEWAYS  = everything else (mixed trend / range-bound)
 *
 * Degrades gracefully: with too little history it falls back to a shorter
 * MA and returns SIDEWAYS with low confidence rather than throwing.
 */
export const classifyMarketRegime = (indexCloses: number[]): MarketRegimeResult => {
  const closes = (indexCloses || []).filter(v => typeof v === 'number' && isFinite(v) && v > 0);
  const reasons: string[] = [];

  // Not enough data to say anything — honest "unknown" => SIDEWAYS, low confidence.
  if (closes.length < 30) {
    return {
      regime: 'SIDEWAYS',
      trend: 'FLAT',
      volPercentile: 50,
      confidence: 10,
      reasons: ['För lite indexdata för en tillförlitlig regimbedömning (faller tillbaka på sidledes).'],
    };
  }

  const last = closes[closes.length - 1];

  // --- Trend via price vs long MA (+ MA slope) -------------------
  // Use the full 200d window when available; otherwise the longest MA the
  // data supports (min 20) so short histories still produce a reading.
  const maPeriod = Math.min(LONG_MA_PERIOD, Math.max(20, closes.length - MA_SLOPE_LOOKBACK));
  const maNow = sma(closes, maPeriod);
  const maPast = sma(closes.slice(0, closes.length - MA_SLOPE_LOOKBACK), maPeriod);

  let trend: 'UP' | 'DOWN' | 'FLAT' = 'FLAT';
  let maSlopeUp = false;
  let maSlopeDown = false;
  if (maNow !== undefined && maPast !== undefined) {
    maSlopeUp = maNow > maPast;
    maSlopeDown = maNow < maPast;
    const dist = (last - maNow) / maNow; // signed distance, fraction
    if (dist > PRICE_MA_FLAT_BAND && maSlopeUp) {
      trend = 'UP';
      reasons.push(`Index ${(dist * 100).toFixed(1)}% över en stigande ${maPeriod}-dagars MA.`);
    } else if (dist < -PRICE_MA_FLAT_BAND && maSlopeDown) {
      trend = 'DOWN';
      reasons.push(`Index ${(Math.abs(dist) * 100).toFixed(1)}% under en fallande ${maPeriod}-dagars MA.`);
    } else {
      trend = 'FLAT';
      reasons.push(`Index nära ${maPeriod}-dagars MA eller blandad trend (±${(PRICE_MA_FLAT_BAND * 100).toFixed(0)}%-band).`);
    }
  } else {
    reasons.push('Otillräcklig historik för långt glidande medelvärde.');
  }

  // --- Realized-vol percentile -----------------------------------
  const volWindow = Math.min(VOL_WINDOW, Math.max(10, Math.floor(closes.length / 2)));
  const volSeries = rollingRealizedVol(closes, volWindow);
  let volPercentile = 50;
  if (volSeries.length >= 2) {
    const currentVol = volSeries[volSeries.length - 1];
    volPercentile = percentileRank(currentVol, volSeries);
    if (volPercentile >= VOL_EXTREME_PCT) {
      reasons.push(`Realiserad ${volWindow}-dagars volatilitet i extremzon (${volPercentile}:e percentilen).`);
    } else if (volPercentile <= 30) {
      reasons.push(`Låg realiserad volatilitet (${volPercentile}:e percentilen) — lugn marknad.`);
    } else {
      reasons.push(`Realiserad volatilitet normal (${volPercentile}:e percentilen).`);
    }
  } else {
    reasons.push('Otillräcklig historik för volatilitetspercentil.');
  }

  const volExtreme = volPercentile >= VOL_EXTREME_PCT;
  const volCalm = volPercentile < VOL_CALM_PCT;

  // --- Combine into a regime -------------------------------------
  let regime: MarketRegime;
  if (trend === 'UP' && volCalm) {
    regime = 'BULL';
  } else if (trend === 'DOWN' || volExtreme) {
    regime = 'BEAR';
  } else {
    regime = 'SIDEWAYS';
  }

  // --- Confidence: how far from the decision boundaries ----------
  // Driven by (a) how far price is from the MA and (b) how far vol is
  // from the "extreme" line. Kept deliberately bounded (25–90).
  let confidence = 50;
  if (maNow !== undefined) {
    const dist = Math.abs((last - maNow) / maNow);
    // 0% from MA -> +0, 10%+ from MA -> +~25
    confidence += clamp(dist / 0.10, 0, 1) * 25;
  }
  // Vol contributes: clearly calm or clearly extreme => more confident.
  const volEdge = Math.abs(volPercentile - VOL_EXTREME_PCT) / VOL_EXTREME_PCT;
  confidence += clamp(volEdge, 0, 1) * 15;
  // A clean trend+vol agreement (bull/bear) is firmer than a residual sideways.
  if (regime === 'SIDEWAYS') confidence -= 10;
  confidence = Math.round(clamp(confidence, 25, 90));

  return { regime, trend, volPercentile, confidence, reasons };
};

// ==================== WEIGHT TILTING ====================
// Pure helper that nudges the base horizon weights toward a regime-appropriate
// posture. Tilts are MODEST (a handful of points, see DELTAS) and the result is
// renormalized back to the SAME total as `base`, so downstream renormalization
// and scoring behave exactly as before — only the *mix* shifts slightly.
//
//   BEAR     → downweight trend-following / momentum (technical, quant) and
//              upweight defensive reads (volatility, fundamental).
//   SIDEWAYS → slightly favour mean-reversion-ish modules (quant, volatility)
//              and trim trend (technical, measuredMoves) since trends fail in ranges.
//   BULL     → identity (let momentum run as-is).

// Signed point deltas applied to the base weights, per regime. Designed to net
// to ~0 within each regime so the post-renormalization mix barely drifts in size.
const REGIME_DELTAS: Record<MarketRegime, Partial<HorizonWeights>> = {
  // Defensive: take ~5pts off momentum-ish, add to volatility + fundamental.
  BEAR: { technical: -3, quant: -2, measuredMoves: -1, volatility: +3, fundamental: +3 },
  // Range posture: lean mean-reversion (quant/volatility), trim trend-following.
  SIDEWAYS: { technical: -2, measuredMoves: -2, quant: +2, volatility: +2 },
  // Momentum-on: leave as-is.
  BULL: {},
};

/**
 * Return a copy of `base` tilted for the given regime, renormalized to the SAME
 * total weight as `base`. Pure — does not mutate the input. BULL is an identity.
 * Deltas are only applied where the base weight is already > 0 (we never
 * resurrect a module that the horizon intentionally switched off, e.g. crypto
 * fundamentals), and weights are floored at 0 before renormalizing.
 */
export const tiltWeightsForRegime = (
  base: HorizonWeights,
  regime: MarketRegime
): HorizonWeights => {
  const deltas = REGIME_DELTAS[regime];

  // BULL (or any regime with no deltas) → identity copy.
  if (!deltas || Object.keys(deltas).length === 0) {
    return { ...base };
  }

  const keys = Object.keys(base) as (keyof HorizonWeights)[];
  const originalTotal = keys.reduce((sum, k) => sum + (base[k] || 0), 0);

  // Apply deltas (only to active modules), floor at 0.
  const tilted: HorizonWeights = { ...base };
  for (const k of keys) {
    const baseVal = base[k] || 0;
    const delta = deltas[k] || 0;
    if (baseVal > 0 && delta !== 0) {
      tilted[k] = Math.max(0, baseVal + delta);
    }
  }

  // Renormalize back to the original total so the overall scale is unchanged.
  const tiltedTotal = keys.reduce((sum, k) => sum + (tilted[k] || 0), 0);
  if (tiltedTotal <= 0 || originalTotal <= 0) return { ...base };

  const factor = originalTotal / tiltedTotal;
  const result = {} as HorizonWeights;
  for (const k of keys) {
    result[k] = (tilted[k] || 0) * factor;
  }
  return result;
};
