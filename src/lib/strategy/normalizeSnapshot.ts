/**
 * normalizeAnalysisSnapshot
 * Canonical mapper from raw FullAnalysis (client-side) or raw DB prediction+signals
 * to a standardized snapshot used by quality gate & regime classification.
 *
 * Handles: scale mismatches (0-1 vs 0-100), missing fields, wrong paths.
 */

export interface NormalizedModuleSignal {
  dir: 'UP' | 'DOWN' | 'NEUTRAL';
  strength: number;   // 0-100
  weight: number;     // 0-100
  confidence: number; // 0-100
}

export interface NormalizedSnapshot {
  totalScore: number;        // 0-100
  confidence: number;        // 0-100
  agreement: number;         // 0-100
  coverage: number;          // 0-100
  volRisk: number;           // 0-100 (higher = worse)
  dataAgeHours: number;
  direction: 'UP' | 'DOWN' | 'NEUTRAL';
  modules: Record<string, NormalizedModuleSignal>;
  trend: {
    durationLikelyDays: number | null;
    durationMinDays: number | null;
    durationMaxDays: number | null;
    trendStrength: number | null;
    reversalRisk: number | null;
    stopLossPrice: number | null;
    stopLossPct: number | null;
    takeProfit: {
      conservativePrice?: number;
      moderatePrice?: number;
      aggressivePrice?: number;
    };
    riskRewardRatio: number | null;
  };
  lastUpdatedISO: string;
  entryPrice: number;
  _debug: {
    missingFields: string[];
    scaleAdjusted: string[];
    moduleKeysSeen: string[];
  };
}

/** Ensure value is on 0-100 scale. If it looks like 0-1 fractional, multiply by 100. */
function ensureScale100(value: unknown, fieldName: string, debug: { scaleAdjusted: string[] }): number {
  if (value == null || value === undefined) return -1; // sentinel for missing
  const num = Number(value);
  if (isNaN(num)) return -1;
  if (num >= 0 && num <= 1.0 && num !== 0 && num !== 1) {
    // Likely 0-1 scale, convert to 0-100
    debug.scaleAdjusted.push(fieldName);
    return Math.round(num * 100);
  }
  return Math.round(num);
}

// Canonical module key mapping
const MODULE_KEY_MAP: Record<string, string> = {
  technical: 'technical',
  quant: 'quant',
  volatility: 'volatility',
  seasonal: 'seasonal',
  fundamental: 'fundamental',
  macro: 'macro',
  orderflow: 'orderFlow',
  orderFlow: 'orderFlow',
  measuredmoves: 'measuredMoves',
  measuredMoves: 'measuredMoves',
  sentiment: 'sentiment',
  ml: 'ml',
};

function canonicalKey(raw: string): string {
  return MODULE_KEY_MAP[raw] || raw;
}

/**
 * Normalize from client-side FullAnalysis object.
 */
