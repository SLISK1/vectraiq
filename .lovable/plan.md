
# Implementationsplan: Betting-flik (komplett)

## Nuläge
- Databastabellerna `betting_matches`, `betting_predictions`, `betting_watchlist` och `pool_tickets` finns redan (bekräftat i types.ts)
- `Header.tsx` och `Index.tsx` saknar ännu Betting-tab och routing
- Inga Betting-specifika Edge Functions eller React-komponenter existerar
- Secrets `FOOTBALL_DATA_API_KEY`, `FIRECRAWL_API_KEY` och `ODDS_API_KEY` saknas — läggs till som **första steg**

---

## Steg 1: Lägg till secrets (3 st)

Direkt när implementationen börjar används `add_secret`-verktyget för att begära:
- `FOOTBALL_DATA_API_KEY`
- `FIRECRAWL_API_KEY`
- `ODDS_API_KEY`

Utan dessa kan Edge Functions inte deployed fungera.

---

## Steg 2: Edge Functions (3 filer)

### `supabase/functions/fetch-matches/index.ts`

Hämtar och cachar matchdata från tre lager:

**Fotboll (football-data.org):**
- `GET https://api.football-data.org/v4/matches?dateFrom=TODAY&dateTo=TODAY+7`
- Header: `X-Auth-Token: FOOTBALL_DATA_API_KEY`
- Täcker PL, La Liga, Bundesliga, Serie A, Ligue 1, UCL, Allsvenskan
- Upsert i `betting_matches` med `external_id` som dedup-nyckel

**UFC (GNews-sökning):**
- Query: `"UFC fight card" OR "UFC event" next week`
- Parsar artiklar för att extrahera fighters och datum
- Skapar `betting_matches`-poster med `sport='ufc'`

**Firecrawl budget controller:**
- Hämtar `source_data.scrape_budget` från DB för dagens datum
- Räknar använda sidor; hoppar över om `>= 15 sidor/dag` (konservativt för 500/mån)
- Scraper bara "high-impact" matcher (PL, UCL, La Liga, UFC main events)
- URL-dedup: hoppar om `source_data.scraped_urls` innehåller URL med timestamp < 6h
- Scraper `goal.com` för fotboll, `mmafighting.com` för UFC (markdown-format)
- Lagrar scrapad data i `source_data` JSONB

**GNews per match:**
- Query: `"[home_team] vs [away_team]"` + `"injury OR lineup OR prediction"`
- Max 3 artiklar per match, lagras i `source_data.news`

**Auth:** Kontrollerar `x-internal-call` header eller service role JWT.

---

### `supabase/functions/analyze-match/index.ts`

Tar `match_id`, läser matchens `source_data`, kör Gemini med evidence gating.

**Evidence gating-logik:**
```
Klassificera varje källa i source_data:
  - "confirmed_fact": om källa är football-data.org API
  - "stats": H2H, tabellposition från API
  - "opinion": GNews artikel med ord som "tips", "prediction", "expert"
  - "news": övriga GNews-artiklar

Confidence cap-regler:
  base_confidence = AI:ns förslag (0-100)
  if no confirmed_fact AND no stats → cap 55
  if only opinion sources → cap 52
  if no injury_data in source_data → subtract 5 (min cap 40)
  if h2h_count < 3 → subtract 5 (min cap 40)
  final = min(base_confidence, applicable_cap)
```

**Gemini-prompt (evidence gated):**
Instruerar modellen att:
- Bara referera fakta som finns i `source_data`
- Citera `{url, date, type}` per påstående i `key_factors`
- Skriva "Inga [skador/lineups] bekräftade" om data saknas
- ALDRIG uppfinna statistik

**Odds-hämtning (The Odds API):**
- `GET https://api.the-odds-api.com/v4/sports/soccer_epl/odds?apiKey=...`
- Matchar mot `home_team`/`away_team` för att hitta rätt match
- Beräknar `implied_prob = (1/odds) / (1/home + 1/draw + 1/away)` (vig-normaliserat)
- `model_edge = predicted_prob - market_implied_prob`

