
# Betting-flik: Produktionskvalitet — Komplett arkitektur

## Vad din feedback identifierade (och hur vi åtgärdar det)

Du lyfte 6 fundamentala problem med den naiva planen. Den reviderade arkitekturen adresserar samtliga:

| Problem | Lösning i denna plan |
|---|---|
| Hallucinerade "fakta" | Evidence gating: AI citerar källa + URL per påstående |
| Confidence overconfidence | Hårdkodade tak: tunt data → max 55%, bara opinion → max 52% |
| Inga odds/line data | Ny kolumn + The Odds API (gratis tier) → market edge-beräkning |
| Ingen backtest/utvärdering | Append-only `betting_predictions`-tabell + `outcome`-kolumn |
| Inga user-specifika tabeller | `betting_watchlist` + `pool_tickets` med RLS per user |
| Firecrawl-budget exploderar | URL-dedup + "high-impact only" + budget controller |

---

## Databas-design (4 tabeller)

### 1. `betting_matches` — publik cache för matcher
Fält: `id`, `sport` (football/ufc), `home_team`, `away_team`, `match_date`, `league`, `status` (upcoming/live/finished), `home_score`, `away_score`, `source_data` (JSONB rådata), `created_at`, `updated_at`.

**Notera:** Prediction sparas INTE här. Den sparas i `betting_predictions` (append-only) för att möjliggöra backtest.

RLS: SELECT för alla. INSERT/UPDATE/DELETE blockerat publikt.

### 2. `betting_predictions` — append-only snapshot-tabell (KRITISK för backtest)
Fält: `id`, `match_id`, `predicted_winner` (home/away/draw), `predicted_prob` (0–1), `confidence_raw` (0–100 before cap), `confidence_capped` (0–100 after cap), `cap_reason` (text, varför cap applicerades), `model_version`, `sources_hash` (SHA-256 av input-data, säkerställer reproducerbarhet), `sources_used` (JSONB: lista av `{url, title, date, type}`), `ai_reasoning` (text), `key_factors` (JSONB), `market_odds_home`, `market_odds_draw`, `market_odds_away`, `market_implied_prob` (beräknad), `model_edge` (model_prob – market_implied), `created_at`, `outcome` (nullable: home_win/draw/away_win), `scored_at` (nullable).

RLS: SELECT för alla. INSERT/UPDATE/DELETE blockerat publikt.

### 3. `betting_watchlist` — personlig bevakning (per user, med RLS)
Fält: `id`, `user_id`, `match_id`, `prediction_id` (referens till vilken snapshot man sparade), `saved_at`, `notes`.

RLS: Fullständig user-isolation (CRUD kräver `auth.uid() = user_id`).

### 4. `pool_tickets` — sparade Topptipset/Stryktipset-rader (per user)
Fält: `id`, `user_id`, `pool_type` (topptipset/stryktipset), `round_id`, `round_name`, `rows_json` (JSONB med `[{match, tip, confidence, reasoning}]`), `system_size` (antal rader i system), `budget_sek`, `created_at`.

RLS: Fullständig user-isolation.

---

## Edge Functions (3 st)

### A) `fetch-matches/index.ts`

**Ansvar:** Hämtar och cachar matchdata. Triggas manuellt eller via cron (1 gång/dag).

**Datainsamling med budget controller:**
```text
1. Football-data.org API (FOOTBALL_DATA_API_KEY) → matcher nästa 7 dagar
2. GNews sökning → nyheter per match (max 3 artiklar/match)
3. Firecrawl webscraping (FIRECRAWL_API_KEY) — med budget controller:
   - Max 3 sidor/match
   - Bara för "high-impact" matcher (top-5 ligor + Champions League)
   - URL-dedup: hoppa över om URL scrapades < 6h sedan
   - Stoppa automatiskt om daglig budget nådd (räknas i JSONB-tabell)
4. UFC: GNews + Firecrawl mmafighting.com (bara huvudmatcher)
5. Upsert i betting_matches
```

**Confidence cap-logik (körs i analyze-match):**
```text
Datakällor klassificeras per typ:
  - "confirmed_fact": officiell lineup, skadekonfirmation från klubb
  - "stats": historisk H2H, tabellposition (från football-data.org)
  - "opinion": expert-tips, artikel-prediktion
  - "news": presskonferens-citat, nyhet

Cap-regler:
  Om inga "confirmed_fact" eller "stats" → max confidence 55%
  Om bara "opinion"-källor → max confidence 52%
  Om inga skaderapporter tillgängliga → cap med 5% extra
  Om H2H < 3 matcher → cap med 5% extra
```

### B) `analyze-match/index.ts`

**Ansvar:** Genererar AI-prediktion för en given match_id. Returnerar strukturerad JSON med citatpliktig källa per faktapåstående.

**Evidence gating — centralt för datakvalitet:**
Gemini-prompten instrueras **explicit** att:
- Bara använda påståenden som finns i `source_data`
- Citera källa (URL + publiceringsdatum + typ) för varje "fact" i reasoning
- Formulera osäkerhet explicit ("Inga skaderapporter tillgängliga", "Baserat på 2 möten i H2H")
- ALDRIG uppfinna statistik eller påstå fakta som saknas i input

**Output-format:**
```json
{
  "predicted_winner": "home|away|draw",
  "predicted_prob": 0.62,
  "confidence_raw": 71,
  "confidence_capped": 55,
  "cap_reason": "Inga bekräftade lineups tillgängliga",
  "key_factors": [
    {
      "factor": "Hemmalagsstyrka",
      "direction": "positive",
      "source": { "url": "https://goal.com/...", "date": "2026-02-19", "type": "stats" }
    }
  ],
  "ai_reasoning": "Baserat på [källa 1] och [källa 2]...",
  "sources_used": [ { "url": "...", "title": "...", "date": "...", "type": "opinion" } ],
  "market_edge": null
}
```

