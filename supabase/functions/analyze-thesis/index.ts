import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================
// LLM-based strategic thesis analysis
// Uses Lovable AI Gateway with google/gemini-3-flash-preview (cheapest path).
// Each call costs ~$0.005. Hard-cap at $10/month via thesis_analysis_budget.
// ============================================================

const KNOWN_THEMES = [
  'cleantech', 'nuclear', 'energy_storage', 'electrification',
  'ai', 'cybersecurity', 'quantum',
  'robotics', 'autonomous',
  'biotech', 'healthtech', 'longevity', 'glp1_obesity',
  'fintech', 'space', 'defense',
  'consumer', 'agtech', 'water',
] as const;

const SYSTEM_PROMPT = `You are a senior equity research analyst evaluating companies for long-term growth potential.

Analyze the company holistically. Output STRICT JSON matching this schema, nothing else:

{
  "thesis_score": 0-100,
  "uniqueness_score": 0-10,
  "moat_score": 0-10,
  "market_size": "small" | "medium" | "large" | "massive",
  "themes": ["theme1", "theme2"],
  "thesis_summary": "1-2 paragraphs explaining your reasoning, in Swedish",
  "key_risks": ["risk1", "risk2", "risk3"],
  "catalysts": ["catalyst1", "catalyst2"]
}

Scoring guidelines:
- thesis_score 80-100: Genuinely unique product solving a massive global problem with strong moat. Examples: ASML for advanced chips, NVO for GLP-1 weight loss.
- thesis_score 60-79: Strong product in a growing market with defensible position. Examples: ISRG, ENPH.
- thesis_score 40-59: Solid business but commoditized or facing competition. Examples: most banks, utilities.
- thesis_score 20-39: Weak position, declining industry, or speculative pre-revenue.
- thesis_score 0-19: Distressed or fraud-risk.

Themes must come from this fixed list: ${KNOWN_THEMES.join(', ')}.

Be intellectually honest:
- Discount hype. A great narrative without revenue or moat is risky.
- Pre-revenue companies should rarely score above 60 unless the product is truly breakthrough.
- Consider survivorship bias — many "next big thing" companies fail.
- Markets price in known information. Your edge is identifying mis-priced strategic positioning, not predicting the future.`;

interface ThesisResult {
  thesis_score: number;
  uniqueness_score: number;
  moat_score: number;
  market_size: string;
  themes: string[];
  thesis_summary: string;
  key_risks: string[];
  catalysts: string[];
}

function validateThesis(raw: unknown): ThesisResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, def: number, min: number, max: number) => {
    const n = Number(v);
    if (isNaN(n)) return def;
    return Math.max(min, Math.min(max, n));
  };
  const arr = (v: unknown): string[] => Array.isArray(v) ? v.map(String).slice(0, 5) : [];
  const validMarketSize = ['small', 'medium', 'large', 'massive'];
  return {
    thesis_score: num(r.thesis_score, 50, 0, 100),
    uniqueness_score: num(r.uniqueness_score, 5, 0, 10),
    moat_score: num(r.moat_score, 5, 0, 10),
    market_size: validMarketSize.includes(String(r.market_size)) ? String(r.market_size) : 'medium',
    themes: arr(r.themes).filter(t => (KNOWN_THEMES as readonly string[]).includes(t)),
    thesis_summary: String(r.thesis_summary || '').slice(0, 2000),
    key_risks: arr(r.key_risks),
    catalysts: arr(r.catalysts),
  };
}

