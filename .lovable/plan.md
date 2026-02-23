
# Fixa data for krypto, fonder och metaller — IMPLEMENTERAT ✓

## Ändringar gjorda

### 1. `fetch-history/index.ts` (omskriven)
- **Krypto**: Ökad delay till 6s, retry med exponentiell backoff (3 försök), loggar misslyckade tickers
- **Metaller**: Bytt från Alpha Vantage `FX_DAILY` till FMP (`XAUUSD`) + Yahoo futures (`GC=F`, `SI=F`, etc.)
- **Fonder**: Ny sektion 5 med proxy-ETF:er (SPY, VT, QQQ, VWO, XLE) via FMP/Yahoo
- Tog bort oanvänd Alpha Vantage metallhistorik-sektion

### 2. `fetch-prices/index.ts`
- **Metaller**: Bytt från Alpha Vantage `CURRENCY_EXCHANGE_RATE` till FMP commodity quotes (`XAUUSD`) + Yahoo futures fallback. Nu med riktig `change_24h` och `change_percent_24h`
- **Fonder**: Bytt från fejkad sinusfunktion (`Math.sin`) till riktiga proxy-ETF-priser via FMP/Yahoo
- Tog bort `SWEDISH_FUNDS` hardkodad konstant

### 3. `generate-signals/index.ts`
- Sänkt minimikrav från 10 till 5 datapunkter
- Tillgångar med <30 datapunkter: kör bara sentiment/seasonal/macro med confidence capped vid 35
- Lägger till "Begränsad data"-varning i evidence
