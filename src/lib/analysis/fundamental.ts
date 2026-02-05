// Fundamental Analysis Module
// Stub implementation - requires external financial data API

import { AnalysisResult, PriceData, FundamentalMetrics } from './types';
import { Direction, Horizon, Evidence } from '@/types/market';

// Simulated fundamental data based on asset type and price trends
const estimateFundamentals = (
  priceHistory: PriceData[],
  assetType: 'stock' | 'crypto' | 'metal',
  ticker: string
): FundamentalMetrics => {
  // For crypto and metals, fundamental metrics are different
  if (assetType === 'crypto') {
    return {
      // Crypto doesn't have traditional P/E, use network value metrics
      marketCap: undefined,
    };
  }
  
  if (assetType === 'metal') {
    return {
      // Metals use supply/demand dynamics
      marketCap: undefined,
    };
  }
  
  // For stocks, estimate based on Swedish market averages
  const swedenMarketAveragePE = 18;
  const currentPrice = priceHistory[priceHistory.length - 1]?.price ?? 100;
  
  // Sector-based estimates
  const sectorPE: Record<string, number> = {
    'VOLVO-B': 12,
    'ERIC-B': 15,
    'SEB-A': 10,
    'ASSA-B': 22,
    'HEXA-B': 25,
    'ATCO-A': 18,
    'SAND': 14,
    'ABB': 20,
    'SWED-A': 9,
    'HM-B': 16,
    'INVE-B': 14,
    'ALFA': 18,
    'ESSITY-B': 16,
    'TEL2-B': 12,
    'SCA-B': 15,
  };
  
  return {
    peRatio: sectorPE[ticker] ?? swedenMarketAveragePE,
    pbRatio: 1.5 + Math.random() * 2, // Typical range
    debtToEquity: 0.3 + Math.random() * 1.2,
    roe: 8 + Math.random() * 20,
    revenueGrowth: -5 + Math.random() * 20,
    earningsGrowth: -10 + Math.random() * 30,
    dividendYield: 1 + Math.random() * 5,
  };
};

// Analyze fundamental metrics
const analyzeFundamentalMetrics = (metrics: FundamentalMetrics): {
  score: number;
  signals: string[];
} => {
  let score = 0;
  const signals: string[] = [];
  
  // P/E Analysis
  if (metrics.peRatio !== undefined) {
    if (metrics.peRatio < 12) {
      score += 2;
      signals.push(`Lågt P/E (${metrics.peRatio.toFixed(1)}) - potentiellt undervärderad`);
    } else if (metrics.peRatio > 30) {
      score -= 2;
      signals.push(`Högt P/E (${metrics.peRatio.toFixed(1)}) - potentiellt övervärderad`);
    }
  }
  
  // ROE Analysis
  if (metrics.roe !== undefined) {
    if (metrics.roe > 15) {
      score += 1;
      signals.push(`Stark ROE (${metrics.roe.toFixed(1)}%)`);
    } else if (metrics.roe < 5) {
      score -= 1;
      signals.push(`Svag ROE (${metrics.roe.toFixed(1)}%)`);
    }
  }
  
  // Debt Analysis
  if (metrics.debtToEquity !== undefined) {
    if (metrics.debtToEquity < 0.5) {
      score += 1;
      signals.push(`Låg skuldsättning (D/E: ${metrics.debtToEquity.toFixed(2)})`);
    } else if (metrics.debtToEquity > 2) {
      score -= 1;
      signals.push(`Hög skuldsättning (D/E: ${metrics.debtToEquity.toFixed(2)})`);
    }
  }
  
  // Growth Analysis
  if (metrics.earningsGrowth !== undefined) {
    if (metrics.earningsGrowth > 15) {
      score += 2;
      signals.push(`Stark vinsttillväxt (${metrics.earningsGrowth.toFixed(1)}%)`);
    } else if (metrics.earningsGrowth < 0) {
      score -= 1;
      signals.push(`Negativ vinsttillväxt (${metrics.earningsGrowth.toFixed(1)}%)`);
    }
  }
  
  // Dividend Analysis
  if (metrics.dividendYield !== undefined) {
    if (metrics.dividendYield > 4) {
      score += 1;
      signals.push(`Hög direktavkastning (${metrics.dividendYield.toFixed(1)}%)`);
    }
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
      value: 'Använder on-chain metrics och network value istället',
      timestamp: new Date().toISOString(),
      source: 'Asset Type',
    });
    
    return {
      module: 'fundamental',
      direction: 'NEUTRAL',
      strength: 50,
      confidence: 30,
      coverage: 20, // Limited data
      evidence,
      metadata: { assetType, reason: 'Crypto lacks traditional fundamentals' },
    };
  }
  
  if (assetType === 'metal') {
    evidence.push({
      type: 'limitation',
      description: 'Råvaror värderas efter utbud/efterfrågan',
      value: 'Fundamentala nyckeltal ej tillämpbara',
      timestamp: new Date().toISOString(),
      source: 'Asset Type',
    });
    
    return {
      module: 'fundamental',
      direction: 'NEUTRAL',
      strength: 50,
      confidence: 30,
      coverage: 20,
      evidence,
      metadata: { assetType, reason: 'Commodities use supply/demand dynamics' },
    };
  }
  
  // Estimate fundamentals for stocks
  const metrics = estimateFundamentals(priceHistory, assetType, ticker);
  const { score, signals } = analyzeFundamentalMetrics(metrics);
  
  // Add evidence from analysis
  signals.forEach((signal, index) => {
    evidence.push({
      type: 'metric',
      description: signal,
      value: score > 0 ? 'Positiv' : score < 0 ? 'Negativ' : 'Neutral',
      timestamp: new Date().toISOString(),
      source: 'Fundamental Analysis',
    });
  });
  
  // Add key metrics as evidence
  if (metrics.peRatio) {
    evidence.push({
      type: 'valuation',
      description: 'P/E-tal',
      value: metrics.peRatio.toFixed(1),
      timestamp: new Date().toISOString(),
      source: 'Valuation Metrics',
    });
  }
  
  if (metrics.dividendYield) {
    evidence.push({
      type: 'dividend',
      description: 'Direktavkastning',
      value: `${metrics.dividendYield.toFixed(1)}%`,
      timestamp: new Date().toISOString(),
      source: 'Dividend Metrics',
    });
  }
  
  // Disclaimer
  evidence.push({
    type: 'disclaimer',
    description: '⚠️ Estimerade värden',
    value: 'Kräver integration med finansdatakälla för exakta siffror',
    timestamp: new Date().toISOString(),
    source: 'System',
  });
  
  // Determine direction based on score
  const direction: Direction = score > 1 ? 'UP' : score < -1 ? 'DOWN' : 'NEUTRAL';
  
  // Strength adjusted by horizon relevance
  const baseStrength = Math.min(100, Math.max(0, 50 + score * 10));
  const strength = Math.round(baseStrength * horizonWeight + 50 * (1 - horizonWeight));
  
  // Coverage is limited since we're using estimates
  const coverage = 40; // Partial data
  
  // Confidence affected by data quality
  const confidence = Math.round(35 + horizonWeight * 25);
  
  return {
    module: 'fundamental',
    direction,
    strength: Math.max(0, Math.min(100, strength)),
    confidence: Math.max(0, Math.min(100, confidence)),
    coverage,
    evidence,
    metadata: { metrics, score, horizonWeight },
  };
};
