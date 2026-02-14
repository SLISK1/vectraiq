// Sentiment Analysis Module (AI-powered)

import { AnalysisResult, SentimentData } from './types';
import { Direction, Horizon, Evidence } from '@/types/market';
import { supabase } from '@/integrations/supabase/client';
import { getCacheKey, getFromCache, setInCache } from './cache';

export interface SentimentAnalysisResult {
  direction: Direction;
  strength: number;
  confidence: number;
  newsScore?: number;
  socialScore?: number;
  analystRating?: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
  evidence: Evidence[];
}

// Cache TTL: 5 minutes for sentiment
const SENTIMENT_CACHE_TTL = 5 * 60 * 1000;

// Call AI for sentiment analysis
export const fetchAISentiment = async (
  ticker: string,
  name: string,
  assetType: 'stock' | 'crypto' | 'metal',
  horizon: Horizon,
  currentPrice?: number
): Promise<SentimentAnalysisResult | null> => {
  try {
    // Check cache first
    const cacheKey = getCacheKey('sentiment', ticker, horizon);
    const cached = getFromCache<SentimentAnalysisResult>(cacheKey, SENTIMENT_CACHE_TTL);
    if (cached) {
      return cached;
    }

    // Check if user is authenticated
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      console.log('AI sentiment: No session, using fallback');
      return null;
    }

    const { data, error } = await supabase.functions.invoke('ai-analysis', {
      body: {
        type: 'sentiment',
        ticker,
        name,
        assetType,
        horizon,
        currentPrice,
      },
    });

    if (error) {
      console.error('AI sentiment error:', error);
      return null;
    }

    if (data?.success && data?.result) {
      console.log(`AI sentiment received for ${ticker}:`, data.result.direction, data.result.confidence);
      // Cache the result
      setInCache(cacheKey, data.result);
      return data.result;
    }

    return null;
  } catch (err) {
    console.error('Failed to fetch AI sentiment:', err);
    return null;
  }
};

// Main sentiment analysis function
export const analyzeSentiment = async (
  ticker: string,
  name: string,
  assetType: 'stock' | 'crypto' | 'metal',
  horizon: Horizon,
  currentPrice?: number
): Promise<AnalysisResult> => {
  const evidence: Evidence[] = [];
  
  // Try to get AI sentiment
  const aiSentiment = await fetchAISentiment(ticker, name, assetType, horizon, currentPrice);
  
  if (aiSentiment) {
    // Use AI-generated sentiment
    evidence.push(...aiSentiment.evidence.map(e => ({
      ...e,
      timestamp: new Date().toISOString(),
    })));
    
    if (aiSentiment.analystRating) {
      const ratingLabels: Record<string, string> = {
        strong_buy: 'Stark Köp',
        buy: 'Köp',
        hold: 'Behåll',
        sell: 'Sälj',
        strong_sell: 'Stark Sälj',
      };
      evidence.push({
        type: 'analyst',
        description: 'Analytikerbetyg',
        value: ratingLabels[aiSentiment.analystRating],
        timestamp: new Date().toISOString(),
        source: 'AI Sentiment Analysis',
      });
    }
    
    return {
      module: 'sentiment',
      direction: aiSentiment.direction,
      strength: aiSentiment.strength,
      confidence: aiSentiment.confidence,
      coverage: 70, // AI provides reasonable coverage
      evidence,
      metadata: {
        newsScore: aiSentiment.newsScore,
        socialScore: aiSentiment.socialScore,
        analystRating: aiSentiment.analystRating,
        source: 'AI',
      },
    };
  }
  
  // Fallback to basic sentiment estimation
  evidence.push({
    type: 'fallback',
    description: 'AI-sentiment ej tillgängligt',
    value: 'Använder basestimering',
    timestamp: new Date().toISOString(),
    source: 'System',
  });
  
  // Basic market-sentiment based on asset type
  let baseDirection: Direction = 'NEUTRAL';
  let baseStrength = 50;
  
  if (assetType === 'crypto') {
    // Crypto - neutral base when no data available
    baseStrength = 50;
    baseDirection = 'NEUTRAL';
  } else if (assetType === 'metal') {
    // Metals (especially gold) often seen as safe haven
    baseStrength = 55;
    baseDirection = 'UP';
  } else {
    // Stocks - neutral base
    baseStrength = 50;
  }
  
  return {
    module: 'sentiment',
    direction: baseDirection,
    strength: Math.round(baseStrength),
    confidence: 35, // Low confidence for fallback
    coverage: 20, // Limited data
    evidence,
    metadata: { source: 'fallback' },
  };
};

