## Diagnos

Roten är inte API/scrapers — det är **auth mellan cron och edge functions**.

- `cron.job` skickar `Authorization: Bearer <ANON_KEY>` plus `x-internal-call: true` till `generate-signals`, `fetch-history`, `fetch-news`, `fetch-fundamentals` m.fl.
- Funktionerna validerar headern med `supabase.auth.getUser(token)`. En **anon-JWT är inte en användarsession**, så `getUser()` returnerar fel → funktionen svarar `401 Invalid token` och skriver ingen data.
- `fetch-prices` har en mildare auth-väg och slipper därför 401 → därför är `raw_prices` färska medan `price_history` och `signals` är frysta sedan 2026‑02‑24.
- `daily-pipeline` har dessutom en känd bugg där en `supabase.rpc(...).catch` kraschar orchestratorn innan history/signals hinner köras.
- Bettingdelen lever delvis eftersom `analyze-match` triggas direkt av cron och inte gör samma `getUser`-check.

Konsekvens: frontend kräver 60–365 dagars historik i `useMarketData.ts`, får 0 punkter och filtrerar bort alla aktier → inga signaler visas.

## Plan

Allt nedan rör enbart **auth- och orchestrator-lagret**. Analys-, scoring-, prediction- och bettingkoden lämnas orörd.

### 1. Inför enhetligt service-role-auth i berörda edge functions
Funktioner som triggas internt av cron/pipeline ska acceptera **antingen** en giltig användar-JWT **eller** `Bearer <SUPABASE_SERVICE_ROLE_KEY>`. Anon-key + `getUser` slutar gälla för dessa.

Berörda funktioner:
- `fetch-history`
- `generate-signals`
- `fetch-news`
- `fetch-fundamentals`
- (samma mönster appliceras i `compute-news-sentiment`, `fetch-events`, `compute-sector-returns`, `fetch-earnings-events` om de har samma `getUser`-grind)

Auth-mönstret blir:

```text
1. Läs Authorization-headern.
2. Om token == SERVICE_ROLE_KEY → tillåt (intern trigger).
3. Annars validera som user-JWT via getUser/getClaims.
4. Saknas/ogiltig → 401.
```

Affärslogik och DB-skrivningar i funktionerna ändras inte.

### 2. Uppdatera cron-jobben till service-role-token
Alla `cron.job`-poster som idag skickar anon-key i Authorization byts till att skicka service-role-nyckeln (lagrad i Supabase). Detta görs som en data-uppdatering (`cron.unschedule` + `cron.schedule` på nytt) — inga schemaändringar i tabeller. Berörda jobb:
- `daily-generate-signals*`
- `daily-fetch-history*` / `weekly-fetch-history*`
- `daily-fetch-news*`
- `daily-fetch-fundamentals*`
- `daily-pipeline-master` (om det går via cron)

`analyze-match`/betting-jobben rörs inte eftersom de redan fungerar.

### 3. Stabilisera `daily-pipeline`-orchestratorn
- Ta bort `.catch()` direkt på `supabase.rpc(...)` (PostgrestBuilder är inte ett Promise).
- Behåll redan införd chunkning av `fetch-prices` / `fetch-history` så enstaka 504 inte dödar hela kedjan.
- Säkerställ att pipelinen alltid skriver färdig status till `pipeline_runs` även när ett delsteg misslyckas.

### 4. Tinning av frysta tabeller (engångskörning)
När 1–3 är på plats:
- Trigga `fetch-history` chunkat (`offset/limit` 80, 365 dagar) tills `price_history` har ≥60 dagar för aktiva symboler.
- Trigga `generate-signals` i batchar om 20 över alla aktiva tickers.
- Trigga `fetch-news` + `compute-news-sentiment` en gång.

Triggas via befintlig `trigger-pipeline`/Admin-panel — ingen ny kod.

### 5. Verifiering
- `validate-data` integritetstestet (redan på plats) ska visa coverage > 0 för `price_history (30d)` och `signals (7d)`, och `missing_sources` ska krympa.
- Frontenden ska börja visa signaler på aktier igen utan ändringar i `useMarketData.ts`.
- Loggar för `generate-signals` / `fetch-history` ska sluta innehålla `Invalid token` / `Unauthorized` från cron.

## Teknisk detalj (för referens)

Cron-headern idag (exempel `daily-generate-signals`):

```text
Authorization: Bearer <ANON_KEY>
x-internal-call: true
```

Edge-funktionen kör:

```text
supabase.auth.getUser(anon_token)   -> error -> 401 Invalid token
```

Efter åtgärd:

```text
if token === SERVICE_ROLE_KEY: pass through (intern)
else: getUser(token); 401 om ogiltig
```

Och cron skickar:

```text
Authorization: Bearer <SERVICE_ROLE_KEY>
```

Inga ändringar i `signals`-, `price_history`-, `raw_prices`-, `asset_predictions`- eller betting-tabellerna. Inga ändringar i analyslogiken eller modellerna.