

# Market Intelligence Pipeline: Komplett forbattringsplan (med alla tillagg)

## Fas 1: Kritiska berakningsfel (A-E, G)

### A. Score-skalning + konsekventa contributions

**Problem (engine.ts rad 125-128, 329-334, 338-345):**
- `calculateModuleScore` ger `dir * strength * (weight/100)` dar strength 0-100 (50=neutral). En neutral signal med strength=50 ger positivt bidrag vid UP.
- `normalizedScore` divideras med `totalWeight` (~100) som ger dubbeldelning.
- `direction` beraknas separat (rad 338-345) med annan logik an score -- kan ge motstridiga resultat.
- `topContributors` (rad 358-362) anvander `s.strength * (s.weight / 100)` -- en annan formel an calculateModuleScore, sa "fel moduler" kan visas som toppbidrag.

**Losning:**
- Konvertera strength fran 0-100 till signad -100..+100: `signedStrength = (strength - 50) * 2 * dirMultiplier`
- Module-bidrag = `signedStrength * (weight / totalWeight)` -- totalSignedScore i -100..+100
- `normalizedScore = 50 + totalSignedScore / 2` -- ger 0..100 score
- Direction fran sign av totalSignedScore med dead-zone +/-5
- **Tillagg:** `topContributors` ska anvanda exakt samma `calculateModuleScore()` -- returnera bade signedStrength och weightedContribution for att UI visar ratt moduler

**Filer:** `src/lib/analysis/engine.ts` rad 124-128 (calculateModuleScore), rad 329-345 (score+direction), rad 358-362 (topContributors)

---

### B. Kalibrerade Predicted Returns

**Problem (engine.ts rad 365-374):**
- Godtyckliga multiplikatorer (2, 5, 12, 25, 80)
- `regimeRisk` OKAR returns -- helt baklangt
- Resultatet utger sig for att vara "forvantad avkastning" men ar en amplitud-proxy

**Losning:**
- Berakna historisk daglig vol fran priceHistory
- `scoreSignal = (score - 50) / 50` (-1..+1)
- `expectedDailyMove = scoreSignal * dailyVol * shrinkage` (shrinkage=0.3)
- Skala per horizon med ratt dagar per tillgangstyp:
  - Aktier: 1w=5, 1mo=21, 1y=252
  - Krypto: 1w=7, 1mo=30, 1y=365
- Returnera `p10/p50/p90` (osakkerhetsband) och visa i UI
- **Tillagg:** Doep interim till `expectedMoveEstimate` / `signalMoveProxy` tills riktig kalibrering finns -- laatsas inte att punktvardet ar en prognos

**Filer:** `src/lib/analysis/engine.ts` rad 364-374, `src/types/market.ts` (PredictedReturns type -- lagg till p10/p90 per horizon)

---

### C. Separera signalConfidence fran reliability + fixad agreement

**Problem (engine.ts rad 159-161, 150-157):**
- `reliability` i ConfidenceBreakdown ar viktat medelvarde av `s.confidence` -- men det ar modulens interna sjalvrapporterade osakkerhet, inte empirisk traff
- `agreement` (rad 150-157) raknar `s.weight * (s.strength / 100)` -- men strength ar 0-100 dar 50=neutral, sa en neutral signal bidrar med 50% vikt till "enighet"

**Losning:**
- Doep om `reliability` till `signalStrength` i ConfidenceBreakdown
- Lagg till `empiricalReliability?: number` fran module_reliability DB
- **Tillagg:** Berakna `agreement` pa signedStrength (inte raa strength), sa att neutrala moduler inte snedvrider enighetsmattet
- Lagg till `low_sample_warning` flagga pa empiricalReliability om N ar litet

**Filer:** `src/types/market.ts` (ConfidenceBreakdown type), `src/lib/analysis/engine.ts` rad 131-168, `src/components/ConfidenceBreakdownCard.tsx`

---

### D. Bayesian shrinkage for reliability

**Problem (engine.ts rad 105-110, score-predictions rad 356):**
- Harda steg-funktioner (0.6->1.2, 0.52->1.0, else->0.5) skapar instabilitet vid gransvarden
- DB-falt heter `correct_predictions`/`total_predictions` men koden anvander `entry.hitRate`/`entry.totalPredictions` -- risk for undefined

**Losning:**
```
posteriorMean = (correct + a) / (total + a + b)  // Beta(10,10) prior
factor = clamp(0.7, 1.3, 1 + (posteriorMean - 0.5) * k)  // k=2
```
- **Tillagg:** Standardisera faltnamn med explicit mapping fran DB till type sa vi inte kor `undefined + 10`
- Start med Beta(10,10) for konservativ shrinkage -- kan overvagas Beta(3,3) om systemet ska lara sig snabbare
- Samma logik i bade `engine.ts` (klientsidan) och `score-predictions/index.ts` (serversidan rad 356) och `generate-signals/index.ts` (rad 360-367)

