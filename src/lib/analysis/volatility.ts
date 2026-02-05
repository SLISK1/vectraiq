// Volatility Analysis Module
// Historical volatility, regime detection, risk metrics

import { AnalysisResult, PriceData, VolatilityMetrics } from './types';
import { Direction, Horizon, Evidence } from '@/types/market';

// Calculate historical volatility (annualized)
const calculateHistoricalVolatility = (prices: number[], period: number = 20): number => {
  if (prices.length < period + 1) return 0;
  
  const returns: number[] = [];
  for (let i = prices.length - period; i < prices.length; i++) {
    returns.push(Math.log(prices[i] / prices[i - 1]));
  }
  
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
  const dailyVol = Math.sqrt(variance);
  
  // Annualize
  return dailyVol * Math.sqrt(252) * 100;
};

// Calculate Average True Range
const calculateATR = (
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14
): number => {
  if (closes.length < period + 1) return 0;
  
  const trueRanges: number[] = [];
  
  for (let i = 1; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trueRanges.push(tr);
  }
  
  const recentTR = trueRanges.slice(-period);
  return recentTR.reduce((a, b) => a + b, 0) / period;
};

// Detect volatility regime
const detectVolatilityRegime = (
  currentVol: number,
  historicalVol: number[]
): 'low' | 'normal' | 'high' | 'extreme' => {
  if (historicalVol.length < 20) return 'normal';
  
  const sortedVol = [...historicalVol].sort((a, b) => a - b);
  const percentile = sortedVol.findIndex(v => v >= currentVol) / sortedVol.length * 100;
  
  if (percentile < 20) return 'low';
  if (percentile < 70) return 'normal';
  if (percentile < 90) return 'high';
  return 'extreme';
};

// Calculate volatility trend (expanding or contracting)
const calculateVolatilityTrend = (prices: number[], period: number = 20): 'expanding' | 'contracting' | 'stable' => {
  if (prices.length < period * 2) return 'stable';
  
  const recentVol = calculateHistoricalVolatility(prices.slice(-period), Math.min(period, prices.length - 1));
  const priorVol = calculateHistoricalVolatility(prices.slice(-period * 2, -period), Math.min(period, prices.length - 1));
  
  const change = (recentVol - priorVol) / priorVol;
  
  if (change > 0.2) return 'expanding';
  if (change < -0.2) return 'contracting';
  return 'stable';
};

// Calculate Bollinger Band Width (volatility indicator)
const calculateBBWidth = (prices: number[], period: number = 20): number => {
  if (prices.length < period) return 0;
  
  const slice = prices.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, p) => sum + Math.pow(p - sma, 2), 0) / period;
  const std = Math.sqrt(variance);
  
  return ((2 * std * 2) / sma) * 100; // Width as percentage
};

// Calculate drawdown metrics
const calculateDrawdownMetrics = (prices: number[]): { maxDrawdown: number; currentDrawdown: number } => {
  if (prices.length < 2) return { maxDrawdown: 0, currentDrawdown: 0 };
  
  let peak = prices[0];
  let maxDrawdown = 0;
  
  for (const price of prices) {
    if (price > peak) peak = price;
    const drawdown = (peak - price) / peak;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }
  
  const currentPeak = Math.max(...prices);
  const currentDrawdown = (currentPeak - prices[prices.length - 1]) / currentPeak;
  
  return { maxDrawdown: maxDrawdown * 100, currentDrawdown: currentDrawdown * 100 };
};

// Get all volatility metrics
export const calculateVolatilityMetrics = (priceHistory: PriceData[]): VolatilityMetrics => {
  const prices = priceHistory.map(p => p.close ?? p.price);
  const highs = priceHistory.map(p => p.high ?? p.price);
  const lows = priceHistory.map(p => p.low ?? p.price);
  
  const currentVol = calculateHistoricalVolatility(prices);
  
  // Calculate rolling volatility for regime detection
  const rollingVol: number[] = [];
  for (let i = 30; i <= prices.length; i++) {
    rollingVol.push(calculateHistoricalVolatility(prices.slice(0, i)));
  }
  
  return {
    historicalVolatility: currentVol,
    averageTrueRange: calculateATR(highs, lows, prices),
    volatilityRegime: detectVolatilityRegime(currentVol, rollingVol),
  };
};

