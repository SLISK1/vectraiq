import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-call',
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

interface SignalResult {
  module: string;
  direction: Direction;
  strength: number;
  confidence: number;
  coverage: number;
  evidence: any[];
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

function analyzeSentiment(closes: number[]): SignalResult {
  // Proxy: price momentum as sentiment proxy
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

    const isInternalCall = req.headers.get('x-internal-call') === 'true';
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ') && !isInternalCall) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!isInternalCall && authHeader !== `Bearer ${supabaseServiceKey}`) {
      const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader! } } });
      const { error } = await supabaseAuth.auth.getUser(authHeader!.replace('Bearer ', ''));
      if (error) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let batchLimit = 20, batchOffset = 0;
    let horizon = '1d';
    try {
      const body = await req.json();
      if (body?.limit) batchLimit = Math.min(Number(body.limit), 50);
      if (body?.offset) batchOffset = Number(body.offset);
      if (body?.horizon) horizon = body.horizon;
    } catch {}

    // Get active symbols
    const { data: symbols, error: symErr } = await supabase
      .from('symbols')
      .select('id, ticker, name, asset_type, metadata')
      .eq('is_active', true)
      .order('ticker', { ascending: true })
      .range(batchOffset, batchOffset + batchLimit - 1);

    if (symErr || !symbols?.length) {
      return new Response(JSON.stringify({ error: symErr?.message || 'No symbols', updated: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Generating signals for ${symbols.length} symbols (offset ${batchOffset})`);

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

        if (!prices || prices.length < 10) {
          results.push({ ticker: symbol.ticker, success: false, error: `Only ${prices?.length || 0} price points` });
          continue;
        }

        const closes = prices.map(p => Number(p.close_price));
        const highs = prices.map(p => Number(p.high_price));
        const lows = prices.map(p => Number(p.low_price));
        const currentPrice = closes[closes.length - 1];

        // Run all analysis modules
        const signals: SignalResult[] = [
          analyzeTechnical(closes, highs, lows, currentPrice),
          analyzeVolatility(closes, highs, lows),
          analyzeQuant(closes),
          analyzeSeasonal(),
          analyzeSentiment(closes),
          analyzeMacro(),
        ];

        // Delete old signals for this symbol+horizon
        await supabase.from('signals').delete().eq('symbol_id', symbol.id).eq('horizon', horizon);

        // Insert new signals
        const inserts = signals.map(s => ({
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
          totalInserted += inserts.length;
          results.push({ ticker: symbol.ticker, success: true, modules: inserts.length });
        }
      } catch (e) {
        results.push({ ticker: symbol.ticker, success: false, error: String(e) });
      }
    }

    console.log(`Done: ${totalInserted} signals inserted for ${results.filter(r => r.success).length} symbols`);

    return new Response(JSON.stringify({ inserted: totalInserted, symbols: results.length, offset: batchOffset, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