**Output sparas i `betting_predictions`:**
```json
{
  "predicted_winner": "home|away|draw",
  "predicted_prob": 0.62,
  "confidence_raw": 71,
  "confidence_capped": 55,
  "cap_reason": "Inga bekräftade lineups",
  "key_factors": [{"factor": "...", "direction": "positive", "source": {...}}],
  "ai_reasoning": "...",
  "sources_used": [...],
  "market_odds_home": 1.85,
  "market_odds_draw": 3.40,
  "market_odds_away": 4.50,
  "market_implied_prob": 0.54,
  "model_edge": 0.08
}
```

**Auth:** Kräver giltig Bearer JWT (autentiserad användare).

---

### `supabase/functions/fetch-pool-tips/index.ts`

Hämtar aktuellt Topptipset/Stryktipset och genererar systemrad.

**Svenska Spel-scraping via Firecrawl:**
- URL: `https://www.svenskaspel.se/stryktipset` eller `/topptipset`
- Format: `json` med schema för att extrahera matcher, lag, datum, omgångsnummer
- Fallback: `markdown` format om JSON-schema misslyckas

**Per rad: Gemini-analys med GNews-kontext:**
- Söker nyheter för varje matchpar
- Kör confidence-cappat AI-förslag (1/X/2)

**System generator:**
```
Input: pool_type, max_rows (default 64), budget_sek
Per match:
  confidence > 70% → spik (🔒) — 1 tecken
  confidence 50-70% → halvgardering (⚖️) — 2 tecken  
  confidence < 50% → helgardering (🔄) — 3 tecken

Räknar totalt rader = produkt av alla tecken-val
Om total > max_rows:
  → Föreslår att ta bort helgarderingar med lägst confidence-skillnad
  → Beräknar ny total

Kostnad = system_size * 1 SEK (Topptipset), 0.50 SEK (Stryktipset)
```

---

## Steg 3: Frontend-komponenter (5 filer)

### `src/pages/BettingPage.tsx`

Huvudsida med:
- **Disclaimer-banner** (alltid synlig): "Spela ansvarsfullt. AI-prediktioner är inte garantier."
- **SportSelector** (Fotboll / UFC / Topptipset / Stryktipset) — egna knappar med ikoner
- **"Hämta matcher"-knapp** → anropar `fetch-matches`, visar loading spinner
- **MatchList** (för fotboll/UFC) — loopar `MatchCard`
- **PoolTipsCard** (för Topptipset/Stryktipset) — kupongvy
- **BacktestPanel** — fällbar sektion längst ned
- Hanterar tom state ("Inga matcher hämtade ännu")

State-hantering:
- `selectedSport: 'football' | 'ufc' | 'topptipset' | 'stryktipset'`
- `matches: BettingMatch[]` från Supabase-query på `betting_matches`
- `predictions: Map<string, BettingPrediction>` från `betting_predictions`
- `isLoading`, `isAnalyzing`

---

### `src/components/betting/MatchCard.tsx`

Glassmorphism-kort med:
- Hemmalag vs Bortalag (centrerat, stor text)
- Datum + liga-badge
- **Prediktion-sektion** (om prediction finns):
  - `ScoreRing` (befintlig komponent) med `confidence_capped`
  - Vinnarbadge: grön (hemmavinst) / röd (bortavinst) / gul (oavgjort)
  - `cap_reason` visas om confidence är cappat: "⚠️ Begränsad data"
  - **Market Edge-badge**: "+8% edge" i blå (positiv) / röd (negativ)
  - "Modell: 62% | Marknad: 54%"
- **"Analysera"-knapp** (om ingen prediction): triggar `analyze-match`
- **"Spara"-knapp** (inloggad): sparar till `betting_watchlist`
- Loading-state under analys

---

### `src/components/betting/MatchDetailModal.tsx`

Full-screen dialog med:
- **Header**: Lag, datum, liga
- **Prediktion-summary**: Vinnare + sannolikhet + konfidensring
- **Odds-jämförelse**: "Modell 62% | Marknad 54% | Edge +8%"
  - Odds från bookmakers visas (Home: 1.85 | Draw: 3.40 | Away: 4.50)
