import { Asset, RankedAsset, ModuleSignal, Direction, Horizon, WatchlistCase, ConfidenceBreakdown } from '@/types/market';

const generateEvidence = (module: string) => {
  const evidenceMap: Record<string, { type: string; description: string; value: string | number; source: string }[]> = {
    technical: [
      { type: 'indicator', description: 'RSI visar översålt', value: 28, source: 'Yahoo Finance' },
      { type: 'pattern', description: 'Double bottom formation', value: 'Confirmed', source: 'TradingView' },
      { type: 'indicator', description: 'MACD korsning', value: 'Bullish', source: 'Yahoo Finance' },
    ],
    fundamental: [
      { type: 'ratio', description: 'P/E vs sektor', value: 0.82, source: 'Börsdata' },
      { type: 'growth', description: 'Vinst Q4 vs förväntning', value: '+12%', source: 'Kvartalsrapport' },
      { type: 'metric', description: 'ROE', value: '18.5%', source: 'Årsredovisning' },
    ],
    sentiment: [
      { type: 'news', description: 'Positiva artiklar senaste 7d', value: 8, source: 'DI, SvD, Affärsvärlden' },
      { type: 'social', description: 'Twitter sentiment score', value: 0.72, source: 'Social Analytics' },
      { type: 'analyst', description: 'Uppgraderingar', value: 3, source: 'Bloomberg' },
    ],
    quant: [
      { type: 'factor', description: 'Momentum Z-score', value: 1.8, source: 'Intern modell' },
      { type: 'factor', description: 'Value score', value: 'High', source: 'Intern modell' },
      { type: 'factor', description: 'Quality rating', value: 'A', source: 'Intern modell' },
    ],
    macro: [
      { type: 'indicator', description: 'SEK/EUR utveckling', value: '-1.2%', source: 'Riksbanken' },
      { type: 'rate', description: 'Styrränta prognos', value: 'Stabil', source: 'Riksbanken' },
      { type: 'gdp', description: 'BNP-tillväxt prognos', value: '1.8%', source: 'Konjunkturinstitutet' },
    ],
    volatility: [
      { type: 'metric', description: 'Historisk volatilitet 30d', value: '22%', source: 'Yahoo Finance' },
      { type: 'metric', description: 'Implicit volatilitet', value: '28%', source: 'Options data' },
      { type: 'regime', description: 'Volatilitetsregim', value: 'Normal', source: 'Intern modell' },
    ],
    seasonal: [
      { type: 'pattern', description: 'Januari-effekt', value: 'Aktiv', source: 'Historisk data' },
      { type: 'cycle', description: 'Sektorcykel', value: 'Expansiv', source: 'Intern modell' },
    ],
    orderFlow: [
      { type: 'volume', description: 'OBV trend', value: 'Stigande', source: 'Yahoo Finance' },
      { type: 'accumulation', description: 'A/D linje', value: 'Positiv', source: 'Yahoo Finance' },
    ],
    ml: [
      { type: 'prediction', description: 'Ensemble prognos', value: '62% UP', source: 'ML Pipeline' },
      { type: 'feature', description: 'Top feature', value: 'Momentum_30d', source: 'Model explainer' },
    ],
    elliottWave: [
      { type: 'wave', description: 'Nuvarande våg', value: 'Wave 3 (impuls)', source: 'Manuell analys' },
      { type: 'confidence', description: 'Wave clarity', value: 'Low', source: 'Intern bedömning' },
    ],
  };
  
  return (evidenceMap[module] || []).map(e => ({
    ...e,
    timestamp: new Date(Date.now() - Math.random() * 86400000 * 7).toISOString(),
  }));
};

const generateSignal = (module: string, horizon: Horizon, baseDirection: Direction): ModuleSignal => {
  const directionModifier = Math.random();
  let direction: Direction = baseDirection;
  if (directionModifier > 0.7) direction = baseDirection === 'UP' ? 'DOWN' : 'UP';
  if (directionModifier > 0.85) direction = 'NEUTRAL';
  
  return {
    module,
    direction,
    strength: Math.floor(Math.random() * 40 + 40),
    horizon,
    confidence: Math.floor(Math.random() * 30 + 50),
    evidence: generateEvidence(module),
    coverage: Math.floor(Math.random() * 30 + 70),
    weight: 10,
  };
};

