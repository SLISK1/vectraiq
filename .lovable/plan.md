

# FMP som primar datakalla med Yahoo Finance som fallback

## Nuvarande situation
- **fetch-prices**: Yahoo Finance ar primar for alla aktiepriser (Nordic + US). FMP anvands bara for att fylla i saknat borsvarde och for korsvalidering.
- **fetch-history**: Yahoo Finance ar enda kallan for historisk prisdata for aktier.
- FMP ar ett officiellt, stabilt API med API-nyckel. Yahoo ar inofficiellt och kan blockas/rate-limitas nar som helst.

## Andring
Gora FMP till primar kalla och Yahoo till fallback i bade `fetch-prices` och `fetch-history`.

## Detaljplan

### 1. fetch-prices/index.ts

**FMP primar for US-aktier:**
- Hamta alla US-aktier i en batch via `GET /v3/quote/AAPL,MSFT,...?apikey=KEY` (1 anrop)
- Returnerar pris, change, changePercent, volume, marketCap direkt
- Bara om FMP misslyckas eller returnerar pris=0 -> fallback till Yahoo per ticker

**FMP primar for Nordic aktier:**
- Hamta varje Nordic-aktie via `GET /v3/quote/VOLV-B.ST?apikey=KEY`
- FMP stodjer nordiska tickers med suffix (.ST, .OL, .CO, .HE)
- Vid misslyckande -> fallback till Yahoo per ticker
- Rate limit: 150ms mellan anrop (FMP tillater ~300 req/min pa gratisnivan)

**Behall befintlig korsvalidering:**
- Nar FMP ar primar anvands Yahoo som validerande kalla istallet for tvartom
- Samma thresholds (3% warning, 15% replace)

**Oforandrat:**
- Crypto via CoinGecko (FMP har inte bra kryptotackning gratis)
- Metaller via Alpha Vantage
- Svenska fonder via NAV-uppskattning

### 2. fetch-history/index.ts

**FMP primar for US-aktier:**
- `GET /v3/historical-price-full/AAPL?from=DATE&to=DATE&apikey=KEY`
- Returnerar OHLCV per dag, perfekt for price_history-tabellen
- Fallback till Yahoo om FMP ger tomt svar

**FMP primar for Nordic aktier:**
- Samma endpoint med nordisk ticker: `/v3/historical-price-full/VOLV-B.ST?...`
- Fallback till Yahoo om FMP inte har data for specifik ticker

**Oforandrat:**
- Crypto via CoinGecko
- Metaller via Alpha Vantage

### 3. Ny hjalp-funktion: fetchFmpQuote och fetchFmpHistory

Lagger till FMP-specifika hjalpfunktioner i respektive edge function:

```text
fetchFmpQuote(ticker) -> { price, change, changePercent, high, low, open, volume, marketCap }
fetchFmpHistory(ticker, days) -> [{ date, open, high, low, close, volume }]
```

### 4. Flode efter andring

```text
US-aktier:    FMP batch -> [om misslyckad] -> Yahoo per ticker
Nordic:       FMP per ticker -> [om misslyckad] -> Yahoo per ticker  
Crypto:       CoinGecko (oforandrat)
Metaller:     Alpha Vantage (oforandrat)
Fonder:       NAV-uppskattning (oforandrat)

Korsvalidering: Yahoo validerar FMP-priser (omvant fran idag)
```

### Tekniska detaljer

**Filer som andras:**
- `supabase/functions/fetch-prices/index.ts` - FMP primar + Yahoo fallback + omvand korsvalidering
- `supabase/functions/fetch-history/index.ts` - FMP primar + Yahoo fallback

**API-budget (FMP gratisniva, 250 req/dag):**
- US batch: 1 anrop
- Nordic per ticker: ~80-100 anrop (en gang per cron-kor)
- Historik: ~12 anrop per kor (vanligtvis bara specifika tickers)
- Total: ryms inom gratisnivan

**Risker:**
- FMP gratisniva kan ha begransad tackning for sma nordiska aktier -> Yahoo fallback hanterar detta
- Ingen kostandsokning - alla API-nycklar finns redan konfigurerade

