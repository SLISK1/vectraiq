
# Förbättringsplan: Aktier / Fonder / Krypto — Prioriterad Roadmap

## Nulägesanalys

Utifrån granskning av kodbasen:

**Befintlig infrastruktur:**
- `symbols`, `raw_prices`, `price_history`, `signals`, `rank_runs`, `watchlist_cases` (med RLS)
- 10 analysmoduler i `src/lib/analysis/` (teknisk, fundamental, quant, volatilitet, säsong, sentiment, orderflow, measured moves, makro, ML)
- `macro.ts` använder hårdkodade statiska värden (ränta 3.25%, inflation 2.1%, BNP 1.8%)
- `signals`-tabellen saknar `rank_run_id`-index och har ingen historik (raderas och skrivs om)
- `watchlist_cases` har `hit` och `return_pct` men ingen `excess_return` vs benchmark
- `StatsPanel` beräknar hit-rate per horisont från `watchlist_cases` men bara för inloggad user
- Kryptoanalys: samma horisontvikter och modules som aktier — ingen separat regimdetektor
- Ingen benchmark/index-jämförelse i nuvarande pipeline

**Identifierade luckor:** asset_predictions-tabell, benchmark-integration, makro live-data, krypto-specifika regler, z-score normalisering, modul-reliability tracking, "vad skulle ändra signal"-UI.

---

## Prioritering av de 11 punkterna

| Prioritet | Punkt | Påverkan | Komplexitet |
|---|---|---|---|
| 1 (Krit.) | #2 Utvärderingsloop — asset_predictions-tabell | Utan detta kan ingenting bevisas | Medium |
| 2 (Hög) | #1 Benchmark/excess_return | Gör ranking meningsfull | Medium |
| 3 (Hög) | #3 Empirisk confidence-kalibrering | Slutar generera meningslösa 42% | Medium |
| 4 (Hög) | #10 UI: "varför" + "vad krävs för att ändra" | Direkt användarnytta | Låg |
| 5 (Med.) | #4 Reliability-viktning per modul | Hedgefond-mässig ensemble | Hög |
| 6 (Med.) | #7 Makro live-data (Riksbanken/SCB) | Ersätter hårdkodade värden | Låg |
| 7 (Med.) | #8 Krypto separata regler + likviditetsfilter | Stopp för skräp i top10 | Medium |
| 8 (Med.) | #9 Z-score normalisering | Bättre ranking | Medium |
| 9 (Låg) | #5 RLS-hårdning (news_cache → authenticated) | Säkerhet | Låg |
| 10 (Låg) | #6 Corporate actions | Korrekthet lång sikt | Hög |
| 11 (Låg) | #11 Job queue för ingestion | Stabilitet | Hög |

---

## Fas 1 — Databas: Nya tabeller + kolumner

### Ny tabell: `asset_predictions` (append-only, kärnan i allt)

```sql
CREATE TABLE public.asset_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol_id UUID NOT NULL REFERENCES public.symbols(id) ON DELETE CASCADE,
  rank_run_id UUID REFERENCES public.rank_runs(id) ON DELETE SET NULL,
  horizon horizon_type NOT NULL,
  predicted_direction signal_direction NOT NULL,
  predicted_prob NUMERIC(4,3),          -- 0-1 sannolikhet för den riktningen
  confidence INTEGER NOT NULL,
  total_score INTEGER NOT NULL,
  
  -- Entry snapshot
  entry_price NUMERIC NOT NULL,
  
  -- Baseline för excess return
  baseline_ticker TEXT,                 -- t.ex. 'OMXSPI' eller 'BTC'
  baseline_price NUMERIC,
  
  -- Filled when horizon ends (scheduler)
  exit_price NUMERIC,
  return_pct NUMERIC,
  excess_return NUMERIC,               -- return_pct - baseline_return_pct
  outcome signal_direction,            -- faktisk riktning
  hit BOOLEAN,                         -- predicted_direction = outcome?
  scored_at TIMESTAMP WITH TIME ZONE,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
-- RLS: SELECT för alla (publik market data, inga user-secrets)
-- INSERT/UPDATE/DELETE: bara service role
```

### Ny tabell: `module_reliability` (walk-forward hit rates per modul)

```sql
CREATE TABLE public.module_reliability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module TEXT NOT NULL,
  horizon horizon_type NOT NULL,
  asset_type TEXT NOT NULL,  -- 'stock', 'crypto', 'metal'
  
  -- Rolling window stats (uppdateras av scheduler)
  total_predictions INTEGER NOT NULL DEFAULT 0,
  correct_predictions INTEGER NOT NULL DEFAULT 0,
  hit_rate NUMERIC(4,3),               -- 0-1
  reliability_weight NUMERIC(4,3),     -- justerat vikt (0.5 om <52%, annars hit_rate)
  
  window_days INTEGER NOT NULL DEFAULT 90,  -- kalibreringsperiod
  last_updated TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  UNIQUE(module, horizon, asset_type)
);
```

