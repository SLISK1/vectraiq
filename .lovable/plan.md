
# Forbattrad ROI/Accuracy-plan (med alla tweaks)

## Prioriteringsordning (betting-fokus forst)

```text
5. Pipeline-orkestrering  (forutsattning for allt)
   |
   v
2. Value-filter + flat/capped staking  (snabbast ROI-effekt)
   |
   v
3. CLV-tracking  (matbar edge)
   |
   v
1. Kalibrering med 5 buckets + ECE/Brier  (modellplattform)
   |
   v
4. Sentiment med health-flagga  (oberoende signal)
   |
   v
6. Fond-proxy  (nice-to-have)
```

---

## Steg 1: Pipeline-orkestrering (Forslag 5)

### Ny edge function: `daily-pipeline/index.ts`

Kaller alla steg i ordning med felhantering och coverage-loggning:

```text
fetch-prices (alla aktiva symboler, batchat)
   -> logga: X symboler fick pris, Y missade
fetch-history (symboler som saknar >30 datapunkter)
generate-signals (batchar om 20)
   -> logga: X symboler fick signaler, per modul: hur manga som korats
score-predictions
   -> logga: X predictions utvarderade, Y watchlist, Z betting
fetch-matches + analyze-match (batch)
   -> logga: X matcher analyserade, Y saknade odds
```

### Ny tabell: `pipeline_runs`

| Kolumn | Typ |
|--------|-----|
| id | uuid PK |
| started_at | timestamptz |
| completed_at | timestamptz |
| status | text (running/completed/failed) |
| step_results | jsonb |
| coverage | jsonb |
| errors | jsonb |

`coverage`-faltet lagrar per-steg-metriker:
```json
{
  "prices": { "attempted": 85, "succeeded": 80, "failed_tickers": ["XYZ.ST"] },
  "signals": { "attempted": 80, "succeeded": 78, "modules_per_symbol": { "avg": 5.8, "min": 3 } },
  "scoring": { "predictions_evaluated": 12, "betting_scored": 5 }
}
```

### Cron-setup
- `0 6 * * *` (06:00 UTC dagligen)
- RLS: deny all public access, select for authenticated users

---

## Steg 2: Value-filter + konservativ staking (Forslag 2)

### Andringar i `analyze-match/index.ts`
- Berakna `is_value_bet = model_edge > 5 AND confidence_capped >= 60`
- Spara i `betting_predictions`

### Staking-logik (INTE Kelly an)
- Flat staking: fast belopp per spel
- Alternativt capped proportional: `stake = min(bank * 0.01, max_stake)`
- Ingen Kelly forran kalibreringen ar igang och vi har 200+ utvarderade bets

### Nya kolumner i `betting_predictions`
- `is_value_bet` (boolean)
- `suggested_stake_pct` (numeric, capped vid 1.0%)

### Frontend-andringar
- "VALUE" badge pa matcher med positiv edge > 5%
- Filter-toggle: "Visa bara value bets"
- Dolja/graya ut matcher med negativ edge

### Away-bias: INTE fixa Poisson an
- Dokumentera away-svagheten (30.8% hit rate)
- Koppla ihop med CLV-data (steg 3) for att forsta om problemet ar:
  - Poisson-modellens hemmafordel
  - Odds-kallans timing (pre-closing vs closing)
  - Bookmaker-mix

---

## Steg 3: CLV-tracking (Forslag 3)

### Nya kolumner i `betting_matches`
- `closing_odds_home` (numeric)
- `closing_odds_draw` (numeric)
- `closing_odds_away` (numeric)
- `closing_odds_fetched_at` (timestamptz)

### Ny kolumn i `betting_predictions`
- `clv` (numeric) = model_implied_prob - closing_implied_prob

### Ny edge function: `fetch-closing-odds/index.ts`
- Kors for matcher som ar <3h fran kickoff
- Hamtar odds fran **samma bookmaker/marknad** som anvandsfor prediction-odds (The Odds API)
- Sparar bade odds OCH timestamp for att undvika brus

### Logik i `score-predictions`
- Nar en match ar finished OCH har closing_odds:
  - `clv = model_implied_prob - (1 / closing_odds_X)` for ratt predicted_winner
  - Spara i betting_predictions

### Nya metrics att logga (fran dag 1)
- **CLV per tidsenhet** (genomsnittlig CLV senaste 30 dagarna)
- **ROI per odds-intervall** (1.4-1.8, 1.8-2.2, 2.2-3.0, 3.0+)
- **Hit rate per edge-bucket** (edge <0%, 0-5%, 5-10%, 10%+)

### Frontend
- CLV-kurva over tid i backtest-panelen
- ROI per odds-intervall (stapeldiagram)

---

## Steg 4: Kalibreringspipeline (Forslag 1)

### Justerad bucket-strategi
- **Start med 5 buckets** (0-20%, 20-40%, 40-60%, 60-80%, 80-100%) tills vi har 500+ predictions
- Byt till 10 buckets nar datamangden tillater det
- Minimum 20 predictions per bucket for att publicera (inte 50-100)

