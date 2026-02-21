// Technical Analysis Module
// Calculates RSI, MACD, Moving Averages, Bollinger Bands, etc.

import { AnalysisResult, PriceData, TechnicalIndicators } from './types';
import { Direction, Horizon, Evidence } from '@/types/market';

// Calculate Simple Moving Average
export const calculateSMA = (prices: number[], period: number): number | undefined => {
  if (prices.length < period) return undefined;
  const slice = prices.slice(-period);
  return slice.reduce((sum, p) => sum + p, 0) / period;
};

// Calculate Exponential Moving Average
export const calculateEMA = (prices: number[], period: number): number | undefined => {
  if (prices.length < period) return undefined;
  
  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((sum, p) => sum + p, 0) / period;
  
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }
  
  return ema;
};

// Calculate RSI (Relative Strength Index)
export const calculateRSI = (prices: number[], period: number = 14): number | undefined => {
  if (prices.length < period + 1) return undefined;

  const changes = prices.slice(1).map((price, i) => price - prices[i]);
  const recentChanges = changes.slice(-period);
  
  const gains = recentChanges.filter(c => c > 0);
  const losses = recentChanges.filter(c => c < 0).map(c => Math.abs(c));
  
  const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / period : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / period : 0;
  
  if (avgLoss === 0) return 100;
  
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
};

// Calculate MACD
export const calculateMACD = (prices: number[]): { value: number; signal: number; histogram: number } | undefined => {
  if (prices.length < 26) return undefined;
  
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  
  if (!ema12 || !ema26) return undefined;
  
  const macdLine = ema12 - ema26;
  
  // Calculate signal line (9-period EMA of MACD)
  const macdHistory: number[] = [];
  for (let i = 26; i <= prices.length; i++) {
    const e12 = calculateEMA(prices.slice(0, i), 12);
    const e26 = calculateEMA(prices.slice(0, i), 26);
    if (e12 && e26) macdHistory.push(e12 - e26);
  }
  
  const signalLine = macdHistory.length >= 9 ? calculateEMA(macdHistory, 9) : macdLine;
  
  return {
    value: macdLine,
    signal: signalLine || macdLine,
    histogram: macdLine - (signalLine || macdLine),
  };
};

// Calculate Bollinger Bands
export const calculateBollingerBands = (prices: number[], period: number = 20, stdDev: number = 2): {
  upper: number;
  middle: number;
  lower: number;
  percentB: number;
} | undefined => {
  if (prices.length < period) return undefined;
  
  const sma = calculateSMA(prices, period);
  if (!sma) return undefined;
  
  const slice = prices.slice(-period);
  const variance = slice.reduce((sum, p) => sum + Math.pow(p - sma, 2), 0) / period;
  const std = Math.sqrt(variance);
  
  const upper = sma + (stdDev * std);
  const lower = sma - (stdDev * std);
  const currentPrice = prices[prices.length - 1];
  const percentB = (currentPrice - lower) / (upper - lower);
  
  return { upper, middle: sma, lower, percentB };
};

// Calculate Stochastic Oscillator
export const calculateStochastic = (
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14
): { k: number; d: number } | undefined => {
  if (closes.length < period) return undefined;
  
  const highPeriod = Math.max(...highs.slice(-period));
  const lowPeriod = Math.min(...lows.slice(-period));
  const currentClose = closes[closes.length - 1];
  
  const k = ((currentClose - lowPeriod) / (highPeriod - lowPeriod)) * 100;
  
  // Calculate %D (3-period SMA of %K)
  const d = k; // Simplified
  
  return { k, d };
};

// Calculate Average True Range
export const calculateATR = (
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14
): number | undefined => {
  if (closes.length < period + 1) return undefined;
  
  const trueRanges: number[] = [];
  
  for (let i = 1; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trueRanges.push(tr);
  }
  
  return calculateSMA(trueRanges, period);
};

// Get all technical indicators
export const calculateAllIndicators = (priceHistory: PriceData[]): TechnicalIndicators => {
  const closes = priceHistory.map(p => p.close ?? p.price);
  const highs = priceHistory.map(p => p.high ?? p.price);
  const lows = priceHistory.map(p => p.low ?? p.price);
  
  return {
    rsi: calculateRSI(closes),
    macd: calculateMACD(closes),
    sma20: calculateSMA(closes, 20),
    sma50: calculateSMA(closes, 50),
    sma200: calculateSMA(closes, 200),
    ema12: calculateEMA(closes, 12),
    ema26: calculateEMA(closes, 26),
    bollingerBands: calculateBollingerBands(closes),
    atr: calculateATR(highs, lows, closes),
    stochastic: calculateStochastic(highs, lows, closes),
  };
};

