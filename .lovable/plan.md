

# Aktiescreener a la Avanza

## Sammanfattning
Bygga en ny "Screener"-flik i appen med en Avanza-inspirerad aktiescreener som visar alla tillgangar i en sorterbar tabell med filter, plus sektorkategorier for enkel navigering. Dessutom lagga till fler svenska aktier i databasen.

## Del 1: Lagga till fler svenska aktier

Du har redan 191 aktier pa OMX Stockholm. Vi lagger till ytterligare ~150-200 aktier for att tacka bredare (sma- och medelstora bolag som saknas). Detta gors via SQL INSERT i databasen med `ON CONFLICT DO NOTHING` for att undvika dubbletter.

Fokus pa:
- Small Cap-bolag som saknas (t.ex. Prostatype Genomics, Simris Group, PixelFox, etc.)
- Mid Cap-bolag som saknas
- NGM-listade bolag
- First North-bolag (populara)

## Del 2: Ny "Screener"-flik

### Ny navigeringsflik
Lagga till "Screener" som en ny flik i Header-komponenten, bredvid Dashboard, Watchlist, Portfolio, etc.

### Kategorisida (som Avanza "Kategorier")
- Rutnit med sektorkategorier: Energi, Finans, Teknologi, Halsovaird, Industri, Fastigheter, Material, Konsumentvaror, Kommunikation, Utilities
- Varje kategori ar en klickbar kort med ikon
- Klick filtrerar tabellen pa den sektorn

### Aktiescreener-tabell (som Avanza "Aktiescreener")
En sorterbar tabell med kolumner:
- **Namn** (ticker + bolagsnamn)
- **Utv. idag** (change_percent_24h)
- **Senast** (sista pris + valuta)
- **Sektor**
- **P/E-tal** (fran fundamentaldata i metadata)
- **Direktavk.** (dividend yield fran metadata)
- **Borsvarde** (market cap)
- **Signal** (VectraIQ:s UP/DOWN/NEUTRAL-riktning)

### Filter
Dropdown-/knappfilter ovanfor tabellen:
- **Bransch** (sektor-filter)
- **Borsvarde** (Small/Mid/Large Cap)
- **Tillgangstyp** (Aktier/Krypto/Fonder/Metaller)
- **Sok pa namn** (textsokning)

Alla filter ar kombinerbara och tabellen uppdateras i realtid.

### Sortering
Klickbara kolumnrubriker som sorterar stigande/fallande (med pil-ikon).

## Tekniska detaljer

### Nya filer
- `src/pages/ScreenerPage.tsx` - Huvudsidan med tabs for Kategorier/Screener
- `src/components/screener/ScreenerTable.tsx` - Sorterbar tabell
- `src/components/screener/ScreenerFilters.tsx` - Filterrad
- `src/components/screener/SectorCategories.tsx` - Sektorkategori-rutnit

### Andrade filer
- `src/components/Header.tsx` - Lagg till "Screener"-flik
- `src/pages/Index.tsx` - Rendera ScreenerPage nar screener-flik ar aktiv

### Dataflode
Screener-tabellen anvander befintlig `useSymbols()` hook som redan hamtar alla symbols med priser. Ingen ny edge function behovs - all data finns redan i databasen.

### Databas
SQL INSERT for ~150-200 nya svenska aktier (Small Cap, First North, NGM) med korrekta tickers, namn, sektor och exchange.

## Implementeringsordning
1. Lagg till nya aktier i databasen
2. Skapa ScreenerTable-komponenten med sortering
3. Skapa ScreenerFilters-komponenten
4. Skapa SectorCategories-komponenten
5. Skapa ScreenerPage som kombinerar allt
6. Uppdatera Header och Index for ny flik

