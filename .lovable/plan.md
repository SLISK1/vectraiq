

# Fixa saknad data i Dashboard-filtren

## Problemanalys

Tre separata dataproblem orsakar de tomma fälten:

| Problem | Orsak | Omfattning |
|---------|-------|------------|
| **Large Cap / Mid Cap** tomt | `market_cap = 0` for alla 352 aktier i `raw_prices` | 100% av aktier |
| **Fonder / Metaller** tomt | 0 rader i `price_history` for dessa tillgangstyper | 11 symboler |
| **Top 10 UP/DOWN** tomt | Signaler genereras bara for `1d`-horisonten | 3 av 4 horisonter |

## Plan

### 1. Fixa market_cap-data for aktier

Problemet: `fetch-prices` edge function hamtar priser men sparar inte `market_cap` korrekt for aktier (FMP returnerar det i ett annat format an krypto).

- Granska `fetch-prices/index.ts` for att se hur market_cap populeras
- Fixa mappningen sa att FMP:s market cap-data sparas i `raw_prices.market_cap`
- Kor funktionen for att uppdatera alla aktier

### 2. Lagg till prishistorik for fonder och metaller

Problemet: `fetch-history` edge function hanterar troligen inte dessa tillgangstyper.

- Granska `fetch-history/index.ts` for att se vilka symboler som inkluderas
- Sakerfall att fonder (7 st) och metaller (4 st) inkluderas i batch-korningen
- Trigga en manuell historik-hamtning for dessa 11 symboler

### 3. Generera signaler for fler horisonter

Problemet: `generate-signals` edge function kor bara for `1d`.

- Granska `generate-signals/index.ts` for att se vilka horisonter som stods
- Utoka till att generera signaler for `1w`, `1mo` och `1y`
- Alternativt: anvand lokalt beraknade signaler (som screener:n redan gor) som fallback i dashboarden nar databassignaler saknas

### 4. Uppdatera filtrering i dashboarden

- Hantera fallet dar `market_cap = 0` battre i UI:t (visa "Saknar data" istallet for att doja tillgangen)
- Lagg till en fallback i Top 10-listan som beraknar signaler lokalt om databassignaler saknas for vald horisont

## Tekniska detaljer

### Filer som andras
- `supabase/functions/fetch-prices/index.ts` -- fixa market_cap-mappning
- `supabase/functions/fetch-history/index.ts` -- inkludera fonder/metaller
- `supabase/functions/generate-signals/index.ts` -- stod for fler horisonter
- `src/hooks/useMarketData.ts` -- fallback-logik for signaler
- `src/pages/Index.tsx` (eller relevant dashboard-komponent) -- UI-hantering av saknad data

### Dataflode efter fix

```text
fetch-prices -> raw_prices (med market_cap for aktier)
fetch-history -> price_history (for alla tillgangstyper)
generate-signals -> signals (for 1d, 1w, 1mo, 1y)
Dashboard -> Laser signals + fallback till lokal analys
```

### Prioriteringsordning
1. Market cap-fix (storst paverkan -- laser Large/Mid Cap for 352 aktier)
2. Prishistorik for fonder/metaller (laser 11 symboler)
3. Signaler for fler horisonter (laser Top 10 for alla horisonter)
4. UI-fallbacks (forbattrar upplevelsen aven nar data saknas)

