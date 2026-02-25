// Analysis Engine - Coordinates all analysis modules
// Refactored: signed scoring, Bayesian shrinkage, calibrated returns, weight renormalization

import { Direction, Horizon, ModuleSignal, ConfidenceBreakdown, Evidence, HorizonWeights, TrendPrediction, HorizonReturnEstimate } from '@/types/market';
import { AnalysisResult, PriceData, AnalysisContext } from './types';
import { analyzeTechnical } from './technical';
import { analyzeQuant } from './quant';
import { analyzeVolatility } from './volatility';
import { analyzeSeasonal } from './seasonal';
import { analyzeFundamental } from './fundamental';
import { analyzeMacro } from './macro';
import { analyzeOrderFlow } from './orderflow';
import { analyzeMeasuredMoves } from './measuredmoves';
import { analyzeSentimentSync } from './sentiment';
import { analyzeMLSync } from './ml';
import { calculateTrendPrediction } from './trendPrediction';

export interface PredictedReturns {
  day1: number;
  week1: number;
  month1: number;
  year1: number;
  year5: number;
  day1Range?: HorizonReturnEstimate;
  week1Range?: HorizonReturnEstimate;
  month1Range?: HorizonReturnEstimate;
  year1Range?: HorizonReturnEstimate;
  year5Range?: HorizonReturnEstimate;
}

export interface FullAnalysis {
  signals: ModuleSignal[];
  totalScore: number;
  direction: Direction;
  confidence: number;
  confidenceBreakdown: ConfidenceBreakdown;
  topContributors: { module: string; contribution: number }[];
  lastUpdated: string;
  predictedReturns: PredictedReturns;
  trendPrediction: TrendPrediction;
  aiSummary: string;
}

// Crypto-specific horizon weights
export const CRYPTO_WEIGHTS: Record<Horizon, HorizonWeights> = {
  '1s': { technical: 35, fundamental: 0, sentiment: 15, measuredMoves: 0, quant: 25, macro: 0, volatility: 25, seasonal: 0, orderFlow: 0, ml: 0 },
  '1m': { technical: 35, fundamental: 0, sentiment: 15, measuredMoves: 0, quant: 25, macro: 0, volatility: 25, seasonal: 0, orderFlow: 0, ml: 0 },
  '1h': { technical: 32, fundamental: 0, sentiment: 20, measuredMoves: 0, quant: 22, macro: 0, volatility: 20, seasonal: 0, orderFlow: 6, ml: 0 },
  '1d': { technical: 28, fundamental: 0, sentiment: 22, measuredMoves: 8, quant: 20, macro: 0, volatility: 18, seasonal: 2, orderFlow: 2, ml: 0 },
  '1w': { technical: 25, fundamental: 5, sentiment: 20, measuredMoves: 12, quant: 22, macro: 5, volatility: 8, seasonal: 3, orderFlow: 0, ml: 0 },
  '1mo': { technical: 18, fundamental: 10, sentiment: 15, measuredMoves: 15, quant: 22, macro: 10, volatility: 8, seasonal: 2, orderFlow: 0, ml: 0 },
  '1y': { technical: 8, fundamental: 20, sentiment: 10, measuredMoves: 12, quant: 20, macro: 15, volatility: 5, seasonal: 5, orderFlow: 0, ml: 5 },
};

import { DEFAULT_WEIGHTS } from '@/types/market';

// ==================== RELIABILITY (BAYESIAN SHRINKAGE) ====================

interface ReliabilityEntry {
  hitRate: number;
  totalPredictions: number;
  correctPredictions: number;
  reliabilityWeight: number;
  lastUpdated: number;
}

const reliabilityCache: Map<string, ReliabilityEntry> = new Map();
const RELIABILITY_CACHE_TTL = 60 * 60 * 1000; // 60 minutes

