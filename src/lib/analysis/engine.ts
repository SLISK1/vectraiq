// Analysis Engine - Coordinates all analysis modules

import { Direction, Horizon, ModuleSignal, ConfidenceBreakdown, Evidence, HorizonWeights, TrendPrediction } from '@/types/market';
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
  year1: number;
  year5: number;
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

// Crypto-specific horizon weights: technical + volatility dominate
// Fundamental = 0 for short horizons (crypto has no P/E etc.)
export const CRYPTO_WEIGHTS: Record<Horizon, HorizonWeights> = {
  '1s': { technical: 35, fundamental: 0, sentiment: 15, measuredMoves: 0, quant: 25, macro: 0, volatility: 25, seasonal: 0, orderFlow: 0, ml: 0 },
  '1m': { technical: 35, fundamental: 0, sentiment: 15, measuredMoves: 0, quant: 25, macro: 0, volatility: 25, seasonal: 0, orderFlow: 0, ml: 0 },
  '1h': { technical: 32, fundamental: 0, sentiment: 20, measuredMoves: 0, quant: 22, macro: 0, volatility: 20, seasonal: 0, orderFlow: 6, ml: 0 },
  '1d': { technical: 28, fundamental: 0, sentiment: 22, measuredMoves: 8, quant: 20, macro: 0, volatility: 18, seasonal: 2, orderFlow: 2, ml: 0 },
  '1w': { technical: 25, fundamental: 5, sentiment: 20, measuredMoves: 12, quant: 22, macro: 5, volatility: 8, seasonal: 3, orderFlow: 0, ml: 0 },
  '1mo': { technical: 18, fundamental: 10, sentiment: 15, measuredMoves: 15, quant: 22, macro: 10, volatility: 8, seasonal: 2, orderFlow: 0, ml: 0 },
  '1y': { technical: 8, fundamental: 20, sentiment: 10, measuredMoves: 12, quant: 20, macro: 15, volatility: 5, seasonal: 5, orderFlow: 0, ml: 5 },
};

// Standard weights for stocks/metals
import { DEFAULT_WEIGHTS } from '@/types/market';

// Module reliability cache (TTL 60 min)
interface ReliabilityEntry {
  hitRate: number;
  totalPredictions: number;
  reliabilityWeight: number;
  lastUpdated: number;
}

const reliabilityCache: Map<string, ReliabilityEntry> = new Map();
const RELIABILITY_CACHE_TTL = 60 * 60 * 1000; // 60 minutes

