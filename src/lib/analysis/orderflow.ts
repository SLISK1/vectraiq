// Order Flow Analysis Module
// Volume analysis, buy/sell pressure, institutional flow indicators

import { AnalysisResult, PriceData, OrderFlowData } from './types';
import { Direction, Horizon, Evidence } from '@/types/market';

// Calculate volume-weighted average price
const calculateVWAP = (priceHistory: PriceData[]): number | undefined => {
  const withVolume = priceHistory.filter(p => p.volume && p.volume > 0);
  if (withVolume.length === 0) return undefined;
  
  const totalVolValue = withVolume.reduce((sum, p) => sum + (p.price * (p.volume || 0)), 0);
  const totalVolume = withVolume.reduce((sum, p) => sum + (p.volume || 0), 0);
  
  return totalVolume > 0 ? totalVolValue / totalVolume : undefined;
};

// Analyze volume trend
const analyzeVolumeTrend = (priceHistory: PriceData[], period: number = 20): {
  trend: 'increasing' | 'decreasing' | 'stable';
  averageVolume: number;
  recentVolume: number;
  ratio: number;
} => {
  const withVolume = priceHistory.filter(p => p.volume && p.volume > 0);
  if (withVolume.length < period) {
    return { trend: 'stable', averageVolume: 0, recentVolume: 0, ratio: 1 };
  }
  
  const recentPeriod = Math.min(5, Math.floor(period / 4));
  const volumes = withVolume.map(p => p.volume || 0);
  
  const averageVolume = volumes.slice(-period).reduce((a, b) => a + b, 0) / period;
  const recentVolume = volumes.slice(-recentPeriod).reduce((a, b) => a + b, 0) / recentPeriod;
  
  const ratio = averageVolume > 0 ? recentVolume / averageVolume : 1;
  
  let trend: 'increasing' | 'decreasing' | 'stable';
  if (ratio > 1.5) trend = 'increasing';
  else if (ratio < 0.7) trend = 'decreasing';
  else trend = 'stable';
  
  return { trend, averageVolume, recentVolume, ratio };
};

// Calculate On-Balance Volume (OBV)
const calculateOBV = (priceHistory: PriceData[]): {
  obv: number;
  obvTrend: Direction;
} => {
  let obv = 0;
  const obvHistory: number[] = [];
  
  for (let i = 1; i < priceHistory.length; i++) {
    const volume = priceHistory[i].volume || 0;
    const priceChange = priceHistory[i].price - priceHistory[i - 1].price;
    
    if (priceChange > 0) {
      obv += volume;
    } else if (priceChange < 0) {
      obv -= volume;
    }
    obvHistory.push(obv);
  }
  
  // Determine OBV trend
  const recentOBV = obvHistory.slice(-10);
  let obvTrend: Direction = 'NEUTRAL';
  if (recentOBV.length >= 2) {
    const obvChange = recentOBV[recentOBV.length - 1] - recentOBV[0];
    if (obvChange > 0) obvTrend = 'UP';
    else if (obvChange < 0) obvTrend = 'DOWN';
  }
  
  return { obv, obvTrend };
};

// Estimate accumulation/distribution
const calculateAccumulationDistribution = (priceHistory: PriceData[]): {
  adLine: number;
  trend: Direction;
} => {
  let ad = 0;
  const adHistory: number[] = [];
  
  for (const candle of priceHistory) {
    const high = candle.high ?? candle.price;
    const low = candle.low ?? candle.price;
    const close = candle.close ?? candle.price;
    const volume = candle.volume ?? 0;
    
    if (high !== low) {
      const clv = ((close - low) - (high - close)) / (high - low);
      ad += clv * volume;
    }
    adHistory.push(ad);
  }
  
  // Determine trend
  const recentAD = adHistory.slice(-10);
  let trend: Direction = 'NEUTRAL';
  if (recentAD.length >= 2) {
    const adChange = recentAD[recentAD.length - 1] - recentAD[0];
    if (adChange > 0) trend = 'UP';
    else if (adChange < 0) trend = 'DOWN';
  }
  
  return { adLine: ad, trend };
};

