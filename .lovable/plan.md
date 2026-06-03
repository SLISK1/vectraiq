
# Varför Top-10 är tom — bekräftad orsak

Jag har kollat databasen och edge-loggarna. Du har rätt i diagnosen, men det exakta filtret som faller är inte "10-punktströskeln" — det är **datumfönstret**:

| Källa | Färskast post | Status |
|---|---|---|
| `raw_prices` (live-pris) | **2026-06-03 09:41 UTC** | OK, uppdateras varje timme |
| `price_history` (dagsbarrer) | **2026-02-23** | Frusen sedan ~100 dagar |
| `pipeline_runs` (senaste) | 2026-02-24 | `failed`, `HTTP 504 step:fetch-prices` |
| `cron.job` (alla 25 jobb) | active=true | Schemalagda OK |

Frontend (`useMarketData.ts:478`) hämtar `price_history` med `gte('date', today-60d)`. Eftersom färskaste rad är 2026-02-23 returnerar queryn **0 rader för varje symbol**, raden på `useMarketData.ts:111` kickar in och loggar "insufficient price history (0 points)" för 322 symboler → ingen rankas → tom Top-10.

Kärnproblemet är alltså att `fetch-history`/`fetch-prices` skriver INTE till `price_history` längre. `daily-pipeline` 504:ar på `fetch-prices`-steget, så history-skrivningen körs aldrig. Live-priserna (`raw_prices`) går via en separat snabb path och är därför fortfarande fräscha — det är det som maskerar att resten av pipelinen ligger nere.

# Plan: tre-stegs återställning

## Steg 1 — Backfill `price_history` manuellt (omedelbart)
Anropa `fetch-history` direkt mot batchar av tickers (max ~30 åt gången för att hålla oss långt under 150s-timeouten) tills `price_history.max(date)` är dagens datum. Det här bryter dödläget utan att vänta på nattjobbet.

- Skript som kör `supabase.functions.invoke('fetch-history', { body: { tickers: batch, days: 200 } })` med 30-symbolers chunks, sekventiellt
- Verifierar efteråt: `select max(date), count(distinct symbol_id) from price_history`
- Förväntat resultat: 322 symboler med data t.o.m. ~2026-06-02, dashboarden visar Top-10 igen

## Steg 2 — Gör `fetch-history`/`fetch-prices` timeoutsäkra (samma dag)
`fetch-prices/index.ts` har redan delvis fått `pMap`, men `fetch-history/index.ts` är fortfarande helt sekventiell med 6 s sleeps mellan CoinGecko-anrop, 500 ms mellan Yahoo, 150 ms mellan FMP — det är därför hela 322-symbol-runt:en aldrig hinner klart inom 150 s. Konvertera:

- CoinGecko: behåll sekventiellt men dropp till 1 s sleep (gratis-quoten klarar det) — kör endast om aktivt åberopas
- US/Nordic FMP-loopar → `pMap` med concurrency 5, ta bort `setTimeout`
- Yahoo-fallbacks → `pMap` concurrency 6, ta bort sleeps
- Metals/funds → `pMap` concurrency 4
- Lägg till `chunk_size`/`offset` body-parametrar så pipelinen kan kalla funktionen 4 ggr om 80 symboler vardera i stället för 1 gång om 322

## Steg 3 — Chunka `daily-pipeline` och fixa det dolda buggens (samma dag)
- I `daily-pipeline/index.ts`: kör `fetch-prices`/`fetch-history` i 80-symbolers chunks (`offset` 0/80/160/240) och `Promise.allSettled` i stället för en enda invocation
- Fixa det andra felet i pipeline_runs: `TypeError: supabase.rpc(...).catch is not a function` — RPC-builder är "thenable" men inte ett riktigt Promise; byt till `await ...; try/catch` eller `Promise.resolve(supabase.rpc(...)).catch(...)`
- Spara per-chunk-fel separat så ett 504 inte längre markerar hela run som failed och hindrar history-steget

## Diagnostik som ingår
- Lägg till `select max(date) from price_history` som en "data-freshness"-rad i `RealityCheck.tsx` så den här typen av tyst pipelinestall syns i UI:t nästa gång

# Tekniska detaljer

**Filer som ändras**
- `supabase/functions/fetch-history/index.ts` — införa `pMap`, ta bort sleeps, stötta `offset/chunk_size`
- `supabase/functions/daily-pipeline/index.ts` — chunkat anrop, fixa `.catch`-buggen, allSettled
- `src/components/RealityCheck.tsx` — visa age på senaste `price_history`-datum

**Inga schemaändringar.** Inga frontend-businesslogikändringar utöver en ny info-rad i RealityCheck.

**Inga nya secrets behövs** — FMP_API_KEY, FINNHUB_API_KEY m.fl. finns redan.

**QA**: efter steg 1, ladda om dashboarden och bekräfta att Top-10 fylls. Efter steg 2+3, trigga `daily-pipeline` manuellt och bekräfta att `pipeline_runs.status='success'` med `prices.succeeded > 300` och `history.succeeded > 300`.
