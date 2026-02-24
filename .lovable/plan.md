

# Strategi-flik -- Uppdaterad plan med riskfixar

## Anvandaren har identifierat 5 risker i den tidigare planen. Alla ingar nu som forstaklassfunktioner.

---

## Riskfix 1: Execution Policy (EntryPrice)

Ny config-parameter `execution_policy` med tre val:

```text
NEXT_OPEN  (default, rekommenderas)
NEXT_CLOSE
LIMIT_AT_SIGNAL_PRICE (avancerat)
```

- Nar strategimotorn skapar ett orderforslag laggs `execution_policy` + `signal_price` (priset vid signaltillfallet) i forslaget.
- I SIMULATE-lage anvands `next day open` som entry (hamtas fran price_history nasta dag).
- UI visar tydligt: "Entry: nasta dags oppning" med tooltip som forklarar varfor.

---

## Riskfix 2: Slippage + Courtage

Nya config-falt i `strategy_configs`:

```text
slippage_bps        numeric DEFAULT 10    -- 10 basis points
commission_per_trade numeric DEFAULT 0    -- fast belopp per trade (SEK)
commission_bps       numeric DEFAULT 0    -- alternativt procentuellt
```

PnL-berakning i SIMULATE:

```text
effective_entry = entry_price * (1 + slippage_bps/10000)   -- for long
effective_exit  = exit_price  * (1 - slippage_bps/10000)   -- for long
net_pnl = gross_pnl - (2 * commission_per_trade) - notional * (2 * commission_bps/10000)
```

UI i "Regler & Parametrar":
- Slippage (bps): slider 0-50, default 10
- Courtage per trade (SEK): input, default 0
- Courtage (bps): input, default 0
- Alla PnL-varden i loggen och oversikten visas som **netto** med en liten "brutto"-etikett tillganglig

---

## Riskfix 3: Survivorship Bias (S&P 500)

- UI visar tydlig text: "S&P 500-listan baseras pa dagens sammansattning och ar inte lämpad for historisk backtesting."
- Badge pa S&P 500-kallan: "CURRENT" (inte "HISTORICAL")
- Ingen backtesting-funktion byggs for S&P 500-universumet i denna version
- `universe_cache` lagrar `disclaimer: "current_constituents_only"` i payload

---

## Riskfix 4: Graceful Degradation for Fundamental Exits

Fundamental Position Mode far en fallback-kedja for exit-triggers:

```text
Prioritet 1: Earnings miss >10% (om data finns i fundamentals)
Prioritet 2: Negativ FCF (om data finns)
Prioritet 3: TotalScore < 55 OR SignalEnighet < 60 (alltid tillganglig)
Prioritet 4: Pris-baserad stop loss (alltid tillganglig)
Prioritet 5: Time-based review (veckovis re-evaluering)
```

- Om fundamental-triggers saknas: UI visar orange badge "Begransade exit-triggers" med forklaring
- Automation faller tillbaks pa pris + score-baserade exits

---

## Riskfix 5: Server-side strategimotor som source of truth

Strategimotorn kors **server-side** i en edge function (`strategy-evaluate`). Client-side koden ar bara for **preview/display**.

```text
Dataflode:
1. Anvandare sparar config -> strategy_configs (DB)
2. Edge function "strategy-evaluate" kors (cron eller manuellt)
   -> Hamtar config, bygger universum, kor quality gate + regim
   -> Skriver resultat till strategy_candidates, strategy_positions
3. Frontend laser fran DB och visar resultat
4. "Preview"-knapp i UI kor samma logik client-side for snabb feedback
   -> Men med tydlig markering: "Forhandsvisning -- ej sparad"
```

---

## Implementation -- 8 steg i ordning

### Steg 1: Databasmigration

6 nya tabeller + RLS:

**strategy_configs** -- en per anvandare
- id, user_id, portfolio_value (100000), max_risk_pct (1.0), max_open_pos (5), max_sector_pct (30)
- mean_reversion_enabled (false), total_score_min (65), agreement_min (80), coverage_min (90), vol_risk_max (60), max_staleness_h (24)
- automation_mode ('OFF'), schedule ('daily'), universe_sources (jsonb), combine_mode ('UNION'), candidate_limit (200)
- execution_policy ('NEXT_OPEN'), slippage_bps (10), commission_per_trade (0), commission_bps (0)
- created_at, updated_at

**strategy_candidates** -- utvarderingsresultat
- id, user_id, config_id, symbol_id, ticker, source, regime, status
- block_reasons (jsonb), total_score, confidence, trend_duration, trend_strength
- stop_loss_price, stop_loss_pct, target_price, target_pct, rr_ratio
- position_size, entry_price, signal_price, analysis_data (jsonb)
- fundamental_exit_available (boolean), evaluated_at, created_at

**strategy_positions** -- oppna/stangda simulerade positioner
- id, user_id, config_id, candidate_id, symbol_id, ticker, regime, side
- entry_price, effective_entry (efter slippage), stop_loss, take_profit, qty
- status ('open'/'closed'/'stopped'/'timed_out')
- opened_at, closed_at, exit_price, effective_exit
- gross_pnl, net_pnl, pnl_pct, slippage_cost, commission_cost, close_reason