// Analyze price-volume relationship
const analyzePriceVolumeRelationship = (priceHistory: PriceData[]): {
  relationship: 'confirmation' | 'divergence' | 'neutral';
  description: string;
} => {
  if (priceHistory.length < 10) {
    return { relationship: 'neutral', description: 'Otillräcklig data' };
  }
  
  const recent = priceHistory.slice(-10);
  const priceChange = (recent[recent.length - 1].price - recent[0].price) / recent[0].price;
  
  const recentVolumes = recent.filter(p => p.volume).map(p => p.volume || 0);
  const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
  
  const olderVolumes = priceHistory.slice(-20, -10).filter(p => p.volume).map(p => p.volume || 0);
  const olderAvgVolume = olderVolumes.length > 0 
    ? olderVolumes.reduce((a, b) => a + b, 0) / olderVolumes.length 
    : avgVolume;
  
  const volumeChange = olderAvgVolume > 0 ? (avgVolume - olderAvgVolume) / olderAvgVolume : 0;
  
  // Check for confirmation or divergence
  if (priceChange > 0.02 && volumeChange > 0.1) {
    return { 
      relationship: 'confirmation', 
      description: 'Prisuppgång bekräftas av ökande volym - starkt köptryck' 
    };
  } else if (priceChange < -0.02 && volumeChange > 0.1) {
    return { 
      relationship: 'confirmation', 
      description: 'Prisnedgång bekräftas av ökande volym - starkt säljtryck' 
    };
  } else if (priceChange > 0.02 && volumeChange < -0.1) {
    return { 
      relationship: 'divergence', 
      description: 'Prisuppgång med sjunkande volym - svagt momentum' 
    };
  } else if (priceChange < -0.02 && volumeChange < -0.1) {
    return { 
      relationship: 'divergence', 
      description: 'Prisnedgång med sjunkande volym - säljtryck avtar' 
    };
  }
  
  return { relationship: 'neutral', description: 'Ingen tydlig pris-volym signal' };
};