export function normalizeFromFullAnalysis(raw: any): NormalizedSnapshot {
  const debug = { missingFields: [] as string[], scaleAdjusted: [] as string[], moduleKeysSeen: [] as string[] };

  // Extract confidenceBreakdown
  const cb = raw?.confidenceBreakdown || {};
  let agreement = ensureScale100(cb.agreement, 'agreement', debug);
  let coverage = ensureScale100(cb.coverage, 'coverage', debug);
  let volRisk = ensureScale100(cb.regimeRisk, 'volRisk', debug);

  if (agreement < 0) { agreement = 50; debug.missingFields.push('agreement'); }
  if (coverage < 0) { coverage = 0; debug.missingFields.push('coverage'); }
  if (volRisk < 0) { volRisk = 50; debug.missingFields.push('volRisk'); }

  // Build modules map
  const modules: Record<string, NormalizedModuleSignal> = {};
  const rawSignals = raw?.signals || [];
  for (const sig of rawSignals) {
    const key = canonicalKey(sig.module || '');
    if (!key) continue;
    debug.moduleKeysSeen.push(key);
    modules[key] = {
      dir: sig.direction || 'NEUTRAL',
      strength: sig.strength ?? 50,
      weight: sig.weight ?? 0,
      confidence: sig.confidence ?? 50,
    };
  }

  // Trend prediction
  const tp = raw?.trendPrediction || {};
  const td = tp?.trendDuration || {};
  const sl = tp?.stopLoss || {};
  const tpLevels = tp?.takeProfit || {};

  const trend = {
    durationLikelyDays: td.likelyDays ?? null,
    durationMinDays: td.minDays ?? null,
    durationMaxDays: td.maxDays ?? null,
    trendStrength: tp.trendStrength ?? null,
    reversalRisk: tp.reversalRisk ?? null,
    stopLossPrice: sl.price ?? null,
    stopLossPct: sl.percentage ?? null,
    takeProfit: {
      conservativePrice: tpLevels.conservative?.price,
      moderatePrice: tpLevels.moderate?.price,
      aggressivePrice: tpLevels.aggressive?.price,
    },
    riskRewardRatio: tp.riskRewardRatio ?? null,
  };

  if (trend.durationLikelyDays == null) debug.missingFields.push('durationLikelyDays');
  if (trend.trendStrength == null) debug.missingFields.push('trendStrength');

  // Data age
  const lastUpdated = raw?.lastUpdated || new Date().toISOString();
  const dataAgeHours = (Date.now() - new Date(lastUpdated).getTime()) / (1000 * 60 * 60);

  return {
    totalScore: Math.max(0, Math.min(100, raw?.totalScore ?? 50)),
    confidence: Math.max(0, Math.min(100, raw?.confidence ?? 50)),
    agreement,
    coverage,
    volRisk,
    dataAgeHours: Math.max(0, dataAgeHours),
    direction: raw?.direction || 'NEUTRAL',
    modules,
    trend,
    lastUpdatedISO: lastUpdated,
    entryPrice: raw?.entryPrice || raw?.currentPrice || 0,
    _debug: debug,
  };
}

/**
 * Normalize from DB prediction row + signals rows (server-side / edge function).
 */
