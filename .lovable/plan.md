
# Lägg till Fundamentalanalysdata

## Sammanfattning

Systemet har redan typdefinitioner (`FundamentalMetrics`) och strukturer för fundamentaldata, men använder idag endast prisbaserade proxy-indikatorer. Vi ska integrera riktiga fundamentaldata (P/E, P/B, ROE, etc.) från Finnhub API för att förbättra analysmodulens precision.

## Nuläge

- **Fundamentalmodulen** (`fundamental.ts`) visar "Fundamentaldata saknas" och beräknar endast momentum/volatilitet från prisdata
- **FundamentalMetrics interface** finns redan med P/E, P/B, debt-to-equity, ROE, etc.
- **Finnhub API-nyckel** är redan konfigurerad i secrets
- **symbols-tabellen** har ett tomt `metadata` JSONB-fält som kan användas för att lagra fundamentaldata

## Lösning

### Steg 1: Skapa ny edge function för fundamentaldata

Skapa `supabase/functions/fetch-fundamentals/index.ts` som:
- Anropar Finnhub Basic Financials API (`/stock/metric?symbol=X&metric=all`)
- Extraherar relevanta nyckeltal: P/E, P/B, ROE, debt-to-equity, dividend yield, market cap
- Sparar data i `symbols.metadata` JSONB-fält
- Körs schemalagt (dagligen) och vid behov

### Steg 2: Uppdatera analysmodulen

Modifiera `src/lib/analysis/fundamental.ts`:
- Ta emot `FundamentalMetrics` som optional parameter
- Använd riktiga nyckeltal när tillgängligt
- Behåll prisbaserade proxies som fallback
- Ge högre konfidens och coverage när riktiga data finns

### Steg 3: Uppdatera dataflödet

Modifiera `src/lib/api/database.ts` och `useMarketData.ts`:
- Inkludera metadata i symbol-queries
- Parsa fundamentaldata från metadata
- Skicka till analyskontext

### Steg 4: Visa fundamentaldata i UI

Uppdatera `ModuleSignalTable` eller skapa en ny komponent för att visa:
- P/E-tal med jämförelse mot branschsnitt
- ROE och skuldsättningsgrad
- Utdelningsavkastning

## Tekniska detaljer

### Finnhub Basic Financials API

Endpoint: `GET /stock/metric?symbol=AAPL&metric=all`

Returnerar bl.a.:
```text
metric: {
  "10DayAverageTradingVolume": 42.61,
  "52WeekHigh": 150.0,
  "52WeekLow": 89.14,
  "peBasicExclExtraTTM": 28.5,
  "pbQuarterly": 12.3,
  "roeTTM": 85.2,
  "debtEquityTTM": 1.95,
  "dividendYieldIndicatedAnnual": 0.65,
  "marketCapitalization": 2890000
}
```

### Edge function: fetch-fundamentals

```text
supabase/functions/fetch-fundamentals/index.ts:

1. Autentisering (intern anrop med service key)
2. Hämta aktiesymboler från symbols-tabellen
3. Loop genom symboler:
   - Anropa Finnhub /stock/metric endpoint
   - Extrahera: peRatio, pbRatio, roe, debtToEquity, dividendYield
   - Uppdatera symbols.metadata
4. Rate limiting: 60 req/min på Finnhub free tier
```

### Uppdaterad FundamentalMetrics

```text
metadata.fundamentals = {
  peRatio: number,
  pbRatio: number,
  roe: number,
  debtToEquity: number,
  dividendYield: number,
  revenueGrowth: number,
  earningsGrowth: number,
  lastUpdated: string
}
```

### Analyslogik

```text
Om fundamentals finns:
  - P/E < 15: +2 poäng ("Lågt P/E-tal")
  - P/E 15-25: 0 poäng ("Normalt P/E")
  - P/E > 25: -1 poäng ("Högt P/E-tal")
  
  - ROE > 15%: +2 poäng ("Stark avkastning på eget kapital")
  - ROE 8-15%: +1 poäng
  - ROE < 8%: -1 poäng
  
  - Debt/Equity < 0.5: +1 poäng ("Låg skuldsättning")
  - Debt/Equity > 2: -2 poäng ("Hög skuldsättning")
  
  Coverage höjs från 50% till 85%
  Confidence höjs med +15-20%

Om fundamentals saknas:
  - Fortsätt använda prisbaserade proxies (nuvarande logik)
```

## Filer som ändras

| Fil | Ändring |
|-----|---------|
| `supabase/functions/fetch-fundamentals/index.ts` | **Ny** - Edge function för att hämta fundamentaldata |
| `src/lib/analysis/fundamental.ts` | Uppdatera för att använda riktiga nyckeltal |
| `src/lib/analysis/types.ts` | Utöka FundamentalMetrics om nödvändigt |
| `src/lib/api/database.ts` | Inkludera metadata i queries |
| `src/hooks/useMarketData.ts` | Skicka fundamentals till analyskontext |
| `src/lib/analysis/engine.ts` | Skicka fundamentals till analyzeFundamental |

## Begränsningar

- **Endast aktier**: Finnhub Basic Financials fungerar bara för aktier, inte krypto/metaller
- **Rate limiting**: Finnhub free tier har 60 anrop/minut - behöver batcha
- **Nordiska aktier**: Kan ha begränsad täckning i Finnhub - US-aktier har bäst data

## Förväntad förbättring

| Mätpunkt | Före | Efter |
|----------|------|-------|
| Fundamental coverage | 45-70% | 75-95% |
| Fundamental confidence | 35-75% | 55-85% |
| Evidens-datapunkter | 3-5 | 8-12 |
| Meddelande i UI | "Fundamentaldata saknas" | P/E, ROE, etc. visas |
