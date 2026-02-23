
# Fixa data for krypto, fonder och metaller

## Problemanalys

Tre separata problem orsakar att krypto, fonder och metaller visar "Inga signaler tillgangliga":

### 1. Fonder: Fejkad data
`fetch-prices` anvander **hardkodade NAV-varden med en sinusfunktion** (linje 421-433) istallet for riktig marknadsdata. `fetch-history` har **ingen logik alls** for fonder -- de faller inte in i nagon av de fyra kategorierna (crypto, US stocks, Nordic stocks, metals).

### 2. Metaller: Saknar historik
`fetch-prices` hamtar realtidspris fran Alpha Vantage men satter `change_24h: 0`. `fetch-history` forsoker hamta via `FX_DAILY` men Alpha Vantage returnerar troligen ingen data for metallsymboler (XAU, XAG, etc.). Resultatet: 0 historikrader for alla 4 metaller.

### 3. Krypto: Delvis data
Bara 3 av 8 kryptovalutor (BTC, ETH, SOL) har historik och signaler. Ovriga 5 (XRP, ADA, AVAX, DOT, LINK) har 0 historikrader -- troligen pga CoinGecko rate limits eller fel under tidigare korningar.

## Losningsplan

### Steg 1: Fixa `fetch-prices` for fonder

Byt ut de fejkade fondpriserna mot riktiga kurser. Eftersom svenska fonder inte finns pa FMP/Yahoo Finance, anvands **Fondkollen-liknande data via FMP ETF-priser** eller alternativt CoinGecko-stil API for fonder. 

**Praktisk losning**: Anvand Yahoo Finance for svenska fonder med ISIN-baserade tickers. Alternativt: behall NAV-estimat men med *riktig* daglig forandring baserad pa underliggande index (t.ex. SPY for USA-fond, EWJ for Asien-fond). Markera tydligt att det ar estimat.

### Steg 2: Fixa `fetch-history` -- lagg till fond- och metallstod

**Metaller**: Byt fran Alpha Vantage `FX_DAILY` till FMP:s `historical-price-full/XAUUSD` (guld mot USD), som fungerar battre for adelmetaller. Yahoo Finance har ocksa `GC=F` (guld), `SI=F` (silver), etc.

**Fonder**: Lagg till en ny sektion i `fetch-history` som hamtar fondhistorik. Eftersom svenska fonder inte ar listade pa internationella borser, anvands proxy-index:
- SWE-USA -> SPY-historik skalad
- SWE-ASIA -> EWJ eller liknande
- Alternativt: Hoppa over fondhistorik och markera fonder som "begransad data" i UI:t.

### Steg 3: Fixa krypto-historik for saknade valutor

Problemet ar troligen CoinGecko rate limits (30 req/min pa gratisplanen). Losning:
- Lagg till retry-logik med exponentiell backoff
- Oka delay mellan anrop fran 4s till 6s
- Lagg till felhantering som loggar vilka krypton som misslyckades

### Steg 4: Utoka `generate-signals` for att hantera tillgangar med begransad data

For tillgangar med <30 dagars historik, generera forenklade signaler baserat pa:
- Senaste priset och 24h-forandring (fran `raw_prices`)
- En "limited data"-flagga sa UI:t kan visa att analysen ar opålitlig

## Tekniska detaljer

### Filer att andra

1. **`supabase/functions/fetch-prices/index.ts`**
   - Byt fondlogiken (linje 421-433) fran sinusfunktion till Yahoo Finance proxy-index
   - Forbattra metallhämtning med forandringsdata

2. **`supabase/functions/fetch-history/index.ts`**
   - Lagg till sektion 5: "METALS via FMP/Yahoo" med tickers `GC=F`, `SI=F`, `PL=F`, `PA=F`
   - Lagg till sektion 6: "FUNDS via proxy index" eller markera som ej stott
   - Oka CoinGecko delay och lagg till retry

3. **`supabase/functions/generate-signals/index.ts`**
   - Hantera tillgangar med lite historik: generera forenklade signaler med "low confidence"-flagga

4. **Eventuellt UI-uppdatering** i dashboard for att visa "Begransad data" istallet for "Inga signaler" nar tillgangen finns men saknar fullstandig historik

### Prioritetsordning

1. Krypto-fix (enklast -- bara oka delays och lagg till retry)
2. Metall-fix (byt datakalla for historik)
3. Fond-fix (mest komplext -- kravs proxy-losning eller tydlig markering i UI)