**Filer:** `src/lib/analysis/engine.ts` rad 105-110, `supabase/functions/score-predictions/index.ts` rad 356, `supabase/functions/generate-signals/index.ts` rad 360-367

---

### E. Renormalisera vikter efter reliability-justering

**Problem (engine.ts rad 313-326):**
- `adjustedWeight = baseWeight * factor` men aldrig renormaliserat -- total kan bli 70 eller 130 istallet for 100
- Felkalibrerar score, coverage, och confidence

**Losning:**
```
rawAdjusted = results.map(r => ({ result: r, weight: baseWeight * factor }))
totalRaw = sum(rawAdjusted.weight)
normFactor = 100 / totalRaw
signals = rawAdjusted.map(x => toModuleSignal(x.result, horizon, round(x.weight * normFactor)))
```
- **Tillagg:** Renormalisera per (horizon, assetType) -- inte globalt
- Spara `effective_weight` i signal_snapshots for transparens

**Filer:** `src/lib/analysis/engine.ts` rad 313-326, `supabase/functions/generate-signals/index.ts` rad 359-367

---

### G. Konsistent riktningslogik

Redan inkluderad i A -- direction harleds fran sign av totalSignedScore med dead-zone +/-5. Ingen separat logik.

---

## Fas 2: Datakvalitet och UI (F, H, I, J)

### F. Objektiv coverage (kravsbaserad per modul)

**Problem:** Moduler rapporterar sin egen coverage godtyckligt.

**Losning:**
- Definiera per modul ett "requirements schema":
  - `technical`: close + high/low + >= 50 datapunkter
  - `volatility`: close + timestamps + >= 30 datapunkter
  - `fundamental`: peRatio eller roe eller revenueGrowth
  - `macro/seasonal`: kan funka med mindre men flaggar "low data"
- Coverage = andel uppfyllda krav per modul
- Moduler returnerar null/undefined nar de saknar nodvandig data

**Filer:** Ny utility-funktion i `src/lib/analysis/engine.ts`, anvandd i varje moduls return

---

### H. Top contributors i NEUTRAL-lage

**Problem (engine.ts rad 358-362):** `.filter(s => s.direction === direction)` filtrerar bort allt vid NEUTRAL -- tom lista.

**Losning:**
- Vid NEUTRAL: sortera pa `abs(weightedContribution)` fran calculateModuleScore() (inte `(strength-50)*(weight/100)` som ar en annan skala)
- Visa topp 4 bidrag med signerad contribution
- **Tillagg:** Contribution-formeln MASTE matcha A/E:s nya scoring

**Filer:** `src/lib/analysis/engine.ts` rad 357-362

---

### I. Volatilitet: sampling-intervall

**Problem (volatility.ts rad 21):** Hardkodar `Math.sqrt(252)` aven for timdata.

**Losning:**
- Berakna **median** tidsdelta (inte mean -- mean forstors av helggap)
- Inferera periodsPerYear fran median delta
- Fallback till per-period vol utan annualisering + label om timestamps ar ojamna

**Filer:** `src/lib/analysis/volatility.ts` rad 8-22

---

### J. TrendPrediction: symmetrisk R:R + guardrails

**Problem (trendPrediction.ts rad 219):**
- `riskRewardRatio = (resistance - current) / riskAmount` aven vid DOWN
- Rad 139: DOWN stop method sags `support` men anvander resistance
- StopLoss kan bli for tajt vid noise

**Losning:**
- UP: `reward = resistance - current`, DOWN: `reward = current - support`
- Fixa method-namn: DOWN-case ska anvanda `resistance` (inte `support`) for stop
- `minStopDistance = max(ATR * 1.5, currentPrice * 0.02)` som golv
- NEUTRAL: visa "range trade" / disable TP/SL

**Filer:** `src/lib/analysis/trendPrediction.ts` rad 126-149 (stops), rad 219 (R:R), ny guardrail

---

## Fas 3: Server-side, backtest, sakerhet (K, L, M, N, O, P)

### K. Backtest/evaluation loop

- Lagg till `p_up`, `weights_version`, `model_version` kolumner i `asset_predictions`
- Ny `calibration_stats` tabell for Brier score per (horizon, asset_type, bucket)
- Cron-job for automatisk recalibration
- Frontend: ny "Modellprestanda"-flik

**DB-migration:**
```sql
ALTER TABLE asset_predictions 
  ADD COLUMN IF NOT EXISTS p_up numeric,
  ADD COLUMN IF NOT EXISTS weights_version text DEFAULT '1.0',
  ADD COLUMN IF NOT EXISTS model_version text DEFAULT '1.0';

CREATE TABLE IF NOT EXISTS calibration_stats (...);
```