// Get reliability factor for a module (from cache or DB)
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
  
  // Try to fetch from DB — this runs client-side so we import supabase lazily
  try {
    const { supabase } = await import('@/integrations/supabase/client');
    const { data } = await supabase
      .from('module_reliability')
      .select('hit_rate, total_predictions, reliability_weight')
      .eq('module', module)
      .eq('horizon', horizon)
      .eq('asset_type', assetType)
      .maybeSingle();
    
    if (data) {
      const entry: ReliabilityEntry = {
        hitRate: Number(data.hit_rate || 0.5),
        totalPredictions: data.total_predictions,
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

// Compute reliability factor for ensemble weighting
const getReliabilityFactor = (entry: ReliabilityEntry | null): number => {
  if (!entry || entry.totalPredictions < 5) return 1.0; // Not enough data
  if (entry.hitRate > 0.60) return 1.2;  // Bonus for strong performers
  if (entry.hitRate >= 0.52) return 1.0; // Normal
  return 0.5;                             // Penalize underperformers
};

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

// Calculate weighted score for a module
const calculateModuleScore = (signal: ModuleSignal): number => {
  const directionMultiplier = signal.direction === 'UP' ? 1 : signal.direction === 'DOWN' ? -1 : 0;
  return directionMultiplier * signal.strength * (signal.weight / 100);
};

// Calculate confidence breakdown with weighted metrics
const calculateConfidenceBreakdown = (
  signals: ModuleSignal[],
  priceDataAge: number,
  isDailyData: boolean = true
): ConfidenceBreakdown => {
  let freshness: number;
  if (isDailyData) {
    if (priceDataAge < 1440) freshness = 95;
    else if (priceDataAge < 2880) freshness = 85;
    else freshness = Math.max(50, 85 - (priceDataAge - 2880) / 60);
  } else {
    freshness = Math.max(0, 100 - priceDataAge * 2);
  }
  
  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  const coverage = totalWeight > 0
    ? Math.round(signals.reduce((sum, s) => sum + s.coverage * s.weight, 0) / totalWeight)
    : 0;
  
  const upWeight = signals.filter(s => s.direction === 'UP')
    .reduce((sum, s) => sum + s.weight * (s.strength / 100), 0);
  const downWeight = signals.filter(s => s.direction === 'DOWN')
    .reduce((sum, s) => sum + s.weight * (s.strength / 100), 0);
  const totalDirWeight = upWeight + downWeight;
  const agreement = totalDirWeight > 0
    ? Math.round((Math.max(upWeight, downWeight) / totalDirWeight) * 100)
    : 50;
  
  const reliability = totalWeight > 0
    ? Math.round(signals.reduce((sum, s) => sum + s.confidence * s.weight, 0) / totalWeight)
    : 50;
  
  const volatilitySignal = signals.find(s => s.module === 'volatility');
  const regimeRisk = volatilitySignal
    ? (volatilitySignal.direction === 'DOWN' ? 70 : volatilitySignal.direction === 'UP' ? 30 : 50)
    : 40;
  
  return { freshness, coverage, agreement, reliability, regimeRisk };
};

// Calculate total confidence with empirical cap rules
const calculateTotalConfidence = (
  breakdown: ConfidenceBreakdown,
  assetType?: string,
  cryptoHighVol?: boolean
): number => {
  let confidence = Math.round(
    0.15 * breakdown.freshness +
    0.25 * breakdown.coverage +
    0.25 * breakdown.agreement +
    0.25 * breakdown.reliability +
    0.10 * (100 - breakdown.regimeRisk)
  );
  
  // Cap rules
  if (breakdown.coverage < 40) confidence = Math.min(confidence, 55);
  if (breakdown.agreement < 50) confidence = Math.max(0, confidence - 10);
  
  // Crypto high-vol regime: sänk confidence med 15%
  if (assetType === 'crypto' && cryptoHighVol) {
    confidence = Math.round(confidence * 0.85);
  }
  
  return confidence;
};

// Generate a short AI summary explaining the prediction
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

// Detect if crypto is in high-volatility regime (30d HV > 60%)
const detectCryptoHighVolRegime = (priceHistory: PriceData[]): boolean => {
  if (priceHistory.length < 30) return false;
  const recent30 = priceHistory.slice(-30);
  const returns = recent30.slice(1).map((p, i) => (p.price - recent30[i].price) / recent30[i].price);
  const avgReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const annualizedVol = Math.sqrt(variance * 365) * 100;
  return annualizedVol > 60;
};

// Run all synchronous analyses
export const runAnalysis = (
  context: AnalysisContext,
  moduleReliabilities?: Map<string, ReliabilityEntry>
): FullAnalysis => {
  const { ticker, name, assetType, horizon, currentPrice, priceHistory } = context;
  
  // Use crypto-specific weights for crypto assets
  const isCrypto = assetType === 'crypto';
  const weights = isCrypto ? CRYPTO_WEIGHTS[horizon] : DEFAULT_WEIGHTS[horizon];
  
  // Crypto high-vol regime detection
  const cryptoHighVol = isCrypto ? detectCryptoHighVolRegime(priceHistory) : false;
  
  const results: AnalysisResult[] = [];
  
  // 1. Technical Analysis
  if (weights.technical > 0 && priceHistory.length >= 10) {
    results.push(analyzeTechnical(priceHistory, currentPrice, horizon));
  }
  
  // 2. Quantitative Analysis
  if (weights.quant > 0 && priceHistory.length >= 10) {
    results.push(analyzeQuant(priceHistory, currentPrice, horizon));
  }
  
  // 3. Volatility Analysis
  if (weights.volatility > 0 && priceHistory.length >= 10) {
    results.push(analyzeVolatility(priceHistory, currentPrice, horizon));
  }
  
  // 4. Seasonal Analysis
  if (weights.seasonal > 0) {
    results.push(analyzeSeasonal(priceHistory, currentPrice, horizon, assetType));
  }
  
  // 5. Fundamental Analysis (skip for crypto on short horizons)
  if (weights.fundamental > 0 && !(isCrypto && ['1d', '1w'].includes(horizon))) {
    results.push(analyzeFundamental(priceHistory, currentPrice, horizon, assetType, ticker, context.fundamentals));
  }
  
  // 6. Macro Analysis
  if (weights.macro > 0) {
    results.push(analyzeMacro(priceHistory, currentPrice, horizon, assetType));
  }
  
  // 7. Order Flow Analysis
  if (weights.orderFlow > 0 && priceHistory.some(p => p.volume)) {
    results.push(analyzeOrderFlow(priceHistory, currentPrice, horizon));
  }
  
  // 8. Measured Moves Analysis
  if (weights.measuredMoves > 0 && priceHistory.length >= 20) {
    results.push(analyzeMeasuredMoves(priceHistory, currentPrice, horizon));
  }
  
  // 9. Sentiment Analysis
  if (weights.sentiment > 0) {
    results.push(analyzeSentimentSync(ticker, name, assetType, horizon, priceHistory));
  }
  
  // 10. ML Analysis
  if (weights.ml > 0 && priceHistory.length >= 20) {
    results.push(analyzeMLSync(priceHistory, currentPrice, horizon));
  }
  
  // Convert to ModuleSignals with reliability-adjusted weights
  const signals = results.map(r => {
    const baseWeight = weights[r.module as keyof HorizonWeights] || 0;
    
    // Apply reliability factor if data is available
    let adjustedWeight = baseWeight;
    if (moduleReliabilities) {
      const key = `${r.module}:${horizon}:${assetType}`;
      const reliability = moduleReliabilities.get(key);
      const factor = getReliabilityFactor(reliability || null);
      adjustedWeight = Math.round(baseWeight * factor);
    }
    
    return toModuleSignal(r, horizon, adjustedWeight);
  });
  
  // Calculate total weighted score
  const weightedScores = signals.map(calculateModuleScore);
  const totalWeightedScore = weightedScores.reduce((sum, s) => sum + s, 0);
  
  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  const normalizedScore = totalWeight > 0
    ? Math.round(50 + (totalWeightedScore / totalWeight) * 50)
    : 50;
  
  // Determine overall direction
  const upSignals = signals.filter(s => s.direction === 'UP');
  const downSignals = signals.filter(s => s.direction === 'DOWN');
  const upWeight = upSignals.reduce((sum, s) => sum + s.weight * s.strength, 0);
  const downWeight = downSignals.reduce((sum, s) => sum + s.weight * s.strength, 0);
  
  const direction: Direction = upWeight > downWeight * 1.1 ? 'UP' 
                             : downWeight > upWeight * 1.1 ? 'DOWN' 
                             : 'NEUTRAL';
  
  // Calculate confidence breakdown
  const priceDataAge = priceHistory.length > 0
    ? (Date.now() - new Date(priceHistory[priceHistory.length - 1].timestamp).getTime()) / 60000
    : 60;
  
  const isDailyData = horizon !== '1s' && horizon !== '1m' && horizon !== '1h';
  
  const confidenceBreakdown = calculateConfidenceBreakdown(signals, priceDataAge, isDailyData);
  const confidence = calculateTotalConfidence(confidenceBreakdown, assetType, cryptoHighVol);
  
  // Get top contributors
  const topContributors = signals
    .filter(s => s.direction === direction)
    .sort((a, b) => (b.strength * b.weight) - (a.strength * a.weight))
    .slice(0, 3)
    .map(s => ({ module: s.module, contribution: Math.round(s.strength * (s.weight / 100)) }));
  
  // Calculate predicted returns
  const baseReturn = (normalizedScore - 50) / 50;
  const volatilityFactor = confidenceBreakdown.regimeRisk / 100;
  
  const predictedReturns: PredictedReturns = {
    day1: Math.round(baseReturn * 2 * (1 + volatilityFactor) * 100) / 100,
    week1: Math.round(baseReturn * 5 * (1 + volatilityFactor * 0.8) * 100) / 100,
    year1: Math.round(baseReturn * 25 * (1 + volatilityFactor * 0.5) * 100) / 100,
    year5: Math.round(baseReturn * 80 * (1 + volatilityFactor * 0.3) * 100) / 100,
  };
  
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

// Run async analyses (for future use)
export const runAsyncAnalyses = async (
  context: AnalysisContext
): Promise<{ sentiment?: AnalysisResult; ml?: AnalysisResult }> => {
  return {};
};

// Helper to create analysis context from symbol data
export const createAnalysisContext = (
  ticker: string,
  name: string,
  assetType: 'stock' | 'crypto' | 'metal',
  currency: string,
  currentPrice: number,
  priceHistory: PriceData[],
  horizon: Horizon,
  fundamentals?: import('./types').FundamentalMetrics
): AnalysisContext => ({
  ticker,
  name,
  assetType,
  currency,
  horizon,
  currentPrice,
  priceHistory,
  fundamentals,
});