export function normalizeFromDB(
  prediction: any,
  signals: any[],
  analysisData?: any
): NormalizedSnapshot {
  const debug = { missingFields: [] as string[], scaleAdjusted: [] as string[], moduleKeysSeen: [] as string[] };

  // Build modules from signals table
  const modules: Record<string, NormalizedModuleSignal> = {};
  for (const sig of signals) {
    const key = canonicalKey(sig.module || '');
    if (!key) continue;
    debug.moduleKeysSeen.push(key);
    modules[key] = {
      dir: sig.direction || 'NEUTRAL',
      strength: sig.strength ?? 50,
      weight: 0, // signals table doesn't store weight, estimate from count
      confidence: sig.confidence ?? 50,
    };
  }

  // Assign equal weights if no weight info available
  const moduleCount = Object.keys(modules).length;
  if (moduleCount > 0) {
    const equalWeight = Math.round(100 / moduleCount);
    for (const key of Object.keys(modules)) {
      modules[key].weight = equalWeight;
    }
  }

  // Calculate agreement: % of signals matching the prediction direction
  const predDir = prediction?.predicted_direction || 'NEUTRAL';
  const dirSignals = signals.filter(s => s.direction === predDir);
  const nonNeutralSignals = signals.filter(s => s.direction !== 'NEUTRAL');
  const agreement = nonNeutralSignals.length > 0
    ? Math.round((dirSignals.length / nonNeutralSignals.length) * 100)
    : 50;

  // Coverage: how many of the 8 expected modules have data
  const expectedModules = 8;
  const coverage = Math.min(100, Math.round((moduleCount / expectedModules) * 100));

  // VolRisk: from volatility module direction
  const volMod = modules['volatility'];
  let volRisk = 50;
  if (volMod) {
    volRisk = volMod.dir === 'DOWN' ? 70 : volMod.dir === 'UP' ? 30 : 50;
  }

  // Check analysisData for previously stored values
  const ad = analysisData || {};
  if (ad.agreement != null) {
    const adAgreement = ensureScale100(ad.agreement, 'ad.agreement', debug);
    if (adAgreement >= 0) {
      // Use the better source
    }
  }

  // Data age
  const createdAt = prediction?.created_at || new Date().toISOString();
  const dataAgeHours = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);

  // Trend data - might be stored in analysis_data from previous runs
  const trend = {
    durationLikelyDays: ad.durationLikelyDays ?? null,
    durationMinDays: ad.durationMinDays ?? null,
    durationMaxDays: ad.durationMaxDays ?? null,
    trendStrength: ad.trendStrength ?? null,
    reversalRisk: ad.reversalRisk ?? null,
    stopLossPrice: ad.stopLossPrice ?? null,
    stopLossPct: ad.stopLossPct ?? null,
    takeProfit: {
      conservativePrice: ad.takeProfitConservative,
      moderatePrice: ad.takeProfitModerate,
      aggressivePrice: ad.takeProfitAggressive,
    },
    riskRewardRatio: ad.riskRewardRatio ?? null,
  };

  return {
    totalScore: prediction?.total_score ?? 50,
    confidence: prediction?.confidence ?? 50,
    agreement,
    coverage,
    volRisk,
    dataAgeHours: Math.max(0, dataAgeHours),
    direction: predDir,
    modules,
    trend,
    lastUpdatedISO: createdAt,
    entryPrice: prediction?.entry_price || 0,
    _debug: debug,
  };
}

// ---- Quality Gate ----
export interface QualityGateResult {
  passed: boolean;
  failed: string[];
  metrics: {
    totalScore: number;
    agreement: number;
    coverage: number;
    volRisk: number;
    dataAgeHours: number;
  };
}

export function passesQualityGate(
  n: NormalizedSnapshot,
  config: { total_score_min: number; agreement_min: number; coverage_min: number; vol_risk_max: number; max_staleness_h: number }
): QualityGateResult {
  const failed: string[] = [];
  if (n.totalScore < config.total_score_min)
    failed.push(`TotalScore ${n.totalScore} < ${config.total_score_min}`);
  if (n.agreement < config.agreement_min)
    failed.push(`Enighet ${n.agreement}% < ${config.agreement_min}%`);
  if (n.coverage < config.coverage_min)
    failed.push(`Täckning ${n.coverage}% < ${config.coverage_min}%`);
  if (n.volRisk > config.vol_risk_max)
    failed.push(`VolRisk ${n.volRisk} > ${config.vol_risk_max}`);
  if (n.dataAgeHours > config.max_staleness_h)
    failed.push(`Data ${Math.round(n.dataAgeHours)}h > ${config.max_staleness_h}h`);

  return {
    passed: failed.length === 0,
    failed,
    metrics: {
      totalScore: n.totalScore,
      agreement: n.agreement,
      coverage: n.coverage,
      volRisk: n.volRisk,
      dataAgeHours: Math.round(n.dataAgeHours * 10) / 10,
    },
  };
}

// ---- Regime Classification ----
export type Regime = 'MOMENTUM' | 'FUNDAMENTAL' | 'MEAN_REVERSION' | 'NONE';

export interface RegimeResult {
  regime: Regime;
  reasons: string[];
}

