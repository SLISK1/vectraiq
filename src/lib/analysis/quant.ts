// Quantitative Analysis Module
// Statistical models: momentum, mean reversion, volatility-adjusted returns

import { AnalysisResult, PriceData } from './types';
import { Direction, Horizon, Evidence } from '@/types/market';

// Calculate returns
const calculateReturns = (prices: number[]): number[] => {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  return returns;
};

// Calculate standard deviation
const calculateStdDev = (values: number[]): number => {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
};

// Calculate Sharpe Ratio (annualized)
const calculateSharpeRatio = (returns: number[], riskFreeRate: number = 0.02): number => {
  if (returns.length === 0) return 0;
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const stdDev = calculateStdDev(returns);
  if (stdDev === 0) return 0;
  
  // Annualize (assuming daily returns)
  const annualizedReturn = avgReturn * 252;
  const annualizedStdDev = stdDev * Math.sqrt(252);
  
  return (annualizedReturn - riskFreeRate) / annualizedStdDev;
};

// Momentum score (based on lookback periods)
const calculateMomentum = (prices: number[], periods: number[]): { score: number; signals: string[] } => {
  const signals: string[] = [];
  let totalScore = 0;
  let validPeriods = 0;
  
  for (const period of periods) {
    if (prices.length >= period) {
      const returnPct = (prices[prices.length - 1] / prices[prices.length - period] - 1) * 100;
      validPeriods++;
      
      if (returnPct > 5) {
        totalScore += 1;
        signals.push(`${period}-dagars momentum: +${returnPct.toFixed(1)}%`);
      } else if (returnPct < -5) {
        totalScore -= 1;
        signals.push(`${period}-dagars momentum: ${returnPct.toFixed(1)}%`);
      }
    }
  }
  
  return {
    score: validPeriods > 0 ? totalScore / validPeriods : 0,
    signals,
  };
};

// Mean reversion indicator (z-score)
const calculateMeanReversion = (prices: number[], period: number = 20): { zScore: number; signal: string } => {
  if (prices.length < period) return { zScore: 0, signal: 'Otillräcklig data' };
  
  const recentPrices = prices.slice(-period);
  const mean = recentPrices.reduce((a, b) => a + b, 0) / period;
  const stdDev = calculateStdDev(recentPrices);
  
  const currentPrice = prices[prices.length - 1];
  const zScore = stdDev > 0 ? (currentPrice - mean) / stdDev : 0;
  
  let signal = 'Neutral';
  if (zScore < -2) signal = 'Extremt undervärderad - potential för återhämtning';
  else if (zScore < -1) signal = 'Undervärderad - mild köpsignal';
  else if (zScore > 2) signal = 'Extremt övervärderad - risk för nedgång';
  else if (zScore > 1) signal = 'Övervärderad - mild säljsignal';
  
  return { zScore, signal };
};

// Volatility-adjusted momentum
const calculateVolatilityAdjustedMomentum = (prices: number[], period: number = 20): number => {
  if (prices.length < period) return 0;
  
  const returns = calculateReturns(prices.slice(-period));
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const stdDev = calculateStdDev(returns);
  
  if (stdDev === 0) return 0;
  return avgReturn / stdDev;
};

// Trend strength (using linear regression)
const calculateTrendStrength = (prices: number[], period: number = 20): { slope: number; r2: number } => {
  if (prices.length < period) return { slope: 0, r2: 0 };
  
  const recentPrices = prices.slice(-period);
  const n = recentPrices.length;
  
  // Linear regression
  const xMean = (n - 1) / 2;
  const yMean = recentPrices.reduce((a, b) => a + b, 0) / n;
  
  let numerator = 0;
  let denominatorX = 0;
  let denominatorY = 0;
  
  for (let i = 0; i < n; i++) {
    const xDiff = i - xMean;
    const yDiff = recentPrices[i] - yMean;
    numerator += xDiff * yDiff;
    denominatorX += xDiff * xDiff;
    denominatorY += yDiff * yDiff;
  }
  
  const slope = denominatorX > 0 ? numerator / denominatorX : 0;
  const r2 = denominatorX > 0 && denominatorY > 0 
    ? Math.pow(numerator, 2) / (denominatorX * denominatorY) 
    : 0;
  
  // Normalize slope as percentage of mean price
  const normalizedSlope = (slope / yMean) * 100;
  
  return { slope: normalizedSlope, r2 };
};

