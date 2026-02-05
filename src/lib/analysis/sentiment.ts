// Sentiment Analysis Module (AI-powered)

import { AnalysisResult, SentimentData } from './types';
import { Direction, Horizon, Evidence } from '@/types/market';
import { supabase } from '@/integrations/supabase/client';

export interface SentimentAnalysisResult {
  direction: Direction;
  strength: number;
  confidence: number;
  newsScore?: number;
  socialScore?: number;
  analystRating?: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
  evidence: Evidence[];
}

// Call AI for sentiment analysis
export const fetchAISentiment = async (
  ticker: string,
  name: string,
  assetType: 'stock' | 'crypto' | 'metal',
  horizon: Horizon,
  currentPrice?: number
): Promise<SentimentAnalysisResult | null> => {
  try {
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
    // Crypto sentiment tends to be more volatile
    baseStrength = 45 + Math.random() * 30;
    baseDirection = baseStrength > 60 ? 'UP' : baseStrength < 40 ? 'DOWN' : 'NEUTRAL';
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

// Synchronous version for compatibility (uses cached/estimated values)
export const analyzeSentimentSync = (
  ticker: string,
  name: string,
  assetType: 'stock' | 'crypto' | 'metal',
  horizon: Horizon
): AnalysisResult => {
  const evidence: Evidence[] = [];
  
  // Use basic estimation without AI
  evidence.push({
    type: 'estimation',
    description: 'Bassentiment-estimering',
    value: 'Utan AI-analys',
    timestamp: new Date().toISOString(),
    source: 'System',
  });
  
  let direction: Direction = 'NEUTRAL';
  let strength = 50;
  
  // Asset-type specific sentiment biases
  if (assetType === 'crypto') {
    strength = 55; // Slightly bullish crypto sentiment
    direction = 'UP';
    evidence.push({
      type: 'market_sentiment',
      description: 'Kryptomarknaden generellt positiv',
      value: 'Baserat på marknadstrend',
      timestamp: new Date().toISOString(),
      source: 'Market Conditions',
    });
  } else if (assetType === 'metal') {
    strength = 52;
    direction = 'NEUTRAL';
    evidence.push({
      type: 'market_sentiment',
      description: 'Ädelmetaller som safe-haven',
      value: 'Neutral till positiv',
      timestamp: new Date().toISOString(),
      source: 'Market Conditions',
    });
  } else {
    // Swedish stocks
    strength = 50;
    direction = 'NEUTRAL';
    evidence.push({
      type: 'market_sentiment',
      description: 'Stockholmsbörsen neutral',
      value: 'Avvaktande marknadsläge',
      timestamp: new Date().toISOString(),
      source: 'Market Conditions',
    });
  }
  
  return {
    module: 'sentiment',
    direction,
    strength,
    confidence: 30,
    coverage: 15,
    evidence,
    metadata: { source: 'sync_estimation' },
  };
};
