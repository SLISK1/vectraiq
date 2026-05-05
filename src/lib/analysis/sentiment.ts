// Sentiment Analysis Module
//
// Reads pre-fetched news sentiment from AnalysisContext.newsSentiment, which is
// populated by the compute-news-sentiment edge function from news_cache.
//
// IMPORTANT: The previous version (analyzeSentimentSync) used a price-momentum
// proxy as "sentiment". That was double-counting momentum already covered by the
// technical & quant modules, leading to false confluence signals. This version
// uses ONLY news-derived sentiment. When news data is missing, the module returns
// NEUTRAL with low coverage so it doesn't bias the aggregate.

import { AnalysisResult, AnalysisContext, NewsSentimentData } from './types';
import { Direction, Horizon, Evidence } from '@/types/market';
import { supabase } from '@/integrations/supabase/client';
import { getCacheKey, getFromCache, setInCache } from './cache';

const SENTIMENT_CACHE_TTL = 5 * 60 * 1000;

export interface SentimentAnalysisResult {
  direction: Direction;
  strength: number;
  confidence: number;
  newsScore?: number;
  socialScore?: number;
  analystRating?: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
  evidence: Evidence[];
}

// Convert news sentiment score (-1..+1) to module signal.
// Mapping is intentionally conservative: even strong news (|score| ~ 0.6) only
// produces strength ~75. News overreacts in the short term and mean-reverts.
function newsToSignal(news: NewsSentimentData, horizon: Horizon, ticker: string): AnalysisResult {
  const evidence: Evidence[] = [];
  const ageHours = (Date.now() - new Date(news.updatedAt).getTime()) / 3_600_000;

  // Direction
  let direction: Direction = 'NEUTRAL';
  if (news.score > 0.08) direction = 'UP';
  else if (news.score < -0.08) direction = 'DOWN';

  // Strength: |score| in [0,1] → strength in [50,90]
  const strength = Math.round(50 + Math.abs(news.score) * 40);

  // Confidence depends on article count (more sources = more reliable signal)
  // and recency (older sentiment is stale)
  const countFactor = Math.min(1, news.articleCount / 5);   // 5+ articles = full credit
  const recencyFactor = Math.max(0.3, Math.pow(0.9, ageHours / 12)); // halves every ~3 days
  const magnitudeFactor = 0.5 + 0.5 * news.magnitude;       // weak intensity dampens
  let confidence = Math.round(40 + 40 * countFactor * recencyFactor * magnitudeFactor);

  // Horizon adjustment: news matters most at 1d-1w. Less for 1y.
  const horizonMul: Record<Horizon, number> = {
    '1s': 0.6, '1m': 0.7, '1h': 0.9, '1d': 1.0, '1w': 0.95, '1mo': 0.8, '1y': 0.55,
  };
  confidence = Math.round(confidence * horizonMul[horizon]);

  // Coverage: high if we have ≥3 articles less than 48h old
  const coverage = Math.min(85, 30 + news.articleCount * 8 + (ageHours < 48 ? 15 : 0));

  evidence.push({
    type: 'news_sentiment',
    description: `Nyhetssentiment ${direction === 'UP' ? 'positivt' : direction === 'DOWN' ? 'negativt' : 'neutralt'}`,
    value: `${news.score >= 0 ? '+' : ''}${(news.score * 100).toFixed(0)}% (${news.articleCount} artiklar)`,
    timestamp: news.updatedAt,
    source: 'News Sentiment Cache',
  });

  if (news.positiveCount + news.negativeCount > 0) {
    evidence.push({
      type: 'article_split',
      description: 'Positiva vs negativa artiklar',
      value: `${news.positiveCount}↑ / ${news.negativeCount}↓`,
      timestamp: news.updatedAt,
      source: 'GNews + Lexicon',
    });
  }

  if (news.topThemes && news.topThemes.length > 0) {
    const topTheme = news.topThemes[0];
    evidence.push({
      type: 'theme',
      description: 'Mest frekvent ord',
      value: `"${topTheme.word}" (${topTheme.count}x, polaritet ${topTheme.polarity > 0 ? '+' : ''}${topTheme.polarity.toFixed(2)})`,
      timestamp: news.updatedAt,
      source: 'Theme Extraction',
    });
  }

  if (ageHours > 48) {
    evidence.push({
      type: 'stale',
      description: 'Sentimentdata är inte färsk',
      value: `${Math.round(ageHours)}h gammal`,
      timestamp: news.updatedAt,
      source: 'System',
    });
  }

  return {
    module: 'sentiment',
    direction,
    strength: Math.max(35, Math.min(90, strength)),
    confidence: Math.max(20, Math.min(80, confidence)),
    coverage: Math.max(0, Math.min(85, coverage)),
    evidence,
    metadata: {
      source: 'news_cache',
      ticker,
      score: news.score,
      magnitude: news.magnitude,
      articleCount: news.articleCount,
    },
  };
}