### Ny tabell: `macro_cache` (ersätter hårdkodade värden)

```sql
CREATE TABLE public.macro_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_key TEXT NOT NULL UNIQUE,     -- t.ex. 'riksbank_rate', 'scb_cpif', 'ecb_rate'
  value NUMERIC NOT NULL,
  unit TEXT,                           -- '%', 'index', etc.
  source_url TEXT,
  fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  valid_until TIMESTAMP WITH TIME ZONE  -- weekly refresh
);
-- RLS: SELECT för alla, INSERT/UPDATE bara service role
```

### Ändring på `watchlist_cases`: lägg till `excess_return` och `baseline_ticker`

```sql
ALTER TABLE public.watchlist_cases 
ADD COLUMN excess_return NUMERIC,
ADD COLUMN baseline_ticker TEXT,
ADD COLUMN baseline_entry_price NUMERIC,
ADD COLUMN baseline_exit_price NUMERIC;
```

---

## Fas 2 — Edge Function: `score-predictions` (ny)

**Ansvar:** Körs dagligen (cron). Stänger predictions vars horisont har gått ut och beräknar outcome + excess_return.

```
GET asset_predictions WHERE exit_price IS NULL AND horizon slutat
→ Hämta aktuellt pris för symbol
→ Hämta baseline-pris (OMXSPI/BTC/ETH/OMXS30 beroende på asset_type)
→ Beräkna:
   return_pct = (exit_price / entry_price - 1) * 100
   baseline_return_pct = (baseline_exit / baseline_entry - 1) * 100
   excess_return = return_pct - baseline_return_pct
   outcome = 'UP' om exit > entry, 'DOWN' om exit < entry
   hit = (predicted_direction == outcome)
→ UPDATE asset_predictions SET exit_price, return_pct, excess_return, outcome, hit, scored_at = NOW()
```

Samma logik körs för `watchlist_cases` (uppdaterar `hit`, `return_pct`, `excess_return`).

**Benchmark-mapping:**
```
asset_type = 'stock', currency = 'SEK' → OMXSPI (Yahoo: ^OMXSPI)
asset_type = 'stock', currency = 'USD' → S&P500 (Yahoo: ^GSPC)
asset_type = 'crypto'                  → BTC  
asset_type = 'metal'                   → GLD
```

---

## Fas 3 — Edge Function: `fetch-macro` (ny)

**Ansvar:** Körs varje vecka. Hämtar makrodata från stabila gratis-källor och cachar i `macro_cache`.

**Datakällor:**
- Riksbanken API (gratis, öppen): `https://api.riksbank.se/swea/v1/Observations/SECBREPOEFF` → styrränta
- SCB JSON API (gratis): inflation CPIF
- ECB Statistical Data Warehouse (gratis, öppen): ECB-ränta
- Alternativt: FRED API (Federal Reserve, gratis) som fallback

**Uppdateringsfrekvens:** 1 gång/vecka (makro ändras sällan). Cachas i `macro_cache`.

**Ändring i `macro.ts`:** Funktionen `getCurrentMacroData()` ersätts med DB-lookup från `macro_cache`. Om ingen färsk data finns, behålls gamla värden med decay på confidence.

---

## Fas 4 — Engine-uppdateringar

### 4a. Empirisk confidence-kalibrering (`engine.ts`)

Nuläge: confidence beräknas deterministiskt från freshness/coverage/agreement.

Förbättring:
```
1. Läs senaste `module_reliability`-rader från DB (cachat i IndexedDB/memory, TTL 1 timme)
2. Beräkna "empirical_confidence" per modul:
   empirical_confidence = reliability.hit_rate * 100 (om >= 10 predictions)
   annars: behåll nuvarande formel
3. I calculateTotalConfidence(): blanda in empirical_confidence
4. Cap-regler:
   - coverage < 40% → max 55%
   - moduler ej överens (agreement < 50%) → sänk 10 poäng
   - inga färska prices (> 48h) → max 55%
```

### 4b. Reliability-viktad ensemble (`engine.ts`)

Nuläge: `DEFAULT_WEIGHTS` är fasta per horisont.

Förbättring (bakåtkompatibel):
```
effectiveWeight[module] = baseWeight[module] * reliabilityFactor[module]

reliabilityFactor = 
  1.2  om hit_rate > 60%  (bonus)
  1.0  om hit_rate 52-60% (normal)
  0.5  om hit_rate < 52%  (halvera)
  0.0  om < 5 predictions (ingen data, behåll basevikt)
```

### 4c. Krypto-specifika regler

- **Eget horisontviktsschema** för krypto: teknisk + volatilitet dominerar, fundamental = 0 för 1d/1w
- **Likviditetsfilter i `useRankedAssets`:** krypto under 10M USD volym/dag filtreras bort
- **Regimdetektor:** om BTC-volatilitet (30d) > 60% → sätt crypto regime = 'high_vol' → sänk alla confidence med 15%

