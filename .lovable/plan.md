

# Fullautomatisk tillaggning av nya tillgangar fran sokningen

## Nuvarande lage

Funktionaliteten ar **redan delvis implementerad**:
- `SearchAssets.tsx` visar en "Lagg till"-knapp nar ingen traffas i sokningen
- `add-symbol` edge-funktionen skapar symbolen i databasen och triggar `fetch-history`
- `useAddSymbol` hooken anropar edge-funktionen och invaldierar cachen

## Vad som saknas

1. **Ticker-validering ar for strikt** -- regex `^[A-Z0-9_-]{1,12}$` tillater inte punkter (`.`), men svenska aktier anvander ofta `.ST` (t.ex. `VOLV-B.ST`). Langden 12 ar ocksa for kort for langre fondnamn.

2. **Automatisk `fetch-prices` triggas inte** -- den nya symbolen far historikdata men inget live-pris forran nasta cron-korning (varje timme).

3. **Automatisk `generate-signals` triggas inte** -- inga analyser/prediktioner skapas for den nya symbolen forran nasta cron-korning.

4. **Smart typ-detektion saknas for nordiska aktier** -- funktionen gissar "stock" for allt som inte ar krypto/metall, men har ingen kunskap om att t.ex. ticker med `.ST`-suffix ar svenska aktier som behover `NORDIC_STOCKS`-mappningen.

5. **Inget `name`-uppslag** -- den nya symbolen far sitt ticker som namn (`name: cleanTicker`) istallet for bolagets riktiga namn.

## Losning

### Steg 1: Utoka `add-symbol` edge-funktionen

Forbattra edge-funktionen att:
- **Tillat punkter i ticker-formatet**: Andra regex till `^[A-Z0-9._-]{1,20}$`
- **Sla upp riktigt bolagsnamn** via FMP API (`/v3/profile/{ticker}`) och spara i `name`-faltet
- **Trigga `fetch-prices`** i bakgrunden (fire-and-forget) for den nya tickern
- **Trigga `generate-signals`** i bakgrunden (fire-and-forget) for den nya tickern
- **Battre typ-detektion**: Om tickern slutar pa `.ST` -- kategorisera som stock med SEK som valuta. Om den innehaller ETF-nyckelord, kategorisera som fond.

### Steg 2: Forbattra frontend-feedbacken

Uppdatera `handleAddNewSymbol` i `Index.tsx` att:
- Visa en toast med "laddar data i bakgrunden..." efter lyckad tillaggning
- Automatiskt invaldera `rankedAssets` efter en kort fordrojning (30s) sa att signalerna dyker upp

## Tekniska detaljer

### Filandringar

**`supabase/functions/add-symbol/index.ts`**:
```
- Andra ticker-regex fran /^[A-Z0-9_-]{1,12}$/ till /^[A-Z0-9._-]{1,20}$/
- Lagg till FMP API-uppslag for bolagsnamn (profile endpoint)
- Lagg till fire-and-forget anrop till fetch-prices for den nya tickern
- Lagg till fire-and-forget anrop till generate-signals for den nya tickern
- Forbattra typ-detektion: .ST-suffix -> stock/SEK, fond-nyckelord -> fund
```

**`src/pages/Index.tsx`**:
```
- Uppdatera handleAddNewSymbol med battre feedback-meddelanden
- Lagg till en setTimeout som invaliderar rankedAssets efter 30 sekunder
  sa att signalerna dyker upp utan manuell omladdning
```

### Flode efter implementering

1. Anvandaren soker pa t.ex. "VOLV-B.ST" i sokfaltet
2. Inga lokala resultat hittas -- knappen "Lagg till VOLV-B.ST" visas
3. Anvandaren klickar knappen
4. `add-symbol` edge-funktionen:
   a. Validerar och rengorer tickern
   b. Slar upp bolagsnamn via FMP
   c. Skapar symbolen i `symbols`-tabellen
   d. Triggar `fetch-history` (365 dagars historik)
   e. Triggar `fetch-prices` (live-pris)
   f. Triggar `generate-signals` (analyser och prediktioner)
5. Anvandaren far en toast: "VOLV-B.ST (Volvo) tillagd! Data hamtas i bakgrunden."
6. Efter ~30 sekunder invalideras cachen och tillgangen dyker upp i dashboarden med priser och signaler