const generateConfidenceBreakdown = (): ConfidenceBreakdown => ({
  freshness: Math.floor(Math.random() * 30 + 60),
  coverage: Math.floor(Math.random() * 25 + 70),
  agreement: Math.floor(Math.random() * 40 + 50),
  reliability: Math.floor(Math.random() * 30 + 55),
  regimeRisk: Math.floor(Math.random() * 40 + 20),
});

const SWEDISH_STOCKS: Asset[] = [
  { ticker: 'VOLVO-B', name: 'Volvo Group', type: 'stock', sector: 'Industri', exchange: 'OMX', currency: 'SEK', lastPrice: 285.40, change24h: 3.20, changePercent24h: 1.13, volume24h: 4500000, marketCap: 285000000000 },
  { ticker: 'ERIC-B', name: 'Ericsson', type: 'stock', sector: 'Teknologi', exchange: 'OMX', currency: 'SEK', lastPrice: 68.50, change24h: -1.10, changePercent24h: -1.58, volume24h: 12000000, marketCap: 228000000000 },
  { ticker: 'SEB-A', name: 'SEB', type: 'stock', sector: 'Finans', exchange: 'OMX', currency: 'SEK', lastPrice: 142.80, change24h: 2.40, changePercent24h: 1.71, volume24h: 3200000, marketCap: 315000000000 },
  { ticker: 'ATCO-A', name: 'Atlas Copco', type: 'stock', sector: 'Industri', exchange: 'OMX', currency: 'SEK', lastPrice: 178.60, change24h: 4.80, changePercent24h: 2.76, volume24h: 5800000, marketCap: 654000000000 },
  { ticker: 'ASSA-B', name: 'Assa Abloy', type: 'stock', sector: 'Industri', exchange: 'OMX', currency: 'SEK', lastPrice: 312.40, change24h: -2.10, changePercent24h: -0.67, volume24h: 2100000, marketCap: 347000000000 },
  { ticker: 'HM-B', name: 'H&M', type: 'stock', sector: 'Konsument', exchange: 'OMX', currency: 'SEK', lastPrice: 156.20, change24h: 5.60, changePercent24h: 3.72, volume24h: 7800000, marketCap: 252000000000 },
  { ticker: 'SAND', name: 'Sandvik', type: 'stock', sector: 'Industri', exchange: 'OMX', currency: 'SEK', lastPrice: 218.90, change24h: 1.30, changePercent24h: 0.60, volume24h: 3400000, marketCap: 275000000000 },
  { ticker: 'HEXA-B', name: 'Hexagon', type: 'stock', sector: 'Teknologi', exchange: 'OMX', currency: 'SEK', lastPrice: 124.50, change24h: -3.20, changePercent24h: -2.50, volume24h: 4200000, marketCap: 324000000000 },
  { ticker: 'INVE-B', name: 'Investor', type: 'stock', sector: 'Finans', exchange: 'OMX', currency: 'SEK', lastPrice: 278.30, change24h: 6.10, changePercent24h: 2.24, volume24h: 2800000, marketCap: 856000000000 },
  { ticker: 'SWED-A', name: 'Swedbank', type: 'stock', sector: 'Finans', exchange: 'OMX', currency: 'SEK', lastPrice: 215.60, change24h: -1.80, changePercent24h: -0.83, volume24h: 4100000, marketCap: 242000000000 },
  { ticker: 'ESSITY-B', name: 'Essity', type: 'stock', sector: 'Konsument', exchange: 'OMX', currency: 'SEK', lastPrice: 282.10, change24h: 3.40, changePercent24h: 1.22, volume24h: 1900000, marketCap: 198000000000 },
  { ticker: 'SKF-B', name: 'SKF', type: 'stock', sector: 'Industri', exchange: 'OMX', currency: 'SEK', lastPrice: 198.40, change24h: 2.80, changePercent24h: 1.43, volume24h: 2600000, marketCap: 89000000000 },
  { ticker: 'TELIA', name: 'Telia Company', type: 'stock', sector: 'Telekom', exchange: 'OMX', currency: 'SEK', lastPrice: 28.45, change24h: 0.35, changePercent24h: 1.25, volume24h: 15000000, marketCap: 116000000000 },
  { ticker: 'KINV-B', name: 'Kinnevik', type: 'stock', sector: 'Finans', exchange: 'OMX', currency: 'SEK', lastPrice: 89.20, change24h: -4.30, changePercent24h: -4.60, volume24h: 1200000, marketCap: 24600000000 },
  { ticker: 'ELUX-B', name: 'Electrolux', type: 'stock', sector: 'Konsument', exchange: 'OMX', currency: 'SEK', lastPrice: 78.60, change24h: 1.20, changePercent24h: 1.55, volume24h: 3800000, marketCap: 22400000000 },
];

