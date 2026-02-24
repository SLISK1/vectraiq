import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ==================== TECHNICAL ANALYSIS ====================

function calculateSMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((s, p) => s + p, 0) / period;
}

function calculateEMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const mult = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((s, p) => s + p, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * mult + ema;
  }
  return ema;
}

function calculateRSI(prices: number[], period = 14): number | null {
  if (prices.length < period + 1) return null;
  const changes = prices.slice(1).map((p, i) => p - prices[i]);
  const recent = changes.slice(-period);
  const gains = recent.filter(c => c > 0);
  const losses = recent.filter(c => c < 0).map(c => Math.abs(c));
  const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / period : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / period : 0;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function calculateMACD(prices: number[]): { value: number; signal: number; histogram: number } | null {
  if (prices.length < 26) return null;
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  if (!ema12 || !ema26) return null;
  const macdLine = ema12 - ema26;
  const macdHistory: number[] = [];
  for (let i = 26; i <= prices.length; i++) {
    const e12 = calculateEMA(prices.slice(0, i), 12);
    const e26 = calculateEMA(prices.slice(0, i), 26);
    if (e12 && e26) macdHistory.push(e12 - e26);
  }
  const signalLine = macdHistory.length >= 9 ? calculateEMA(macdHistory, 9) : macdLine;
  return { value: macdLine, signal: signalLine || macdLine, histogram: macdLine - (signalLine || macdLine) };
}

function calculateBollingerBands(prices: number[], period = 20): { percentB: number } | null {
  if (prices.length < period) return null;
  const sma = calculateSMA(prices, period);
  if (!sma) return null;
  const slice = prices.slice(-period);
  const variance = slice.reduce((sum, p) => sum + Math.pow(p - sma, 2), 0) / period;
  const std = Math.sqrt(variance);
  const upper = sma + 2 * std;
  const lower = sma - 2 * std;
  const percentB = (prices[prices.length - 1] - lower) / (upper - lower);
  return { percentB };
}

function calculateStochastic(highs: number[], lows: number[], closes: number[], period = 14): { k: number } | null {
  if (closes.length < period) return null;
  const highP = Math.max(...highs.slice(-period));
  const lowP = Math.min(...lows.slice(-period));
  if (highP === lowP) return null;
  return { k: ((closes[closes.length - 1] - lowP) / (highP - lowP)) * 100 };
}

type Direction = 'UP' | 'DOWN' | 'NEUTRAL';
type AssetType = 'stock' | 'crypto' | 'metal' | 'fund';

interface SignalResult {
  module: string;
  direction: Direction;
  strength: number;
  confidence: number;
  coverage: number;
  evidence: any[];
}

function getBenchmarkTicker(assetType: AssetType, currency: string): string {
  if (assetType === 'crypto') return 'BTC-USD';
  if (assetType === 'metal') return 'GLD';
  if (currency === 'USD') return '^GSPC';
  return '^OMXSPI';
}

async function fetchBenchmarkPrice(ticker: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return null;
    const json = await res.json();
    const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    if (!closes?.length) return null;
    const valid = closes.filter((c: number | null) => c != null);
    return valid.length > 0 ? valid[valid.length - 1] : null;
  } catch {
    return null;
  }
}

