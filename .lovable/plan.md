
# Implementera FMP API-integration for fundamentaldata

## Oversikt
Ersatt den nuvarande bristfalliga fundamentaldatahamtningen for nordiska aktier (som bara ger 52-veckors range) med Financial Modeling Prep (FMP) API som ger riktiga nyckeltal (P/E, ROE, skuldsattning, tillvaxt) for bade nordiska och US-aktier.

## Varfor FMP?
- Stodjer nordiska aktier via `.ST`-suffix (samma som Yahoo Finance)
- Gratis tier: 250 API-anrop/dag (racker for ~250 aktier dagligen)
- Har `ratios-ttm` endpoint med 60+ nyckeltal inklusive P/E, ROE, D/E, utdelning
- Har `profile` endpoint for marknadsvarde, sektor, bransch

## Andringar

### 1. Lagg till FMP API-nyckel som secret
- Anvandaren behover skapa ett gratis FMP-konto pa financialmodelingprep.com
- API-nyckeln sparas som `FMP_API_KEY` i backend-secrets

### 2. Uppdatera `fetch-fundamentals` edge function
- Lagg till ny funktion `fetchFMP()` som anropar:
  - `https://financialmodelingprep.com/stable/ratios-ttm?symbol=TICKER&apikey=KEY` for nyckeltal
  - `https://financialmodelingprep.com/stable/profile?symbol=TICKER&apikey=KEY` for marknadsvarde
- Mappning av FMP-falt till vart `FundamentalData`-interface:
  - `priceToEarningsRatioTTM` -> `peRatio`
  - `priceToBookRatioTTM` -> `pbRatio`
  - `returnOnEquityTTM` -> `roe`
  - `debtToEquityRatioTTM` -> `debtToEquity`
  - `dividendYieldTTM` -> `dividendYield`
  - `revenueGrowth` -> `revenueGrowth` (fran profile)
  - `netIncomeGrowth` -> `earningsGrowth` (fran profile)
- For nordiska aktier: anvand FMP forst, falla tillbaka pa `deriveFromPriceData` om FMP saknar data
- For US-aktier: FMP forst, sedan Finnhub, sedan Alpha Vantage (sparar Finnhub/AV rate limits)
- Delay: 300ms mellan FMP-anrop (250/dag = inga problem med batchar pa 50)
- Ta bort den hardkodade `US_TICKERS`-listan -- anvand FMP for alla aktier oavsett bors

### 3. Uppdatera `fundamental.ts` frontend-modul
- Uppdatera evidence-texten fran "Finnhub" till "FMP / Finnhub" for att reflektera den nya kallan
- Inga logikandringar behovs -- modulen anvander redan `FundamentalMetrics`-interfacet

## Tekniska detaljer

### Ny FMP-funktion i `fetch-fundamentals/index.ts`:

```text
fetchFMP(ticker, apiKey) -> FundamentalData | null
  1. Anropa ratios-ttm?symbol={ticker}
  2. Anropa profile?symbol={ticker}  
  3. Kombinera data till FundamentalData
  4. Returnera null om inga meningsfulla falt finns
```

### Andrad prioritetsordning per symbol:

```text
For ALLA aktier (bade nordiska och US):
  1. FMP (ratios-ttm + profile)  -- 300ms delay
  2. Finnhub (om FMP saknar data + finnhubApiKey finns)  -- 1100ms delay
  3. Alpha Vantage (sista utväg, max 5 st)  -- 12500ms delay
  4. deriveFromPriceData (om inget API har data)
```

### Filer som andras:
1. **supabase/functions/fetch-fundamentals/index.ts** -- ny `fetchFMP()` funktion, andrad prioritetsordning
2. **src/lib/analysis/fundamental.ts** -- uppdaterad source-text i evidence

### Uppsattning:
- FMP API-nyckel laggs till som backend-secret via add_secret-verktyget