export const getModuleReliability = async (
  module: string,
  horizon: Horizon,
  assetType: string
): Promise<ReliabilityEntry | null> => {
  const key = `${module}:${horizon}:${assetType}`;
  const cached = reliabilityCache.get(key);
  if (cached && Date.now() - cached.lastUpdated < RELIABILITY_CACHE_TTL) {
    return cached;
  }
  
  try {
    const { supabase } = await import('@/integrations/supabase/client');
    const { data } = await supabase
      .from('module_reliability')
      .select('hit_rate, total_predictions, correct_predictions, reliability_weight')
      .eq('module', module)
      .eq('horizon', horizon)
      .eq('asset_type', assetType)
      .maybeSingle();
    
    if (data) {
      const entry: ReliabilityEntry = {
        hitRate: Number(data.hit_rate || 0.5),
        totalPredictions: data.total_predictions ?? 0,
        correctPredictions: data.correct_predictions ?? 0,
        reliabilityWeight: Number(data.reliability_weight || 1.0),
        lastUpdated: Date.now(),
      };
      reliabilityCache.set(key, entry);
      return entry;
    }
  } catch {
    // Silent fail — use base weights
  }
  
  return null;
};

// Bayesian shrinkage with Beta(10,10) prior
// Replaces hard step-function thresholds with continuous weighting
export const getReliabilityFactor = (entry: ReliabilityEntry | null): number => {
  if (!entry || entry.totalPredictions < 3) return 1.0; // Not enough data — neutral

  const a = 10, b = 10; // Beta prior parameters (conservative)
  const correct = entry.correctPredictions ?? Math.round(entry.hitRate * entry.totalPredictions);
  const total = entry.totalPredictions;
  
  const posteriorMean = (correct + a) / (total + a + b);
  
  // Continuous factor centered at 0.5, sensitivity k=2
  const k = 2.0;
  const raw = 1 + (posteriorMean - 0.5) * k;
  return Math.max(0.7, Math.min(1.3, raw));
};

// ==================== SCORING ====================

// Convert AnalysisResult to ModuleSignal
const toModuleSignal = (result: AnalysisResult, horizon: Horizon, weight: number): ModuleSignal => ({
  module: result.module,
  direction: result.direction,
  strength: result.strength,
  horizon,
  confidence: result.confidence,
  evidence: result.evidence,
  coverage: result.coverage,
  weight,
});

// Calculate signed module contribution (A: fixed scoring)
// strength is 0-100 where 50=neutral. Convert to -100..+100 signed.
// Weight-normalized so total contributions sum to meaningful range.
export const calculateModuleScore = (signal: ModuleSignal, totalWeight: number): number => {
  const dirMultiplier = signal.direction === 'UP' ? 1
    : signal.direction === 'DOWN' ? -1 : 0;
  // Map 0-100 strength to -100..+100 with direction
  const signedStrength = (signal.strength - 50) * 2 * dirMultiplier;
  // Weighted contribution (totalWeight should be ~100 after renormalization)
  return totalWeight > 0 ? signedStrength * (signal.weight / totalWeight) : 0;
};

// ==================== CONFIDENCE BREAKDOWN ====================

