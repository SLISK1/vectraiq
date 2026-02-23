// Analysis module types and interfaces

import { Direction, Horizon, ModuleSignal, Evidence } from '@/types/market';

export interface PriceData {
  price: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  timestamp: string;
}

export interface HistoricalData {
  prices: PriceData[];
  ticker: string;
  currency: string;
}

export interface ModuleConfig {
  enabled: boolean;
  weight: number;
  minDataPoints: number;
}

export interface AnalysisResult {
  module: string;
  direction: Direction;
  strength: number; // 0-100
  confidence: number; // 0-100
  coverage: number; // 0-100 (data availability)
  evidence: Evidence[];
  metadata?: Record<string, unknown>;
}

export interface TechnicalIndicators {
  rsi?: number;
  macd?: { value: number; signal: number; histogram: number };
  sma20?: number;
  sma50?: number;
  sma200?: number;
  ema12?: number;
  ema26?: number;
  bollingerBands?: { upper: number; middle: number; lower: number; percentB: number };
  atr?: number;
  stochastic?: { k: number; d: number };
  // Alpha Vantage enriched indicators
  avRsi?: number;
  avMacd?: { value: number; signal: number; histogram: number };
  adx?: number;
  vwap?: number;
}

export interface FundamentalMetrics {
  peRatio?: number | null;
  pbRatio?: number | null;
  debtToEquity?: number | null;
  roe?: number | null;
  revenueGrowth?: number | null;
  earningsGrowth?: number | null;
  dividendYield?: number | null;
  marketCap?: number | null;
  week52High?: number | null;
  week52Low?: number | null;
  lastUpdated?: string;
}

export interface SentimentData {
  overallScore: number; // -100 to 100
  newsScore?: number;
  socialScore?: number;
  analystRating?: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
  fearGreedIndex?: number;
}

export interface MacroData {
  interestRate?: number;
  inflation?: number;
  gdpGrowth?: number;
  unemploymentRate?: number;
  currencyStrength?: number;
  commodityTrend?: Direction;
}

export interface VolatilityMetrics {
  historicalVolatility?: number;
  impliedVolatility?: number;
  vix?: number;
  beta?: number;
  averageTrueRange?: number;
  volatilityRegime?: 'low' | 'normal' | 'high' | 'extreme';
}

export interface SeasonalPattern {
  monthlyReturns: Record<number, number>; // month (1-12) -> avg return
  quarterlyReturns: Record<number, number>; // quarter (1-4) -> avg return
  dayOfWeekReturns: Record<number, number>; // day (0-6) -> avg return
  currentSeasonalBias: Direction;
  historicalAccuracy: number;
}

export interface OrderFlowData {
  buyVolume?: number;
  sellVolume?: number;
  volumeImbalance?: number;
  largeBlockTrades?: number;
  institutionalFlow?: Direction;
}

export interface MLPrediction {
  predictedDirection: Direction;
  confidence: number;
  modelVersion: string;
  features: string[];
  prediction30d?: number;
  prediction90d?: number;
}

export interface AnalysisContext {
  ticker: string;
  name: string;
  assetType: 'stock' | 'crypto' | 'metal' | 'fund';
  currency: string;
  horizon: Horizon;
  currentPrice: number;
  priceHistory: PriceData[];
  fundamentals?: FundamentalMetrics;
  macro?: MacroData;
  avCache?: { indicator_type: string; data: any }[];
}

// Metadata structure stored in symbols.metadata
export interface SymbolMetadata {
  fundamentals?: FundamentalMetrics;
  [key: string]: unknown;
}
