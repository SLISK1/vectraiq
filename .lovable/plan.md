
# Fler datakällor i matchanalysen

## Nuläge
`analyze-match` använder idag 4 källor:
- **Football-Data.org** - H2H, tabellposition, form
- **GNews** - 5 nyhetsartiklar
- **Firecrawl Search** - 3 webbartiklar med markdown-innehall (budgetbegransad)
- **The Odds API** - marknadsodds

Outnyttjade resurser:
- `NEWSAPI_KEY` - konfigurerad men oanvand i analysen
- Perplexity - tillganglig som connector, ger AI-sokning med kallhanvisningar

## Plan

### 1. Lagg till Perplexity som primarkalla for djupanalys
Perplexity gor en AI-driven webbsokning (i princip "Google + sammanfattning") och returnerar ett grundat svar med kallor. Detta ersatter behovet av att manuellt soka och tolka flera webbsidor.

- Anslut Perplexity-connectorn till projektet
- I `analyze-match/index.ts`, lagg till ett Perplexity-anrop som soker efter match-preview, skadeinfo och taktikanalys
- Anvand `sonar`-modellen med `search_recency_filter: 'week'` for att fa ferska resultat
- Inkludera citations i prompt-kontexten for AI:n

### 2. Lagg till NewsAPI som kompletterande nyhetskalla
`NEWSAPI_KEY` finns redan men anvands inte i analyze-match.

- Lagg till ett NewsAPI-anrop i `analyze-match/index.ts` (endpoint: `everything`)
- Sok efter `"{home_team}" AND "{away_team}"` senaste 7 dagarna
- Hamta upp till 5 artiklar, klassificera dem med befintlig `classifyArticle`-funktion
- Merga med GNews-artiklarna (deduplicera pa URL)

### 3. Uppdatera prompt-byggare
- Ny funktion `buildPerplexitySection()` som formaterar Perplexitys sammanfattning och kallor
- Utoka `buildNewsSection()` for att hantera artiklar fran bade GNews och NewsAPI
- Uppdatera evidence gating: Perplexity-svar med citations hojer confidence cap ytterligare

### 4. Uppdatera evidence gating och sources
- Perplexity-kallor laggs till i `sources[]` med typ "stats" eller "confirmed_fact" beroende pa innehall
- NewsAPI-kallor laggs till pa samma satt som GNews
- Om Perplexity returnerar skadeinfo setts `hasInjuryData = true`

## Tekniska detaljer

### Perplexity-integration (i edge function)
```text
POST https://api.perplexity.ai/chat/completions
{
  model: "sonar",
  messages: [{ role: "user", content: "{home} vs {away} {league} match preview injuries team news form" }],
  search_recency_filter: "week"
}
```
Returnerar: svar med `citations[]` (URL-lista) som kan anvandas som kallor.

### NewsAPI-integration
```text
GET https://newsapi.org/v2/everything?q="{home}" AND "{away}"&from={7dagar}&sortBy=relevancy&pageSize=5&apiKey={key}
```

### Ordning av datahemtning (parallelliserad)
Alla externa anrop (Football-Data H2H, standings, GNews, NewsAPI, Perplexity, Firecrawl, Odds) kors med `Promise.allSettled()` dar det ar mojligt for att minimera svarstid. Football-Data har rate-limit (6s) sa de forblir sekventiella.

### Paverkan pa Firecrawl-budget
Firecrawl behalles for hog-impact-matcher men Perplexity minskar beroendet av Firecrawl for vanliga matcher, vilket sparar Firecrawl-credits.

## Filer som andras
- `supabase/functions/analyze-match/index.ts` - lagg till Perplexity + NewsAPI, ny prompt-sektion, uppdaterad evidence gating
- Ingen databasandring kravs (sources_used ar redan JSONB)