// No-data fallback: NEUTRAL with very low coverage so the module barely contributes.
function noDataResult(reason: string): AnalysisResult {
  return {
    module: 'sentiment',
    direction: 'NEUTRAL',
    strength: 50,
    confidence: 25,
    coverage: 10, // Low coverage → reliability shrinkage will down-weight further
    evidence: [{
      type: 'no_data',
      description: 'Ingen nyhetsdata tillgänglig',
      value: reason,
      timestamp: new Date().toISOString(),
      source: 'System',
    }],
    metadata: { source: 'no_data', reason },
  };
}

// Main entry — sync, reads from pre-fetched context.
// REPLACES the old analyzeSentimentSync which used momentum as a sentiment proxy.
export const analyzeSentimentFromContext = (context: AnalysisContext): AnalysisResult => {
  const news = context.newsSentiment;
  if (!news || news.articleCount === 0) {
    return noDataResult('news_sentiment_cache miss');
  }
  return newsToSignal(news, context.horizon, context.ticker);
};

// Backward-compatibility wrapper — returns NEUTRAL low-coverage when called
// without enriched context. Existing call sites (e.g. ScreenerDetailModal that
// pass only ticker/name without context) get a safe fallback rather than the
// old momentum-proxy bug.
export const analyzeSentimentSync = (
  ticker: string,
  _name: string,
  _assetType: 'stock' | 'crypto' | 'metal' | 'fund',
  _horizon: Horizon,
  _priceHistory?: { price: number; close?: number; timestamp: string }[]
): AnalysisResult => {
  // Without an AnalysisContext we can't access the pre-fetched newsSentiment.
  // Return no-data instead of the old momentum-proxy that double-counted technical.
  return noDataResult(`no enriched context for ${ticker}`);
};

// Async fetch — kept for future on-demand use (e.g. detail modal).
// Calls the existing ai-analysis edge function which uses Firecrawl.
export const fetchAISentiment = async (
  ticker: string,
  name: string,
  assetType: 'stock' | 'crypto' | 'metal' | 'fund',
  horizon: Horizon,
  currentPrice?: number
): Promise<SentimentAnalysisResult | null> => {
  try {
    const cacheKey = getCacheKey('sentiment', ticker, horizon);
    const cached = getFromCache<SentimentAnalysisResult>(cacheKey, SENTIMENT_CACHE_TTL);
    if (cached) return cached;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;

    const { data, error } = await supabase.functions.invoke('ai-analysis', {
      body: { type: 'sentiment', ticker, name, assetType, horizon, currentPrice },
    });

    if (error) {
      console.error('AI sentiment error:', error);
      return null;
    }
    if (data?.success && data?.result) {
      setInCache(cacheKey, data.result);
      return data.result;
    }
    return null;
  } catch (err) {
    console.error('Failed to fetch AI sentiment:', err);
    return null;
  }
};

// Async version that combines pre-fetched cache + on-demand AI top-up.
// Used by the detail modal where we can afford the latency.
export const analyzeSentiment = async (
  ticker: string,
  name: string,
  assetType: 'stock' | 'crypto' | 'metal' | 'fund',
  horizon: Horizon,
  currentPrice?: number
): Promise<AnalysisResult> => {
  const ai = await fetchAISentiment(ticker, name, assetType, horizon, currentPrice);
  if (ai) {
    return {
      module: 'sentiment',
      direction: ai.direction,
      strength: ai.strength,
      confidence: ai.confidence,
      coverage: 70,
      evidence: ai.evidence.map(e => ({ ...e, timestamp: new Date().toISOString() })),
      metadata: {
        source: 'AI',
        newsScore: ai.newsScore,
        socialScore: ai.socialScore,
        analystRating: ai.analystRating,
      },
    };
  }
  return noDataResult('AI sentiment unavailable');
};