function analyzeTechnical(closes: number[], highs: number[], lows: number[], currentPrice: number): SignalResult {
  const evidence: any[] = [];
  let bullish = 0, bearish = 0, total = 0;

  const rsi = calculateRSI(closes);
  if (rsi != null) {
    total++;
    if (rsi < 30) { bullish++; evidence.push({ type: 'indicator', description: `RSI översålt (${rsi.toFixed(1)})`, source: 'RSI' }); }
    else if (rsi > 70) { bearish++; evidence.push({ type: 'indicator', description: `RSI överköpt (${rsi.toFixed(1)})`, source: 'RSI' }); }
  }

  const macd = calculateMACD(closes);
  if (macd) {
    total++;
    if (macd.histogram > 0) { bullish++; evidence.push({ type: 'indicator', description: 'MACD bullish', source: 'MACD' }); }
    else if (macd.histogram < 0) { bearish++; evidence.push({ type: 'indicator', description: 'MACD bearish', source: 'MACD' }); }
  }

  const sma20 = calculateSMA(closes, 20);
  const sma50 = calculateSMA(closes, 50);
  if (sma20 && sma50) {
    total++;
    if (currentPrice > sma20 && sma20 > sma50) { bullish++; evidence.push({ type: 'trend', description: 'Upptrend (SMA20>SMA50)', source: 'MA' }); }
    else if (currentPrice < sma20 && sma20 < sma50) { bearish++; evidence.push({ type: 'trend', description: 'Nedtrend (SMA20<SMA50)', source: 'MA' }); }
  }

  const bb = calculateBollingerBands(closes);
  if (bb) {
    total++;
    if (bb.percentB < 0.2) { bullish++; evidence.push({ type: 'volatility', description: 'Nära nedre BB', source: 'BB' }); }
    else if (bb.percentB > 0.8) { bearish++; evidence.push({ type: 'volatility', description: 'Nära övre BB', source: 'BB' }); }
  }

  const stoch = calculateStochastic(highs, lows, closes);
  if (stoch) {
    total++;
    if (stoch.k < 20) { bullish++; evidence.push({ type: 'momentum', description: `Stochastic översålt (${stoch.k.toFixed(0)})`, source: 'Stochastic' }); }
    else if (stoch.k > 80) { bearish++; evidence.push({ type: 'momentum', description: `Stochastic överköpt (${stoch.k.toFixed(0)})`, source: 'Stochastic' }); }
  }

  const net = bullish - bearish;
  const direction: Direction = net > 0 ? 'UP' : net < 0 ? 'DOWN' : 'NEUTRAL';
  const strength = total > 0 ? Math.round(50 + (net / total) * 50) : 50;
  const available = [rsi, macd, sma20, bb, stoch].filter(v => v != null).length;
  const coverage = Math.round((available / 5) * 100);
  const agreement = total > 0 ? Math.abs(net) / total : 0;
  const confidence = Math.round(40 + agreement * 50 + (coverage / 100) * 10);

  return { module: 'technical', direction, strength: clamp(strength), confidence: clamp(confidence), coverage, evidence };
}

function analyzeVolatility(closes: number[], highs: number[], lows: number[]): SignalResult {
  // Simple volatility analysis based on ATR and historical volatility
  const returns = closes.slice(1).map((p, i) => (p - closes[i]) / closes[i]);
  const avgReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const hv = Math.sqrt(variance * 252) * 100; // annualized

  let direction: Direction = 'NEUTRAL';
  const evidence: any[] = [];

  if (hv > 50) { direction = 'DOWN'; evidence.push({ type: 'volatility', description: `Hög volatilitet (${hv.toFixed(0)}%)`, source: 'HV' }); }
  else if (hv < 20) { direction = 'UP'; evidence.push({ type: 'volatility', description: `Låg volatilitet (${hv.toFixed(0)}%)`, source: 'HV' }); }

  return { module: 'volatility', direction, strength: clamp(Math.round(50 + (30 - hv) * 1.5)), confidence: 55, coverage: 80, evidence };
}

function analyzeQuant(closes: number[]): SignalResult {
  // Momentum & mean reversion
  const evidence: any[] = [];
  let bullish = 0, bearish = 0, total = 0;

  // 20-day momentum
  if (closes.length >= 20) {
    total++;
    const mom = (closes[closes.length - 1] / closes[closes.length - 20] - 1) * 100;
    if (mom > 5) { bullish++; evidence.push({ type: 'momentum', description: `20d momentum +${mom.toFixed(1)}%`, source: 'Momentum' }); }
    else if (mom < -5) { bearish++; evidence.push({ type: 'momentum', description: `20d momentum ${mom.toFixed(1)}%`, source: 'Momentum' }); }
  }

  // Mean reversion signal
  const sma20 = calculateSMA(closes, 20);
  if (sma20) {
    total++;
    const deviation = ((closes[closes.length - 1] - sma20) / sma20) * 100;
    if (deviation < -5) { bullish++; evidence.push({ type: 'reversion', description: `${deviation.toFixed(1)}% under SMA20`, source: 'Mean Rev' }); }
    else if (deviation > 5) { bearish++; evidence.push({ type: 'reversion', description: `${deviation.toFixed(1)}% över SMA20`, source: 'Mean Rev' }); }
  }

  const net = bullish - bearish;
  const direction: Direction = net > 0 ? 'UP' : net < 0 ? 'DOWN' : 'NEUTRAL';
  return { module: 'quant', direction, strength: clamp(Math.round(50 + (net / Math.max(total, 1)) * 40)), confidence: 50, coverage: 70, evidence };
}