// Main quant analysis function
export const analyzeQuant = (
  priceHistory: PriceData[],
  currentPrice: number,
  horizon: Horizon
): AnalysisResult => {
  const prices = priceHistory.map(p => p.close ?? p.price);
  const evidence: Evidence[] = [];
  
  let bullishScore = 0;
  let bearishScore = 0;
  let totalFactors = 0;
  
  // 1. Momentum Analysis
  const momentumPeriods = horizon === '1d' ? [5, 10] : 
                          horizon === '1w' ? [5, 10, 20] : 
                          horizon === '1mo' ? [10, 20, 50] : [20, 50, 100];
  
  const momentum = calculateMomentum(prices, momentumPeriods);
  if (momentum.signals.length > 0) {
    totalFactors++;
    if (momentum.score > 0) {
      bullishScore += momentum.score;
      evidence.push({
        type: 'momentum',
        description: 'Positivt momentum',
        value: momentum.signals.join(', '),
        timestamp: new Date().toISOString(),
        source: 'Momentum Analysis',
      });
    } else if (momentum.score < 0) {
      bearishScore += Math.abs(momentum.score);
      evidence.push({
        type: 'momentum',
        description: 'Negativt momentum',
        value: momentum.signals.join(', '),
        timestamp: new Date().toISOString(),
        source: 'Momentum Analysis',
      });
    }
  }
  
  // 2. Mean Reversion
  const meanReversion = calculateMeanReversion(prices);
  if (Math.abs(meanReversion.zScore) > 1) {
    totalFactors++;
    if (meanReversion.zScore < -1) {
      bullishScore += 1;
      evidence.push({
        type: 'mean_reversion',
        description: 'Mean reversion köpsignal',
        value: `Z-score: ${meanReversion.zScore.toFixed(2)} - ${meanReversion.signal}`,
        timestamp: new Date().toISOString(),
        source: 'Mean Reversion',
      });
    } else if (meanReversion.zScore > 1) {
      bearishScore += 1;
      evidence.push({
        type: 'mean_reversion',
        description: 'Mean reversion säljsignal',
        value: `Z-score: ${meanReversion.zScore.toFixed(2)} - ${meanReversion.signal}`,
        timestamp: new Date().toISOString(),
        source: 'Mean Reversion',
      });
    }
  }
  
  // 3. Volatility-Adjusted Momentum
  const volAdjMomentum = calculateVolatilityAdjustedMomentum(prices);
  if (Math.abs(volAdjMomentum) > 0.5) {
    totalFactors++;
    if (volAdjMomentum > 0.5) {
      bullishScore += 1;
      evidence.push({
        type: 'vol_adj_momentum',
        description: 'Starkt riskjusterat momentum',
        value: volAdjMomentum.toFixed(2),
        timestamp: new Date().toISOString(),
        source: 'Vol-Adjusted Momentum',
      });
    } else if (volAdjMomentum < -0.5) {
      bearishScore += 1;
      evidence.push({
        type: 'vol_adj_momentum',
        description: 'Svagt riskjusterat momentum',
        value: volAdjMomentum.toFixed(2),
        timestamp: new Date().toISOString(),
        source: 'Vol-Adjusted Momentum',
      });
    }
  }
  
  // 4. Trend Strength
  const trend = calculateTrendStrength(prices);
  if (trend.r2 > 0.5) {
    totalFactors++;
    if (trend.slope > 0.1) {
      bullishScore += 1;
      evidence.push({
        type: 'trend',
        description: 'Stark uppåtgående trend',
        value: `Lutning: ${trend.slope.toFixed(2)}%/dag, R²: ${(trend.r2 * 100).toFixed(0)}%`,
        timestamp: new Date().toISOString(),
        source: 'Trend Analysis',
      });
    } else if (trend.slope < -0.1) {
      bearishScore += 1;
      evidence.push({
        type: 'trend',
        description: 'Stark nedåtgående trend',
        value: `Lutning: ${trend.slope.toFixed(2)}%/dag, R²: ${(trend.r2 * 100).toFixed(0)}%`,
        timestamp: new Date().toISOString(),
        source: 'Trend Analysis',
      });
    }
  }
  
  // 5. Sharpe Ratio
  const returns = calculateReturns(prices);
  if (returns.length >= 20) {
    const sharpe = calculateSharpeRatio(returns);
    totalFactors++;
    if (sharpe > 1) {
      bullishScore += 1;
      evidence.push({
        type: 'risk_adjusted',
        description: 'Utmärkt riskjusterad avkastning',
        value: `Sharpe Ratio: ${sharpe.toFixed(2)}`,
        timestamp: new Date().toISOString(),
        source: 'Sharpe Ratio',
      });
    } else if (sharpe < -0.5) {
      bearishScore += 1;
      evidence.push({
        type: 'risk_adjusted',
        description: 'Negativ riskjusterad avkastning',
        value: `Sharpe Ratio: ${sharpe.toFixed(2)}`,
        timestamp: new Date().toISOString(),
        source: 'Sharpe Ratio',
      });
    }
  }
  
  // Calculate direction and strength
  const netScore = bullishScore - bearishScore;
  const direction: Direction = netScore > 0 ? 'UP' : netScore < 0 ? 'DOWN' : 'NEUTRAL';
  
  const strength = totalFactors > 0 
    ? Math.round(50 + (netScore / Math.max(totalFactors, 1)) * 40)
    : 50;
  
  // Coverage based on data availability
  const minRequired = horizon === '1y' ? 252 : horizon === '1mo' ? 60 : 20;
  const coverage = Math.min(100, Math.round((prices.length / minRequired) * 100));
  
  // Confidence based on data quality and signal agreement
  const confidence = Math.round(
    30 + 
    (coverage / 100) * 30 + 
    (totalFactors > 0 ? (Math.abs(netScore) / totalFactors) * 40 : 0)
  );
  
  return {
    module: 'quant',
    direction,
    strength: Math.max(0, Math.min(100, strength)),
    confidence: Math.max(0, Math.min(100, confidence)),
    coverage,
    evidence,
    metadata: {
      momentumScore: momentum.score,
      meanReversionZScore: meanReversion.zScore,
      volAdjMomentum,
      trendSlope: trend.slope,
      trendR2: trend.r2,
    },
  };
};
