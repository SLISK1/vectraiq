// Trend Duration and Stop/Loss Prediction Module
// Fixed: symmetric R:R for DOWN, min stop distance guardrail, method naming (J)

import { Direction, Horizon, TrendPrediction } from '@/types/market';
import { PriceData } from './types';

interface TrendAnalysisInput {
  priceHistory: PriceData[];
  currentPrice: number;
  direction: Direction;
  confidence: number;
  horizon: Horizon;
  volatilityScore: number; // 0-100, higher = more volatile
}

// Calculate Average True Range (ATR)
const calculateATR = (prices: PriceData[], period: number = 14): number => {
  if (prices.length < period + 1) return 0;
  
  const trueRanges: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const high = prices[i].high || prices[i].price;
    const low = prices[i].low || prices[i].price;
    const prevClose = prices[i - 1].close || prices[i - 1].price;
    
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }
  
  const recentTRs = trueRanges.slice(-period);
  return recentTRs.reduce((sum, tr) => sum + tr, 0) / recentTRs.length;
};

// Find support/resistance levels
const findSupportResistance = (prices: PriceData[], direction: Direction): { support: number; resistance: number } => {
  if (prices.length < 10) {
    const currentPrice = prices[prices.length - 1]?.price || 0;
    return { support: currentPrice * 0.95, resistance: currentPrice * 1.05 };
  }
  
  const recentPrices = prices.slice(-30);
  const lows = recentPrices.map(p => p.low || p.price);
  const highs = recentPrices.map(p => p.high || p.price);
  
  const sortedLows = [...lows].sort((a, b) => a - b);
  const sortedHighs = [...highs].sort((a, b) => a - b);
  
  const supportIdx = Math.floor(sortedLows.length * 0.2);
  const resistanceIdx = Math.floor(sortedHighs.length * 0.8);
  
  return {
    support: sortedLows[supportIdx],
    resistance: sortedHighs[resistanceIdx],
  };
};

// Calculate historical trend duration
const calculateHistoricalTrendDurations = (prices: PriceData[]): number[] => {
  if (prices.length < 20) return [5, 10, 20];
  
  const durations: number[] = [];
  let trendStart = 0;
  let currentDirection: Direction = 'NEUTRAL';
  
  for (let i = 1; i < prices.length; i++) {
    const prevPrice = prices[i - 1].price;
    const currPrice = prices[i].price;
    const change = (currPrice - prevPrice) / prevPrice;
    
    let newDirection: Direction = 'NEUTRAL';
    if (change > 0.01) newDirection = 'UP';
    else if (change < -0.01) newDirection = 'DOWN';
    
    if (newDirection !== 'NEUTRAL' && newDirection !== currentDirection) {
      if (currentDirection !== 'NEUTRAL') {
        durations.push(i - trendStart);
      }
      trendStart = i;
      currentDirection = newDirection;
    }
  }
  
  if (currentDirection !== 'NEUTRAL') {
    durations.push(prices.length - trendStart);
  }
  
  return durations.length > 0 ? durations : [5, 10, 20];
};

// Horizon to typical days mapping
const horizonToDays: Record<Horizon, number> = {
  '1s': 0.001,
  '1m': 0.001,
  '1h': 0.04,
  '1d': 1,
  '1w': 7,
  '1mo': 30,
  '1y': 365,
};