function analyzeSeasonal(): SignalResult {
  const month = new Date().getMonth() + 1;
  // Historical monthly bias for stocks
  const monthlyBias: Record<number, number> = { 1: 1.2, 2: 0.5, 3: 0.8, 4: 1.5, 5: -0.2, 6: -0.1, 7: 0.8, 8: -0.5, 9: -1.0, 10: 0.3, 11: 1.5, 12: 1.2 };
  const bias = monthlyBias[month] || 0;
  const direction: Direction = bias > 0.5 ? 'UP' : bias < -0.3 ? 'DOWN' : 'NEUTRAL';
  return {
    module: 'seasonal', direction, strength: clamp(Math.round(50 + bias * 15)), confidence: 40, coverage: 60,
    evidence: [{ type: 'seasonal', description: `Historisk månadsbias: ${bias > 0 ? '+' : ''}${bias.toFixed(1)}%`, source: 'Seasonal' }],
  };
}

// Sentiment with health flag - uses news_cache when available
async function analyzeSentimentWithNews(
  supabase: any, ticker: string, closes: number[]
): Promise<SignalResult> {
  const evidence: any[] = [];
  let sentimentSource: 'cached_news' | 'none' = 'none';
  let articleCount = 0;
  let direction: Direction = 'NEUTRAL';
  let strength = 50;
  let confidence = 30;
  let coverage = 40;

  // Try news_cache first (articles < 24h old)
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: newsArticles } = await supabase
      .from('news_cache')
      .select('title, description, sentiment_score')
      .eq('ticker', ticker)
      .gte('fetched_at', oneDayAgo)
      .limit(30);

    if (newsArticles && newsArticles.length > 0) {
      sentimentSource = 'cached_news';
      articleCount = newsArticles.length;

      // Calculate sentiment from articles with existing sentiment_score
      const withScore = newsArticles.filter((a: any) => a.sentiment_score != null);
      let avgSentiment = 0;
      if (withScore.length > 0) {
        avgSentiment = withScore.reduce((s: number, a: any) => s + Number(a.sentiment_score), 0) / withScore.length;
      } else {
        // Simple keyword-based sentiment from titles
        let pos = 0, neg = 0;
        const posWords = ['surge', 'rally', 'gain', 'rise', 'up', 'bull', 'strong', 'growth', 'beat', 'höj', 'stiger', 'stark'];
        const negWords = ['fall', 'drop', 'crash', 'bear', 'loss', 'decline', 'weak', 'miss', 'sänk', 'sjunker', 'svag'];
        for (const a of newsArticles) {
          const text = ((a.title || '') + ' ' + (a.description || '')).toLowerCase();
          for (const w of posWords) if (text.includes(w)) pos++;
          for (const w of negWords) if (text.includes(w)) neg++;
        }
        if (pos + neg > 0) avgSentiment = (pos - neg) / (pos + neg);
      }

      // Article count weight multiplier
      const countMultiplier = articleCount <= 3 ? 0.3 : articleCount <= 10 ? 0.7 : 1.0;
      // Source weight (cached_news = 0.5x)
      const sourceMultiplier = 0.5;
      const effectiveWeight = countMultiplier * sourceMultiplier;

      direction = avgSentiment > 0.15 ? 'UP' : avgSentiment < -0.15 ? 'DOWN' : 'NEUTRAL';
      strength = clamp(Math.round(50 + avgSentiment * 40 * effectiveWeight));
      confidence = clamp(Math.round(40 + effectiveWeight * 25));
      coverage = clamp(Math.round(50 + articleCount * 2));

      evidence.push({
        type: 'news_sentiment', source: 'News Cache',
        description: `${articleCount} nyhetsartiklar (sentiment: ${avgSentiment > 0 ? '+' : ''}${(avgSentiment * 100).toFixed(0)}%)`,
      });
      evidence.push({
        type: 'sentiment_health', source: 'System',
        description: `Källa: cached_news | Artiklar: ${articleCount} | Vikt: ${(effectiveWeight * 100).toFixed(0)}%`,
      });
    }
  } catch (e) {
    console.warn(`News sentiment lookup failed for ${ticker}:`, e);
  }

  // Fallback: momentum proxy with weight = 0 if no news
  if (sentimentSource === 'none') {
    if (closes.length >= 5) {
      const recent5d = (closes[closes.length - 1] / closes[closes.length - 5] - 1) * 100;
      // Weight = 0 for momentum proxy per plan (not real sentiment)
      direction = 'NEUTRAL';
      strength = 50;
      confidence = 20;
      coverage = 30;
      evidence.push({
        type: 'sentiment_health', source: 'System',
        description: `Ingen nyhetsdata – sentiment-vikt = 0 (momentum: ${recent5d > 0 ? '+' : ''}${recent5d.toFixed(1)}%)`,
      });
    }
  }

  return {
    module: 'sentiment', direction, strength, confidence, coverage, evidence,
  };
}