const CRYPTO_ASSETS: Asset[] = [
  { ticker: 'BTC', name: 'Bitcoin', type: 'crypto', currency: 'USD', lastPrice: 98450, change24h: 2340, changePercent24h: 2.43, volume24h: 45000000000, marketCap: 1920000000000 },
  { ticker: 'ETH', name: 'Ethereum', type: 'crypto', currency: 'USD', lastPrice: 3420, change24h: -45, changePercent24h: -1.30, volume24h: 18000000000, marketCap: 411000000000 },
  { ticker: 'SOL', name: 'Solana', type: 'crypto', currency: 'USD', lastPrice: 198.50, change24h: 12.30, changePercent24h: 6.61, volume24h: 4500000000, marketCap: 92000000000 },
  { ticker: 'XRP', name: 'Ripple', type: 'crypto', currency: 'USD', lastPrice: 2.45, change24h: 0.18, changePercent24h: 7.93, volume24h: 8200000000, marketCap: 140000000000 },
  { ticker: 'ADA', name: 'Cardano', type: 'crypto', currency: 'USD', lastPrice: 0.98, change24h: 0.05, changePercent24h: 5.38, volume24h: 1200000000, marketCap: 34500000000 },
  { ticker: 'AVAX', name: 'Avalanche', type: 'crypto', currency: 'USD', lastPrice: 42.80, change24h: -1.20, changePercent24h: -2.73, volume24h: 890000000, marketCap: 17200000000 },
  { ticker: 'DOT', name: 'Polkadot', type: 'crypto', currency: 'USD', lastPrice: 8.45, change24h: 0.32, changePercent24h: 3.94, volume24h: 420000000, marketCap: 12800000000 },
  { ticker: 'LINK', name: 'Chainlink', type: 'crypto', currency: 'USD', lastPrice: 18.90, change24h: 0.85, changePercent24h: 4.71, volume24h: 680000000, marketCap: 11400000000 },
];

const METALS: Asset[] = [
  { ticker: 'XAU', name: 'Guld', type: 'metal', currency: 'USD', lastPrice: 2680, change24h: 28, changePercent24h: 1.06, volume24h: 180000000000 },
  { ticker: 'XAG', name: 'Silver', type: 'metal', currency: 'USD', lastPrice: 31.20, change24h: 0.45, changePercent24h: 1.46, volume24h: 5200000000 },
  { ticker: 'XPT', name: 'Platina', type: 'metal', currency: 'USD', lastPrice: 982, change24h: -8, changePercent24h: -0.81, volume24h: 450000000 },
  { ticker: 'XPD', name: 'Palladium', type: 'metal', currency: 'USD', lastPrice: 1045, change24h: 15, changePercent24h: 1.46, volume24h: 320000000 },
];

export const ALL_ASSETS: Asset[] = [...SWEDISH_STOCKS, ...CRYPTO_ASSETS, ...METALS];

const MODULES = ['technical', 'fundamental', 'sentiment', 'elliottWave', 'quant', 'macro', 'volatility', 'seasonal', 'orderFlow', 'ml'];

