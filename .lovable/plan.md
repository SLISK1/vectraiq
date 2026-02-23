
# Fix: Nytillagda aktier far aldrig pris eller analys

## Rotorsaksanalys

Tre separata buggar forhindrar att nytillagda symboler (via sokningen pa hemsidan) far prisdata och analys:

### BUG 1: `generate-signals` kraschar vid start (KRITISK)
Rad 275 i `generate-signals/index.ts` refererar till `reliabilityMap.size` -- men variabeln `reliabilityMap` togs bort i en tidigare refaktor. Funktionen kastar `ReferenceError: reliabilityMap is not defined` vid VARJE anrop, inklusive cron-jobb. Detta forklarar varfor det finns **noll loggar** for funktionen och varfor inga signaler genereras for NAGRA symboler.

### BUG 2: `generate-signals` saknar `tickers`-filter
Nar `add-symbol` anropar `generate-signals` med `{ tickers: ["BURE.ST"] }` ignoreras parametern helt. Funktionen laster bara `limit`/`offset`-paginering (rad 258-267, 296-302), sa den processar de forsta 20 symbolerna i bokstavsordning istallet for den nyligen tillagda symbolen.

### BUG 3: `add-symbol` timeout-problem med `setTimeout`
Rad 186-192 i `add-symbol` anvander `setTimeout(5000)` for att fordroja `generate-signals`-anropet -- men Deno.serve returnerar response INNAN timeout fires, sa edge function-runtimen kan avsluta processen innan anropet ens skickas.

## Bevis fran databasen

Senaste 5 nytillagda symboler:
- CADELER: 0 priser, 0 historik, 0 signaler
- AXACTOR: 0 priser, 0 historik, 0 signaler  
- BLUENORD: 0 priser, 0 historik, 0 signaler
- CITYCON: 0 priser, 0 historik, 0 signaler
- ADDLIFE: 0 priser, 0 historik, 0 signaler

## Fix-plan

### Fix 1: Ta bort kraschande kod i `generate-signals`
**Fil:** `supabase/functions/generate-signals/index.ts`
- Rad 275: Byt `reliabilityMap.size` till `reliabilityDataMap.size`

### Fix 2: Lagg till `tickers`-filter i `generate-signals`
**Fil:** `supabase/functions/generate-signals/index.ts`
- Rad 258-267: Parsa `body.tickers` array fran request body
- Rad 296-302: Om `tickers` finns, anvand `.in('ticker', tickers)` istallet for `.range(offset, limit)`
- Sa att `add-symbol` kan trigga signaler for just den nya symbolen

### Fix 3: Ersatt `setTimeout` med `await` i `add-symbol`
**Fil:** `supabase/functions/add-symbol/index.ts`
- Rad 164-192: Gor fetch-history och fetch-prices till `await`-anrop (seriellt, inte fire-and-forget) sa att prisdata garanterat finns innan generate-signals anropas
- Alternativt: gor alla tre till `await` med Promise.allSettled, eller gor fetch-history + fetch-prices parallellt och generate-signals sekventiellt efterat
- Returnera response efter alla tre ar klara, sa att frontend far korrekt status

### Fix 4: Deploya och testa
- Deploya bada edge functions
- Testa med `curl` att `add-symbol` + `fetch-prices` + `generate-signals` ger data for en ny ticker
- Verifiera att cron-jobb for `generate-signals` fungerar igen (har varit brutet)

## Tekniska detaljer

### `generate-signals/index.ts` andringar:

**Rad 275 (kraschfix):**
```
// Before (kraschar):
console.log(`Loaded ${reliabilityMap.size} module_reliability entries`);

// After:
console.log(`Loaded ${reliabilityDataMap.size} module_reliability entries`);
```

**Rad 258-267 (tickers-filter):**
```typescript
let batchLimit = 20, batchOffset = 0;
let horizons: string[] = ['1d'];
let tickerFilter: string[] | null = null;  // NY
try {
  const body = await req.json();
  if (body?.tickers && Array.isArray(body.tickers)) {
    tickerFilter = body.tickers.map((t: string) => t.toUpperCase().trim());
  }
  // ... befintlig limit/offset/horizon-logik
} catch {}
```

**Rad 296-302 (query-uppdatering):**
```typescript
let symQuery = supabase
  .from('symbols')
  .select('id, ticker, name, asset_type, currency, metadata')
  .eq('is_active', true)
  .order('ticker', { ascending: true });

if (tickerFilter && tickerFilter.length > 0) {
  symQuery = symQuery.in('ticker', tickerFilter);
} else {
  symQuery = symQuery.range(batchOffset, batchOffset + batchLimit - 1);
}
const { data: symbols, error: symErr } = await symQuery;
```

### `add-symbol/index.ts` andringar:

**Rad 164-192 (sequential await istallet for fire-and-forget):**
```typescript
// 1. Fetch history + prices in parallel (both must complete before signals)
const [histRes, priceRes] = await Promise.allSettled([
  fetch(`${supabaseUrl}/functions/v1/fetch-history`, {
    method: "POST",
    headers: internalHeaders,
    body: JSON.stringify({ tickers: [cleanTicker], days: 365 }),
  }),
  fetch(`${supabaseUrl}/functions/v1/fetch-prices`, {
    method: "POST",
    headers: internalHeaders,
    body: JSON.stringify({ tickers: [cleanTicker] }),
  }),
]);

console.log(`History: ${histRes.status}, Prices: ${priceRes.status}`);

// 2. Generate signals AFTER price data is available
try {
  await fetch(`${supabaseUrl}/functions/v1/generate-signals`, {
    method: "POST",
    headers: internalHeaders,
    body: JSON.stringify({ tickers: [cleanTicker], allHorizons: true }),
  });
} catch (e) {
  console.warn('generate-signals trigger failed:', e);
}
```

## Filer som andras

| Fil | Andring |
|-----|---------|
| `supabase/functions/generate-signals/index.ts` | Fix krasch (rad 275), lagg till tickers-filter |
| `supabase/functions/add-symbol/index.ts` | Byt fire-and-forget till await, ta bort setTimeout |