// Sync fallback (kept for backward compat)
function analyzeSentiment(closes: number[]): SignalResult {
  if (closes.length < 5) return { module: 'sentiment', direction: 'NEUTRAL', strength: 50, confidence: 30, coverage: 40, evidence: [] };
  const recent5d = (closes[closes.length - 1] / closes[closes.length - 5] - 1) * 100;
  const direction: Direction = recent5d > 2 ? 'UP' : recent5d < -2 ? 'DOWN' : 'NEUTRAL';
  return {
    module: 'sentiment', direction, strength: clamp(Math.round(50 + recent5d * 5)), confidence: 35, coverage: 50,
    evidence: [{ type: 'sentiment', description: `5d prismomentum: ${recent5d > 0 ? '+' : ''}${recent5d.toFixed(1)}%`, source: 'Price Proxy' }],
  };
}

function analyzeMacro(): SignalResult {
  // Static macro view - could be enhanced with real data
  return {
    module: 'macro', direction: 'NEUTRAL', strength: 50, confidence: 40, coverage: 50,
    evidence: [{ type: 'macro', description: 'Makromiljö: neutral', source: 'Macro' }],
  };
}

function clamp(v: number, min = 0, max = 100) { return Math.max(min, Math.min(max, v)); }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const isServiceRole = authHeader === `Bearer ${supabaseServiceKey}`;
    if (!isServiceRole) {
      const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader! } } });
      const { error } = await supabaseAuth.auth.getUser(authHeader!.replace('Bearer ', ''));
      if (error) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let batchLimit = 20, batchOffset = 0;
    let horizons: string[] = ['1d'];
    let tickerFilter: string[] | null = null;
    try {
      const body = await req.json();
      if (body?.tickers && Array.isArray(body.tickers)) {
        tickerFilter = body.tickers.map((t: string) => t.toUpperCase().trim());
      }
      if (body?.limit) batchLimit = Math.min(Number(body.limit), 50);
      if (body?.offset) batchOffset = Number(body.offset);
      if (body?.horizon) horizons = [body.horizon];
      if (body?.horizons && Array.isArray(body.horizons)) horizons = body.horizons;
      if (body?.allHorizons) horizons = ['1d', '1w', '1mo', '1y'];
    } catch {}

    // ── Fetch module_reliability to adjust weights ──
    const { data: reliabilityRows } = await supabase
      .from('module_reliability')
      .select('module, horizon, asset_type, hit_rate, reliability_weight');

    // Bayesian reliability data map

    // Load correct_predictions for Bayesian shrinkage
    const reliabilityDataMap = new Map<string, { rw: number; correct: number; total: number }>();
    for (const r of (reliabilityRows || [])) {
      const key = `${r.module}:${r.horizon}:${r.asset_type}`;
      reliabilityDataMap.set(key, {
        rw: Number(r.reliability_weight ?? 1.0),
        correct: (r as any).correct_predictions ?? 0,
        total: (r as any).total_predictions ?? 0,
      });
    }

    function getReliabilityWeight(mod: string, horizon: string, assetType: string): number {
      const entry = reliabilityDataMap.get(`${mod}:${horizon}:${assetType}`);
      if (!entry || entry.total < 3) return 1.0;
      // Bayesian shrinkage Beta(10,10)
      const posteriorMean = (entry.correct + 10) / (entry.total + 20);
      return Math.max(0.7, Math.min(1.3, 1 + (posteriorMean - 0.5) * 2));
    }

    // Get active symbols — support ticker filter from add-symbol
    let symQuery = supabase
      .from('symbols')
      .select('id, ticker, name, asset_type, currency, metadata')
      .eq('is_active', true)
      .order('ticker', { ascending: true });

    if (tickerFilter && tickerFilter.length > 0) {
      symQuery = symQuery.in('ticker', tickerFilter);
    } else {
      symQuery = symQuery.range(batchOffset, batchOffset + batchLimit - 1);
    }
    const { data: symbols, error: symErr } = await symQuery;

    if (symErr || !symbols?.length) {
      return new Response(JSON.stringify({ error: symErr?.message || 'No symbols', updated: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Generating signals for ${symbols.length} symbols, horizons: ${horizons.join(',')}, offset ${batchOffset}`);

    const results: { ticker: string; success: boolean; modules?: number; error?: string }[] = [];
    let totalInserted = 0;

    for (const symbol of symbols) {
      try {
        // Fetch price history
        const { data: prices } = await supabase
          .from('price_history')
          .select('close_price, open_price, high_price, low_price, volume, date')
          .eq('symbol_id', symbol.id)
          .order('date', { ascending: true })
          .limit(200);

        const isLimitedData = !prices || prices.length < 30;

        if (!prices || prices.length < 5) {
          results.push({ ticker: symbol.ticker, success: false, error: `Only ${prices?.length || 0} price points` });
          continue;
        }

        const closes = prices.map(p => Number(p.close_price));
        const highs = prices.map(p => Number(p.high_price));
        const lows = prices.map(p => Number(p.low_price));
        const currentPrice = closes[closes.length - 1];

        // Run all analysis modules
        let signals: SignalResult[];
        const assetType = (symbol.asset_type || 'stock') as AssetType;

        // Check for fund proxy
        let effectiveCloses = closes;
        let effectiveHighs = highs;
        let effectiveLows = lows;
        let effectiveCurrentPrice = currentPrice;
        let proxyUsed = false;
        let proxyConfidenceReduction = 0;

        if (assetType === 'fund') {
          const proxyEtf = (symbol.metadata as any)?.proxy_etf;
          if (proxyEtf) {
            // Find proxy symbol and use its price data
            const { data: proxySym } = await supabase
              .from('symbols')
              .select('id')
              .eq('ticker', proxyEtf)
              .single();
            if (proxySym) {
              const { data: proxyPrices } = await supabase
                .from('price_history')
                .select('close_price, high_price, low_price')
                .eq('symbol_id', proxySym.id)
                .order('date', { ascending: true })
                .limit(200);
              if (proxyPrices && proxyPrices.length >= 30) {
                effectiveCloses = proxyPrices.map(p => Number(p.close_price));
                effectiveHighs = proxyPrices.map(p => Number(p.high_price));
                effectiveLows = proxyPrices.map(p => Number(p.low_price));
                effectiveCurrentPrice = effectiveCloses[effectiveCloses.length - 1];
                proxyUsed = true;
                proxyConfidenceReduction = 15; // tracking error penalty
              }
            }
          }
        }

        if (isLimitedData && !proxyUsed) {
          // Limited data: only run modules that work with sparse data
          const limitedConfidenceCap = 35;
          const sentimentResult = await analyzeSentimentWithNews(supabase, symbol.ticker, closes);
          signals = [
            sentimentResult,
            analyzeSeasonal(),
            analyzeMacro(),
          ].map(s => ({
            ...s,
            confidence: Math.min(s.confidence, limitedConfidenceCap),
            evidence: [...s.evidence, { type: 'warning', description: 'Begränsad data – låg tillförlitlighet', source: 'DataQuality' }],
          }));
        } else {
          const sentimentResult = await analyzeSentimentWithNews(supabase, symbol.ticker, effectiveCloses);
          signals = [
            analyzeTechnical(effectiveCloses, effectiveHighs, effectiveLows, effectiveCurrentPrice),
            analyzeVolatility(effectiveCloses, effectiveHighs, effectiveLows),
            analyzeQuant(effectiveCloses),
            analyzeSeasonal(),
            sentimentResult,
            analyzeMacro(),
          ];
          // Apply proxy confidence reduction
          if (proxyUsed && proxyConfidenceReduction > 0) {
            signals = signals.map(s => ({
              ...s,
              confidence: Math.max(20, s.confidence - proxyConfidenceReduction),
              evidence: [...s.evidence, { type: 'proxy', description: `Fond-proxy använd – konfidens reducerad ${proxyConfidenceReduction}%`, source: 'FundProxy' }],
            }));
          }
        }

        let symbolInserted = 0;

        for (const horizon of horizons) {
          // Delete old signals for this symbol+horizon
          await supabase.from('signals').delete().eq('symbol_id', symbol.id).eq('horizon', horizon);

          // === E: Apply reliability weights + RENORMALIZE to sum=100 ===
          const moduleWeights: Record<string, number> = {
            technical: 25, volatility: 15, quant: 20, seasonal: 5, sentiment: 15, macro: 20,
          };
          const rawAdjusted = signals.map(s => {
            const baseWeight = moduleWeights[s.module] || 15;
            const rw = getReliabilityWeight(s.module, horizon, assetType);
            return { signal: s, adjustedWeight: baseWeight * rw };
          });
          const totalRawWeight = rawAdjusted.reduce((s, x) => s + x.adjustedWeight, 0);
          const normFactor = totalRawWeight > 0 ? 100 / totalRawWeight : 1;

          const weightedSignals = rawAdjusted.map(({ signal: s, adjustedWeight }) => ({
            ...s,
            effectiveWeight: Math.round(adjustedWeight * normFactor),
          }));

          // Insert new signals
          const inserts = weightedSignals.map(s => ({
            symbol_id: symbol.id,
            module: s.module,
            direction: s.direction as 'UP' | 'DOWN' | 'NEUTRAL',
            strength: Math.round(s.strength),
            confidence: Math.round(s.confidence),
            coverage: Math.round(s.coverage),
            horizon: horizon as any,
            evidence: s.evidence,
          }));

          const { error: insertErr } = await supabase.from('signals').insert(inserts);
          if (insertErr) {
            results.push({ ticker: symbol.ticker, success: false, error: insertErr.message });
          } else {
            symbolInserted += inserts.length;

            // === A+G: Signed scoring — matching engine.ts ===
            const totalWeight = weightedSignals.reduce((sum, s) => sum + s.effectiveWeight, 0);
            const signedScores = weightedSignals.map(s => {
              const dirMult = s.direction === 'UP' ? 1 : s.direction === 'DOWN' ? -1 : 0;
              const signedStrength = (s.strength - 50) * 2 * dirMult;
              return totalWeight > 0 ? signedStrength * (s.effectiveWeight / totalWeight) : 0;
            });
            const totalSignedScore = signedScores.reduce((a, b) => a + b, 0);
            const normalizedScore = Math.round(50 + totalSignedScore / 2);
            const overallDir: Direction = totalSignedScore > 5 ? 'UP' : totalSignedScore < -5 ? 'DOWN' : 'NEUTRAL';
            const p_up = Math.max(0, Math.min(1, 0.5 + totalSignedScore / 200));
            const avgConfidence = Math.round(weightedSignals.reduce((sum, s) => sum + s.confidence, 0) / weightedSignals.length);

            const benchmarkTicker = getBenchmarkTicker(assetType, symbol.currency || 'SEK');
            const benchmarkPrice = horizon === horizons[0] ? await fetchBenchmarkPrice(benchmarkTicker) : null;

            const { data: predData } = await supabase.from('asset_predictions').insert({
              symbol_id: symbol.id,
              horizon: horizon as any,
              predicted_direction: overallDir,
              predicted_prob: overallDir === 'NEUTRAL' ? 0.5 : p_up,
              confidence: avgConfidence,
              total_score: Math.max(0, Math.min(100, normalizedScore)),
              entry_price: currentPrice,
              baseline_ticker: benchmarkTicker,
              baseline_price: benchmarkPrice,
              p_up: Math.round(p_up * 1000) / 1000,
              weights_version: '2.0',
              model_version: '2.0-signed',
            }).select('id').single();

            // ── Save signal_snapshots for self-learning ──
            if (predData?.id) {
              const snapshots = weightedSignals.map(s => ({
                prediction_id: predData.id,
                symbol_id: symbol.id,
                module: s.module,
                direction: s.direction,
                strength: Math.round(s.strength),
                confidence: Math.round(s.confidence),
                horizon,
              }));
              const { error: snapErr } = await supabase.from('signal_snapshots').insert(snapshots);
              if (snapErr) console.error(`Snapshot insert error for ${symbol.ticker}:`, snapErr.message);
            }
          }
        }

        totalInserted += symbolInserted;
        results.push({ ticker: symbol.ticker, success: true, modules: symbolInserted });
      } catch (e) {
        results.push({ ticker: symbol.ticker, success: false, error: String(e) });
      }
    }

    console.log(`Done: ${totalInserted} signals inserted for ${results.filter(r => r.success).length} symbols across ${horizons.length} horizons`);

    return new Response(JSON.stringify({ inserted: totalInserted, symbols: results.length, horizons, offset: batchOffset, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