- **Confidence-förklaring**: "Confidence begränsad till 55% — [cap_reason]"
- **Key Factors** (expanderbar lista):
  - Per faktor: text + riktning (pil upp/ned) + källa (klickbar URL + datum + typ-badge)
  - Typ-badge: Fakta (blå) | Statistik (lila) | Opinion (orange) | Nyhet (grå)
- **AI Reasoning** (expanderbar textblock med källcitat)
- **Källor-förteckning** (lista med alla `sources_used`)
- **Systemrad-knapp** (bara för pool-matcher)
- Disclaimer i footer

---

### `src/components/betting/PoolTipsCard.tsx`

Kupong-vy för Topptipset/Stryktipset:
- **Omgångsinformation**: Omgångsnummer, datum, pool-typ
- **Radlista** — per rad:
  - Hemma vs Borta + datum
  - AI-förslag: 1 / X / 2 med sannolikheter (t.ex. "1 (58%) | X (24%) | 2 (18%)")
  - Confidence-progress-bar (färgkodad: grön/gul/röd)
  - Spik-indikator: 🔒 (singel) / ⚖️ (dubbel) / 🔄 (trippel)
- **System Generator** (höger panel):
  - Slider: Max antal rader (1–128)
  - Input: Budget SEK
  - Live-beräkning: "32 rader = 32 kr" (uppdateras per ändring)
  - Varning om budget överskrids
  - "Reducera system"-knapp om för många rader
- **Spara-knapp** → `pool_tickets` (kräver inloggning)
- **Kopiera rad-knapp** → clipboard-format "1X2X12..."

---

### `src/components/betting/BacktestPanel.tsx`

Fällbar panel (Accordion) längst ned på BettingPage:
- **Accuracy-tabell per liga**:
  - Liga | Prediktioner | Korrekta | Accuracy% | vs Market%
- **Kalibrering**:
  - Binned: "40-50%: 47% rätt | 50-60%: 54% rätt | 60-70%: 63% rätt"
  - (Empty state om < 10 avslutade prediktioner)
- **ROI-simulering**: "+12.3% om man följt alla tips"
- Hämtar data från `betting_predictions` där `outcome IS NOT NULL`

---

## Steg 4: Modifiera befintliga filer

### `src/components/Header.tsx`
- Lägg till `'betting'` i `TabId` union type
- Importera `Trophy` från lucide-react
- Lägg till `{ id: 'betting' as const, label: 'Betting', icon: Trophy }` i `tabs`-arrayen (efter Screener)

### `src/pages/Index.tsx`
- Importera `BettingPage` från `@/pages/BettingPage`
- Lägg till rendering block: `{activeTab === 'betting' && <BettingPage />}`

---

## supabase/config.toml — lägg till verify_jwt-inställningar

```toml
[functions.fetch-matches]
verify_jwt = false

[functions.analyze-match]
verify_jwt = false

[functions.fetch-pool-tips]
verify_jwt = false
```

(JWT-validering sker i koden istället, samma mönster som `ai-analysis`.)

---

## Filsammanfattning

| Fil | Åtgärd |
|-----|--------|
| `supabase/functions/fetch-matches/index.ts` | Ny |
| `supabase/functions/analyze-match/index.ts` | Ny |
| `supabase/functions/fetch-pool-tips/index.ts` | Ny |
| `src/pages/BettingPage.tsx` | Ny |
| `src/components/betting/MatchCard.tsx` | Ny |
| `src/components/betting/MatchDetailModal.tsx` | Ny |
| `src/components/betting/PoolTipsCard.tsx` | Ny |
| `src/components/betting/BacktestPanel.tsx` | Ny |
| `src/components/Header.tsx` | Uppdatera: TabId + Trophy-tab |
| `src/pages/Index.tsx` | Uppdatera: BettingPage-routing |
| `supabase/config.toml` | Uppdatera: verify_jwt för 3 funktioner |

Secrets som begärs: `FOOTBALL_DATA_API_KEY`, `FIRECRAWL_API_KEY`, `ODDS_API_KEY`
