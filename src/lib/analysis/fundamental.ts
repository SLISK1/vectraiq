// Fundamental Analysis Module
// Note: Full fundamental analysis requires external financial data API integration

import { AnalysisResult, PriceData, FundamentalMetrics } from './types';
import { Direction, Horizon, Evidence } from '@/types/market';

// Calculate basic metrics from price history only
const calculatePriceBasedMetrics = (
  priceHistory: PriceData[]
): { momentum: number; volatility: number; trend: Direction } => {
  if (priceHistory.length < 10) {
    return { momentum: 0, volatility: 0, trend: 'NEUTRAL' };
  }
  
  // Calculate price change over different periods
  const currentPrice = priceHistory[priceHistory.length - 1].price;
  const weekAgoIdx = Math.max(0, priceHistory.length - 5);
  const monthAgoIdx = Math.max(0, priceHistory.length - 22);
  
  const weekChange = (currentPrice - priceHistory[weekAgoIdx].price) / priceHistory[weekAgoIdx].price;
  const monthChange = (currentPrice - priceHistory[monthAgoIdx].price) / priceHistory[monthAgoIdx].price;
  
  // Calculate volatility from price changes
  const returns: number[] = [];
  for (let i = 1; i < priceHistory.length; i++) {
    returns.push((priceHistory[i].price - priceHistory[i - 1].price) / priceHistory[i - 1].price);
  }
  
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const volatility = Math.sqrt(variance) * Math.sqrt(252) * 100; // Annualized
  
  // Determine trend from momentum
  const momentum = (weekChange + monthChange * 0.5) * 100;
  const trend: Direction = momentum > 5 ? 'UP' : momentum < -5 ? 'DOWN' : 'NEUTRAL';
  
  return { momentum, volatility, trend };
};

// Analyze price-based indicators as proxy for fundamentals
const analyzePriceMetrics = (momentum: number, volatility: number): {
  score: number;
  signals: string[];
} => {
  let score = 0;
  const signals: string[] = [];
  
  // Momentum Analysis
  if (momentum > 10) {
    score += 2;
    signals.push(`Stark momentum (${momentum.toFixed(1)}%)`);
  } else if (momentum > 5) {
    score += 1;
    signals.push(`Positiv momentum (${momentum.toFixed(1)}%)`);
  } else if (momentum < -10) {
    score -= 2;
    signals.push(`Negativ momentum (${momentum.toFixed(1)}%)`);
  } else if (momentum < -5) {
    score -= 1;
    signals.push(`Svag momentum (${momentum.toFixed(1)}%)`);
  }
  
  // Volatility Analysis
  if (volatility < 15) {
    score += 1;
    signals.push(`Låg volatilitet (${volatility.toFixed(1)}%)`);
  } else if (volatility > 40) {
    score -= 1;
    signals.push(`Hög volatilitet (${volatility.toFixed(1)}%)`);
  }
  
  return { score, signals };
};

// Main fundamental analysis function
export const analyzeFundamental = (
  priceHistory: PriceData[],
  currentPrice: number,
  horizon: Horizon,
  assetType: 'stock' | 'crypto' | 'metal',
  ticker: string
): AnalysisResult => {
  const evidence: Evidence[] = [];
  
  // Fundamental analysis is more relevant for longer horizons
  const horizonWeight = horizon === '1y' ? 1.0 :
                        horizon === '1mo' ? 0.7 :
                        horizon === '1w' ? 0.4 : 0.2;
  
  // For crypto and metals, fundamental analysis is limited
  if (assetType === 'crypto') {
    evidence.push({
      type: 'limitation',
      description: 'Krypto saknar traditionella fundamenta',
      value: 'Analys baserad på prisdata endast',
      timestamp: new Date().toISOString(),
      source: 'Prishistorik',
    });
  } else if (assetType === 'metal') {
    evidence.push({
      type: 'limitation',
      description: 'Råvaror värderas efter utbud/efterfrågan',
      value: 'Analys baserad på prisdata endast',
      timestamp: new Date().toISOString(),
      source: 'Prishistorik',
    });
  } else {
    evidence.push({
      type: 'limitation',
      description: 'Fundamentaldata saknas',
      value: 'P/E, ROE, etc. kräver extern datakälla',
      timestamp: new Date().toISOString(),
      source: 'System',
    });
  }
  
  // Calculate metrics from price data
  const { momentum, volatility, trend } = calculatePriceBasedMetrics(priceHistory);
  const { score, signals } = analyzePriceMetrics(momentum, volatility);
  
  // Add price-based evidence
  signals.forEach((signal) => {
    evidence.push({
      type: 'price_metric',
      description: signal,
      value: score > 0 ? 'Positiv' : score < 0 ? 'Negativ' : 'Neutral',
      timestamp: new Date().toISOString(),
      source: 'Prisanalys',
    });
  });
  
  if (priceHistory.length >= 10) {
    evidence.push({
      type: 'data_points',
      description: 'Datapunkter analyserade',
      value: `${priceHistory.length} dagars prishistorik`,
      timestamp: new Date().toISOString(),
      source: 'Databas',
    });
  }
  
  // Determine direction based on score and trend
  const direction: Direction = score > 1 ? 'UP' : score < -1 ? 'DOWN' : trend;
  
  // Strength adjusted by horizon relevance
  const baseStrength = Math.min(100, Math.max(0, 50 + score * 10));
  const strength = Math.round(baseStrength * horizonWeight + 50 * (1 - horizonWeight));
  
  // Coverage is limited since we only have price data
  const coverage = priceHistory.length >= 30 ? 35 : priceHistory.length >= 10 ? 25 : 10;
  
  // Confidence affected by data availability
  const confidence = Math.round(25 + (priceHistory.length / 60) * 20 + horizonWeight * 15);
  
  return {
    module: 'fundamental',
    direction,
    strength: Math.max(0, Math.min(100, strength)),
    confidence: Math.max(0, Math.min(100, confidence)),
    coverage,
    evidence,
    metadata: { momentum, volatility, score, horizonWeight, dataSource: 'price_only' },
  };
};