// Enrich indicators with Alpha Vantage cached data
export const enrichWithAVIndicators = (
  indicators: TechnicalIndicators,
  avCache: { indicator_type: string; data: any }[]
): TechnicalIndicators => {
  const enriched = { ...indicators };

  for (const entry of avCache) {
    switch (entry.indicator_type) {
      case 'RSI':
        if (entry.data?.latest != null) {
          enriched.avRsi = entry.data.latest;
        }
        break;
      case 'MACD':
        if (entry.data?.latest) {
          enriched.avMacd = {
            value: entry.data.latest.macd,
            signal: entry.data.latest.signal,
            histogram: entry.data.latest.histogram,
          };
        }
        break;
      case 'ADX':
        if (entry.data?.latest != null) {
          enriched.adx = entry.data.latest;
        }
        break;
      case 'VWAP':
        if (entry.data?.latest != null) {
          enriched.vwap = entry.data.latest;
        }
        break;
    }
  }

  return enriched;
};

// Main technical analysis function
export const analyzeTechnical = (
  priceHistory: PriceData[],
  currentPrice: number,
  horizon: Horizon,
  avCache?: { indicator_type: string; data: any }[]
): AnalysisResult => {
  let indicators = calculateAllIndicators(priceHistory);
  
  // Enrich with AV data if available
  if (avCache && avCache.length > 0) {
    indicators = enrichWithAVIndicators(indicators, avCache);
  }

  const evidence: Evidence[] = [];
  
  let bullishSignals = 0;
  let bearishSignals = 0;
  let totalSignals = 0;
  
  // RSI Analysis (use AV RSI if available for cross-validation)
  const effectiveRsi = indicators.avRsi ?? indicators.rsi;
  if (effectiveRsi !== undefined) {
    totalSignals++;
    const rsiSource = indicators.avRsi != null ? 'RSI (AV-validerad)' : 'RSI';
    if (effectiveRsi < 30) {
      bullishSignals++;
      evidence.push({
        type: 'indicator',
        description: `${rsiSource} översålt (${effectiveRsi.toFixed(1)})`,
        value: effectiveRsi,
        timestamp: new Date().toISOString(),
        source: rsiSource,
      });
    } else if (effectiveRsi > 70) {
      bearishSignals++;
      evidence.push({
        type: 'indicator',
        description: `${rsiSource} överköpt (${effectiveRsi.toFixed(1)})`,
        value: effectiveRsi,
        timestamp: new Date().toISOString(),
        source: rsiSource,
      });
    }
    
    // RSI divergence check: if local and AV RSI disagree significantly
    if (indicators.rsi != null && indicators.avRsi != null) {
      const rsiDiff = Math.abs(indicators.rsi - indicators.avRsi);
      if (rsiDiff > 10) {
        evidence.push({
          type: 'indicator',
          description: `RSI-avvikelse: lokal=${indicators.rsi.toFixed(1)} vs AV=${indicators.avRsi.toFixed(1)}`,
          value: rsiDiff,
          timestamp: new Date().toISOString(),
          source: 'RSI Cross-Validation',
        });
      }
    }
  }
  
  // MACD Analysis (prefer AV if available)
  const effectiveMacd = indicators.avMacd ?? indicators.macd;
  if (effectiveMacd) {
    totalSignals++;
    const macdSource = indicators.avMacd ? 'MACD (AV)' : 'MACD';
    if (effectiveMacd.histogram > 0 && effectiveMacd.value > effectiveMacd.signal) {
      bullishSignals++;
      evidence.push({
        type: 'indicator',
        description: `${macdSource} bullish crossover`,
        value: effectiveMacd.histogram,
        timestamp: new Date().toISOString(),
        source: macdSource,
      });
    } else if (effectiveMacd.histogram < 0 && effectiveMacd.value < effectiveMacd.signal) {
      bearishSignals++;
      evidence.push({
        type: 'indicator',
        description: `${macdSource} bearish crossover`,
        value: effectiveMacd.histogram,
        timestamp: new Date().toISOString(),
        source: macdSource,
      });
    }
  }
  
  // Moving Average Analysis
  if (indicators.sma20 && indicators.sma50) {
    totalSignals++;
    if (currentPrice > indicators.sma20 && indicators.sma20 > indicators.sma50) {
      bullishSignals++;
      evidence.push({
        type: 'trend',
        description: 'Pris över SMA20 och SMA50 - upptrend',
        value: `${((currentPrice / indicators.sma50 - 1) * 100).toFixed(1)}% över SMA50`,
        timestamp: new Date().toISOString(),
        source: 'Moving Averages',
      });
    } else if (currentPrice < indicators.sma20 && indicators.sma20 < indicators.sma50) {
      bearishSignals++;
      evidence.push({
        type: 'trend',
        description: 'Pris under SMA20 och SMA50 - nedtrend',
        value: `${((1 - currentPrice / indicators.sma50) * 100).toFixed(1)}% under SMA50`,
        timestamp: new Date().toISOString(),
        source: 'Moving Averages',
      });
    }
  }
  
  // Bollinger Bands Analysis
  if (indicators.bollingerBands) {
    totalSignals++;
    const { percentB } = indicators.bollingerBands;
    if (percentB < 0.2) {
      bullishSignals++;
      evidence.push({
        type: 'volatility',
        description: 'Pris nära nedre Bollinger Band',
        value: `%B: ${(percentB * 100).toFixed(1)}%`,
        timestamp: new Date().toISOString(),
        source: 'Bollinger Bands',
      });
    } else if (percentB > 0.8) {
      bearishSignals++;
      evidence.push({
        type: 'volatility',
        description: 'Pris nära övre Bollinger Band',
        value: `%B: ${(percentB * 100).toFixed(1)}%`,
        timestamp: new Date().toISOString(),
        source: 'Bollinger Bands',
      });
    }
  }
  
  // Stochastic Analysis
  if (indicators.stochastic) {
    totalSignals++;
    if (indicators.stochastic.k < 20) {
      bullishSignals++;
      evidence.push({
        type: 'momentum',
        description: `Stochastic översålt (%K: ${indicators.stochastic.k.toFixed(1)})`,
        value: indicators.stochastic.k,
        timestamp: new Date().toISOString(),
        source: 'Stochastic',
      });
    } else if (indicators.stochastic.k > 80) {
      bearishSignals++;
      evidence.push({
        type: 'momentum',
        description: `Stochastic överköpt (%K: ${indicators.stochastic.k.toFixed(1)})`,
        value: indicators.stochastic.k,
        timestamp: new Date().toISOString(),
        source: 'Stochastic',
      });
    }
  }
  
  // ADX Analysis (trend strength from Alpha Vantage)
  if (indicators.adx != null) {
    totalSignals++;
    if (indicators.adx > 25) {
      // Strong trend — amplify the direction signal
      evidence.push({
        type: 'trend',
        description: `ADX stark trend (${indicators.adx.toFixed(1)}) — förstärker riktningssignal`,
        value: indicators.adx,
        timestamp: new Date().toISOString(),
        source: 'ADX (Alpha Vantage)',
      });
      // ADX confirms whatever direction we already have
      if (bullishSignals > bearishSignals) bullishSignals++;
      else if (bearishSignals > bullishSignals) bearishSignals++;
    } else if (indicators.adx < 20) {
      evidence.push({
        type: 'trend',
        description: `ADX svag trend (${indicators.adx.toFixed(1)}) — sidledes marknad`,
        value: indicators.adx,
        timestamp: new Date().toISOString(),
        source: 'ADX (Alpha Vantage)',
      });
    }
  }
  
  // VWAP Analysis (institutional support/resistance)
  if (indicators.vwap != null && currentPrice > 0) {
    totalSignals++;
    const vwapDiff = ((currentPrice - indicators.vwap) / indicators.vwap) * 100;
    if (currentPrice > indicators.vwap * 1.01) {
      bullishSignals++;
      evidence.push({
        type: 'indicator',
        description: `Pris ${vwapDiff.toFixed(1)}% över VWAP — köptryck`,
        value: indicators.vwap,
        timestamp: new Date().toISOString(),
        source: 'VWAP (Alpha Vantage)',
      });
    } else if (currentPrice < indicators.vwap * 0.99) {
      bearishSignals++;
      evidence.push({
        type: 'indicator',
        description: `Pris ${Math.abs(vwapDiff).toFixed(1)}% under VWAP — säljtryck`,
        value: indicators.vwap,
        timestamp: new Date().toISOString(),
        source: 'VWAP (Alpha Vantage)',
      });
    }
  }
  
  // Calculate direction and strength
  const netSignal = bullishSignals - bearishSignals;
  const direction: Direction = netSignal > 0 ? 'UP' : netSignal < 0 ? 'DOWN' : 'NEUTRAL';
  
  const strength = totalSignals > 0 
    ? Math.round(50 + (netSignal / totalSignals) * 50)
    : 50;
  
  // Coverage based on available indicators (now out of 14 with AV additions)
  const availableIndicators = Object.values(indicators).filter(v => v !== undefined).length;
  const totalPossibleIndicators = 14; // 10 base + 4 AV
  const coverage = Math.round((availableIndicators / totalPossibleIndicators) * 100);
  
  // Confidence based on signal agreement
  const signalAgreement = totalSignals > 0 
    ? Math.abs(netSignal) / totalSignals 
    : 0;
  const confidence = Math.round(40 + signalAgreement * 50 + (coverage / 100) * 10);
  
  return {
    module: 'technical',
    direction,
    strength: Math.max(0, Math.min(100, strength)),
    confidence: Math.max(0, Math.min(100, confidence)),
    coverage,
    evidence,
    metadata: { indicators },
  };
};
