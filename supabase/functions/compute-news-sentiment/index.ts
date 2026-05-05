import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Lexicon-based sentiment scorer.
// Swedish + English financial terms. Each entry: weight in [-1.0, +1.0].
const LEXICON: Record<string, number> = {
  // Bullish — English
  'beat': 0.6, 'beats': 0.6, 'surge': 0.7, 'surges': 0.7, 'rally': 0.6, 'rallies': 0.6,
  'soar': 0.8, 'soars': 0.8, 'jump': 0.5, 'jumps': 0.5, 'gain': 0.4, 'gains': 0.4,
  'upgrade': 0.6, 'upgraded': 0.6, 'outperform': 0.7, 'bullish': 0.7, 'breakout': 0.6,
  'record': 0.5, 'profit': 0.4, 'profits': 0.4, 'growth': 0.4, 'expand': 0.3, 'expands': 0.3,
  'acquire': 0.4, 'acquires': 0.4, 'partnership': 0.3, 'launch': 0.3, 'launches': 0.3,
  'win': 0.4, 'wins': 0.4, 'approve': 0.4, 'approved': 0.4, 'approval': 0.4,
  'dividend': 0.3, 'buyback': 0.5, 'guidance': 0.2, 'raises': 0.4, 'raised': 0.4,
  'milestone': 0.4, 'breakthrough': 0.6, 'strong': 0.4, 'robust': 0.4, 'momentum': 0.3,

  // Bearish — English
  'miss': -0.6, 'misses': -0.6, 'plunge': -0.8, 'plunges': -0.8, 'crash': -0.9, 'crashes': -0.9,
  'fall': -0.4, 'falls': -0.4, 'drop': -0.5, 'drops': -0.5, 'tumble': -0.7, 'tumbles': -0.7,
  'downgrade': -0.6, 'downgraded': -0.6, 'underperform': -0.7, 'bearish': -0.7,
  'loss': -0.5, 'losses': -0.5, 'decline': -0.4, 'declines': -0.4, 'cut': -0.5, 'cuts': -0.5,
  'lawsuit': -0.5, 'investigation': -0.6, 'probe': -0.5, 'fraud': -0.9, 'scandal': -0.8,
  'bankruptcy': -0.9, 'default': -0.8, 'recall': -0.6, 'warning': -0.5, 'warned': -0.5,
  'layoff': -0.5, 'layoffs': -0.5, 'restructure': -0.3, 'delay': -0.4, 'delays': -0.4,
  'weak': -0.4, 'weakness': -0.4, 'concern': -0.3, 'concerns': -0.3, 'risk': -0.2, 'risks': -0.2,
  'recession': -0.7, 'crisis': -0.7, 'shortfall': -0.6, 'lower': -0.3, 'lowered': -0.4,

  // Bullish — Swedish
  'stiger': 0.5, 'stigit': 0.5, 'rusar': 0.7, 'rusat': 0.7, 'ökar': 0.4, 'ökat': 0.4,
  'höjer': 0.4, 'höjt': 0.4, 'rekord': 0.5, 'vinst': 0.4, 'vinster': 0.4, 'tillväxt': 0.4,
  'köp': 0.5, 'köprekommendation': 0.7, 'överträffar': 0.6, 'överträffat': 0.6,
  'genombrott': 0.6, 'starka': 0.4, 'stark': 0.4, 'positiv': 0.3, 'positivt': 0.3,
  'lansering': 0.3, 'lanserar': 0.3, 'expanderar': 0.3, 'utdelning': 0.3,

  // Bearish — Swedish
  'faller': -0.4, 'fallit': -0.4, 'rasar': -0.8, 'rasat': -0.8, 'minskar': -0.4,
  'sänker': -0.4, 'sänkt': -0.4, 'förlust': -0.5, 'förluster': -0.5, 'nedskrivning': -0.6,
  'sälj': -0.5, 'säljrekommendation': -0.7, 'missar': -0.6, 'missat': -0.6,
  'varnar': -0.5, 'varning': -0.5, 'utredning': -0.5, 'konkurs': -0.9, 'bedrägeri': -0.9,
  'svaga': -0.4, 'svag': -0.4, 'negativ': -0.3, 'negativt': -0.3, 'oro': -0.4,
  'kris': -0.7, 'recession': -0.7, 'lågkonjunktur': -0.6,
};

// Negation words that flip the next 3 words' sentiment
const NEGATIONS = new Set(['not', 'no', 'never', 'without', 'inte', 'ingen', 'inga', 'aldrig', 'utan']);

// Intensifiers that boost the next word
const INTENSIFIERS: Record<string, number> = {
  'very': 1.4, 'extremely': 1.6, 'massive': 1.5, 'huge': 1.4, 'significant': 1.3,
  'mycket': 1.4, 'extremt': 1.6, 'kraftig': 1.5, 'kraftigt': 1.5, 'stort': 1.3, 'stor': 1.3,
};

