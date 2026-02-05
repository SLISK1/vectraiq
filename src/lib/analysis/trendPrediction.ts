// Trend Duration and Stop/Loss Prediction Module

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
  
  // Find clusters of support/resistance
  const sortedLows = [...lows].sort((a, b) => a - b);
  const sortedHighs = [...highs].sort((a, b) => a - b);
  
  // Use 20th percentile for support, 80th for resistance
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
  
  // Add final trend
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
  
  // Calculate ATR for volatility-based stop loss
  const atr = calculateATR(priceHistory);
  const atrMultiplier = 2; // Standard ATR multiplier for stop loss
  
  // Find support/resistance
  const { support, resistance } = findSupportResistance(priceHistory, direction);
  
  // Calculate stop loss based on multiple methods
  const atrStopDistance = atr * atrMultiplier;
  const supportStopDistance = Math.abs(currentPrice - support);
  const volatilityStopDistance = currentPrice * (volatilityScore / 100) * 0.15; // 15% of volatility score
  
  // Choose the tightest reasonable stop
  let stopLossPrice: number;
  let stopLossMethod: 'atr' | 'support' | 'volatility';
  
  if (direction === 'UP') {
    const stops = [
      { price: currentPrice - atrStopDistance, method: 'atr' as const },
      { price: Math.max(support, currentPrice * 0.9), method: 'support' as const },
      { price: currentPrice - volatilityStopDistance, method: 'volatility' as const },
    ];
    const best = stops.reduce((a, b) => a.price > b.price ? a : b);
    stopLossPrice = best.price;
    stopLossMethod = best.method;
  } else if (direction === 'DOWN') {
    // For short positions, stop loss is above current price
    const stops = [
      { price: currentPrice + atrStopDistance, method: 'atr' as const },
      { price: Math.min(resistance, currentPrice * 1.1), method: 'support' as const },
      { price: currentPrice + volatilityStopDistance, method: 'volatility' as const },
    ];
    const best = stops.reduce((a, b) => a.price < b.price ? a : b);
    stopLossPrice = best.price;
    stopLossMethod = best.method;
  } else {
    // Neutral - use volatility-based
    stopLossPrice = currentPrice * (1 - volatilityScore / 1000);
    stopLossMethod = 'volatility';
  }
  
  const stopLossPercentage = Math.abs((stopLossPrice - currentPrice) / currentPrice) * 100;
  
  // Calculate take profit levels based on risk/reward
  const riskAmount = Math.abs(currentPrice - stopLossPrice);
  
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
  
  // Calculate trend duration based on historical data and horizon
  const historicalDurations = calculateHistoricalTrendDurations(priceHistory);
  const avgDuration = historicalDurations.reduce((a, b) => a + b, 0) / historicalDurations.length;
  const maxHistoricalDuration = Math.max(...historicalDurations);
  
  const horizonDays = horizonToDays[horizon];
  
  // Adjust trend duration based on confidence and volatility
  const confidenceMultiplier = confidence / 100;
  const volatilityPenalty = 1 - (volatilityScore / 200); // Higher volatility = shorter trends
  
  const baseDuration = Math.max(horizonDays, avgDuration * 0.5);
  const likelyDuration = Math.round(baseDuration * confidenceMultiplier * volatilityPenalty);
  
  // Calculate trend strength (how strongly is the trend continuing)
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
  
  // Calculate reversal risk based on trend exhaustion and volatility
  const exhaustionLevel = Math.min(100, (confidence - 30) * 1.5); // High confidence can mean exhaustion
  const reversalRisk = Math.round(
    (100 - trendStrength) * 0.4 + 
    volatilityScore * 0.3 + 
    (100 - confidence) * 0.3
  );
  
  return {
    trendDuration: {
      minDays: Math.max(1, Math.round(likelyDuration * 0.5)),
      maxDays: Math.round(likelyDuration * 2),
      likelyDays: Math.max(1, likelyDuration),
    },
    stopLoss: {
      price: Math.round(stopLossPrice * 100) / 100,
      percentage: Math.round(stopLossPercentage * 100) / 100,
      method: stopLossMethod,
    },
    takeProfit: {
      conservative: calculateTP(1.5), // 1.5:1 risk/reward
      moderate: calculateTP(2.5),     // 2.5:1 risk/reward
      aggressive: calculateTP(4),     // 4:1 risk/reward
    },
    riskRewardRatio: Math.round(((resistance - currentPrice) / riskAmount) * 100) / 100,
    trendStrength: Math.round(trendStrength),
    reversalRisk: Math.min(100, Math.max(0, reversalRisk)),
  };
};
