import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AnalysisRequest {
  type: 'sentiment' | 'ml_prediction' | 'pattern_recognition' | 'deep_analysis';
  ticker: string;
  name: string;
  assetType: 'stock' | 'crypto' | 'metal';
  horizon: string;
  priceHistory?: { price: number; timestamp: string }[];
  currentPrice?: number;
}

// Fetch financial analyses via Firecrawl Search
async function fetchFirecrawlAnalyses(ticker: string, companyName: string, assetType: string): Promise<string> {
  const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
  if (!FIRECRAWL_API_KEY) {
    console.log('FIRECRAWL_API_KEY not configured, skipping Firecrawl search');
    return '';
  }

  try {
    const searchTerms = assetType === 'crypto'
      ? `${companyName} crypto analysis price prediction`
      : `${companyName} ${ticker} stock analysis quarterly earnings forecast`;

    console.log(`Firecrawl search: "${searchTerms}"`);

    const response = await fetch('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: searchTerms,
        limit: 5,
        lang: 'en',
        tbs: 'qdr:w', // Last week
        scrapeOptions: { formats: ['markdown'] },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Firecrawl search error: ${response.status}`, errText);
      return '';
    }

    const data = await response.json();
    const results = data?.data || [];

    if (results.length === 0) return '';

    // Extract relevant snippets (max ~800 chars per result to stay within prompt limits)
    const snippets = results
      .filter((r: any) => r.markdown || r.description)
      .slice(0, 3)
      .map((r: any, i: number) => {
        const content = (r.markdown || r.description || '').substring(0, 800);
        const source = r.url ? new URL(r.url).hostname : 'unknown';
        const title = r.title || 'Untitled';
        return `[${i + 1}. ${title} — ${source}]\n${content}`;
      })
      .join('\n\n');

    console.log(`Firecrawl: got ${results.length} results, using ${Math.min(3, results.length)}`);
    return snippets;
  } catch (e) {
    console.error('Firecrawl search failed:', e);
    return '';
  }
}

// Fetch recent news from news_cache for a ticker
async function getRecentNews(ticker: string, supabase: any): Promise<string> {
  try {
    const { data } = await supabase
      .from('news_cache')
      .select('title, description, source_name, published_at')
      .eq('ticker', ticker)
      .order('published_at', { ascending: false })
      .limit(5);

    if (!data || data.length === 0) return '';

    return data.map((n: any) => {
      const date = n.published_at ? new Date(n.published_at).toLocaleDateString('sv-SE') : '';
      return `- [${n.source_name}${date ? ` ${date}` : ''}] ${n.title}${n.description ? ': ' + n.description.substring(0, 150) : ''}`;
    }).join('\n');
  } catch {
    return '';
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // === AUTHENTICATION CHECK ===
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Validate the JWT token
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getUser(token);
    
    if (claimsError || !claimsData?.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === API KEY CHECK ===
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // === INPUT VALIDATION ===
    const body = await req.json();
    const { type, ticker, name, assetType, horizon, priceHistory, currentPrice }: AnalysisRequest = body;

    if (!type || !ticker || !name || !assetType || !horizon) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!['sentiment', 'ml_prediction', 'pattern_recognition', 'deep_analysis'].includes(type)) {
      return new Response(JSON.stringify({ error: "Invalid analysis type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!/^[A-Z0-9_.-]{1,20}$/i.test(ticker)) {
      return new Response(JSON.stringify({ error: "Invalid ticker format" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create service-role client for DB reads
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let systemPrompt = "";
    let userPrompt = "";

    switch (type) {
      case 'sentiment': {
        // Fetch real news from news_cache
        const newsText = await getRecentNews(ticker, supabase);
        const hasRealNews = newsText.length > 0;

        // Fetch financial analyses via Firecrawl
        const firecrawlSentiment = await fetchFirecrawlAnalyses(ticker, name, assetType);
        const hasFirecrawl = firecrawlSentiment.length > 0;

        systemPrompt = `Du är en finansanalytiker specialiserad på sentimentanalys för den svenska och globala marknaden. 
${hasRealNews ? 'Du har tillgång till riktiga nyhetsrubriker nedan. Basera din analys på dessa nyheter.' : 'Inga nyheter hittades. Basera din analys på allmänt marknadssentiment.'}
${hasFirecrawl ? 'Du har även tillgång till utdrag från aktuella finansanalyser nedan.' : ''}
Svara ENDAST med ett JSON-objekt i exakt detta format:
{
  "direction": "UP" | "DOWN" | "NEUTRAL",
  "strength": <number 0-100>,
  "confidence": <number 0-100>,
  "newsScore": <number -100 to 100>,
  "socialScore": <number -100 to 100>,
  "analystRating": "strong_buy" | "buy" | "hold" | "sell" | "strong_sell",
  "evidence": [
    { "type": "sentiment", "description": "<kort beskrivning>", "value": "<värde>", "source": "<källa>" }
  ]
}`;
        userPrompt = `Analysera sentiment för ${ticker} (${name}), en ${assetType === 'stock' ? 'aktie' : assetType === 'crypto' ? 'kryptovaluta' : 'råvara'}.
Horisont: ${horizon}
${currentPrice ? `Aktuellt pris: ${currentPrice}` : ''}

${hasRealNews ? `SENASTE NYHETER:\n${newsText}\n` : 'Inga aktuella nyheter tillgängliga.'}

${hasFirecrawl ? `FINANSANALYSER (från webben):\n${firecrawlSentiment}\n` : ''}

${hasRealNews || hasFirecrawl ? 'Analysera sentimentet i ovanstående material. Identifiera positiva och negativa signaler.' : 'Ge en neutral basestimering.'}

OBS: Var realistisk och balanserad. Ge inte för extrema värden.${hasRealNews ? ' Referera specifikt till nyheterna i din evidence.' : ''}${hasFirecrawl ? ' Referera till finansanalyserna i din evidence.' : ''}`;
        break;
      }

      case 'ml_prediction': {
        systemPrompt = `Du är en kvantitativ analytiker som använder machine learning för finansiella prognoser.
Baserat på prishistoriken och tillgångsinformationen, ge en ML-baserad prediktion.
Svara ENDAST med ett JSON-objekt i exakt detta format:
{
  "direction": "UP" | "DOWN" | "NEUTRAL",
  "strength": <number 0-100>,
  "confidence": <number 0-100>,
  "predictedReturn": <number i procent>,
  "modelFeatures": ["<feature1>", "<feature2>", ...],
  "evidence": [
    { "type": "ml_signal", "description": "<kort beskrivning>", "value": "<värde>", "source": "ML Model" }
  ]
}`;
        
        const priceDataSummary = priceHistory && priceHistory.length > 0 
          ? `Senaste ${priceHistory.length} prispunkter:
Start: ${priceHistory[0].price} (${priceHistory[0].timestamp})
Slut: ${priceHistory[priceHistory.length - 1].price} (${priceHistory[priceHistory.length - 1].timestamp})
Högsta: ${Math.max(...priceHistory.map(p => p.price))}
Lägsta: ${Math.min(...priceHistory.map(p => p.price))}
Förändring: ${((priceHistory[priceHistory.length - 1].price / priceHistory[0].price - 1) * 100).toFixed(2)}%`
          : 'Ingen prishistorik tillgänglig';

        userPrompt = `Analysera ${ticker} (${name}) med ML-modeller.
Tillgångstyp: ${assetType}
Horisont: ${horizon}
${currentPrice ? `Aktuellt pris: ${currentPrice}` : ''}

Prisdata:
${priceDataSummary}

Ge en ML-baserad prognos med features som momentum, volatilitet, trendstyrka och säsongsmönster.`;
        break;
      }

      case 'pattern_recognition': {
        systemPrompt = `Du är en expert på teknisk analys och mönsterigenkänning i finansiella marknader.
Identifiera chartmönster och ge en bedömning.
Svara ENDAST med ett JSON-objekt i exakt detta format:
{
  "direction": "UP" | "DOWN" | "NEUTRAL",
  "strength": <number 0-100>,
  "confidence": <number 0-100>,
  "patterns": [
    { "name": "<mönsternamn>", "type": "bullish" | "bearish" | "neutral", "reliability": <number 0-100> }
  ],
  "evidence": [
    { "type": "pattern", "description": "<kort beskrivning>", "value": "<värde>", "source": "Pattern Analysis" }
  ]
}`;

        const patternPriceData = priceHistory && priceHistory.length > 0
          ? `Prissekvens (senaste ${Math.min(20, priceHistory.length)} punkter):
${priceHistory.slice(-20).map(p => p.price).join(', ')}`
          : 'Ingen prishistorik tillgänglig';

        userPrompt = `Analysera chartmönster för ${ticker} (${name}).
Tillgångstyp: ${assetType}
Horisont: ${horizon}

${patternPriceData}

Identifiera eventuella mönster som:
- Head and Shoulders / Omvänd H&S
- Dubbel topp/botten
- Trianglar (stigande, fallande, symmetriska)
- Flaggor och vimplar
- Cup and Handle`;
        break;
      }

      case 'deep_analysis': {
        const newsText = await getRecentNews(ticker, supabase);
        const hasRealNews = newsText.length > 0;

        // Fetch financial analyses via Firecrawl
        const firecrawlDeep = await fetchFirecrawlAnalyses(ticker, name, assetType);
        const hasFirecrawlDeep = firecrawlDeep.length > 0;

        // Fetch fundamentals from symbols metadata
        const { data: symbolData } = await supabase
          .from('symbols')
          .select('metadata, sector, exchange')
          .eq('ticker', ticker)
          .single();

        const fundamentals = (symbolData?.metadata as any)?.fundamentals || {};
        const sector = symbolData?.sector || 'Okänd';

        const fundSection = Object.keys(fundamentals).length > 0
          ? `FUNDAMENTA:\n- P/E: ${fundamentals.peRatio ?? 'N/A'}\n- P/B: ${fundamentals.pbRatio ?? 'N/A'}\n- ROE: ${fundamentals.roe ?? 'N/A'}\n- Revenue Growth: ${fundamentals.revenueGrowth ?? 'N/A'}\n- Dividend Yield: ${fundamentals.dividendYield ?? 'N/A'}\n- Debt/Equity: ${fundamentals.debtToEquity ?? 'N/A'}`
          : 'FUNDAMENTA: Ej tillgänglig';

        const priceDataSummary = priceHistory && priceHistory.length > 0
          ? `PRISDATA (${priceHistory.length} datapunkter):\nStart: ${priceHistory[0].price} (${priceHistory[0].timestamp})\nSlut: ${priceHistory[priceHistory.length - 1].price} (${priceHistory[priceHistory.length - 1].timestamp})\nHögsta: ${Math.max(...priceHistory.map(p => p.price))}\nLägsta: ${Math.min(...priceHistory.map(p => p.price))}\nFörändring: ${((priceHistory[priceHistory.length - 1].price / priceHistory[0].price - 1) * 100).toFixed(2)}%`
          : 'Ingen prishistorik tillgänglig';

        systemPrompt = `Du är en senior investeringsanalytiker som ger djupa, nyanserade aktieanalyser. Du kombinerar teknisk analys, fundamental analys och sentimentanalys till en helhetsbild. Skriv på svenska.
${hasFirecrawlDeep ? 'Du har tillgång till utdrag från aktuella finansanalyser och rapporter. Använd dessa som komplement.' : ''}

Svara ENDAST med ett JSON-objekt i exakt detta format:
{
  "direction": "UP" | "DOWN" | "NEUTRAL",
  "strength": <number 0-100>,
  "confidence": <number 0-100>,
  "summary": "<2-3 meningars sammanfattning>",
  "deep_reasoning": "<3-5 stycken djupanalys på svenska>",
  "value_rating": <1-10>,
  "risk_factors": ["<risk1>", "<risk2>", ...],
  "catalysts": ["<katalysator1>", "<katalysator2>", ...],
  "price_targets": { "bear": <number>, "base": <number>, "bull": <number> },
  "recommendation": "strong_buy" | "buy" | "hold" | "sell" | "strong_sell",
  "evidence": [
    { "type": "deep_analysis", "description": "<kort beskrivning>", "value": "<värde>", "source": "GPT-5 Deep Analysis" }
  ]
}`;

        userPrompt = `Ge en djupanalys av ${ticker} (${name}).
Tillgångstyp: ${assetType === 'stock' ? 'aktie' : assetType === 'crypto' ? 'kryptovaluta' : 'råvara'}
Sektor: ${sector}
Horisont: ${horizon}
${currentPrice ? `Aktuellt pris: ${currentPrice}` : ''}

${priceDataSummary}

${fundSection}

${hasRealNews ? `SENASTE NYHETER:\n${newsText}` : 'Inga nyheter tillgängliga.'}

${hasFirecrawlDeep ? `FINANSANALYSER (från webben):\n${firecrawlDeep}` : ''}

INSTRUKTIONER:
1. Kombinera teknisk, fundamental och sentimentanalys
2. Identifiera 2-3 huvudsakliga risker och katalysatorer
3. Ge pristargets för bear/base/bull scenario
4. Bedöm value rating (1=övervärderad, 10=kraftigt undervärderad)
5. Var ärlig om osäkerhet och databegränsningar
${hasFirecrawlDeep ? '6. Referera till externa analyser och rapporter i din bedömning' : ''}`;
        break;
      }

      default:
        throw new Error(`Unknown analysis type: ${type}`);
    }

    // Use GPT-5.2 for deep analysis (enhanced reasoning), Gemini for others
    const model = type === 'deep_analysis' ? 'openai/gpt-5.2' : 'google/gemini-3-flash-preview';
    const maxTokens = type === 'deep_analysis' ? 4000 : 1000;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: type === 'deep_analysis' ? 0.4 : 0.3,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(JSON.stringify({ 
          error: "Rate limit exceeded. Please try again later.",
          code: "RATE_LIMITED"
        }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      if (response.status === 402) {
        return new Response(JSON.stringify({ 
          error: "AI usage limit reached. Please add credits.",
          code: "PAYMENT_REQUIRED"
        }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const aiResponse = await response.json();
    const content = aiResponse.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("Empty response from AI");
    }

    // Parse JSON from response
    let analysisResult;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (parseError) {
      console.error("Failed to parse AI response:", content);
      throw new Error("Failed to parse AI response as JSON");
    }

    return new Response(JSON.stringify({
      success: true,
      type,
      ticker,
      result: analysisResult,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("AI analysis error:", error);
    return new Response(JSON.stringify({ 
      success: false,
      error: error instanceof Error ? error.message : "Unknown error" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
