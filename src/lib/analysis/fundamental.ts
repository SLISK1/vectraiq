// Fundamental Analysis Module
// Uses real fundamental data when available, with price-based proxies as fallback

import { AnalysisResult, PriceData, FundamentalMetrics } from './types';
import { Direction, Horizon, Evidence } from '@/types/market';

// Calculate price-based metrics as fallback proxies
const calculatePriceBasedMetrics = (
  priceHistory: PriceData[]
): { 
  momentum: number; 
  volatility: number; 
  trend: Direction;
  fiftyTwoWeekPosition: number;
  momentumQuality: number;
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
  const momentumQuality = recentReturns.length > 0 
    ? (dominantDirection / recentReturns.length) * 100
    : 50;
  
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

// Analyze REAL fundamental metrics (P/E, ROE, etc.)
const analyzeRealFundamentals = (
  fundamentals: FundamentalMetrics
): {
  score: number;
  signals: string[];
  coverage: number;
  confidence: number;
} => {
  let score = 0;
  const signals: string[] = [];
  let dataPoints = 0;
  const totalPossiblePoints = 7; // P/E, P/B, ROE, D/E, Dividend, Revenue Growth, Earnings Growth

  // P/E Ratio Analysis
  if (fundamentals.peRatio !== undefined && fundamentals.peRatio !== null) {
    dataPoints++;
    if (fundamentals.peRatio < 15) {
      score += 2;
      signals.push(`Lågt P/E-tal (${fundamentals.peRatio.toFixed(1)}) - undervärderad`);
    } else if (fundamentals.peRatio <= 25) {
      score += 0.5;
      signals.push(`Normalt P/E-tal (${fundamentals.peRatio.toFixed(1)})`);
    } else if (fundamentals.peRatio <= 40) {
      score -= 0.5;
      signals.push(`Högt P/E-tal (${fundamentals.peRatio.toFixed(1)}) - premium-värdering`);
    } else {
      score -= 1.5;
      signals.push(`Mycket högt P/E-tal (${fundamentals.peRatio.toFixed(1)}) - övervärderad risk`);
    }
  }

  // P/B Ratio Analysis
  if (fundamentals.pbRatio !== undefined && fundamentals.pbRatio !== null) {
    dataPoints++;
    if (fundamentals.pbRatio < 1) {
      score += 1.5;
      signals.push(`P/B under 1 (${fundamentals.pbRatio.toFixed(2)}) - handlas under bokfört värde`);
    } else if (fundamentals.pbRatio <= 3) {
      score += 0.5;
      signals.push(`Normalt P/B (${fundamentals.pbRatio.toFixed(2)})`);
    } else {
      score -= 0.5;
      signals.push(`Högt P/B (${fundamentals.pbRatio.toFixed(2)})`);
    }
  }

  // ROE Analysis
  if (fundamentals.roe !== undefined && fundamentals.roe !== null) {
    dataPoints++;
    if (fundamentals.roe > 20) {
      score += 2;
      signals.push(`Utmärkt ROE (${fundamentals.roe.toFixed(1)}%) - stark lönsamhet`);
    } else if (fundamentals.roe > 15) {
      score += 1.5;
      signals.push(`Bra ROE (${fundamentals.roe.toFixed(1)}%)`);
    } else if (fundamentals.roe > 8) {
      score += 0.5;
      signals.push(`Acceptabel ROE (${fundamentals.roe.toFixed(1)}%)`);
    } else if (fundamentals.roe > 0) {
      score -= 0.5;
      signals.push(`Låg ROE (${fundamentals.roe.toFixed(1)}%) - svag lönsamhet`);
    } else {
      score -= 1.5;
      signals.push(`Negativ ROE (${fundamentals.roe.toFixed(1)}%) - förlust`);
    }
  }

  // Debt-to-Equity Analysis
  if (fundamentals.debtToEquity !== undefined && fundamentals.debtToEquity !== null) {
    dataPoints++;
    if (fundamentals.debtToEquity < 0.3) {
      score += 1.5;
      signals.push(`Mycket låg skuldsättning (D/E: ${fundamentals.debtToEquity.toFixed(2)})`);
    } else if (fundamentals.debtToEquity < 0.7) {
      score += 1;
      signals.push(`Låg skuldsättning (D/E: ${fundamentals.debtToEquity.toFixed(2)})`);
    } else if (fundamentals.debtToEquity < 1.5) {
      score += 0;
      signals.push(`Normal skuldsättning (D/E: ${fundamentals.debtToEquity.toFixed(2)})`);
    } else if (fundamentals.debtToEquity < 2.5) {
      score -= 1;
      signals.push(`Hög skuldsättning (D/E: ${fundamentals.debtToEquity.toFixed(2)})`);
    } else {
      score -= 2;
      signals.push(`Mycket hög skuldsättning (D/E: ${fundamentals.debtToEquity.toFixed(2)}) - risk`);
    }
  }

  // Dividend Yield Analysis
  if (fundamentals.dividendYield !== undefined && fundamentals.dividendYield !== null) {
    dataPoints++;
    if (fundamentals.dividendYield > 5) {
      score += 1;
      signals.push(`Hög direktavkastning (${fundamentals.dividendYield.toFixed(2)}%)`);
    } else if (fundamentals.dividendYield > 2) {
      score += 0.5;
      signals.push(`God direktavkastning (${fundamentals.dividendYield.toFixed(2)}%)`);
    } else if (fundamentals.dividendYield > 0) {
      signals.push(`Låg direktavkastning (${fundamentals.dividendYield.toFixed(2)}%)`);
    }
  }

  // Revenue Growth Analysis
  if (fundamentals.revenueGrowth !== undefined && fundamentals.revenueGrowth !== null) {
    dataPoints++;
    if (fundamentals.revenueGrowth > 20) {
      score += 1.5;
      signals.push(`Stark omsättningstillväxt (${fundamentals.revenueGrowth.toFixed(1)}%)`);
    } else if (fundamentals.revenueGrowth > 10) {
      score += 1;
      signals.push(`Bra omsättningstillväxt (${fundamentals.revenueGrowth.toFixed(1)}%)`);
    } else if (fundamentals.revenueGrowth > 0) {
      score += 0.5;
      signals.push(`Positiv omsättningstillväxt (${fundamentals.revenueGrowth.toFixed(1)}%)`);
    } else {
      score -= 1;
      signals.push(`Negativ omsättningstillväxt (${fundamentals.revenueGrowth.toFixed(1)}%)`);
    }
  }

  // Earnings Growth Analysis
  if (fundamentals.earningsGrowth !== undefined && fundamentals.earningsGrowth !== null) {
    dataPoints++;
    if (fundamentals.earningsGrowth > 25) {
      score += 1.5;
      signals.push(`Stark vinsttillväxt (${fundamentals.earningsGrowth.toFixed(1)}%)`);
    } else if (fundamentals.earningsGrowth > 10) {
      score += 1;
      signals.push(`Bra vinsttillväxt (${fundamentals.earningsGrowth.toFixed(1)}%)`);
    } else if (fundamentals.earningsGrowth > 0) {
      score += 0.5;
      signals.push(`Positiv vinsttillväxt (${fundamentals.earningsGrowth.toFixed(1)}%)`);
    } else {
      score -= 1;
      signals.push(`Negativ vinsttillväxt (${fundamentals.earningsGrowth.toFixed(1)}%)`);
    }
  }

  // Calculate coverage based on data points available
  const coverage = Math.round((dataPoints / totalPossiblePoints) * 100);
  
  // Confidence increases with more data points
  const baseConfidence = 50;
  const dataConfidenceBoost = dataPoints * 6; // +6% per data point
  const confidence = Math.min(85, baseConfidence + dataConfidenceBoost);

  return { score, signals, coverage, confidence };
};

// Analyze price-based proxies (fallback when no fundamental data)
const analyzePriceProxies = (
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
  
  // Momentum Analysis
  if (momentum > 15) {
    score += 2;
    signals.push(`Mycket stark momentum (${momentum.toFixed(1)}%)`);
  } else if (momentum > 8) {
    score += 1.5;
    signals.push(`Stark momentum (${momentum.toFixed(1)}%)`);
  } else if (momentum > 3) {
    score += 0.5;
    signals.push(`Positiv momentum (${momentum.toFixed(1)}%)`);
  } else if (momentum < -15) {
    score -= 2;
    signals.push(`Mycket svag momentum (${momentum.toFixed(1)}%)`);
  } else if (momentum < -8) {
    score -= 1.5;
    signals.push(`Negativ momentum (${momentum.toFixed(1)}%)`);
  } else if (momentum < -3) {
    score -= 0.5;
    signals.push(`Svagt negativ momentum (${momentum.toFixed(1)}%)`);
  }
  
  // Volatility Analysis
  if (volatility < 15) {
    score += 0.5;
    signals.push(`Låg volatilitet (${volatility.toFixed(1)}%)`);
    coverageBoost += 5;
  } else if (volatility > 50) {
    score -= 1;
    signals.push(`Extremt hög volatilitet (${volatility.toFixed(1)}%)`);
  } else if (volatility > 35) {
    score -= 0.5;
    signals.push(`Hög volatilitet (${volatility.toFixed(1)}%)`);
  }
  
  // 52-week position analysis
  if (fiftyTwoWeekPosition > 85) {
    signals.push(`Nära 52-veckors högsta (${fiftyTwoWeekPosition.toFixed(0)}%)`);
    coverageBoost += 5;
  } else if (fiftyTwoWeekPosition < 15) {
    signals.push(`Nära 52-veckors lägsta (${fiftyTwoWeekPosition.toFixed(0)}%)`);
    coverageBoost += 5;
  }
  
  // Momentum quality
  if (momentumQuality > 70) {
    score += 0.5;
    signals.push(`Konsistent prisriktning (${momentumQuality.toFixed(0)}%)`);
    coverageBoost += 5;
  }
  
  // Risk-adjusted return
  if (riskAdjustedReturn > 1.5) {
    score += 0.5;
    signals.push(`Bra riskjusterad avkastning (${riskAdjustedReturn.toFixed(2)})`);
    coverageBoost += 5;
  } else if (riskAdjustedReturn < -1) {
    score -= 0.5;
    signals.push(`Dålig riskjusterad avkastning (${riskAdjustedReturn.toFixed(2)})`);
  }
  
  return { score, signals, coverageBoost };
};

// Main fundamental analysis function
export const analyzeFundamental = (
  priceHistory: PriceData[],
  currentPrice: number,
  horizon: Horizon,
  assetType: 'stock' | 'crypto' | 'metal' | 'fund',
  ticker: string,
  fundamentals?: FundamentalMetrics
): AnalysisResult => {
  const evidence: Evidence[] = [];
  
  // Fundamental analysis is more relevant for longer horizons
  const horizonWeight = horizon === '1y' ? 1.0 :
                        horizon === '1mo' ? 0.7 :
                        horizon === '1w' ? 0.4 : 0.2;
  
  let totalScore = 0;
  let coverage = 30; // Base coverage
  let confidence = 40; // Base confidence
  const allSignals: string[] = [];
  
  // Check if we have real fundamental data (only for stocks)
  const hasFundamentals = assetType === 'stock' && fundamentals && (
    fundamentals.peRatio !== undefined ||
    fundamentals.roe !== undefined ||
    fundamentals.pbRatio !== undefined
  );
  
  if (hasFundamentals && fundamentals) {
    // Use REAL fundamental data
    const fundAnalysis = analyzeRealFundamentals(fundamentals);
    totalScore += fundAnalysis.score;
    allSignals.push(...fundAnalysis.signals);
    coverage = Math.max(coverage, fundAnalysis.coverage);
    confidence = fundAnalysis.confidence;
    
    evidence.push({
      type: 'fundamental_data',
      description: 'Fundamentaldata från FMP / Finnhub',
      value: `${fundAnalysis.signals.length} nyckeltal analyserade`,
      timestamp: new Date().toISOString(),
      source: 'FMP / Finnhub API',
    });
    
    // Add market cap evidence if available
    if (fundamentals.marketCap) {
      const capInBillions = fundamentals.marketCap / 1e9;
      evidence.push({
        type: 'market_cap',
        description: 'Börsvärde',
        value: `${capInBillions.toFixed(1)} mdr`,
        timestamp: new Date().toISOString(),
        source: 'FMP / Finnhub API',
      });
    }
    
  } else {
    // Fallback: Use price-based proxies
    if (assetType === 'crypto') {
      evidence.push({
        type: 'limitation',
        description: 'Krypto saknar traditionella fundamenta',
        value: 'Analys baserad på prisdata',
        timestamp: new Date().toISOString(),
        source: 'Prishistorik',
      });
    } else if (assetType === 'metal') {
      evidence.push({
        type: 'limitation',
        description: 'Råvaror värderas efter utbud/efterfrågan',
        value: 'Analys baserad på prisdata',
        timestamp: new Date().toISOString(),
        source: 'Prishistorik',
      });
    } else {
      evidence.push({
        type: 'limitation',
        description: 'Fundamentaldata ej tillgänglig',
        value: 'Använder prisbaserade proxies',
        timestamp: new Date().toISOString(),
        source: 'System',
      });
    }
    
    // Calculate proxy metrics
    const priceMetrics = calculatePriceBasedMetrics(priceHistory);
    const proxyAnalysis = analyzePriceProxies(
      priceMetrics.momentum,
      priceMetrics.volatility,
      priceMetrics.fiftyTwoWeekPosition,
      priceMetrics.momentumQuality,
      priceMetrics.riskAdjustedReturn
    );
    
    // Dampen proxy scores to avoid double-counting with technical/sentiment modules
    // that also use price data. Factor 0.4 reduces overlap while preserving signal.
    const proxyDamping = 0.4;
    totalScore += proxyAnalysis.score * proxyDamping;
    allSignals.push(...proxyAnalysis.signals);
    coverage = Math.min(40, 25 + proxyAnalysis.coverageBoost);
    confidence = Math.min(45, 35 + proxyAnalysis.signals.length * 2);
  }
  
  // Add evidence for each signal
  allSignals.forEach((signal) => {
    const isPositive = signal.includes('Stark') || signal.includes('Positiv') || 
                       signal.includes('Låg skuld') || signal.includes('Bra') ||
                       signal.includes('Utmärkt') || signal.includes('God') ||
                       signal.includes('Lågt P/E') || signal.includes('P/B under');
    const isNegative = signal.includes('Negativ') || signal.includes('Svag') || 
                       signal.includes('Hög skuld') || signal.includes('Dålig') ||
                       signal.includes('risk') || signal.includes('förlust') ||
                       signal.includes('övervärd');
    evidence.push({
      type: hasFundamentals ? 'fundamental_metric' : 'price_proxy',
      description: signal,
      value: isPositive ? 'Positiv' : isNegative ? 'Negativ' : 'Neutral',
      timestamp: new Date().toISOString(),
      source: hasFundamentals ? 'Fundamental Analysis' : 'Price Proxy',
    });
  });
  
  // Determine direction based on score
  const direction: Direction = totalScore > 1.5 ? 'UP' : totalScore < -1.5 ? 'DOWN' : 'NEUTRAL';
  
  // Strength adjusted by horizon and score magnitude
  const baseStrength = Math.min(100, Math.max(0, 50 + totalScore * 7));
  const strength = Math.round(baseStrength * horizonWeight + 50 * (1 - horizonWeight));
  
  // Adjust confidence for horizon
  const finalConfidence = Math.round(confidence * horizonWeight + 40 * (1 - horizonWeight));
  
  return {
    module: 'fundamental',
    direction,
    strength: Math.max(0, Math.min(100, strength)),
    confidence: Math.max(35, Math.min(85, finalConfidence)),
    coverage: Math.max(30, Math.min(95, coverage)),
    evidence,
    metadata: { 
      hasFundamentals,
      totalScore, 
      horizonWeight,
      signalCount: allSignals.length,
      dataSource: hasFundamentals ? 'fmp_fundamentals' : 'price_proxy',
    },
  };
};
