// Analysis Engine - Coordinates all analysis modules

import { Direction, Horizon, ModuleSignal, ConfidenceBreakdown, Evidence, DEFAULT_WEIGHTS, HorizonWeights, TrendPrediction } from '@/types/market';
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
  priceDataAge: number, // minutes since last update
  isDailyData: boolean = true
): ConfidenceBreakdown => {
  // Freshness: adapt for daily vs intraday data
  // For daily data: full freshness if < 24h old, gentle decay after
  // For intraday: degrade 2% per minute as before
  let freshness: number;
  if (isDailyData) {
    if (priceDataAge < 1440) { // < 24 hours
      freshness = 95;
    } else if (priceDataAge < 2880) { // < 48 hours
      freshness = 85;
    } else {
      // After 48h, gentle decay: lose 1% per hour
      freshness = Math.max(50, 85 - (priceDataAge - 2880) / 60);
    }
  } else {
    freshness = Math.max(0, 100 - priceDataAge * 2);
  }
  
  // Calculate total weight for weighted averages
  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  
  // Coverage: weighted average based on module weights
  // Modules with higher weights matter more for coverage calculation
  const coverage = totalWeight > 0
    ? Math.round(signals.reduce((sum, s) => sum + s.coverage * s.weight, 0) / totalWeight)
    : 0;
  
  // Agreement: weighted by both module weight AND strength
  // Strong signals from important modules count more
  const upWeight = signals.filter(s => s.direction === 'UP')
    .reduce((sum, s) => sum + s.weight * (s.strength / 100), 0);
  const downWeight = signals.filter(s => s.direction === 'DOWN')
    .reduce((sum, s) => sum + s.weight * (s.strength / 100), 0);
  const totalDirWeight = upWeight + downWeight;
  const agreement = totalDirWeight > 0
    ? Math.round((Math.max(upWeight, downWeight) / totalDirWeight) * 100)
    : 50;
  
  // Reliability: weighted average of module confidences
  const reliability = totalWeight > 0
    ? Math.round(signals.reduce((sum, s) => sum + s.confidence * s.weight, 0) / totalWeight)
    : 50;
  
  // Regime Risk: based on volatility module if available
  const volatilitySignal = signals.find(s => s.module === 'volatility');
  const regimeRisk = volatilitySignal
    ? (volatilitySignal.direction === 'DOWN' ? 70 : volatilitySignal.direction === 'UP' ? 30 : 50)
    : 40;
  
  return { freshness, coverage, agreement, reliability, regimeRisk };
};

// Calculate total confidence from breakdown
const calculateTotalConfidence = (breakdown: ConfidenceBreakdown): number => {
  // Adjusted weights: freshness less important for daily data strategies
  return Math.round(
    0.15 * breakdown.freshness +    // Reduced from 0.25
    0.25 * breakdown.coverage +     // Increased from 0.20
    0.25 * breakdown.agreement +    // Same
    0.25 * breakdown.reliability +  // Increased from 0.20
    0.10 * (100 - breakdown.regimeRisk)
  );
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
  
  // Get evidence from top modules
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

// Run all synchronous analyses
export const runAnalysis = (
  context: AnalysisContext
): FullAnalysis => {
  const { ticker, name, assetType, horizon, currentPrice, priceHistory } = context;
  const weights = DEFAULT_WEIGHTS[horizon];
  
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
  
  // 5. Fundamental Analysis
  if (weights.fundamental > 0) {
    results.push(analyzeFundamental(priceHistory, currentPrice, horizon, assetType, ticker));
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
  
  // 9. Sentiment Analysis (sync version) - pass priceHistory for momentum proxy
  if (weights.sentiment > 0) {
    results.push(analyzeSentimentSync(ticker, name, assetType, horizon, priceHistory));
  }
  
  // 10. ML Analysis (sync version)
  if (weights.ml > 0 && priceHistory.length >= 20) {
    results.push(analyzeMLSync(priceHistory, currentPrice, horizon));
  }
  
  // Convert to ModuleSignals with weights
  const signals = results.map(r => toModuleSignal(
    r, 
    horizon, 
    weights[r.module as keyof HorizonWeights] || 0
  ));
  
  // Calculate total weighted score
  const weightedScores = signals.map(calculateModuleScore);
  const totalWeightedScore = weightedScores.reduce((sum, s) => sum + s, 0);
  
  // Normalize to 0-100 scale
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
  
  // Determine if we're using daily data (typical for most horizons)
  const isDailyData = horizon !== '1s' && horizon !== '1m' && horizon !== '1h';
  
  const confidenceBreakdown = calculateConfidenceBreakdown(signals, priceDataAge, isDailyData);
  const confidence = calculateTotalConfidence(confidenceBreakdown);
  
  // Get top contributors
  const topContributors = signals
    .filter(s => s.direction === direction)
    .sort((a, b) => (b.strength * b.weight) - (a.strength * a.weight))
    .slice(0, 3)
    .map(s => ({ module: s.module, contribution: Math.round(s.strength * (s.weight / 100)) }));
  
  // Calculate predicted returns based on analysis
  const directionMultiplier = direction === 'UP' ? 1 : direction === 'DOWN' ? -1 : 0;
  const baseReturn = (normalizedScore - 50) / 50; // -1 to 1
  const volatilityFactor = confidenceBreakdown.regimeRisk / 100;
  
  const predictedReturns: PredictedReturns = {
    day1: Math.round(baseReturn * 2 * (1 + volatilityFactor) * 100) / 100,
    week1: Math.round(baseReturn * 5 * (1 + volatilityFactor * 0.8) * 100) / 100,
    year1: Math.round(baseReturn * 25 * (1 + volatilityFactor * 0.5) * 100) / 100,
    year5: Math.round(baseReturn * 80 * (1 + volatilityFactor * 0.3) * 100) / 100,
  };
  
  // Generate AI summary
  const topModuleNames = topContributors.slice(0, 2).map(c => c.module);
  const aiSummary = generateAISummary(ticker, direction, confidence, topModuleNames, signals);
  
  // Calculate trend prediction with stop/loss
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

// Run async analyses (sentiment and ML with AI)
export const runAsyncAnalyses = async (
  context: AnalysisContext
): Promise<{ sentiment?: AnalysisResult; ml?: AnalysisResult }> => {
  const { ticker, name, assetType, horizon, currentPrice, priceHistory } = context;
  const weights = DEFAULT_WEIGHTS[horizon];
  
  const asyncResults: { sentiment?: AnalysisResult; ml?: AnalysisResult } = {};
  
  // These would use the async AI-powered versions
  // For now, return empty - the sync versions are used in main analysis
  
  return asyncResults;
};

// Helper to create analysis context from symbol data
export const createAnalysisContext = (
  ticker: string,
  name: string,
  assetType: 'stock' | 'crypto' | 'metal',
  currency: string,
  currentPrice: number,
  priceHistory: PriceData[],
  horizon: Horizon
): AnalysisContext => ({
  ticker,
  name,
  assetType,
  currency,
  horizon,
  currentPrice,
  priceHistory,
});