export const calculateTrendPrediction = (input: TrendAnalysisInput): TrendPrediction => {
  const { priceHistory, currentPrice, direction, confidence, horizon, volatilityScore } = input;
  
  const atr = calculateATR(priceHistory);
  const atrMultiplier = 2;
  
  const { support, resistance } = findSupportResistance(priceHistory, direction);
  
  // Min stop distance guardrail: max(ATR * 1.5, price * 2%)
  const minStopDistance = Math.max(atr * 1.5, currentPrice * 0.02);
  
  // Calculate stop loss based on multiple methods
  const atrStopDistance = Math.max(atr * atrMultiplier, minStopDistance);
  const volatilityStopDistance = Math.max(currentPrice * (volatilityScore / 100) * 0.15, minStopDistance);
  
  let stopLossPrice: number;
  let stopLossMethod: 'atr' | 'support' | 'resistance' | 'volatility';
  
  if (direction === 'UP') {
    const supportStopDistance = Math.max(Math.abs(currentPrice - support), minStopDistance);
    const stops = [
      { price: currentPrice - atrStopDistance, method: 'atr' as const },
      { price: currentPrice - supportStopDistance, method: 'support' as const },
      { price: currentPrice - volatilityStopDistance, method: 'volatility' as const },
    ];
    // Choose tightest stop (highest price = closest to current)
    const best = stops.reduce((a, b) => a.price > b.price ? a : b);
    stopLossPrice = best.price;
    stopLossMethod = best.method;
  } else if (direction === 'DOWN') {
    // For short: stop loss ABOVE current price, use resistance
    const resistanceStopDistance = Math.max(Math.abs(resistance - currentPrice), minStopDistance);
    const stops = [
      { price: currentPrice + atrStopDistance, method: 'atr' as const },
      { price: currentPrice + resistanceStopDistance, method: 'resistance' as const },
      { price: currentPrice + volatilityStopDistance, method: 'volatility' as const },
    ];
    // Choose tightest stop (lowest price = closest to current)
    const best = stops.reduce((a, b) => a.price < b.price ? a : b);
    stopLossPrice = best.price;
    stopLossMethod = best.method;
  } else {
    // NEUTRAL — use volatility-based, wider stop
    stopLossPrice = currentPrice * (1 - Math.max(volatilityScore / 1000, 0.02));
    stopLossMethod = 'volatility';
  }
  
  const stopLossPercentage = Math.abs((stopLossPrice - currentPrice) / currentPrice) * 100;
  const riskAmount = Math.abs(currentPrice - stopLossPrice);
  
  // Calculate take profit levels
  const calculateTP = (ratio: number): { price: number; percentage: number } => {
    const tpDistance = riskAmount * ratio;
    const tpPrice = direction === 'UP'
      ? currentPrice + tpDistance
      : direction === 'DOWN'
        ? currentPrice - tpDistance
        : currentPrice + tpDistance;
    return {
      price: Math.round(tpPrice * 100) / 100,
      percentage: Math.round((tpDistance / currentPrice) * 10000) / 100,
    };
  };
  
  // Calculate trend duration
  const historicalDurations = calculateHistoricalTrendDurations(priceHistory);
  const avgDuration = historicalDurations.reduce((a, b) => a + b, 0) / historicalDurations.length;
  
  const hDays = horizonToDays[horizon];
  const confidenceMultiplier = confidence / 100;
  const volatilityPenalty = 1 - (volatilityScore / 200);
  const baseDuration = Math.max(hDays, avgDuration * 0.5);
  const likelyDuration = Math.max(1, Math.round(baseDuration * confidenceMultiplier * volatilityPenalty));
  
  // Trend strength
  const recentPrices = priceHistory.slice(-10);
  let trendStrength = 50;
  if (recentPrices.length >= 2) {
    const priceChange = (recentPrices[recentPrices.length - 1].price - recentPrices[0].price) / recentPrices[0].price;
    if (direction === 'UP') {
      trendStrength = Math.min(100, Math.max(0, 50 + priceChange * 500));
    } else if (direction === 'DOWN') {
      trendStrength = Math.min(100, Math.max(0, 50 - priceChange * 500));
    }
  }
  
  // Reversal risk
  const reversalRisk = Math.round(
    (100 - trendStrength) * 0.4 +
    volatilityScore * 0.3 +
    (100 - confidence) * 0.3
  );
  
  // === J: Symmetric risk/reward ratio ===
  let riskRewardRatio: number;
  if (direction === 'UP') {
    const reward = resistance - currentPrice;
    riskRewardRatio = riskAmount > 0 ? Math.round((reward / riskAmount) * 100) / 100 : 0;
  } else if (direction === 'DOWN') {
    const reward = currentPrice - support;
    riskRewardRatio = riskAmount > 0 ? Math.round((reward / riskAmount) * 100) / 100 : 0;
  } else {
    // NEUTRAL: R:R is meaningless
    riskRewardRatio = 0;
  }
  
  return {
    trendDuration: {
      minDays: Math.max(1, Math.round(likelyDuration * 0.5)),
      maxDays: Math.round(likelyDuration * 2),
      likelyDays: likelyDuration,
    },
    stopLoss: {
      price: Math.round(stopLossPrice * 100) / 100,
      percentage: Math.round(stopLossPercentage * 100) / 100,
      method: stopLossMethod,
    },
    takeProfit: {
      conservative: calculateTP(1.5),
      moderate: calculateTP(2.5),
      aggressive: calculateTP(4),
    },
    riskRewardRatio: Math.max(0, riskRewardRatio),
    trendStrength: Math.round(trendStrength),
    reversalRisk: Math.min(100, Math.max(0, reversalRisk)),
  };
};
