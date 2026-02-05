// Machine Learning Analysis Module (AI-powered)

import { AnalysisResult, PriceData, MLPrediction } from './types';
import { Direction, Horizon, Evidence } from '@/types/market';
import { supabase } from '@/integrations/supabase/client';

export interface MLAnalysisResult {
  direction: Direction;
  strength: number;
  confidence: number;
  predictedReturn?: number;
  modelFeatures?: string[];
  evidence: Evidence[];
}

// Call AI for ML prediction
export const fetchAIMLPrediction = async (
  ticker: string,
  name: string,
  assetType: 'stock' | 'crypto' | 'metal',
  horizon: Horizon,
  priceHistory: PriceData[],
  currentPrice: number
): Promise<MLAnalysisResult | null> => {
  try {
    const { data, error } = await supabase.functions.invoke('ai-analysis', {
      body: {
        type: 'ml_prediction',
        ticker,
        name,
        assetType,
        horizon,
        priceHistory: priceHistory.slice(-50).map(p => ({
          price: p.close ?? p.price,
          timestamp: p.timestamp,
        })),
        currentPrice,
      },
    });

    if (error) {
      console.error('AI ML prediction error:', error);
      return null;
    }

    if (data?.success && data?.result) {
      return data.result;
    }

    return null;
  } catch (err) {
    console.error('Failed to fetch AI ML prediction:', err);
    return null;
  }
};

// Main ML analysis function
export const analyzeML = async (
  priceHistory: PriceData[],
  currentPrice: number,
  horizon: Horizon,
  ticker: string,
  name: string,
  assetType: 'stock' | 'crypto' | 'metal'
): Promise<AnalysisResult> => {
  const evidence: Evidence[] = [];
  
  // ML analysis is more relevant for longer horizons
  const horizonWeight = horizon === '1y' ? 1.0 :
                        horizon === '1mo' ? 0.8 :
                        horizon === '1w' ? 0.5 : 0.3;
  
  // Try to get AI ML prediction
  const aiPrediction = await fetchAIMLPrediction(
    ticker, name, assetType, horizon, priceHistory, currentPrice
  );
  
  if (aiPrediction) {
    evidence.push(...aiPrediction.evidence.map(e => ({
      ...e,
      timestamp: new Date().toISOString(),
    })));
    
    if (aiPrediction.predictedReturn !== undefined) {
      evidence.push({
        type: 'prediction',
        description: 'ML-baserad avkastningsprognos',
        value: `${aiPrediction.predictedReturn >= 0 ? '+' : ''}${aiPrediction.predictedReturn.toFixed(1)}%`,
        timestamp: new Date().toISOString(),
        source: 'ML Model',
      });
    }
    
    if (aiPrediction.modelFeatures && aiPrediction.modelFeatures.length > 0) {
      evidence.push({
        type: 'features',
        description: 'Viktiga ML-features',
        value: aiPrediction.modelFeatures.join(', '),
        timestamp: new Date().toISOString(),
        source: 'Feature Analysis',
      });
    }
    
    // Adjust confidence by horizon relevance
    const adjustedConfidence = Math.round(aiPrediction.confidence * horizonWeight);
    
    return {
      module: 'ml',
      direction: aiPrediction.direction,
      strength: aiPrediction.strength,
      confidence: Math.max(20, adjustedConfidence),
      coverage: 60,
      evidence,
      metadata: {
        predictedReturn: aiPrediction.predictedReturn,
        modelFeatures: aiPrediction.modelFeatures,
        source: 'AI',
      },
    };
  }
  
  // Fallback to basic statistical prediction
  evidence.push({
    type: 'fallback',
    description: 'AI-ML ej tillgängligt',
    value: 'Använder statistisk estimering',
    timestamp: new Date().toISOString(),
    source: 'System',
  });
  
  return analyzeMLSync(priceHistory, currentPrice, horizon);
};

