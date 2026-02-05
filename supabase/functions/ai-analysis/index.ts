const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AnalysisRequest {
  type: 'sentiment' | 'ml_prediction' | 'pattern_recognition';
  ticker: string;
  name: string;
  assetType: 'stock' | 'crypto' | 'metal';
  horizon: string;
  priceHistory?: { price: number; timestamp: string }[];
  currentPrice?: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const { type, ticker, name, assetType, horizon, priceHistory, currentPrice }: AnalysisRequest = await req.json();

    let systemPrompt = "";
    let userPrompt = "";

    switch (type) {
      case 'sentiment':
        systemPrompt = `Du är en finansanalytiker specialiserad på sentimentanalys för den svenska och globala marknaden. 
Analysera tillgången och ge en strukturerad sentimentbedömning.
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

Ge en realistisk sentimentbedömning baserat på:
- Allmänt marknadssentiment för denna typ av tillgång
- Typiska nyhetsflöden och analytikerbetyg
- Sociala medier-trender

OBS: Var realistisk och balanserad. Ge inte för extrema värden.`;
        break;

      case 'ml_prediction':
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

      case 'pattern_recognition':
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

      default:
        throw new Error(`Unknown analysis type: ${type}`);
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 1000,
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