export function classifyRegime(
  n: NormalizedSnapshot,
  config: {
    mean_reversion_enabled: boolean;
    agreement_min: number;
  }
): RegimeResult {
  const reasons: string[] = [];
  const fund = n.modules['fundamental'];
  const quant = n.modules['quant'];
  const mm = n.modules['measuredMoves'];
  const duration = n.trend.durationLikelyDays;
  const strength = n.trend.trendStrength;

  // 1. FUNDAMENTAL
  const fundMinDays = 90;
  const fundMinAgreement = Math.max(config.agreement_min, 70);
  if (fund) {
    if (fund.dir === 'UP' && fund.weight >= 20) {
      if (duration != null && duration >= fundMinDays && n.agreement >= fundMinAgreement) {
        reasons.push(`Fundamental UP, vikt=${fund.weight}, duration=${duration}d ≥ ${fundMinDays}, enighet=${n.agreement}% ≥ ${fundMinAgreement}%`);
        return { regime: 'FUNDAMENTAL', reasons };
      } else {
        const parts: string[] = [];
        if (duration == null) parts.push('duration saknas');
        else if (duration < fundMinDays) parts.push(`duration ${duration}d < ${fundMinDays}`);
        if (n.agreement < fundMinAgreement) parts.push(`enighet ${n.agreement}% < ${fundMinAgreement}%`);
        reasons.push(`Fundamental möjlig men: ${parts.join(', ')}`);
      }
    }
  } else {
    reasons.push('Fundamental-modul saknas');
  }

  // 2. MOMENTUM
  const momMinStrength = 40;
  const momMinDays = 7;
  const momMaxDays = 60;
  if (quant && mm) {
    if (quant.dir === 'UP' && mm.dir === 'UP') {
      if (strength != null && strength >= momMinStrength &&
          duration != null && duration >= momMinDays && duration <= momMaxDays) {
        reasons.push(`Quant+MeasuredMoves UP, styrka=${strength} ≥ ${momMinStrength}, duration=${duration}d [${momMinDays}-${momMaxDays}]`);
        return { regime: 'MOMENTUM', reasons };
      } else {
        const parts: string[] = [];
        if (strength == null) parts.push('trendStrength saknas');
        else if (strength < momMinStrength) parts.push(`styrka ${strength} < ${momMinStrength}`);
        if (duration == null) parts.push('duration saknas');
        else if (duration < momMinDays) parts.push(`duration ${duration}d < ${momMinDays}`);
        else if (duration > momMaxDays) parts.push(`duration ${duration}d > ${momMaxDays}`);
        reasons.push(`Momentum möjlig men: ${parts.join(', ')}`);
      }
    } else {
      if (quant.dir !== 'UP') reasons.push(`Quant dir=${quant.dir} (behöver UP)`);
      if (mm.dir !== 'UP') reasons.push(`MeasuredMoves dir=${mm.dir} (behöver UP)`);
    }
  } else {
    if (!quant) reasons.push('Quant-modul saknas');
    if (!mm) reasons.push('MeasuredMoves-modul saknas');
  }

  // 3. MEAN_REVERSION
  const mrMaxStrength = 50;
  const mrMaxDays = 7;
  if (config.mean_reversion_enabled) {
    if (quant && quant.dir === 'UP') {
      if ((strength == null || strength < mrMaxStrength) &&
          (duration == null || duration <= mrMaxDays)) {
        reasons.push(`Mean Reversion: quant UP, styrka=${strength ?? '?'} < ${mrMaxStrength}, duration=${duration ?? '?'} ≤ ${mrMaxDays}`);
        return { regime: 'MEAN_REVERSION', reasons };
      } else {
        const parts: string[] = [];
        if (strength != null && strength >= mrMaxStrength) parts.push(`styrka ${strength} ≥ ${mrMaxStrength}`);
        if (duration != null && duration > mrMaxDays) parts.push(`duration ${duration}d > ${mrMaxDays}`);
        reasons.push(`Mean Reversion möjlig men: ${parts.join(', ')}`);
      }
    }
  } else {
    if (quant?.dir === 'UP' && (strength == null || strength < mrMaxStrength)) {
      reasons.push('Mean Reversion möjlig men inaktiverad i config');
    }
  }

  return { regime: 'NONE', reasons };
}