---

### L. Flytta kritisk logik server-side (gradvis)

- `generate-signals` sparar redan server-beraknade signaler -- anvand dessa som primary source
- Lagg till `ranked_assets` cache-tabell som fylls av `generate-signals`
- Frontend hamtar fardiga rankningar istallet for att kora 10 moduler i browsern
- Inkrementell migration -- behover inte goras i ett steg

---

### M. Datapipes och priskvalitet

- Lagg till `quality_score`, `market_timestamp` i `raw_prices`
- Centraliserad exponential backoff i `fetch-prices`
- Marka fund proxy-priser i UI

---

### N. AI-analys: disciplin och validering

**Problem (ai-analysis/index.ts rad 12):** `assetType` saknar `fund`.

**Losning:**
- Lagg till `fund` i assetType (rad 12)
- Zod-schema-validering pa AI-svar innan retur
- Logga `{ model, prompt_version, input_tokens, output_tokens }`
- Inga nyheter/analyser -> tvinga `confidence < 45` + varning

---

### O. Sakerhet: service_role-skydd (nytt)

**Problem:** Flera edge functions (`generate-signals` rad 250, `score-predictions` rad 67) accepterar `Bearer {service_role_key}` som auth -- om nyckeln lackte kan nagon kora godtyckliga batch-operationer.

**Losning:**
- "Cron/internal" endpoints ska BARA acceptera `x-internal-call: true` header (som redan skotsas av Supabase cron)
- Ta bort `authHeader === Bearer ${supabaseServiceKey}` som godkand klient-auth
- Lagg till rate-limit / audit-log per edge function

---

### P. AI: prompt injection-skydd (nytt)

**Problem:** Firecrawl markdown kan innehalla prompt injection i `ai-analysis/index.ts`.

**Losning:**
- Sanera input: strip HTML-taggar, max tokens per kalla (redan 800 tecken, men lagg till HTML strip)
- Domanalowlist eller "source scoring"
- Instruera modellen att ENBART citera fran given text, aldrig fabricera kallor

---

## Implementeringsordning

| Prio | Atgard | Paverkan | Risk |
|------|--------|----------|------|
| 1 | A + G | Alla scores fixas | Hog |
| 2 | D + E | Sjalvlarande systemet stabiliseras | Hog |
| 3 | B | Missvisande returns tas bort | Medel |
| 4 | C | UI-klarhet (confidence vs reliability) | Lag |
| 5 | H + J | UI-buggar (tom lista, asymmetrisk R:R) | Lag |
| 6 | I + F | Datakvalitet (vol sampling, objektiv coverage) | Lag |
| 7 | N + P | AI-robusthet och sakerhet | Medel |
| 8 | O | Servicerolle-skydd | Medel |
| 9 | K | Backtest-infrastruktur | Lag |
| 10 | L + M | Gradvis server-migrering | Lag |

## Filer som berors (sammanfattning)

| Fil | Atgarder |
|-----|----------|
| `src/lib/analysis/engine.ts` | A, B, C, D, E, F, G, H |
| `src/lib/analysis/types.ts` | C (AnalysisContext assetType) |
| `src/lib/analysis/volatility.ts` | I |
| `src/lib/analysis/trendPrediction.ts` | J |
| `src/types/market.ts` | B (PredictedReturns), C (ConfidenceBreakdown) |
| `src/components/ConfidenceBreakdownCard.tsx` | C |
| `supabase/functions/score-predictions/index.ts` | D |
| `supabase/functions/generate-signals/index.ts` | D, E |
| `supabase/functions/ai-analysis/index.ts` | N, P |
| DB-migrationer | K, M |
| Enhetstester | A, D, E (nya) |

## Testplan

### Enhetstester (Fas 1)
- Max bullish signals -> score nara 100
- Max bearish signals -> score nara 0
- Balanserad mix -> score ~50
- Direction matchar sign av totalSignedScore
- Vikter summerar till 100 efter reliability-justering
- Bayesian: n=0 -> factor=1.0, n=100 + hitRate=0.7 -> factor~1.2
- Predicted returns: score=50 -> returns ~0, hog vol -> bredare band (inte hogre)
- NEUTRAL ger icke-tom topContributors

### Integrationstest (Fas 2)
- Kor `generate-signals` for 5 kanda aktier -- verifiera score-spridning 20-80 (inte 45-55)
- Verifiera volatilitet beraknas korrekt for crypto (365d) vs aktier (252d)
- TrendPrediction: DOWN-case ger korrekt R:R och stop-method

### Backtest (Fas 3)
- Gruppera `asset_predictions` per score-bucket
- Monotont okande hit-rate per bucket
- Brier score < 0.25
- Kalibreringskurva: predicted P(up) vs faktisk P(up)

