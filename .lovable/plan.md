

## Paper Portfolio -- Simulerad handel med latsaspengar

### Oversikt

Bygger ett komplett "Paper Portfolio"-system dar anvandare far en startkassa pa 100 000 SEK och kan simulera kop/salj-affarer i aktier, fonder och krypto. Ingen riktig handel -- enbart simulering.

### 1. Databasschema (4 nya tabeller)

**A) paper_portfolios**
- `id` uuid PK
- `user_id` uuid (NOT NULL, RLS-skyddad)
- `base_currency` text DEFAULT 'SEK'
- `starting_cash` numeric DEFAULT 100000
- `cash_balance` numeric DEFAULT 100000
- `created_at` / `updated_at` timestamptz

**B) paper_trades** (append-only logg)
- `id` uuid PK
- `user_id` uuid
- `portfolio_id` uuid FK -> paper_portfolios
- `symbol_id` uuid FK -> symbols
- `ticker` text
- `asset_type` text
- `side` text ('buy' | 'sell')
- `qty` numeric
- `price` numeric
- `fee` numeric
- `notional` numeric
- `executed_at` timestamptz DEFAULT now()
- `notes` text nullable

**C) paper_holdings** (aktuella positioner)
- `id` uuid PK
- `user_id` uuid
- `portfolio_id` uuid FK -> paper_portfolios
- `symbol_id` uuid FK -> symbols
- `ticker` text
- `qty` numeric
- `avg_cost` numeric
- `updated_at` timestamptz
- UNIQUE constraint: (portfolio_id, symbol_id)

**D) paper_portfolio_snapshots** (historik for graf)
- `id` uuid PK
- `user_id` uuid
- `portfolio_id` uuid FK -> paper_portfolios
- `snapshot_at` timestamptz DEFAULT now()
- `cash_balance` numeric
- `holdings_value` numeric
- `total_value` numeric
- `pnl_total` numeric
- `pnl_pct` numeric
- `benchmark_value` numeric nullable
- `benchmark_return_pct` numeric nullable

Alla tabeller far RLS-policies: SELECT/INSERT/UPDATE/DELETE enbart for `auth.uid() = user_id`.

### 2. Edge Functions (2 funktioner)

**A) paper-trade** (POST)
- Input: `{ symbol_id, ticker, side, amount_type: 'cash' | 'qty', amount, portfolio_id? }`
- Logik:
  1. Hamta eller skapa `paper_portfolios` for anvandaren (auto-init vid forsta trade)
  2. Hamta senaste pris fran `raw_prices` -- om inget pris finns, blockera trade
  3. Berakna qty/notional baserat pa `amount_type`
  4. Fee: 0.1% av notional
  5. Buy: verifiera cash >= notional + fee, uppdatera cash_balance, upsert holding (viktad genomsnittskostnad)
  6. Sell: verifiera holdings qty >= requested qty, uppdatera cash_balance, minska holding (ta bort om qty = 0)
  7. Spara trade i `paper_trades`
  8. Skapa snapshot i `paper_portfolio_snapshots`
  9. Returnera uppdaterad portfolio

**B) paper-snapshot** (POST, cron-anrop)
- Kor dagligen (eller vid varje trade)
- Loopar alla paper_portfolios
- For varje: summera holdings_value med senaste priser fran `raw_prices`
- Berakna benchmark-avkastning (OMXS30 / BTC beroende pa portfoljmix)
- Skriv snapshot-rad

### 3. Frontend -- Nya komponenter

**A) Ny tab: "Paper" i Header**
- Lagg till `'paper'` i TabId-typen
- Ikon: Wallet eller Briefcase (med annan stil an befintliga Portfolio)

**B) PaperPortfolioPage.tsx** (ny sida)
- Sammanfattningskort: Total Value, Cash, Holdings Value, Total P/L, Dagens P/L
- Disclaimer-banner: "Simulerad handel med latsaspengar. Ej finansiell radgivning."
- Holdings-tabell: ticker, typ, qty, avg_cost, last_price, market_value, P/L (SEK), P/L (%)
- Transaktionshistorik (senaste 20 trades)
- Utvecklingsgraf (snapshots over tid, jfr benchmark)
- "Aterstall portfolio" knapp med bekraftelsedialog

**C) PaperTradeModal.tsx** (ny modal)
- Oppnas fran:
  - RankedAssetCard (ny "Simulera trade" knapp)
  - AssetDetailModal (ny knapp)
  - PaperPortfolioPage holdings-tabell (salj-knapp)
- Innehall:
  - Symbolinfo (ticker, namn, senaste pris)
  - Kop/Salj toggle
  - Beloppstyp: SEK eller Antal
  - Beloppsinput
  - Uppskattat resultat (qty, notional, fee)
  - Bekrafta-knapp
  - Disclaimer-text

**D) usePaperPortfolio.ts** (ny hook)
- `usePaperPortfolio()` -- hamtar portfolio + holdings + priser
- `usePaperTrade()` -- mutation for att gora trade via edge function
- `usePaperSnapshots()` -- hamtar snapshots for graf
- `useResetPaperPortfolio()` -- mutation for att aterstalla

### 4. Integration med befintliga vyer

- **RankedAssetCard**: Ny knapp "Simulera" bredvid watchlist-knappen
- **AssetDetailModal**: Ny "Simulera kop/salj" knapp i header
- Knappar kraver inloggning (visar auth-modal om ej inloggad)

### 5. Benchmark-logik

- Bestams av portfoljens dominerande tillgangstyp:
  - Om flest aktier/fonder: anvand OMXS30 (eller narmaste index i symbols-tabellen)
  - Om flest krypto: anvand BTC
- Sparas i snapshots for historisk jamforelse

### 6. Cron-schema

- Daglig snapshot kl 22:00 UTC via pg_cron + pg_net (anropar `paper-snapshot`)

### 7. Filstruktur (nya filer)

```text
src/
  components/
    paper/
      PaperPortfolioPage.tsx
      PaperTradeModal.tsx
      PaperHoldingsTable.tsx
      PaperSnapshotChart.tsx
      PaperSummaryCards.tsx
  hooks/
    usePaperPortfolio.ts
supabase/
  functions/
    paper-trade/index.ts
    paper-snapshot/index.ts
  migrations/
    (4 tabeller + RLS + triggers)
```

### 8. Implementationsordning

1. Databasmigration (4 tabeller, RLS, triggers)
2. Edge function: `paper-trade`
3. Edge function: `paper-snapshot`
4. Hook: `usePaperPortfolio.ts`
5. Komponenter: PaperTradeModal, PaperSummaryCards, PaperHoldingsTable, PaperSnapshotChart
6. PaperPortfolioPage (sammansatt)
7. Header: lagg till "Paper" tab
8. Index.tsx: rendera PaperPortfolioPage
9. Integration: knappar i RankedAssetCard och AssetDetailModal
10. Cron-jobb for dagliga snapshots
11. Deploy edge functions