### Nya metrics (utover hit rate per bucket)
- **Brier Score**: `mean((predicted_prob - actual_outcome)^2)` -- lagre ar battre
- **ECE (Expected Calibration Error)**: viktat genomsnitt av |predicted - actual| per bucket
- **Log Loss**: `-mean(actual * log(pred) + (1-actual) * log(1-pred))`

### Kalibrerings-modell-versionering
- Spara `calibration_version` (t.ex. "v1-5bucket-2026-02") i calibration_stats
- Nar en ny kalibrering beraknas, bumpa versionen
- asset_predictions far en `calibration_version`-kolumn sa man vet vilken mapping som anvandes

### Andringar i `score-predictions/index.ts`
Lagg till steg 6 efter module_reliability (steg 5):

```text
Steg 6: Calibration stats
- Bucketa alla scored predictions (senaste 90 dagarna) i 5 intervall
- Berakna: actual hit rate, count, Brier, ECE per (bucket, horizon, asset_type)
- Upsert i calibration_stats
```

### Nya kolumner i `calibration_stats`
- `brier_score` (redan finns)
- `ece` (numeric)
- `log_loss` (numeric)
- `calibration_version` (text)
- `sample_count` (integer)

### Frontend
- Kalibreringskurva (Recharts): x = predicted prob bucket center, y = actual hit rate
- Diagonallinje for "perfekt kalibrering"
- Brier/ECE visas som KPI-kort

---

## Steg 5: Riktig nyhetssentiment med health-flagga (Forslag 4)

### Sentiment-kalla-hierarki
1. `ai-analysis` (bast, men kostar API-anrop)
2. `news_cache` (cached nyheter, gratis)
3. `none` (inget sentiment tillgangligt)

### Ny metadata per sentiment-signal
```json
{
  "sentiment_source": "ai" | "cached_news" | "none",
  "article_count": 12,
  "sentiment_score": 0.65
}
```

### Vikjustering baserad pa kalla
- `ai` -> full vikt (1.0x)
- `cached_news` -> reducerad vikt (0.5x) pga alder/coverage
- `none` -> vikt = 0 (inte momentum-proxy)

### Artikel-count-viktning
- 1-3 artiklar: 0.3x multiplikator
- 4-10 artiklar: 0.7x multiplikator
- 10+ artiklar: 1.0x multiplikator

### Andringar i `generate-signals/index.ts`
- Efter tekniska modulerna, kolla `news_cache` for symbolens ticker
- Om nyheter finns (<24h gamla): berakna sentiment fran titlar/descriptions
- Spara `sentiment_source` och `article_count` i signal evidence
- Om inga nyheter: satt sentiment-vikt till 0

---

## Steg 6: Fond-proxy (Forslag 6, bonus)

- Nar fond laggs till via `add-symbol`: identifiera proxy-ETF automatiskt
- Spara i `symbols.metadata.proxy_etf`
- `generate-signals` anvander proxy-ETF:ens prisdata for teknisk analys
- Reducerad konfidensgrad (tracking error-faktor)

---

## 5 Must-Have Metrics (loggas fran dag 1)

### Betting
| Metric | Var den loggas |
|--------|---------------|
| CLV per 30d | `pipeline_runs.coverage` |
| ROI per odds-intervall | Ny vy i backtest-panelen |
| Hit rate per edge-bucket | Ny vy i backtest-panelen |

### Markets (aktier/krypto/metaller)
| Metric | Var den loggas |
|--------|---------------|
| Brier Score | `calibration_stats` |
| ECE (Expected Calibration Error) | `calibration_stats` |

---

## Teknisk sammanfattning

### Nya filer
| Fil | Beskrivning |
|-----|-------------|
| `supabase/functions/daily-pipeline/index.ts` | Orkestrerings-function |
| `supabase/functions/fetch-closing-odds/index.ts` | Hamtar stangningsodds |

### Andrade filer
| Fil | Andringar |
|-----|-----------|
| `supabase/functions/score-predictions/index.ts` | Steg 6: calibration stats + CLV-berakning |
| `supabase/functions/generate-signals/index.ts` | Sentiment health-flagga + viktjustering |
| `supabase/functions/analyze-match/index.ts` | is_value_bet + suggested_stake_pct |
| `src/components/betting/BacktestPanel.tsx` | CLV-kurva, ROI per odds, hit rate per edge |
| `src/components/betting/MatchCard.tsx` | VALUE badge, grayout negativ edge |

### Nya/andrade tabeller
| Tabell | Andringar |
|--------|-----------|
| `pipeline_runs` | NY -- orkestrerings-logg |
| `betting_predictions` | +is_value_bet, +suggested_stake_pct, +clv |
| `betting_matches` | +closing_odds_home/draw/away, +closing_odds_fetched_at |
| `calibration_stats` | +ece, +log_loss, +calibration_version, +sample_count |

### Config
| Fil | Andringar |
|-----|-----------|
| `supabase/config.toml` | +daily-pipeline, +fetch-closing-odds (verify_jwt=false) |
| Cron (pg_cron SQL) | daily-pipeline 06:00 UTC |
