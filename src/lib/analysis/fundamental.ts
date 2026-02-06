// Fundamental Analysis Module
// Note: Full fundamental analysis requires external financial data API integration

import { AnalysisResult, PriceData, FundamentalMetrics } from './types';
import { Direction, Horizon, Evidence } from '@/types/market';

// Calculate comprehensive price-based metrics
const calculatePriceBasedMetrics = (
  priceHistory: PriceData[]
): { 
  momentum: number; 
  volatility: number; 
  trend: Direction;
  fiftyTwoWeekPosition: number; // 0-100, where 100 = at 52-week high
  momentumQuality: number; // 0-100, how consistent the momentum is
  riskAdjustedReturn: number;
} => {
  if (priceHistory.length < 10) {
    return { 
      momentum: 0, 
      volatility: 0, 
      trend: 'NEUTRAL',
      fiftyTwoWeekPosition: 50,
      momentumQuality: 50,
      riskAdjustedReturn: 0,
    };
  }
  
  const prices = priceHistory.map(p => p.close ?? p.price);
  const currentPrice = prices[prices.length - 1];
  
  // Calculate price change over different periods
  const weekAgoIdx = Math.max(0, prices.length - 5);
  const monthAgoIdx = Math.max(0, prices.length - 22);
  const threeMonthAgoIdx = Math.max(0, prices.length - 66);
  
  const weekChange = (currentPrice - prices[weekAgoIdx]) / prices[weekAgoIdx];
  const monthChange = (currentPrice - prices[monthAgoIdx]) / prices[monthAgoIdx];
  const threeMonthChange = prices.length >= 66 
    ? (currentPrice - prices[threeMonthAgoIdx]) / prices[threeMonthAgoIdx]
    : monthChange;
  
  // Calculate volatility from price changes
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const volatility = Math.sqrt(variance) * Math.sqrt(252) * 100; // Annualized
  
  // Determine trend from momentum
  const momentum = (weekChange * 0.4 + monthChange * 0.35 + threeMonthChange * 0.25) * 100;
  const trend: Direction = momentum > 5 ? 'UP' : momentum < -5 ? 'DOWN' : 'NEUTRAL';
  
  // Calculate 52-week high/low position
  const high52w = Math.max(...prices);
  const low52w = Math.min(...prices);
  const fiftyTwoWeekPosition = high52w > low52w 
    ? ((currentPrice - low52w) / (high52w - low52w)) * 100
    : 50;
  
  // Calculate momentum quality (consistency)
  const recentReturns = returns.slice(-20);
  const positiveCount = recentReturns.filter(r => r > 0).length;
  const negativeCount = recentReturns.filter(r => r < 0).length;
  const dominantDirection = positiveCount >= negativeCount ? positiveCount : negativeCount;
  const momentumQuality = (dominantDirection / recentReturns.length) * 100;
  
  // Risk-adjusted return (Sharpe-like ratio simplified)
  const riskAdjustedReturn = volatility > 0 ? (avgReturn * 252 * 100) / volatility : 0;
  
  return { 
    momentum, 
    volatility, 
    trend,
    fiftyTwoWeekPosition,
    momentumQuality,
    riskAdjustedReturn,
  };
};

