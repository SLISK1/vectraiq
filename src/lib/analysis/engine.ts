// Analysis Engine - Coordinates all analysis modules

import { Direction, Horizon, ModuleSignal, ConfidenceBreakdown, Evidence, DEFAULT_WEIGHTS, HorizonWeights } from '@/types/market';
import { AnalysisResult, PriceData, AnalysisContext } from './types';
import { analyzeTechnical } from './technical';
import { analyzeQuant } from './quant';
import { analyzeVolatility } from './volatility';
import { analyzeSeasonal } from './seasonal';
import { analyzeFundamental } from './fundamental';
import { analyzeMacro } from './macro';
import { analyzeOrderFlow } from './orderflow';
import { analyzeElliottWave } from './elliottwave';
import { analyzeSentimentSync } from './sentiment';
import { analyzeMLSync } from './ml';

export interface FullAnalysis {
  signals: ModuleSignal[];
  totalScore: number;
  direction: Direction;
  confidence: number;
  confidenceBreakdown: ConfidenceBreakdown;
  topContributors: { module: string; contribution: number }[];
  lastUpdated: string;
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

// Calculate confidence breakdown
const calculateConfidenceBreakdown = (
  signals: ModuleSignal[],
  priceDataAge: number // minutes since last update
): ConfidenceBreakdown => {
  // Freshness: based on data age
  const freshness = Math.max(0, 100 - priceDataAge * 2); // Degrade 2% per minute
  
  // Coverage: average of all module coverages
  const coverage = signals.length > 0
    ? Math.round(signals.reduce((sum, s) => sum + s.coverage, 0) / signals.length)
    : 0;
  
  // Agreement: how many modules agree on direction
  const upVotes = signals.filter(s => s.direction === 'UP').length;
  const downVotes = signals.filter(s => s.direction === 'DOWN').length;
  const totalVotes = upVotes + downVotes;
  const agreement = totalVotes > 0
    ? Math.round((Math.max(upVotes, downVotes) / signals.length) * 100)
    : 50;
  
  // Reliability: average confidence of modules
  const reliability = signals.length > 0
    ? Math.round(signals.reduce((sum, s) => sum + s.confidence, 0) / signals.length)
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
  return Math.round(
    0.25 * breakdown.freshness +
    0.20 * breakdown.coverage +
    0.25 * breakdown.agreement +
    0.20 * breakdown.reliability +
    0.10 * (100 - breakdown.regimeRisk)
  );
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
  
  // 8. Elliott Wave Analysis
  if (weights.elliottWave > 0 && priceHistory.length >= 30) {
    results.push(analyzeElliottWave(priceHistory, currentPrice, horizon));
  }
  
  // 9. Sentiment Analysis (sync version)
  if (weights.sentiment > 0) {
    results.push(analyzeSentimentSync(ticker, name, assetType, horizon));
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
  
  const confidenceBreakdown = calculateConfidenceBreakdown(signals, priceDataAge);
  const confidence = calculateTotalConfidence(confidenceBreakdown);
  
  // Get top contributors
  const topContributors = signals
    .filter(s => s.direction === direction)
    .sort((a, b) => (b.strength * b.weight) - (a.strength * a.weight))
    .slice(0, 3)
    .map(s => ({ module: s.module, contribution: Math.round(s.strength * (s.weight / 100)) }));
  
  return {
    signals,
    totalScore: Math.max(0, Math.min(100, normalizedScore)),
    direction,
    confidence,
    confidenceBreakdown,
    topContributors,
    lastUpdated: new Date().toISOString(),
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