async function checkAndConsumeBudget(
  sb: ReturnType<typeof createClient>,
  estimatedCostUsd: number
): Promise<{ ok: boolean; reason?: string; budget?: { used: number; cap: number } }> {
  const monthKey = new Date().toISOString().substring(0, 7); // YYYY-MM

  // Get current budget row
  const { data: row } = await sb
    .from('thesis_analysis_budget')
    .select('*')
    .eq('month_key', monthKey)
    .maybeSingle();

  const cap = row ? Number((row as Record<string, unknown>).budget_cap_usd || 10) : 10;
  const usedSoFar = row ? Number((row as Record<string, unknown>).estimated_cost_usd || 0) : 0;
  const callsSoFar = row ? Number((row as Record<string, unknown>).calls_used || 0) : 0;

  if (usedSoFar + estimatedCostUsd > cap) {
    return { ok: false, reason: `Budget cap reached: $${usedSoFar.toFixed(3)}/$${cap}`, budget: { used: usedSoFar, cap } };
  }

  // Optimistically consume budget BEFORE calling LLM (to prevent races)
  const { error } = await sb
    .from('thesis_analysis_budget')
    .upsert({
      month_key: monthKey,
      calls_used: callsSoFar + 1,
      estimated_cost_usd: usedSoFar + estimatedCostUsd,
      budget_cap_usd: cap,
      last_updated: new Date().toISOString(),
    }, { onConflict: 'month_key' });

  if (error) {
    console.error('Budget upsert failed:', error);
    // Don't block on budget tracking failure — just log
  }

  return { ok: true, budget: { used: usedSoFar + estimatedCostUsd, cap } };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

    // === AUTH GUARD: require service-role key or valid user JWT ===
    {
      const _authHeader = req.headers.get('authorization') || '';
      const _token = _authHeader.replace(/^Bearer\s+/i, '');
      const _serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
      if (!_token) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (_token !== _serviceKey) {
        try {
          const _authClient = (await import('npm:@supabase/supabase-js@2')).createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_ANON_KEY')!,
          );
          const { data: { user } } = await _authClient.auth.getUser(_token);
          if (!user) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }
        } catch {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }
    }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableKey = Deno.env.get('LOVABLE_API_KEY');

    if (!lovableKey) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sb = createClient(supabaseUrl, serviceKey);

    let body: { ticker?: string; tickers?: string[]; force?: boolean; trigger_reason?: string } = {};
    try {
      body = await req.json();
    } catch { /* no body */ }

    const tickers = body.tickers || (body.ticker ? [body.ticker] : []);
    const force = !!body.force;
    const triggerReason = body.trigger_reason || 'on_demand';

    if (tickers.length === 0) {
      return new Response(JSON.stringify({ error: 'Provide ticker or tickers in body' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results: Array<{ ticker: string; status: string; thesis_score?: number; reason?: string }> = [];
    const ESTIMATED_COST_PER_CALL = 0.005; // ~$0.005 per Gemini Flash call

    for (const ticker of tickers) {
      // Check cache freshness — skip if recent (60d) unless force=true
      if (!force) {
        const { data: cached } = await sb
          .from('strategic_thesis_cache')
          .select('updated_at, thesis_score')
          .eq('ticker', ticker)
          .maybeSingle();
        if (cached) {
          const ageDays = (Date.now() - new Date((cached as Record<string, unknown>).updated_at as string).getTime()) / (1000 * 60 * 60 * 24);
          if (ageDays < 60) {
            results.push({ ticker, status: 'cached', thesis_score: Number((cached as Record<string, unknown>).thesis_score) });
            continue;
          }
        }
      }

      // Budget check
      const budgetCheck = await checkAndConsumeBudget(sb, ESTIMATED_COST_PER_CALL);
      if (!budgetCheck.ok) {
        results.push({ ticker, status: 'budget_exhausted', reason: budgetCheck.reason });
        break; // Stop processing further tickers when budget is hit
      }

      // Pull symbol info
      const { data: symbol } = await sb
        .from('symbols')
        .select('ticker, name, asset_type, exchange, sector, currency, theme, risk_class, listing_date, metadata')
        .eq('ticker', ticker)
        .maybeSingle();

      if (!symbol) {
        results.push({ ticker, status: 'not_found' });
        continue;
      }

      // Pull recent news context
      const { data: news } = await sb
        .from('news_cache')
        .select('title, description, published_at')
        .eq('ticker', ticker)
        .order('published_at', { ascending: false })
        .limit(8);

      // Build user prompt
      const sym = symbol as Record<string, unknown>;
      const meta = (sym.metadata as Record<string, unknown>) || {};
      const fundamentals = (meta.fundamentals as Record<string, unknown>) || {};

      const newsContext = (news || [])
        .map((n: Record<string, unknown>) => `- ${n.title || ''}: ${(n.description as string || '').slice(0, 200)}`)
        .join('\n');

      const userPrompt = `Company: ${sym.name} (${sym.ticker})
Asset type: ${sym.asset_type}
Exchange: ${sym.exchange}
Sector: ${sym.sector || 'unknown'}
Pre-tagged theme: ${sym.theme || 'none'}
Risk class: ${sym.risk_class}
${sym.listing_date ? `Listed: ${sym.listing_date}` : ''}

Fundamentals (TTM):
- Market cap: ${fundamentals.marketCap || 'unknown'}
- P/E: ${fundamentals.peRatio || 'unknown'}
- ROE: ${fundamentals.roe || 'unknown'}%
- Revenue growth: ${fundamentals.revenueGrowth || 'unknown'}%
- Earnings growth: ${fundamentals.earningsGrowth || 'unknown'}%

Recent news headlines (last 7 days):
${newsContext || '(no recent news in cache)'}

Provide your strategic thesis as JSON. Respond ONLY with the JSON object, no markdown wrapping.`;

      // Call Lovable Gateway with Gemini Flash
      const llmResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${lovableKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-3-flash-preview',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 1200,
        }),
      });

      if (!llmResponse.ok) {
        const errText = await llmResponse.text();
        console.error(`LLM call failed for ${ticker}: ${llmResponse.status} ${errText}`);
        results.push({ ticker, status: 'llm_error', reason: `HTTP ${llmResponse.status}` });
        continue;
      }

      const llmData = await llmResponse.json();
      const content = llmData.choices?.[0]?.message?.content || '';

      // Strip markdown fences if present
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        results.push({ ticker, status: 'parse_error', reason: 'No JSON in response' });
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (e) {
        results.push({ ticker, status: 'parse_error', reason: String(e) });
        continue;
      }

      const validated = validateThesis(parsed);
      if (!validated) {
        results.push({ ticker, status: 'validation_failed' });
        continue;
      }

      // Upsert into cache
      const { error: upsertError } = await sb
        .from('strategic_thesis_cache')
        .upsert({
          ticker,
          thesis_score: validated.thesis_score,
          uniqueness_score: validated.uniqueness_score,
          moat_score: validated.moat_score,
          market_size: validated.market_size,
          themes: validated.themes,
          thesis_summary: validated.thesis_summary,
          key_risks: validated.key_risks,
          catalysts: validated.catalysts,
          model_used: 'google/gemini-3-flash-preview',
          trigger_reason: triggerReason,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'ticker' });

      if (upsertError) {
        console.error(`Upsert failed for ${ticker}:`, upsertError);
        results.push({ ticker, status: 'db_error', reason: upsertError.message });
        continue;
      }

      results.push({ ticker, status: 'analyzed', thesis_score: validated.thesis_score });

      // Throttle between LLM calls
      await new Promise(r => setTimeout(r, 300));
    }

    return new Response(JSON.stringify({
      processed: results.length,
      analyzed: results.filter(r => r.status === 'analyzed').length,
      cached: results.filter(r => r.status === 'cached').length,
      errors: results.filter(r => !['analyzed', 'cached'].includes(r.status)).length,
      results,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
