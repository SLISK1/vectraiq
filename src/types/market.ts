export type Horizon = '1s' | '1m' | '1h' | '1d' | '1w' | '1mo' | '1y';

export type Direction = 'UP' | 'DOWN' | 'NEUTRAL';

export type AssetType = 'stock' | 'crypto' | 'metal' | 'fund';

export interface ModuleSignal {
  module: string;
  direction: Direction;
  strength: number; // 0-100
  horizon: Horizon;
  confidence: number; // 0-100
  evidence: Evidence[];
  coverage: number; // 0-100 (how much data is missing)
  weight: number; // Current weight for this horizon
}

export interface Evidence {
  type: string;
  description: string;
  value: string | number;
  timestamp: string;
  source: string;
}

export interface ConfidenceBreakdown {
  freshness: number;
  coverage: number;
  agreement: number;
  reliability: number;
  regimeRisk: number;
}

export interface Asset {
  ticker: string;
  name: string;
  type: AssetType;
  sector?: string;
  exchange?: string;
  currency: string;
  lastPrice: number;
  change24h: number;
  changePercent24h: number;
  volume24h: number;
  marketCap?: number;
}

export interface PredictedReturns {
  day1: number;
  week1: number;
  year1: number;
  year5: number;
}

export interface TrendPrediction {
  trendDuration: {
    minDays: number;
    maxDays: number;
    likelyDays: number;
  };
  stopLoss: {
    price: number;
    percentage: number;
    method: 'atr' | 'support' | 'volatility';
  };
  takeProfit: {
    conservative: { price: number; percentage: number };
    moderate: { price: number; percentage: number };
    aggressive: { price: number; percentage: number };
  };
  riskRewardRatio: number;
  trendStrength: number; // 0-100
  reversalRisk: number; // 0-100
}

export type MarketCapCategory = 'small' | 'medium' | 'large' | 'all';

export interface RankedAsset extends Asset {
  totalScore: number;
  direction: Direction;
  confidence: number;
  confidenceBreakdown: ConfidenceBreakdown;
  signals: ModuleSignal[];
  topContributors: { module: string; contribution: number }[];
  horizon: Horizon;
  lastUpdated: string;
  predictedReturns?: PredictedReturns;
  trendPrediction?: TrendPrediction;
  aiSummary?: string;
  marketCapCategory?: MarketCapCategory;
}

export interface WatchlistCase {
  id: string;
  ticker: string;
  asset: Asset;
  savedAt: string;
  horizon: Horizon;
  predictionDirection: Direction;
  entryPrice: number;
  entryPriceSource: string;
  targetEndTime: string;
  confidenceAtSave: number;
  expectedMove?: number;
  modelSnapshotId: string;
  // Live tracking
  currentPrice?: number;
  currentReturn?: number;
  // Result (filled when horizon ends)
  exitPrice?: number;
  returnPct?: number;
  hit?: boolean;
  resultLockedAt?: string;
}

export interface HorizonWeights {
  technical: number;
  fundamental: number;
  sentiment: number;
  elliottWave: number;
  quant: number;
  macro: number;
  volatility: number;
  seasonal: number;
  orderFlow: number;
  ml: number;
}

export const DEFAULT_WEIGHTS: Record<Horizon, HorizonWeights> = {
  '1s': { technical: 30, fundamental: 0, sentiment: 10, elliottWave: 0, quant: 20, macro: 0, volatility: 20, seasonal: 0, orderFlow: 20, ml: 0 },
  '1m': { technical: 30, fundamental: 0, sentiment: 10, elliottWave: 0, quant: 20, macro: 0, volatility: 20, seasonal: 0, orderFlow: 20, ml: 0 },
  '1h': { technical: 28, fundamental: 2, sentiment: 15, elliottWave: 0, quant: 18, macro: 5, volatility: 18, seasonal: 2, orderFlow: 12, ml: 0 },
  '1d': { technical: 25, fundamental: 5, sentiment: 15, elliottWave: 0, quant: 15, macro: 10, volatility: 15, seasonal: 3, orderFlow: 10, ml: 2 },
  '1w': { technical: 20, fundamental: 15, sentiment: 15, elliottWave: 0, quant: 20, macro: 10, volatility: 10, seasonal: 5, orderFlow: 3, ml: 2 },
  '1mo': { technical: 15, fundamental: 25, sentiment: 10, elliottWave: 0, quant: 20, macro: 15, volatility: 10, seasonal: 5, orderFlow: 0, ml: 0 },
  '1y': { technical: 5, fundamental: 35, sentiment: 5, elliottWave: 0, quant: 20, macro: 20, volatility: 5, seasonal: 10, orderFlow: 0, ml: 0 },
};

export const HORIZON_LABELS: Record<Horizon, string> = {
  '1s': '1 sekund',
  '1m': '1 minut',
  '1h': '1 timme',
  '1d': '1 dag',
  '1w': '1 vecka',
  '1mo': '1 månad',
  '1y': '1 år',
};

export const HORIZON_SUPPORT: Record<Horizon, 'full' | 'limited' | 'unsupported'> = {
  '1s': 'unsupported',
  '1m': 'unsupported',
  '1h': 'limited',
  '1d': 'full',
  '1w': 'full',
  '1mo': 'full',
  '1y': 'full',
};

export const MODULE_NAMES: Record<string, string> = {
  technical: 'Teknisk Analys',
  fundamental: 'Fundamental Analys',
  sentiment: 'Sentiment',
  elliottWave: 'Elliott Wave',
  quant: 'Kvantmodeller',
  macro: 'Makroekonomi',
  volatility: 'Volatilitet',
  seasonal: 'Säsongsmönster',
  orderFlow: 'Orderflöde',
  ml: 'Machine Learning',
};