// Synchronous version - uses momentum proxy when price data is available
export const analyzeSentimentSync = (
  ticker: string,
  name: string,
  assetType: 'stock' | 'crypto' | 'metal',
  horizon: Horizon,
  priceHistory?: { price: number; close?: number; timestamp: string }[]
): AnalysisResult => {
  const evidence: Evidence[] = [];
  
  let direction: Direction = 'NEUTRAL';
  let strength = 50;
  let confidence = 40; // Base confidence higher than before
  let coverage = 35; // Base coverage
  
  // If we have price history, calculate momentum-based sentiment proxy
  if (priceHistory && priceHistory.length >= 5) {
    const prices = priceHistory.map(p => p.close ?? p.price);
    const recentPrices = prices.slice(-10);
    
    // Calculate short-term momentum (5-day)
    const shortTermReturns: number[] = [];
    for (let i = 1; i < Math.min(6, recentPrices.length); i++) {
      shortTermReturns.push((recentPrices[recentPrices.length - i] - recentPrices[recentPrices.length - i - 1]) / recentPrices[recentPrices.length - i - 1]);
    }
    const avgShortReturn = shortTermReturns.length > 0
      ? shortTermReturns.reduce((a, b) => a + b, 0) / shortTermReturns.length
      : 0;
    
    // Calculate medium-term momentum if we have enough data
    let avgMediumReturn = 0;
    if (prices.length >= 20) {
      const mediumReturns: number[] = [];
      for (let i = 1; i < Math.min(20, prices.length); i++) {
        mediumReturns.push((prices[prices.length - i] - prices[prices.length - i - 1]) / prices[prices.length - i - 1]);
      }
      avgMediumReturn = mediumReturns.reduce((a, b) => a + b, 0) / mediumReturns.length;
    }
    
    // Combine short and medium term momentum
    const combinedMomentum = avgShortReturn * 0.6 + avgMediumReturn * 0.4;
    
    // Determine direction and strength based on momentum
    if (combinedMomentum > 0.008) {
      direction = 'UP';
      strength = Math.min(80, 55 + combinedMomentum * 400);
      confidence = 50;
    } else if (combinedMomentum < -0.008) {
      direction = 'DOWN';
      strength = Math.min(80, 55 + Math.abs(combinedMomentum) * 400);
      confidence = 50;
    } else {
      // Weak or no momentum
      direction = 'NEUTRAL';
      strength = 50;
      confidence = 45;
    }
    
    // Check for momentum consistency (all same direction = higher confidence)
    const positiveReturns = shortTermReturns.filter(r => r > 0).length;
    const consistencyRatio = shortTermReturns.length > 0
      ? Math.max(positiveReturns, shortTermReturns.length - positiveReturns) / shortTermReturns.length
      : 0.5;
    
    if (consistencyRatio > 0.8) {
      confidence += 8;
      evidence.push({
        type: 'consistency',
        description: 'Konsistent prisrörelse',
        value: `${Math.round(consistencyRatio * 100)}% dagar i samma riktning`,
        timestamp: new Date().toISOString(),
        source: 'Momentum Proxy',
      });
    }
    
    evidence.push({
      type: 'momentum_proxy',
      description: 'Sentiment baserat på prismomentum',
      value: `${combinedMomentum >= 0 ? '+' : ''}${(combinedMomentum * 100).toFixed(2)}%`,
      timestamp: new Date().toISOString(),
      source: 'Price Momentum Proxy',
    });
    
    coverage = Math.min(60, 35 + Math.floor(priceHistory.length / 5));
  } else {
    evidence.push({
      type: 'limitation',
      description: 'Begränsad prisdata för sentimentproxy',
      value: 'Använder basestimering',
      timestamp: new Date().toISOString(),
      source: 'System',
    });
  }
  
  // Asset type adjustments
  if (assetType === 'crypto') {
    confidence -= 5; // Crypto sentiment is less predictable
    evidence.push({
      type: 'asset_adjustment',
      description: 'Krypto har högre sentimentvolatilitet',
      value: '-5% konfidensjustering',
      timestamp: new Date().toISOString(),
      source: 'Asset Analysis',
    });
  } else if (assetType === 'metal') {
    confidence += 5; // Metals tend to have more stable sentiment patterns
    evidence.push({
      type: 'asset_adjustment',
      description: 'Ädelmetaller har stabilare sentiment',
      value: '+5% konfidensjustering',
      timestamp: new Date().toISOString(),
      source: 'Asset Analysis',
    });
  }
  
  // Horizon adjustment - sentiment is more reliable for shorter horizons
  const horizonMultiplier = horizon === '1d' ? 1.1 : horizon === '1w' ? 1.0 : horizon === '1mo' ? 0.9 : 0.85;
  confidence = Math.round(confidence * horizonMultiplier);
  
  return {
    module: 'sentiment',
    direction,
    strength: Math.round(strength),
    confidence: Math.max(35, Math.min(65, confidence)),
    coverage,
    evidence,
    metadata: { 
      source: 'momentum_proxy',
      method: priceHistory && priceHistory.length >= 5 ? 'price_momentum' : 'base_estimate',
    },
  };
};
