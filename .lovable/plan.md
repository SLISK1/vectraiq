
# Plan: Hämta data och signaler för alla tillgångar som saknar analysdata

## Problem
65 av 296 aktiva tillgångar saknar prishistorik och därmed analyssignaler. Orsaken varierar per kategori:

| Kategori | Antal | Orsak |
|----------|-------|-------|
| Nordiska aktier (.ST) | ~30 | Yahoo-symbolen matchar men hämtningen kan ha misslyckats (felaktigt symbolformat, avlistade bolag) |
| Nordiska aktier (utan suffix) | ~7 | Saknar mapping i NORDIC_STOCKS och matchar inte .ST-filtret (t.ex. ATRLJ-B, KAHOT, KIND-SDB) |
| Krypto | 5 | Finns i CRYPTO_IDS men troligen CoinGecko rate-limit |
| Metaller | 4 | Alpha Vantage begränsat till 2 st per körning |
| Fonder | 7 | Ingen hämtningslogik implementerad |
| US-aktier | 1 | AMD saknas i US_STOCKS-listan |

## Losning

### Steg 1: Utoka fetch-history med saknade ticker-mappningar
- Lagg till AMD i US_STOCKS-listan
- Lagg till saknade nordiska aktier utan .ST-suffix i NORDIC_STOCKS-mappningen (t.ex. ATRLJ-B -> ATRLJ-B.ST, KAHOT -> KAHOT.OL, KIND-SDB -> KIND-SDB.ST, KARO -> KARO.ST, FM -> FM.ST, COLL -> COLL.ST, RAYSH -> RAYS.ST)
- Fixa felaktiga Yahoo-symboler for aktier som har .ST men anvander fel format (t.ex. EMBRACER-B.ST, BOLIDEN.ST, CALLIDITAS.ST)
- Utoka metals-hämtningen fran 2 till 4 st
- Lagg till fonddata via Yahoo Finance for fonder som har ISIN/Yahoo-ticker

### Steg 2: Forbattra felhantering och retry-logik
- Lagg till tydlig loggning nar Yahoo returnerar fel for en specifik ticker
- For krypto: oka delay mellan CoinGecko-anrop for att undvika rate limits (fran 2.5s till 4s)
- Lagg till stod for att skicka specifika tickers till fetch-history sa man kan rikta om hämtning

### Steg 3: Schemalagg signalgenerering via pg_cron
- Skapa pg_cron-jobb for generate-signals som kors dagligen efter att prishistorik hamtats
- Batcha i grupper om 50 med offset (precis som fetch-fundamentals)
- Schemalagger kl 08:00-08:10 UTC (efter prishistorik-hämtningen)

### Steg 4: Inaktivera tillgangar utan datakallor
- For fonder och andra tillgangar dar ingen extern datakalla finns, markera som is_active = false eller lagg till en flagga som visar att data saknas
- Detta förhindrar att tomma kort visas i Screener

## Tekniska detaljer

### Filer som andras:
1. **supabase/functions/fetch-history/index.ts** - Utokade mappningar, fixade Yahoo-symboler, battre felhantering, okat CoinGecko-delay
2. **Ny migration** - pg_cron-jobb for generate-signals (6 jobb med offset 0-250, kl 08:00-08:10 UTC)
3. **supabase/functions/generate-signals/index.ts** - Eventuellt stod for paginering via limit/offset (redan implementerat)

### Ticker-mappningar som laggs till/fixas:

```text
Nordiska utan suffix:
  ATRLJ-B  -> ATRLJ-B.ST
  KAHOT    -> KAHOT.OL
  KIND-SDB -> KIND-SDB.ST
  KARO     -> KARO.ST
  FM       -> FM.ST
  COLL     -> COLL.ST
  RAYSH    -> RAYS.ST (redan mappad men ticker i DB ar RAYSH)

Nordiska med .ST som kan ha fel Yahoo-symbol:
  EMBRACER-B.ST -> EMBRAC-B.ST (ratt Yahoo-symbol)
  BOLIDEN.ST    -> BOL.ST (ratt Yahoo-symbol)
  CALLIDITAS.ST -> kontrollera ratt symbol
  FAST.ST       -> BALD-B.ST? (Balder)
  FORTN.ST      -> FORTUM.HE (finsk aktie, fel bors)
  LUND-A.ST     -> kontrollera
  SWMA.ST       -> avlistad (Swedish Match koptes av PMI)

US-aktier:
  AMD laggs till i US_STOCKS

Krypto:
  Oka delay, ingen mappningsandring behovs

Metaller:
  Slopa grans pa 2 st, hamta alla 4
```

### Korningsordning efter deploy:
1. Kor fetch-history for saknade tickers
2. Kor generate-signals for alla
3. Verifiera att luckan minskat