Sparas i `betting_predictions` (append-only). Räknar `sources_hash` från SHA-256 av input.

### C) `fetch-pool-tips/index.ts`

**Ansvar:** Scraper aktuellt Topptipset/Stryktipset från Svenska Spel + genererar systemrad.

**System generator-läge:**
```text
Input: pooltyp, max_rader (t.ex. 64), budget_sek
Output:
  - Per match: tip (1/X/2) + prob (0–1) + confidence
  - Systemstrategi:
    * Spikar (confidence > 70%): singel
    * Halvgarderingar (confidence 50–70%): dubbel  
    * Helgarderingar (confidence < 50%): trippel (1X2)
  - Räknar ut antal rader totalt, ger varning om budget överskrids
  - Föreslår reducerat system om för många rader
```

---

## Frontend-komponenter

### `src/pages/BettingPage.tsx`
- **SportSelector**: Fotboll | UFC | Topptipset | Stryktipset
- Varning-banner: "Spela ansvarsfullt. AI-prediktioner är inte investeringsrådgivning."
- Hämta-knapp + loading state
- MatchList med MatchCard per match

### `src/components/betting/MatchCard.tsx`
- Hem/borta med emoji-flaggor
- Datum, liga, status-badge
- Prediction-badge (grön/röd/gul för hem/bort/oavgjort)
- **Market Edge badge** (t.ex. "+8% edge" i blå om model > market)
- `ScoreRing` (befintlig komponent) för confidence_capped
- Caps visas explicit: "Confidence begränsad (tunt data)"
- "Analysera"-knapp → triggar analyze-match

### `src/components/betting/MatchDetailModal.tsx`
- AI-reasoning med källcitat (klickbara URLs)
- Key factors-lista med källa per faktor
- Källförteckning: typ-badge per källa (Fakta/Statistik/Opinion/Nyhet)
- **Odds-jämförelse**: "Modell: 62% | Marknad: 54% | Edge: +8%"
- Confidence-förklaring: varför cap applicerades
- Systemrad-knapp för pool-matcher

### `src/components/betting/PoolTipsCard.tsx`
- Kupongvy med alla rader
- Per rad: lag + datum + AI-tip (1/X/2) + confidence-bar
- **Systemrad-generator**: välj max rader + budget
- Spikindikator (🔒), halvgardering (⚖️), helgardering (🔄)
- Antal rader + uppskattad kostnad visas i realtid
- Spara-knapp → `pool_tickets` (kräver inloggning)

### `src/components/betting/BacktestPanel.tsx` (ny)
- Visar accuracy per liga
- Kalibrering: "När vi säger 70%, hur ofta blev det rätt?"
- Jämförelse mot market implied probability

---

## Odds-integration

**The Odds API** (gratis tier: 500 req/månad, mer än tillräckligt):
- Endpoint: `https://api.the-odds-api.com/v4/sports/{sport}/odds`
- Ger: `home_odds`, `draw_odds`, `away_odds` från bookmakers
- Vi beräknar `implied_prob = 1 / decimal_odds` (normaliserat för vig)
- `model_edge = model_prob – market_implied_prob`
- Visas i UI: "Modell 62% vs Marknad 54% → +8% edge"

**Kräver ny secret:** `ODDS_API_KEY` (gratis på the-odds-api.com)

---

## Backtest-loop

När en match är färdigspelad (status = 'finished' och scores finns):
- Skrivs `outcome` + `scored_at` i `betting_predictions`
- `BacktestPanel` kan sedan räkna:
  - **Accuracy**: korrekt predicerade / totala
  - **Kalibrering**: binned accuracy per confidence-nivå (40–50%, 50–60%, etc.)
  - **Model vs Market**: var modellen bättre än bookmaker implied probability?
  - **ROI simulering**: om man satsat lika mycket varje gång

---

## Secrets som behövs (totalt 3 nya)

| Secret | Tjänst | Tier |
|---|---|---|
| `FOOTBALL_DATA_API_KEY` | football-data.org | Gratis (10 req/min) |
| `FIRECRAWL_API_KEY` | firecrawl.dev | Gratis (500 sidor/mån) |
| `ODDS_API_KEY` | the-odds-api.com | Gratis (500 req/mån) |

`GNEWS_API_KEY`, `LOVABLE_API_KEY` redan konfigurerade.

---

## Header & Routing

`Header.tsx`: Lägg till `'betting'` i `TabId` + ny tab med `Trophy`-ikon från lucide-react.
`Index.tsx`: `{activeTab === 'betting' && <BettingPage />}`

---

## Filförteckning

**Databas (1 migration):**
- Tabeller: `betting_matches`, `betting_predictions`, `betting_watchlist`, `pool_tickets`

**Nya Edge Functions (3 st):**
1. `supabase/functions/fetch-matches/index.ts`
2. `supabase/functions/analyze-match/index.ts`
3. `supabase/functions/fetch-pool-tips/index.ts`

**Nya Frontend-filer (5 st):**
1. `src/pages/BettingPage.tsx`
2. `src/components/betting/MatchCard.tsx`
3. `src/components/betting/MatchDetailModal.tsx`
4. `src/components/betting/PoolTipsCard.tsx`
5. `src/components/betting/BacktestPanel.tsx`

**Modifierade filer (2 st):**
1. `src/components/Header.tsx`
2. `src/pages/Index.tsx`