const calculateConfidenceBreakdown = (
  signals: ModuleSignal[],
  priceDataAge: number,
  isDailyData: boolean = true
): ConfidenceBreakdown => {
  // Freshness
  let freshness: number;
  if (isDailyData) {
    if (priceDataAge < 1440) freshness = 95;
    else if (priceDataAge < 2880) freshness = 85;
    else freshness = Math.max(50, 85 - (priceDataAge - 2880) / 60);
  } else {
    freshness = Math.max(0, 100 - priceDataAge * 2);
  }
  
  // Coverage (weighted by module weight)
  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  const coverage = totalWeight > 0
    ? Math.round(signals.reduce((sum, s) => sum + s.coverage * s.weight, 0) / totalWeight)
    : 0;
  
  // Agreement — calculated on SIGNED strength so neutrals don't bias
  // A module with strength=50 (neutral) contributes 0 to agreement
  const upContrib = signals.reduce((sum, s) => {
    if (s.direction !== 'UP') return sum;
    return sum + ((s.strength - 50) * 2 / 100) * s.weight;
  }, 0);
  const downContrib = signals.reduce((sum, s) => {
    if (s.direction !== 'DOWN') return sum;
    return sum + ((s.strength - 50) * 2 / 100) * s.weight;
  }, 0);
  const totalDirContrib = Math.abs(upContrib) + Math.abs(downContrib);
  const agreement = totalDirContrib > 0
    ? Math.round((Math.max(Math.abs(upContrib), Math.abs(downContrib)) / totalDirContrib) * 100)
    : 50;
  
  // Signal Strength (module self-reported confidence, NOT empirical reliability)
  const signalStrength = totalWeight > 0
    ? Math.round(signals.reduce((sum, s) => sum + s.confidence * s.weight, 0) / totalWeight)
    : 50;
  
  // Regime risk from volatility module
  const volatilitySignal = signals.find(s => s.module === 'volatility');
  const regimeRisk = volatilitySignal
    ? (volatilitySignal.direction === 'DOWN' ? 70 : volatilitySignal.direction === 'UP' ? 30 : 50)
    : 40;
  
  return { freshness, coverage, agreement, signalStrength, regimeRisk };
};

// Total confidence with cap rules
const calculateTotalConfidence = (
  breakdown: ConfidenceBreakdown,
  assetType?: string,
  cryptoHighVol?: boolean
): number => {
  let confidence = Math.round(
    0.15 * breakdown.freshness +
    0.25 * breakdown.coverage +
    0.25 * breakdown.agreement +
    0.25 * breakdown.signalStrength +
    0.10 * (100 - breakdown.regimeRisk)
  );
  
  if (breakdown.coverage < 40) confidence = Math.min(confidence, 55);
  if (breakdown.agreement < 50) confidence = Math.max(0, confidence - 10);
  
  if (assetType === 'crypto' && cryptoHighVol) {
    confidence = Math.round(confidence * 0.85);
  }
  
  return confidence;
};

// ==================== CALIBRATED RETURNS (B) ====================

// Horizon days by asset type
const HORIZON_DAYS_STOCK: Record<string, number> = { '1d': 1, '1w': 5, '1mo': 21, '1y': 252, '5y': 1260 };
const HORIZON_DAYS_CRYPTO: Record<string, number> = { '1d': 1, '1w': 7, '1mo': 30, '1y': 365, '5y': 1825 };

const calculateCalibratedReturns = (
  normalizedScore: number,
  assetType: string,
  priceHistory: PriceData[]
): PredictedReturns => {
  // Historical daily vol from price data
  const prices = priceHistory.map(p => p.close ?? p.price);
  if (prices.length < 5) {
    return { day1: 0, week1: 0, month1: 0, year1: 0, year5: 0 };
  }
  
  const logReturns = prices.slice(1).map((p, i) => Math.log(p / prices[i]));
  const meanReturn = logReturns.reduce((s, r) => s + r, 0) / logReturns.length;
  const variance = logReturns.reduce((s, r) => s + Math.pow(r - meanReturn, 2), 0) / logReturns.length;
  const dailyVol = Math.sqrt(variance);
  
  // Score-to-expected-move: linear mapping with dynamic shrinkage
  const scoreSignal = (normalizedScore - 50) / 50; // -1 to +1
  // Dynamic shrinkage: stronger signals get less shrinkage (0.2–0.4 range)
  const signalMagnitude = Math.abs(scoreSignal);
  const shrinkage = 0.4 - signalMagnitude * 0.2;
  const expectedDailyMove = scoreSignal * dailyVol * shrinkage;
  
  const horizonDays = assetType === 'crypto' ? HORIZON_DAYS_CRYPTO : HORIZON_DAYS_STOCK;
  
  const scale = (days: number): HorizonReturnEstimate => {
    const expected = expectedDailyMove * days;
    const uncertainty = dailyVol * Math.sqrt(days);
    return {
      expected: Math.round(expected * 10000) / 100,
      p10: Math.round((expected - 1.28 * uncertainty) * 10000) / 100,
      p90: Math.round((expected + 1.28 * uncertainty) * 10000) / 100,
    };
  };
  
  const d1 = scale(horizonDays['1d']);
  const w1 = scale(horizonDays['1w']);
  const m1 = scale(horizonDays['1mo']);
  const y1 = scale(horizonDays['1y']);
  const y5 = scale(horizonDays['5y']);
  
  return {
    day1: d1.expected,
    week1: w1.expected,
    month1: m1.expected,
    year1: y1.expected,
    year5: y5.expected,
    day1Range: d1,
    week1Range: w1,
    month1Range: m1,
    year1Range: y1,
    year5Range: y5,
  };
};

