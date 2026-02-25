// Machine Learning Analysis Module (AI-powered)

import { AnalysisResult, PriceData, MLPrediction } from './types';
import { Direction, Horizon, Evidence } from '@/types/market';
import { supabase } from '@/integrations/supabase/client';
import { getCacheKey, getFromCache, setInCache } from './cache';

export interface MLAnalysisResult {
  direction: Direction;
  strength: number;
  confidence: number;
  predictedReturn?: number;
  modelFeatures?: string[];
  evidence: Evidence[];
}

// Cache TTL: 5 minutes for ML predictions
const ML_CACHE_TTL = 5 * 60 * 1000;

// Call AI for ML prediction
export const fetchAIMLPrediction = async (
  ticker: string,
  name: string,
  assetType: 'stock' | 'crypto' | 'metal' | 'fund',
  horizon: Horizon,
  priceHistory: PriceData[],
  currentPrice: number
): Promise<MLAnalysisResult | null> => {
  try {
    // Check cache first
    const cacheKey = getCacheKey('ml', ticker, horizon);
    const cached = getFromCache<MLAnalysisResult>(cacheKey, ML_CACHE_TTL);
    if (cached) {
      return cached;
    }

    // Check if user is authenticated
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      console.log('AI ML: No session, using fallback');
      return null;
    }

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
      console.log(`AI ML received for ${ticker}:`, data.result.direction, data.result.confidence);
      // Cache the result
      setInCache(cacheKey, data.result);
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
  assetType: 'stock' | 'crypto' | 'metal' | 'fund'
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
    description: 'AI-ML ej tillgängligt — använder statistisk modell',
    value: 'Momentum + trend + volatilitet (ej maskininlärning)',
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
  
  // Lowered threshold from 50 to 15 for broader applicability
  if (prices.length < 15) {
    return {
      module: 'ml',
      direction: 'NEUTRAL',
      strength: 50,
      confidence: 25,
      coverage: Math.round((prices.length / 30) * 100),
      evidence: [{
        type: 'limitation',
        description: 'Begränsad data för ML-analys',
        value: `Har ${prices.length} datapunkter, optimalt 50+`,
        timestamp: new Date().toISOString(),
        source: 'ML Module',
      }],
      metadata: { reason: 'Limited data' },
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
  
  // Enhanced coverage calculation - more generous for shorter histories
  const coverage = prices.length >= 100 ? 85 :
                   prices.length >= 50 ? 70 :
                   prices.length >= 30 ? 55 :
                   Math.round((prices.length / 30) * 55);
  
  // Enhanced confidence based on data quality and feature clarity
  const dataQualityBonus = Math.min(20, prices.length / 5);
  const featureClarity = Math.abs(score) > 1 ? 10 : Math.abs(score) > 0 ? 5 : 0;
  const confidence = Math.round(35 + dataQualityBonus + featureClarity);
  
  evidence.push({
    type: 'info',
    description: 'Statistisk heuristik (momentum + trend), ej ML',
    value: `Analyserat ${prices.length} datapunkter`,
    timestamp: new Date().toISOString(),
    source: 'Statistisk Modell',
  });
  
  return {
    module: 'ml',
    direction,
    strength,
    confidence: Math.max(35, Math.min(70, confidence)),
    coverage,
    evidence,
    metadata: {
      avgReturn,
      stdDev,
      recentMomentum,
      trendStrength,
      featureClarity,
      source: 'statistical',
    },
  };
};