export const generateRankedAssets = (horizon: Horizon, direction: 'UP' | 'DOWN', limit = 10): RankedAsset[] => {
  const shuffled = [...ALL_ASSETS].sort(() => Math.random() - 0.5);
  
  return shuffled.slice(0, limit).map((asset, index) => {
    const signals = MODULES.map(module => generateSignal(module, horizon, direction));
    const agreementCount = signals.filter(s => s.direction === direction).length;
    const totalStrength = signals.reduce((acc, s) => acc + (s.direction === direction ? s.strength : -s.strength * 0.5), 0);
    
    const confidenceBreakdown = generateConfidenceBreakdown();
    confidenceBreakdown.agreement = Math.floor((agreementCount / MODULES.length) * 100);
    
    const confidence = Math.floor(
      0.25 * confidenceBreakdown.freshness +
      0.20 * confidenceBreakdown.coverage +
      0.25 * confidenceBreakdown.agreement +
      0.20 * confidenceBreakdown.reliability +
      0.10 * (100 - confidenceBreakdown.regimeRisk)
    );
    
    const topContributors = signals
      .filter(s => s.direction === direction)
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 3)
      .map(s => ({ module: s.module, contribution: s.strength }));
    
    return {
      ...asset,
      totalScore: Math.max(0, Math.min(100, Math.floor(50 + totalStrength / 5) - index * 2)),
      direction,
      confidence,
      confidenceBreakdown,
      signals,
      topContributors,
      horizon,
      lastUpdated: new Date().toISOString(),
    };
  }).sort((a, b) => b.totalScore - a.totalScore);
};

export const MOCK_WATCHLIST: WatchlistCase[] = [
  {
    id: 'wl-1',
    ticker: 'VOLVO-B',
    asset: SWEDISH_STOCKS[0],
    savedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    horizon: '1w',
    predictionDirection: 'UP',
    entryPrice: 278.50,
    entryPriceSource: 'Yahoo Finance',
    targetEndTime: new Date(Date.now() + 86400000 * 4).toISOString(),
    confidenceAtSave: 72,
    modelSnapshotId: 'snap-2024-01-28',
    currentPrice: 285.40,
    currentReturn: 2.48,
  },
  {
    id: 'wl-2',
    ticker: 'BTC',
    asset: CRYPTO_ASSETS[0],
    savedAt: new Date(Date.now() - 86400000 * 14).toISOString(),
    horizon: '1mo',
    predictionDirection: 'UP',
    entryPrice: 92000,
    entryPriceSource: 'CoinGecko',
    targetEndTime: new Date(Date.now() + 86400000 * 16).toISOString(),
    confidenceAtSave: 68,
    modelSnapshotId: 'snap-2024-01-17',
    currentPrice: 98450,
    currentReturn: 7.01,
  },
  {
    id: 'wl-3',
    ticker: 'HEXA-B',
    asset: SWEDISH_STOCKS[7],
    savedAt: new Date(Date.now() - 86400000 * 10).toISOString(),
    horizon: '1w',
    predictionDirection: 'DOWN',
    entryPrice: 128.90,
    entryPriceSource: 'Yahoo Finance',
    targetEndTime: new Date(Date.now() - 86400000 * 3).toISOString(),
    confidenceAtSave: 65,
    modelSnapshotId: 'snap-2024-01-21',
    exitPrice: 124.50,
    returnPct: -3.41,
    hit: true,
    resultLockedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
  },
];

export const MOCK_STATS = {
  hitRateByHorizon: {
    '1d': { total: 45, hits: 28, rate: 62.2 },
    '1w': { total: 32, hits: 22, rate: 68.8 },
    '1mo': { total: 18, hits: 13, rate: 72.2 },
    '1y': { total: 5, hits: 4, rate: 80.0 },
  },
  hitRateByModule: {
    technical: 61,
    fundamental: 68,
    sentiment: 58,
    quant: 65,
    macro: 72,
    volatility: 54,
    seasonal: 63,
    orderFlow: 51,
    ml: 48,
  },
  calibration: [
    { confidence: 50, hitRate: 48 },
    { confidence: 60, hitRate: 58 },
    { confidence: 70, hitRate: 67 },
    { confidence: 80, hitRate: 76 },
    { confidence: 90, hitRate: 85 },
  ],
};