// Synchronous version using statistical methods
export const analyzeMLSync = (
  priceHistory: PriceData[],
  currentPrice: number,
  horizon: Horizon
): AnalysisResult => {
  const evidence: Evidence[] = [];
  const prices = priceHistory.map(p => p.close ?? p.price);
  
  if (prices.length < 10) {
    return {
      module: 'ml',
      direction: 'NEUTRAL',
      strength: 50,
      confidence: 20,
      coverage: Math.round((prices.length / 50) * 100),
      evidence: [{
        type: 'limitation',
        description: 'Otillräcklig data för ML-analys',
        value: `Har ${prices.length} datapunkter, behöver minst 50`,
        timestamp: new Date().toISOString(),
        source: 'ML Module',
      }],
      metadata: { reason: 'Insufficient data' },
    };
  }
  
  // Simple statistical features
  const returns = prices.slice(1).map((p, i) => (p - prices[i]) / prices[i]);
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  
  // Momentum feature
  const recentReturns = returns.slice(-10);
  const recentMomentum = recentReturns.reduce((a, b) => a + b, 0) / recentReturns.length;
  
  // Trend feature
  const firstHalf = prices.slice(0, Math.floor(prices.length / 2));
  const secondHalf = prices.slice(Math.floor(prices.length / 2));
  const trendStrength = (secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length) /
                        (firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length) - 1;
  
  // Calculate direction based on features
  let score = 0;
  
  if (recentMomentum > 0.005) {
    score += 1;
    evidence.push({
      type: 'feature',
      description: 'Positivt kortvarigt momentum',
      value: `${(recentMomentum * 100).toFixed(2)}%`,
      timestamp: new Date().toISOString(),
      source: 'Statistical Model',
    });
  } else if (recentMomentum < -0.005) {
    score -= 1;
    evidence.push({
      type: 'feature',
      description: 'Negativt kortvarigt momentum',
      value: `${(recentMomentum * 100).toFixed(2)}%`,
      timestamp: new Date().toISOString(),
      source: 'Statistical Model',
    });
  }
  
  if (trendStrength > 0.02) {
    score += 1;
    evidence.push({
      type: 'feature',
      description: 'Positiv trendstyrka',
      value: `${(trendStrength * 100).toFixed(1)}%`,
      timestamp: new Date().toISOString(),
      source: 'Statistical Model',
    });
  } else if (trendStrength < -0.02) {
    score -= 1;
    evidence.push({
      type: 'feature',
      description: 'Negativ trendstyrka',
      value: `${(trendStrength * 100).toFixed(1)}%`,
      timestamp: new Date().toISOString(),
      source: 'Statistical Model',
    });
  }
  
  // Volatility penalty
  if (stdDev > 0.03) {
    evidence.push({
      type: 'risk',
      description: 'Hög volatilitet påverkar prognoskonfidensen',
      value: `Std Dev: ${(stdDev * 100).toFixed(1)}%`,
      timestamp: new Date().toISOString(),
      source: 'Statistical Model',
    });
  }
  
  const direction: Direction = score > 0 ? 'UP' : score < 0 ? 'DOWN' : 'NEUTRAL';
  const strength = Math.min(100, Math.max(0, 50 + score * 15));
  const coverage = Math.min(100, Math.round((prices.length / 100) * 100));
  const confidence = Math.round(30 + (coverage / 100) * 20);
  
  evidence.push({
    type: 'info',
    description: 'Statistisk modell baserad på prisdata',
    value: `Analyserat ${prices.length} datapunkter`,
    timestamp: new Date().toISOString(),
    source: 'Databas',
  });
  
  return {
    module: 'ml',
    direction,
    strength,
    confidence: Math.max(20, Math.min(60, confidence)),
    coverage,
    evidence,
    metadata: {
      avgReturn,
      stdDev,
      recentMomentum,
      trendStrength,
      source: 'statistical',
    },
  };
};