// Analyze price-based indicators as proxy for fundamentals
const analyzePriceMetrics = (
  momentum: number, 
  volatility: number,
  fiftyTwoWeekPosition: number,
  momentumQuality: number,
  riskAdjustedReturn: number
): {
  score: number;
  signals: string[];
  coverageBoost: number;
} => {
  let score = 0;
  let coverageBoost = 0;
  const signals: string[] = [];
  
  // Momentum Analysis (enhanced)
  if (momentum > 15) {
    score += 3;
    signals.push(`Mycket stark momentum (${momentum.toFixed(1)}%)`);
  } else if (momentum > 8) {
    score += 2;
    signals.push(`Stark momentum (${momentum.toFixed(1)}%)`);
  } else if (momentum > 3) {
    score += 1;
    signals.push(`Positiv momentum (${momentum.toFixed(1)}%)`);
  } else if (momentum < -15) {
    score -= 3;
    signals.push(`Mycket svag momentum (${momentum.toFixed(1)}%)`);
  } else if (momentum < -8) {
    score -= 2;
    signals.push(`Negativ momentum (${momentum.toFixed(1)}%)`);
  } else if (momentum < -3) {
    score -= 1;
    signals.push(`Svagt negativ momentum (${momentum.toFixed(1)}%)`);
  }
  
  // Volatility Analysis
  if (volatility < 12) {
    score += 1;
    signals.push(`Låg volatilitet (${volatility.toFixed(1)}%)`);
    coverageBoost += 5;
  } else if (volatility > 50) {
    score -= 2;
    signals.push(`Extremt hög volatilitet (${volatility.toFixed(1)}%)`);
  } else if (volatility > 35) {
    score -= 1;
    signals.push(`Hög volatilitet (${volatility.toFixed(1)}%)`);
  }
  
  // 52-week position analysis
  if (fiftyTwoWeekPosition > 85) {
    signals.push(`Nära 52-veckors högsta (${fiftyTwoWeekPosition.toFixed(0)}%)`);
    // Near highs can be bullish but risky
    score += 0.5;
    coverageBoost += 10;
  } else if (fiftyTwoWeekPosition < 15) {
    signals.push(`Nära 52-veckors lägsta (${fiftyTwoWeekPosition.toFixed(0)}%)`);
    // Near lows - could be value or falling knife
    coverageBoost += 10;
  } else if (fiftyTwoWeekPosition > 60 && fiftyTwoWeekPosition < 85) {
    signals.push(`Stabil upptrend, ${fiftyTwoWeekPosition.toFixed(0)}% av spannet`);
    score += 1;
    coverageBoost += 8;
  }
  
  // Momentum quality (consistency)
  if (momentumQuality > 70) {
    score += 1;
    signals.push(`Konsistent prisriktning (${momentumQuality.toFixed(0)}%)`);
    coverageBoost += 10;
  } else if (momentumQuality < 40) {
    signals.push(`Hackig prisrörelse (${momentumQuality.toFixed(0)}%)`);
    score -= 0.5;
  }
  
  // Risk-adjusted return
  if (riskAdjustedReturn > 1.5) {
    score += 1;
    signals.push(`Bra riskjusterad avkastning (${riskAdjustedReturn.toFixed(2)})`);
    coverageBoost += 8;
  } else if (riskAdjustedReturn < -1) {
    score -= 1;
    signals.push(`Dålig riskjusterad avkastning (${riskAdjustedReturn.toFixed(2)})`);
  }
  
  return { score, signals, coverageBoost };
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
  
  // Calculate enhanced metrics from price data
  const { 
    momentum, 
    volatility, 
    trend,
    fiftyTwoWeekPosition,
    momentumQuality,
    riskAdjustedReturn,
  } = calculatePriceBasedMetrics(priceHistory);
  
  const { score, signals, coverageBoost } = analyzePriceMetrics(
    momentum, 
    volatility,
    fiftyTwoWeekPosition,
    momentumQuality,
    riskAdjustedReturn
  );
  
  // Add price-based evidence
  signals.forEach((signal) => {
    const isPositive = signal.includes('Stark') || signal.includes('Positiv') || 
                       signal.includes('Låg volatilitet') || signal.includes('Konsistent') ||
                       signal.includes('Bra risk');
    const isNegative = signal.includes('Negativ') || signal.includes('Svag') || 
                       signal.includes('Hög volatilitet') || signal.includes('Dålig') ||
                       signal.includes('Extremt');
    evidence.push({
      type: 'price_metric',
      description: signal,
      value: isPositive ? 'Positiv' : isNegative ? 'Negativ' : 'Neutral',
      timestamp: new Date().toISOString(),
      source: 'Fundamental Proxy',
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
  const direction: Direction = score > 1.5 ? 'UP' : score < -1.5 ? 'DOWN' : trend;
  
  // Strength adjusted by horizon relevance and score magnitude
  const baseStrength = Math.min(100, Math.max(0, 50 + score * 8));
  const strength = Math.round(baseStrength * horizonWeight + 50 * (1 - horizonWeight));
  
  // Enhanced coverage calculation with proxy indicators
  const baseCoverage = priceHistory.length >= 60 ? 45 : 
                       priceHistory.length >= 30 ? 38 : 
                       priceHistory.length >= 10 ? 30 : 15;
  const coverage = Math.min(70, baseCoverage + coverageBoost);
  
  // Enhanced confidence calculation
  const dataConfidence = Math.min(30, (priceHistory.length / 100) * 30);
  const proxyConfidence = Math.min(25, signals.length * 5);
  const horizonConfidence = horizonWeight * 20;
  const confidence = Math.round(30 + dataConfidence + proxyConfidence + horizonConfidence);
  
  return {
    module: 'fundamental',
    direction,
    strength: Math.max(0, Math.min(100, strength)),
    confidence: Math.max(35, Math.min(75, confidence)),
    coverage,
    evidence,
    metadata: { 
      momentum, 
      volatility, 
      fiftyTwoWeekPosition,
      momentumQuality,
      riskAdjustedReturn,
      score, 
      horizonWeight, 
      dataSource: 'enhanced_price_proxy' 
    },
  };
};
