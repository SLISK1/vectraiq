

# Integrera Perplexity for djupare tillgangsanalys

## Nulagsbild

Idag anvander `ai-analysis` edge function enbart:
- **news_cache** (GNews-rubriker) for sentimentanalys
- **Prishistorik** (fran klienten) for ML och monsterigenkanning
- **Gemini LLM** for att tolka data och generera JSON-signaler

Det saknas realtidsinformation om nyheter, analytikerrapporter, sektorutveckling och makrotrender som paverkar enskilda tillgangar. Perplexity kan fylla detta gap genom att gora en AI-driven webbsokning for varje tillgang och returnera ett grundat svar med kallor.

## Plan

### 1. Anslut Perplexity-connectorn
Perplexity ar tillganglig som connector men inte ansluten till projektet annu. Forsta steget ar att koppla den, vilket gor `PERPLEXITY_API_KEY` tillganglig som miljovariabel i edge functions.

### 2. Lagg till Perplexity-sokning i `ai-analysis` edge function
For varje analystyp (sentiment, ml_prediction, pattern_recognition), gor ett Perplexity-anrop fore Gemini-steget. Sokfrasen anpassas efter tillgangstyp:

| Tillgangstyp | Sokfraga |
|-------------|----------|
| Aktie | `"{ticker}" "{name}" stock analysis outlook earnings news {year}` |
| Krypto | `"{ticker}" crypto price prediction analysis market sentiment {year}` |
| Metall | `"{ticker}" {name} commodity price forecast supply demand {year}` |
| Fond | `"{name}" fund performance holdings analysis {year}` |

Parametrar:
- Modell: `sonar`
- `search_recency_filter: "week"` for ferska resultat
- `max_tokens: 500` for att halla svarstiden nere

### 3. Injicera Perplexity-kontext i Gemini-prompten
Perplexitys svar + citations laggs till i user-prompten som en ny sektion:

```
WEBBANALYS (Perplexity Search):
{perplexity_response}

Källor: {citation_urls}
```

Detta ger Gemini konkret, grundad information att basera sin analys pa istallet for att gissa.

### 4. Utoka assetType for att stodja fonder
Lagg till `'fund'` som giltig assetType i valideringen och i prompt-bygget. Fonder saknar traditionella nyckeltal men Perplexity kan hamta NAV-utveckling, innehavsforandringar och fondbetyg.

### 5. Fallback vid Perplexity-fel
Om Perplexity-anropet misslyckas (timeout, rate limit, nyckel saknas) fortsatter analysen utan den extra kontexten -- samma beteende som idag. Logga felet for diagnostik.

### 6. Uppdatera evidence med kallor
Perplexity returnerar `citations[]` (URL-lista). Dessa laggs till i evidence-listan fran Gemini som en extra post:

```json
{
  "type": "web_research",
  "description": "Realtidsdata fran webbsokning",
  "value": "3 kallor analyserade",
  "source": "Perplexity Search"
}
```

## Tekniska detaljer

### Fil som andras
- `supabase/functions/ai-analysis/index.ts`

### Nytt flode i edge function

```text
1. Validera input + auth (oforandrat)
2. [NY] Gor Perplexity-sokning parallellt med news_cache-hamtning
3. Bygg system/user-prompt MED Perplexity-kontext
4. Anropa Gemini (oforandrat)
5. Returnera resultat med utokad evidence
```

### Perplexity API-anrop (i edge function)
```text
POST https://api.perplexity.ai/chat/completions
Headers: Authorization: Bearer ${PERPLEXITY_API_KEY}
Body: {
  model: "sonar",
  messages: [{ role: "user", content: searchQuery }],
  search_recency_filter: "week",
  max_tokens: 500
}
Response: { choices: [{ message: { content: "..." } }], citations: ["url1", "url2"] }
```

### Paverkan pa prestanda
- Perplexity-anropet tar ~1-3 sekunder
- Kors parallellt med news_cache-hamtning sa total extra latens ar minimal
- Haller max_tokens lagt (500) for snabb respons

### Ingen databasandring kravs
All data floder genom edge function -> klient. Inga nya tabeller eller kolumner behovs.