// Main order flow analysis function
export const analyzeOrderFlow = (
  priceHistory: PriceData[],
  currentPrice: number,
  horizon: Horizon
): AnalysisResult => {
  const evidence: Evidence[] = [];
  let bullishSignals = 0;
  let bearishSignals = 0;
  let totalSignals = 0;
  
  // Check if we have volume data
  const hasVolumeData = priceHistory.some(p => p.volume && p.volume > 0);
  
  if (!hasVolumeData) {
    evidence.push({
      type: 'limitation',
      description: 'Volymdata saknas',
      value: 'Orderflödesanalys kräver volymdata',
      timestamp: new Date().toISOString(),
      source: 'Data Quality',
    });
    
    return {
      module: 'orderFlow',
      direction: 'NEUTRAL',
      strength: 50,
      confidence: 20,
      coverage: 0,
      evidence,
      metadata: { hasVolumeData: false },
    };
  }
  
  // 1. VWAP Analysis
  const vwap = calculateVWAP(priceHistory);
  if (vwap !== undefined) {
    totalSignals++;
    if (currentPrice > vwap * 1.02) {
      bullishSignals++;
      evidence.push({
        type: 'vwap',
        description: 'Pris över VWAP',
        value: `Pris: ${currentPrice.toFixed(2)}, VWAP: ${vwap.toFixed(2)}`,
        timestamp: new Date().toISOString(),
        source: 'VWAP Analysis',
      });
    } else if (currentPrice < vwap * 0.98) {
      bearishSignals++;
      evidence.push({
        type: 'vwap',
        description: 'Pris under VWAP',
        value: `Pris: ${currentPrice.toFixed(2)}, VWAP: ${vwap.toFixed(2)}`,
        timestamp: new Date().toISOString(),
        source: 'VWAP Analysis',
      });
    }
  }
  
  // 2. Volume Trend
  const volumeTrend = analyzeVolumeTrend(priceHistory);
  evidence.push({
    type: 'volume_trend',
    description: 'Volymtrend',
    value: volumeTrend.trend === 'increasing' ? 'Ökande' : 
           volumeTrend.trend === 'decreasing' ? 'Minskande' : 'Stabil',
    timestamp: new Date().toISOString(),
    source: 'Volume Analysis',
  });
  
  // 3. OBV Analysis
  const { obv, obvTrend } = calculateOBV(priceHistory);
  totalSignals++;
  if (obvTrend === 'UP') {
    bullishSignals++;
    evidence.push({
      type: 'obv',
      description: 'On-Balance Volume stigande',
      value: 'Netto köptryck',
      timestamp: new Date().toISOString(),
      source: 'OBV Analysis',
    });
  } else if (obvTrend === 'DOWN') {
    bearishSignals++;
    evidence.push({
      type: 'obv',
      description: 'On-Balance Volume fallande',
      value: 'Netto säljtryck',
      timestamp: new Date().toISOString(),
      source: 'OBV Analysis',
    });
  }
  
  // 4. Accumulation/Distribution
  const { adLine, trend: adTrend } = calculateAccumulationDistribution(priceHistory);
  totalSignals++;
  if (adTrend === 'UP') {
    bullishSignals++;
    evidence.push({
      type: 'accumulation',
      description: 'Ackumulering pågår',
      value: 'Institutionellt köptryck indikeras',
      timestamp: new Date().toISOString(),
      source: 'A/D Line',
    });
  } else if (adTrend === 'DOWN') {
    bearishSignals++;
    evidence.push({
      type: 'distribution',
      description: 'Distribution pågår',
      value: 'Institutionell försäljning indikeras',
      timestamp: new Date().toISOString(),
      source: 'A/D Line',
    });
  }
  
  // 5. Price-Volume Relationship
  const pvRelationship = analyzePriceVolumeRelationship(priceHistory);
  totalSignals++;
  if (pvRelationship.relationship === 'confirmation') {
    // Confirmation strengthens current direction
    const priceChange = (priceHistory[priceHistory.length - 1].price - priceHistory[0].price);
    if (priceChange > 0) bullishSignals++;
    else bearishSignals++;
  }
  evidence.push({
    type: 'price_volume',
    description: 'Pris-Volym Relation',
    value: pvRelationship.description,
    timestamp: new Date().toISOString(),
    source: 'Price-Volume Analysis',
  });
  
  // Calculate direction and strength
  const netSignal = bullishSignals - bearishSignals;
  const direction: Direction = netSignal > 0 ? 'UP' : netSignal < 0 ? 'DOWN' : 'NEUTRAL';
  
  const strength = totalSignals > 0 
    ? Math.round(50 + (netSignal / totalSignals) * 40)
    : 50;
  
  // Coverage based on volume data availability
  const dataPointsWithVolume = priceHistory.filter(p => p.volume && p.volume > 0).length;
  const coverage = Math.min(100, Math.round((dataPointsWithVolume / priceHistory.length) * 100));
  
  // Confidence based on data quality and signal agreement
  const signalAgreement = totalSignals > 0 ? Math.abs(netSignal) / totalSignals : 0;
  const confidence = Math.round(30 + (coverage / 100) * 30 + signalAgreement * 40);
  
  return {
    module: 'orderFlow',
    direction,
    strength: Math.max(0, Math.min(100, strength)),
    confidence: Math.max(0, Math.min(100, confidence)),
    coverage,
    evidence,
    metadata: {
      vwap,
      volumeTrend: volumeTrend.trend,
      volumeRatio: volumeTrend.ratio,
      obvTrend,
      adTrend,
      pvRelationship: pvRelationship.relationship,
    },
  };
};
