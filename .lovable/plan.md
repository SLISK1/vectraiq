# Fokusera Betting-fliken på VM 2026 (herrar)

VM 2026 (16 jun – 19 jul 2026) blir default-vy. Befintliga ligor finns kvar som filter. Odds-priser tas via The Odds API (`soccer_fifa_world_cup`), och Oddset-specifika marknader (1X2/Dubbelchans, BTTS, Ö/U 2.5, Exakt resultat, Hörnor, Kort) hämtas via Firecrawl mot Oddsets matchsidor med cache i `odds_snapshots`.

## 1. Backend – matchhämtning

**`supabase/functions/fetch-matches/index.ts`**
- Lägg till `{ id: "WC", name: "VM 2026" }` i `FOOTBALL_COMPETITIONS` och i `HIGH_IMPACT_LEAGUES`.
- Säkerställ att football-data.org-anropet hämtar 2026-säsongen för WC (filter `?dateFrom=2026-06-16&dateTo=2026-07-19` när comp = WC).
- Tagga rader med `sport = 'football'`, `league = 'VM 2026'`.

**`supabase/functions/analyze-match/index.ts`**
- Mappa `"VM 2026": "soccer_fifa_world_cup"` i `SPORT_ODDS_KEY`.
- Markera VM som high-impact så att news/H2H-scrape körs.

## 2. Oddset-scrape (Firecrawl)

Ny edge function **`fetch-oddset-markets`** (verify_jwt=false, service-role only):
- Input: `{ match_id }`.
- Slår upp match i `betting_matches`, bygger Oddset-URL via `spela.svenskaspel.se/oddset` sökning på lagnamn (Firecrawl `search` + `scrape` med `formats: ['json']` och ett strikt schema för marknaderna: `1X2`, `dubbelchans`, `btts`, `ou25`, `exact_score[]`, `corners_ou`, `cards_ou`).
- Skriver rader till `odds_snapshots` med `bookmaker='oddset'`, `market`, `selection`, `line`, `odds_pre_match`, `implied_pre_match = 1/odds` (normerat per marknad så over-round dras av).
- Cache-TTL: 30 min (skippa scrape om senaste snapshot < 30 min gammal). Respekterar Firecrawl-kvoten enligt befintlig `api_usage_tracker`-policy.

Cron: kör för alla VM-matcher inom 24 h, var 30:e minut, via befintlig pg_cron.

## 3. Recommend / settlement

- `recommend_bets` läser redan `odds_snapshots`; lägg till marknadsnycklar `DC` (dubbelchans), `EXACT` (exakt resultat) i `MARKETS`-arrayen och i `compute_p_raw` (Poisson från `team_rates_cache` ger både dubbelchans och exakt resultat-matris).
- `betting-settle`: lägg till settlement för `DC` (utifrån `home_score/away_score`) och `EXACT` (exakt matchning). Hörnor/kort fortsätter via `fetch-match-stats`.

## 4. Frontend

**`src/pages/BettingPage.tsx`**
- Default `selectedLeague = 'VM 2026'` (om den finns i listan, annars första tillgängliga).
- Pin-knapp för "VM 2026" som sortera först i ligafiltret + flagg-emoji 🏆.
- Visa "Oddset"-badge på matcher där `odds_snapshots` innehåller `bookmaker='oddset'`.

**`src/components/betting/MarketPicker.tsx`**
- Lägg till `DC` (Dubbelchans), `EXACT` (Exakt resultat) i `OPTIONS`.

**`src/components/betting/MatchDetailModal.tsx` / `SidePredictions.tsx`**
- Ny sektion "Oddset-marknader" som listar alla snapshots med bookmaker `oddset` grupperade per marknad, med edge mot vår `p_cal`.

## 5. Migration

Tillägg till `odds_snapshots`:
- Ingen ny kolumn behövs (bookmaker finns). Lägg dock till partial-index:
  `CREATE INDEX IF NOT EXISTS idx_odds_snapshots_oddset ON public.odds_snapshots (match_id, market) WHERE bookmaker = 'oddset';`
- Säkerställ ENUM/CHECK på `market` tillåter `DC` och `EXACT` (om CHECK finns; annars skip).

## Tekniska noter

- Firecrawl-scrape av Oddset är skör — scrapen valideras med Zod-schema och vid fel loggas felet i `pipeline_runs` utan att blockera Odds API-priserna.
- Implied probability normeras per marknad: `p_i = (1/odds_i) / Σ(1/odds_j)` för att ta bort bookmaker-marginal innan edge-jämförelse.
- Disclaimers (inga spelråd) bibehålls i UI enligt projektregler.

## Filer som ändras / skapas

| Fil | Åtgärd |
|---|---|
| `supabase/functions/fetch-matches/index.ts` | Lägg till WC-kod, datumfilter |
| `supabase/functions/analyze-match/index.ts` | SPORT_ODDS_KEY + high-impact |
| `supabase/functions/fetch-oddset-markets/index.ts` | NY |
| `supabase/functions/compute_p_raw/index.ts` | DC + EXACT från Poisson |
| `supabase/functions/recommend_bets/index.ts` | MARKETS += DC, EXACT |
| `supabase/functions/betting-settle/index.ts` | Settle DC, EXACT |
| `supabase/migrations/<new>.sql` | Partial index |
| `supabase/config.toml` | Cron för `fetch-oddset-markets` |
| `src/pages/BettingPage.tsx` | Default-liga VM, sortering |
| `src/components/betting/MarketPicker.tsx` | Nya marknader |
| `src/components/betting/MatchDetailModal.tsx` | Oddset-sektion |