// Main volatility analysis function
export const analyzeVolatility = (
  priceHistory: PriceData[],
  currentPrice: number,
  horizon: Horizon
): AnalysisResult => {
  const prices = priceHistory.map(p => p.close ?? p.price);
  const highs = priceHistory.map(p => p.high ?? p.price);
  const lows = priceHistory.map(p => p.low ?? p.price);
  
  const evidence: Evidence[] = [];
  let riskScore = 50; // Start neutral
  
  // 1. Historical Volatility
  const histVol = calculateHistoricalVolatility(prices);
  evidence.push({
    type: 'volatility',
    description: 'Historisk volatilitet (20 dagar, annualiserad)',
    value: `${histVol.toFixed(1)}%`,
    timestamp: new Date().toISOString(),
    source: 'Historical Volatility',
  });
  
  // 2. Volatility Regime
  const metrics = calculateVolatilityMetrics(priceHistory);
  const regime = metrics.volatilityRegime;
  
  let regimeRiskAdjustment = 0;
  switch (regime) {
    case 'low':
      regimeRiskAdjustment = -10;
      evidence.push({
        type: 'regime',
        description: 'Låg volatilitetsregim',
        value: 'Gynnsamt för trendföljande strategier',
        timestamp: new Date().toISOString(),
        source: 'Regime Detection',
      });
      break;
    case 'normal':
      regimeRiskAdjustment = 0;
      evidence.push({
        type: 'regime',
        description: 'Normal volatilitetsregim',
        value: 'Balanserad risk',
        timestamp: new Date().toISOString(),
        source: 'Regime Detection',
      });
      break;
    case 'high':
      regimeRiskAdjustment = 15;
      evidence.push({
        type: 'regime',
        description: 'Hög volatilitetsregim',
        value: 'Ökad osäkerhet och risk',
        timestamp: new Date().toISOString(),
        source: 'Regime Detection',
      });
      break;
    case 'extreme':
      regimeRiskAdjustment = 30;
      evidence.push({
        type: 'regime',
        description: 'Extrem volatilitetsregim',
        value: 'Mycket hög risk - försiktighet rekommenderas',
        timestamp: new Date().toISOString(),
        source: 'Regime Detection',
      });
      break;
  }
  riskScore += regimeRiskAdjustment;
  
  // 3. Volatility Trend
  const volTrend = calculateVolatilityTrend(prices);
  if (volTrend === 'expanding') {
    riskScore += 10;
    evidence.push({
      type: 'trend',
      description: 'Expanderande volatilitet',
      value: 'Ökande osäkerhet',
      timestamp: new Date().toISOString(),
      source: 'Volatility Trend',
    });
  } else if (volTrend === 'contracting') {
    riskScore -= 10;
    evidence.push({
      type: 'trend',
      description: 'Kontraktande volatilitet',
      value: 'Minskande osäkerhet',
      timestamp: new Date().toISOString(),
      source: 'Volatility Trend',
    });
  }
  
  // 4. Drawdown Analysis
  const { maxDrawdown, currentDrawdown } = calculateDrawdownMetrics(prices);
  if (currentDrawdown > 10) {
    riskScore += 15;
    evidence.push({
      type: 'drawdown',
      description: 'Signifikant drawdown',
      value: `Nuvarande: ${currentDrawdown.toFixed(1)}%, Max: ${maxDrawdown.toFixed(1)}%`,
      timestamp: new Date().toISOString(),
      source: 'Drawdown Analysis',
    });
  }
  
  // 5. Bollinger Band Width
  const bbWidth = calculateBBWidth(prices);
  evidence.push({
    type: 'bandwidth',
    description: 'Bollinger Band Width',
    value: `${bbWidth.toFixed(1)}%`,
    timestamp: new Date().toISOString(),
    source: 'BB Width',
  });
  
  // For volatility module, direction indicates risk level
  // High volatility = DOWN (bearish for confidence), Low = UP (bullish)
  const direction: Direction = riskScore > 60 ? 'DOWN' : riskScore < 40 ? 'UP' : 'NEUTRAL';
  
  // Strength represents how strongly the volatility affects the outlook
  const strength = Math.abs(riskScore - 50) + 50;
  
  // Coverage based on data availability
  const minRequired = horizon === '1y' ? 252 : horizon === '1mo' ? 60 : 20;
  const coverage = Math.min(100, Math.round((prices.length / minRequired) * 100));
  
  // Confidence - higher when regime is clear
  const regimeClarity = regime === 'extreme' || regime === 'low' ? 80 : regime === 'high' ? 70 : 60;
  const confidence = Math.round((coverage + regimeClarity) / 2);
  
  return {
    module: 'volatility',
    direction,
    strength: Math.max(0, Math.min(100, strength)),
    confidence: Math.max(0, Math.min(100, confidence)),
    coverage,
    evidence,
    metadata: {
      historicalVolatility: histVol,
      regime,
      volTrend,
      maxDrawdown,
      currentDrawdown,
      bbWidth,
      riskScore,
    },
  };
};