interface ArticleScore {
  score: number;          // -1..+1
  magnitude: number;      // sum of abs(scores) for hits, normalized
  hits: number;
}

function scoreText(text: string): ArticleScore {
  if (!text) return { score: 0, magnitude: 0, hits: 0 };
  const tokens = text.toLowerCase().replace(/[^\p{L}\s-]/gu, ' ').split(/\s+/).filter(Boolean);

  let total = 0;
  let absTotal = 0;
  let hits = 0;
  let negationDistance = 0;
  let pendingIntensifier = 1.0;

  for (const token of tokens) {
    if (NEGATIONS.has(token)) {
      negationDistance = 3;
      continue;
    }
    if (INTENSIFIERS[token]) {
      pendingIntensifier = INTENSIFIERS[token];
      continue;
    }

    const base = LEXICON[token];
    if (base !== undefined) {
      const sign = negationDistance > 0 ? -1 : 1;
      const value = base * sign * pendingIntensifier;
      total += value;
      absTotal += Math.abs(value);
      hits++;
      pendingIntensifier = 1.0;
    } else if (pendingIntensifier !== 1.0) {
      // Intensifier didn't attach to a sentiment word — drop it after 1 token
      pendingIntensifier = 1.0;
    }

    if (negationDistance > 0) negationDistance--;
  }

  if (hits === 0) return { score: 0, magnitude: 0, hits: 0 };

  // Average score per hit, clamped to [-1, +1]
  const avgScore = total / hits;
  return {
    score: Math.max(-1, Math.min(1, avgScore)),
    magnitude: Math.min(1, absTotal / Math.max(1, hits) / 0.7),
    hits,
  };
}

// Recency weight: newer articles count more (half-life ~3 days)
function recencyWeight(publishedAt: string | null): number {
  if (!publishedAt) return 0.5;
  const ageHours = (Date.now() - new Date(publishedAt).getTime()) / 3_600_000;
  if (ageHours < 0) return 1.0;
  return Math.pow(0.5, ageHours / 72);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const sb = createClient(supabaseUrl, serviceKey);

    let tickers: string[] = [];
    try {
      const body = await req.json();
      if (body?.tickers && Array.isArray(body.tickers)) tickers = body.tickers;
      else if (body?.ticker) tickers = [body.ticker];
    } catch { /* no body — process all */ }

    if (tickers.length === 0) {
      const { data: distinct } = await sb
        .from('news_cache')
        .select('ticker')
        .gte('fetched_at', new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString());
      tickers = Array.from(new Set((distinct || []).map(r => r.ticker)));
    }

    if (tickers.length === 0) {
      return new Response(JSON.stringify({ processed: 0, reason: 'no recent news' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const upserts: Array<Record<string, unknown>> = [];

    for (const ticker of tickers) {
      const { data: articles } = await sb
        .from('news_cache')
        .select('title, description, published_at')
        .eq('ticker', ticker)
        .gte('fetched_at', new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString());

      if (!articles || articles.length === 0) continue;

      let weightedScore = 0;
      let totalWeight = 0;
      let totalMag = 0;
      let posCount = 0;
      let negCount = 0;
      const themes: Record<string, number> = {};

      for (const a of articles) {
        const text = `${a.title || ''} ${a.description || ''}`;
        const result = scoreText(text);
        if (result.hits === 0) continue;

        const w = recencyWeight(a.published_at);
        weightedScore += result.score * w;
        totalWeight += w;
        totalMag += result.magnitude;
        if (result.score > 0.1) posCount++;
        else if (result.score < -0.1) negCount++;

        // Track top themes (most-hit lexicon words for explainability)
        const tokens = text.toLowerCase().replace(/[^\p{L}\s-]/gu, ' ').split(/\s+/);
        for (const t of tokens) if (LEXICON[t]) themes[t] = (themes[t] || 0) + 1;
      }

      if (totalWeight === 0) continue;

      const finalScore = weightedScore / totalWeight;
      const finalMag = totalMag / articles.length;
      const topThemes = Object.entries(themes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([k, v]) => ({ word: k, count: v, polarity: LEXICON[k] }));

      upserts.push({
        ticker,
        score: Math.round(finalScore * 1000) / 1000,
        magnitude: Math.round(finalMag * 1000) / 1000,
        article_count: articles.length,
        positive_count: posCount,
        negative_count: negCount,
        top_themes: topThemes,
        updated_at: new Date().toISOString(),
      });
    }

    if (upserts.length > 0) {
      const { error } = await sb
        .from('news_sentiment_cache')
        .upsert(upserts, { onConflict: 'ticker' });
      if (error) throw error;
    }

    return new Response(JSON.stringify({ processed: upserts.length, tickers: tickers.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