// ==================== AI SUMMARY ====================

const generateAISummary = (
  ticker: string,
  direction: Direction,
  confidence: number,
  topModules: string[],
  signals: ModuleSignal[]
): string => {
  const moduleNames: Record<string, string> = {
    technical: 'teknisk analys',
    fundamental: 'fundamental data',
    sentiment: 'marknadssentiment',
    quant: 'kvantmodeller',
    macro: 'makroekonomi',
    volatility: 'volatilitetsanalys',
    seasonal: 'säsongsmönster',
    orderFlow: 'orderflöde',
    ml: 'ML-modeller',
    measuredMoves: 'measured moves',
  };

  const dirText = direction === 'UP' ? 'stiga' : direction === 'DOWN' ? 'falla' : 'vara sidledes';
  const confText = confidence >= 70 ? 'hög' : confidence >= 50 ? 'måttlig' : 'låg';
  
  const keyEvidence: string[] = [];
  for (const mod of topModules) {
    const signal = signals.find(s => s.module === mod);
    if (signal?.evidence?.length) {
      keyEvidence.push(signal.evidence[0].description);
    }
  }
  
  const moduleList = topModules.map(m => moduleNames[m] || m).join(' och ');
  const evidenceText = keyEvidence.length > 0 ? ` Nyckelindikationer: ${keyEvidence.slice(0, 2).join('; ')}.` : '';
  
  return `${ticker} förväntas ${dirText} baserat på ${moduleList} (${confText} konfidens).${evidenceText}`;
};

// ==================== REGIME DETECTION ====================

const detectCryptoHighVolRegime = (priceHistory: PriceData[]): boolean => {
  if (priceHistory.length < 30) return false;
  const recent30 = priceHistory.slice(-30);
  const returns = recent30.slice(1).map((p, i) => (p.price - recent30[i].price) / recent30[i].price);
  const avgReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const annualizedVol = Math.sqrt(variance * 365) * 100;
  return annualizedVol > 60;
};

// ==================== OBJECTIVE COVERAGE (F) ====================

export const calculateObjectiveCoverage = (
  priceHistory: PriceData[],
  horizon: Horizon,
  moduleName: string
): number => {
  const minDataByModule: Record<string, number> = {
    technical: 50,
    volatility: 30,
    quant: 20,
    seasonal: 10,
    fundamental: 5,
    macro: 5,
    orderFlow: 20,
    measuredMoves: 20,
    sentiment: 5,
    ml: 20,
  };
  
  const minRequired = minDataByModule[moduleName] || 20;
  const checks: boolean[] = [];
  
  // Check 1: Sufficient data length
  checks.push(priceHistory.length >= minRequired);
  
  // Check 2: Has close prices
  checks.push(priceHistory.every(p => (p.close ?? p.price) != null));
  
  // Check 3: Has high/low (needed for technical, volatility)
  if (['technical', 'volatility', 'orderFlow'].includes(moduleName)) {
    checks.push(priceHistory.some(p => p.high != null && p.low != null));
  }
  
  // Check 4: Has volume (needed for orderFlow)
  if (moduleName === 'orderFlow') {
    checks.push(priceHistory.some(p => p.volume != null && p.volume > 0));
  }
  
  // Check 5: Data freshness
  if (priceHistory.length > 0) {
    const lastTs = new Date(priceHistory[priceHistory.length - 1].timestamp).getTime();
    const ageHours = (Date.now() - lastTs) / (1000 * 60 * 60);
    checks.push(ageHours < 48); // Data less than 48h old
  }
  
  const passed = checks.filter(Boolean).length;
  return Math.round((passed / checks.length) * 100);
};