### 4d. Z-score normalisering per sektor

I `transformToRankedAsset` (useMarketData.ts):
```
Beräkna z-score av totalScore inom samma sektor + asset_type bucket
presentera "score vs peers" (t.ex. "+1.2σ vs aktier i tech-sektorn")
```

---

## Fas 5 — UI-förbättringar

### 5a. `AssetDetailModal.tsx` — "Varför + vad krävs för att ändra åsikt"

**Ny sektion "Signalförklaring"** (under ModuleSignalTable):

```
Viktigaste positivt bidrag:   Teknisk analys (+22 poäng) — RSI översålt, MACD bullish
Viktigaste negativt bidrag:   Volatilitet (−8 poäng) — Hög annualiserad volatilitet

Vad skulle ändra signal till DOWN?
→ Teknisk: RSI över 70 + MACD-korsning negativ
→ Fundamental: P/E > 30 eller earnings miss
→ Makro: Riksbanken höjer räntan till > 4.5%
```

**Ny sektion "Excess Return vs Benchmark"** (om data finns i `asset_predictions`):
```
Senaste 20 predictions på 1w:
Asset: +3.2% i snitt | OMXSPI: +1.1% i snitt | Excess: +2.1%
Hit rate: 14/20 (70%) | Kalibrering: när vi säger 65%, träffar vi 63%
```

### 5b. `RankedAssetCard.tsx` — Kompakt benchmark-badge

Lägg till i kortet:
```
"+2.1% vs index" (grön om positiv excess)
"Hit 14/20 på 1w" (under ticker)
```

### 5c. `StatsPanel.tsx` — Lägg till excess_return + modul-reliability

Ny rad i tabellen:
```
Horisont | Predictions | Hit rate | Excess vs Index | Bästa modul
1 dag    | 45          | 58%      | +1.3%           | Teknisk (71%)
1 vecka  | 120         | 62%      | +2.8%           | Quant (68%)
```

---

## Fas 6 — RLS-härdning

### `news_cache` SELECT policy → `TO authenticated`

```sql
DROP POLICY "News cache is viewable by everyone" ON public.news_cache;
CREATE POLICY "News cache is viewable by authenticated users"
  ON public.news_cache FOR SELECT
  TO authenticated
  USING (true);
```

**Motivering:** Nyhetscachen är inte ett publikt behov — bara inloggade users ska nyttja den. `symbols`, `raw_prices`, `signals`, `rank_runs` behålls som publika (market data är ok att vara öppen).

---

## Filförteckning

**Databas (1 migration):**
- Ny tabell: `asset_predictions`
- Ny tabell: `module_reliability`
- Ny tabell: `macro_cache`
- ALTER TABLE: `watchlist_cases` (lägg till excess_return-kolumner)
- DROP + CREATE POLICY: `news_cache` SELECT → `TO authenticated`

**Nya Edge Functions (2 st):**
1. `supabase/functions/score-predictions/index.ts` — Stänger predictions, beräknar excess_return, uppdaterar module_reliability
2. `supabase/functions/fetch-macro/index.ts` — Hämtar Riksbanken/SCB/ECB-data, cachar i macro_cache

**Modifierade Edge Functions (1 st):**
- `supabase/functions/generate-signals/index.ts` — Spara snapshot i `asset_predictions` vid varje körning

**Modifierade analysmoduler (2 st):**
- `src/lib/analysis/macro.ts` — Hämta från `macro_cache` istället för hårdkodade värden
- `src/lib/analysis/engine.ts` — Reliability-viktning + empirisk confidence + krypto-regimdetektor

**Modifierade hooks (1 st):**
- `src/hooks/useMarketData.ts` — Likviditetsfilter för krypto, z-score normalisering, läs module_reliability

**Modifierade UI-komponenter (3 st):**
- `src/components/AssetDetailModal.tsx` — "Varför + vad ändrar åsikt", excess return-sektion
- `src/components/RankedAssetCard.tsx` — Benchmark-badge
- `src/components/StatsPanel.tsx` — Excess return + modul-reliability per horisont

**Ny UI-komponent (1 st):**
- `src/components/SignalFlipCard.tsx` — "Vad krävs för att ändra signal" (återanvändbar, används i AssetDetailModal)

---

## Vad utelämnas medvetet i denna fas

- **Corporate actions (#6):** Kräver en dedikerad datakälla (FMP Corporate Actions API). Tas i separat fas.
- **Job queue (#11):** pg_cron-schemat funkar tillräckligt bra; en riktig queue-arkitektur (t.ex. pg_listen) är överkill tills ingestionproblem faktiskt uppstår.
- **Fund data (fonder):** `asset_type`-enumen inkluderar inte 'fund' ännu — om fonder ska läggas till krävs en separat migration och fonddatakälla.