**strategy_trade_log** -- alla handelser
- id, user_id, config_id, run_id, action, ticker, details (jsonb), created_at

**strategy_automation_jobs** -- korningshistorik
- id, user_id, config_id, started_at, completed_at, status
- universe_size, candidates_found, positions_opened, positions_closed, errors (jsonb)

**universe_cache** -- S&P 500 etc.
- id, cache_key (unique), payload (jsonb), source, updated_at, expires_at, is_stale

RLS: alla strategy_*-tabeller user_id = auth.uid(). universe_cache: SELECT for alla, write deny.

### Steg 2: Edge function `fetch-sp500`

- Hamtar fran FMP `/api/v3/sp500_constituent`
- FMP_API_KEY finns redan
- Caching i universe_cache, TTL 24h
- Fallback till stale cache vid API-fel
- Returnerar `{ source, updatedAt, tickers[], count, stale, disclaimer }`

### Steg 3: Strategimotor -- `src/lib/strategy/engine.ts`

Rena funktioner (anvands bade server-side och for preview):

- `evaluateCandidate(analysis, config)` -> `{ eligible, mode, reasons, suggestedOrder, fundamentalExitAvailable }`
- `buildUniverse(sources, combineMode, limit)` -> `ticker[]`
- `classifyRegime(analysis, config)` -> regime + reasons
- `calculatePositionSize(portfolioValue, riskPct, entryPrice, stopLoss)` -> qty + berakning
- `calculateNetPnl(entry, exit, qty, slippageBps, commissionPerTrade, commissionBps)` -> { gross, net, costs }

### Steg 4: Edge function `strategy-evaluate`

Server-side orkestrering:
1. Hamtar config fran strategy_configs
2. Bygger universum (watchlist + screener + SP500 + manuella)
3. For varje ticker: hamtar analysdata fran asset_predictions + signals
4. Kor quality gate + regimklassificering
5. Skapar strategy_candidates
6. I SIMULATE: oppnar/stanger positioner med slippage/courtage
7. Loggar allt i strategy_trade_log + strategy_automation_jobs
8. Auth: user JWT eller service role key

### Steg 5: Hooks -- `src/hooks/useStrategy.ts`

- `useStrategyConfig()` -- CRUD
- `useStrategyCandidates(configId)` -- laser fran DB
- `useStrategyPositions(configId)` -- oppna + stangda
- `useStrategyLog(configId)` -- med paginering
- `useSP500Universe()` -- anropar fetch-sp500
- `useRunEvaluation()` -- mutation som triggar strategy-evaluate

### Steg 6: Frontend-komponenter

```text
src/components/strategy/
  StrategyPage.tsx           -- Huvudsida med 4 tabs
  UniverseBuilder.tsx        -- Checkboxes, combine mode, SP500 status
  StrategyOverview.tsx       -- KPI-kort + kandidattabell
  CandidateTable.tsx         -- Sorterad tabell
  CandidateDetail.tsx        -- Sidepanel med regler, entry/stop/target, position size
  StrategyRulesForm.tsx      -- Sliders for thresholds, risk, slippage, courtage, execution policy
  AutomationPanel.tsx        -- Mode-valjare, schema, logg med CSV-export
  StrategyStatusBadge.tsx    -- Chips: "Klar att agera", "Vanta", "Blockerad", "Simulering"
  RegimeBadge.tsx            -- MOMENTUM / FUNDAMENTAL / MEAN_REVERSION
```

Layout foljder Screener-sidans monster (ikon-header, cards, tabell).

Disclaimer langst upp: "Historisk data garanterar inte framtida resultat. Denna funktion syftar till att hjalpa dig simulera och testa strategier."

### Steg 7: Navigation

- Lagg till `'strategy'` i TabId-typen
- Ny tab: `{ id: 'strategy', label: 'Strategi', icon: Target }`
- Rendera `<StrategyPage />` nar activeTab === 'strategy' i Index.tsx

### Steg 8: Cron for automation

- `strategy-evaluate` kors dagligen 09:00 UTC (efter signals ar klara)
- Veckovis alternativ: mandag 09:00 UTC
- Bara for anvandare med automation_mode = 'SIMULATE'

---

## Teknisk sammanfattning

### Nya filer
| Fil | Beskrivning |
|-----|-------------|
| `supabase/functions/fetch-sp500/index.ts` | S&P 500 via FMP + caching |
| `supabase/functions/strategy-evaluate/index.ts` | Server-side strategimotor |
| `src/lib/strategy/engine.ts` | Ren evaluerings-logik |
| `src/hooks/useStrategy.ts` | React hooks for strategi-data |
| `src/components/strategy/*.tsx` | 9 frontend-komponenter |

### Andrade filer
| Fil | Andringar |
|-----|-----------|
| `src/components/Header.tsx` | +strategy tab |
| `src/pages/Index.tsx` | +StrategyPage rendering |
| `supabase/config.toml` | +fetch-sp500, +strategy-evaluate |

### Nya tabeller
| Tabell | Rader |
|--------|-------|
| strategy_configs | 1 per anvandare |
| strategy_candidates | N per utvarderings-korning |
| strategy_positions | Simulerade trades |
| strategy_trade_log | Alla handelser |
| strategy_automation_jobs | Korningshistorik |
| universe_cache | S&P 500 + framtida index |