// ==================== MAIN ANALYSIS ====================

export const runAnalysis = (
  context: AnalysisContext,
  moduleReliabilities?: Map<string, ReliabilityEntry>
): FullAnalysis => {
  const { ticker, name, assetType, horizon, currentPrice, priceHistory } = context;
  
  const isCrypto = assetType === 'crypto';
  const baseWeights = isCrypto ? CRYPTO_WEIGHTS[horizon] : DEFAULT_WEIGHTS[horizon];
  const cryptoHighVol = isCrypto ? detectCryptoHighVolRegime(priceHistory) : false;
  
  const results: AnalysisResult[] = [];
  
  // Run all modules
  if (baseWeights.technical > 0 && priceHistory.length >= 10) {
    results.push(analyzeTechnical(priceHistory, currentPrice, horizon, context.avCache));
  }
  if (baseWeights.quant > 0 && priceHistory.length >= 10) {
    results.push(analyzeQuant(priceHistory, currentPrice, horizon));
  }
  if (baseWeights.volatility > 0 && priceHistory.length >= 10) {
    results.push(analyzeVolatility(priceHistory, currentPrice, horizon));
  }
  if (baseWeights.seasonal > 0) {
    results.push(analyzeSeasonal(priceHistory, currentPrice, horizon, assetType));
  }
  if (baseWeights.fundamental > 0 && !(isCrypto && ['1d', '1w'].includes(horizon))) {
    results.push(analyzeFundamental(priceHistory, currentPrice, horizon, assetType, ticker, context.fundamentals));
  }
  if (baseWeights.macro > 0) {
    results.push(analyzeMacro(priceHistory, currentPrice, horizon, assetType));
  }
  if (baseWeights.orderFlow > 0 && priceHistory.some(p => p.volume)) {
    results.push(analyzeOrderFlow(priceHistory, currentPrice, horizon));
  }
  if (baseWeights.measuredMoves > 0 && priceHistory.length >= 20) {
    results.push(analyzeMeasuredMoves(priceHistory, currentPrice, horizon));
  }
  if (baseWeights.sentiment > 0) {
    results.push(analyzeSentimentSync(ticker, name, assetType, horizon, priceHistory));
  }
  if (baseWeights.ml > 0 && priceHistory.length >= 20) {
    results.push(analyzeMLSync(priceHistory, currentPrice, horizon));
  }
  
  // === F: Override self-reported coverage with objective calculation ===
  const objectiveResults = results.map(r => ({
    ...r,
    coverage: calculateObjectiveCoverage(priceHistory, horizon, r.module),
  }));

  // === E: Apply reliability factors + RENORMALIZE weights ===
  const rawAdjusted = objectiveResults.map(r => {
    const bw = baseWeights[r.module as keyof HorizonWeights] || 0;
    let factor = 1.0;
    
    if (moduleReliabilities) {
      const key = `${r.module}:${horizon}:${assetType}`;
      const reliability = moduleReliabilities.get(key);
      factor = getReliabilityFactor(reliability || null);
    }
    
    return { result: r, adjustedWeight: bw * factor };
  });
  
  const totalRawWeight = rawAdjusted.reduce((s, x) => s + x.adjustedWeight, 0);
  const normFactor = totalRawWeight > 0 ? 100 / totalRawWeight : 1;
  
  const signals = rawAdjusted.map(({ result, adjustedWeight }) =>
    toModuleSignal(result, horizon, Math.round(adjustedWeight * normFactor))
  );
  
  // === A+G: Signed scoring — direction derived from same aggregate ===
  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  const weightedScores = signals.map(s => calculateModuleScore(s, totalWeight));
  const totalSignedScore = weightedScores.reduce((sum, s) => sum + s, 0);
  
  // totalSignedScore is -100..+100, map to 0..100
  const normalizedScore = Math.round(50 + totalSignedScore / 2);
  
  // Direction from same signed score with dead-zone ±5
  const direction: Direction = totalSignedScore > 5 ? 'UP'
    : totalSignedScore < -5 ? 'DOWN'
    : 'NEUTRAL';
  
  // === C: Confidence breakdown with proper separation ===
  const priceDataAge = priceHistory.length > 0
    ? (Date.now() - new Date(priceHistory[priceHistory.length - 1].timestamp).getTime()) / 60000
    : 60;
  const isDailyData = horizon !== '1s' && horizon !== '1m' && horizon !== '1h';
  
  const confidenceBreakdown = calculateConfidenceBreakdown(signals, priceDataAge, isDailyData);
  
  // Add empirical reliability from DB if available
  if (moduleReliabilities && moduleReliabilities.size > 0) {
    let totalReliabilityN = 0;
    let weightedPosterior = 0;
    let anyLowSample = false;
    
    for (const [, entry] of moduleReliabilities) {
      if (entry.totalPredictions < 5) {
        anyLowSample = true;
        continue;
      }
      const correct = entry.correctPredictions ?? Math.round(entry.hitRate * entry.totalPredictions);
      const posterior = (correct + 10) / (entry.totalPredictions + 20);
      weightedPosterior += posterior * entry.totalPredictions;
      totalReliabilityN += entry.totalPredictions;
    }
    
    if (totalReliabilityN > 0) {
      confidenceBreakdown.empiricalReliability = Math.round((weightedPosterior / totalReliabilityN) * 100);
    }
    confidenceBreakdown.lowSampleWarning = anyLowSample;
  }
  
  const confidence = calculateTotalConfidence(confidenceBreakdown, assetType, cryptoHighVol);
  
  // === H: Top contributors — consistent with signed scoring ===
  let topContributors: { module: string; contribution: number }[];
  if (direction === 'NEUTRAL') {
    // Show top 4 by absolute contribution
    const contributions = signals.map((s, i) => ({
      module: s.module,
      contribution: Math.round(weightedScores[i]),
    }));
    contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
    topContributors = contributions.slice(0, 4);
  } else {
    // Show top 3 modules that align with direction
    const contributions = signals
      .map((s, i) => ({ module: s.module, contribution: Math.round(weightedScores[i]) }))
      .filter(c => (direction === 'UP' && c.contribution > 0) || (direction === 'DOWN' && c.contribution < 0));
    contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
    topContributors = contributions.slice(0, 3);
  }
  
  // === B: Calibrated returns ===
  const predictedReturns = calculateCalibratedReturns(normalizedScore, assetType, priceHistory);
  
  const topModuleNames = topContributors.slice(0, 2).map(c => c.module);
  const aiSummary = generateAISummary(ticker, direction, confidence, topModuleNames, signals);
  
  const volatilitySignal = signals.find(s => s.module === 'volatility');
  const volatilityScore = volatilitySignal?.strength || 50;
  
  const trendPrediction = calculateTrendPrediction({
    priceHistory,
    currentPrice,
    direction,
    confidence,
    horizon,
    volatilityScore,
  });
  
  return {
    signals,
    totalScore: Math.max(0, Math.min(100, normalizedScore)),
    direction,
    confidence,
    confidenceBreakdown,
    topContributors,
    lastUpdated: new Date().toISOString(),
    predictedReturns,
    trendPrediction,
    aiSummary,
  };
};

// Helper to create analysis context from symbol data
export const createAnalysisContext = (
  ticker: string,
  name: string,
  assetType: 'stock' | 'crypto' | 'metal' | 'fund',
  currency: string,
  currentPrice: number,
  priceHistory: PriceData[],
  horizon: Horizon,
  fundamentals?: import('./types').FundamentalMetrics,
  avCache?: { indicator_type: string; data: any }[]
): AnalysisContext => ({
  ticker,
  name,
  assetType,
  currency,
  horizon,
  currentPrice,
  priceHistory,
  fundamentals,
  avCache,
});
