## Diagnos av nuläget

Snittet av `confidence_capped` senaste 7 dagarna är **44.7** (raw 47.3), inga value bets och 0 predictions ≥60. Rotorsakerna är inte att modellen är osäker – det är att vi *strypar* den. Konkret data från DB:

- **168 1X2-predictions** men bara **13** har `model_edge` ifyllt → ingen value-bet-detektion möjlig (kräver edge >5 % och conf ≥60).
- **0 settled bets** och `calibration_buckets` är tomt → kalibreringen står kvar i "Fas 1" (shrinkage ×0.85) som drar ner sannolikheter.
- **6 av 39 senaste** har `cap_reason = "Standings saknas; Inga skaderapporter tillgängliga"` → cap fastnar på 45–55.
- Sido-marknader (BTTS/OU/Corners/Cards/HT/FTS) sparas med **`sources_used = []`** och får ofta `confidence_capped = 30` när AI:n returnerar raw=30 (golvet MIN_CAP=40 används bara som tak, inte som golv).
- `module_reliability` har 10 rader men används inte i confidence-formeln idag.

## Mål

Höj snittet av `confidence_capped` från ~45 → ~60 för 1X2 och ~50 för sidomarknader, **utan** att modellen blir överkonfident. Skapa minst 3–5 value bets per dag istället för 0.

## Plan

### 1. Säkerställ odds på *alla* predictions (största enskilda lyftet)

Idag fetchas Odds API bara för "high-impact leagues" → 155 av 168 1X2-rader saknar `model_edge`. Det betyder att value-filter och konfidens-vikt aldrig triggas.

- I `analyze-match`: om `marketOdds*` saknas, hämta från senaste `odds_snapshots`-raden för matchen (vi har redan färska från `fetch-oddset-markets` / `odds_caching`) innan vi går till externa API. Faller den tillbaka används Pinnacle/Bet365-snapshot.
- Räkna `model_edge` också för CORNERS_OU, CARDS_OU, HT_OU_GOALS och FIRST_TO_SCORE när odds finns i snapshoten.

### 2. Räkna om cap-tabellen (mer evidensbaserad)

Nuvarande tak är för hårda när vi har Poisson + H2H + odds. Föreslagna nya nivåer:

```text
h2h≥5 + standings + odds      → 85   (idag 80, +5)
h2h≥3 + standings + odds      → 78   (idag 70, +8)
h2h≥3 + standings, ingen odds → 70
standings + h2h<3             → 65
endast confirmed_fact         → 55
inget                         → 45
```

Lägg till **bonus +5** om en kalibrerad p_cal finns och **+5** om news_sentiment har ≥3 källor inom 72 h. Avdraget för "inga skaderapporter" tas bort när ligan är top-5 (där laguppställning släpps 1 h före avspark – då hanteras det av en sen re-analysis istället).

### 3. Ersätt MIN_CAP-bugen med ett riktigt golv

Idag: `confidence_capped = min(raw, cap)`. När AI svarar raw=30 blir slutvärdet 30 trots `MIN_CAP=40`. Ändras till:

```text
confidence_capped = clamp(raw, MIN_CAP, cap)
```

Detta tar bort dagens "30:or" på sidomarknader.

### 4. Sidomarknader ärver kontext

I `analyze-match` skickar vi idag `confidence_raw` direkt till sidobets. Justera så att varje sidomarknad får sin egen confidence baserat på:

- Poisson-priorn → bonus +5 om p_raw är >0.6 eller <0.4 (tydligt utfall).
- Edge mot snapshot-odds när odds finns.
- Spara `sources_used` även för sidomarknader (kopiera huvudradens lista) så `n_sources > 0` i UI:t.

### 5. Aktivera kalibreringspipen

`calibration_buckets` är tomt eftersom inga bets settlats. Vi behöver:

- Schemalägga `betting-settle` + `update-calibration` dagligen (kollar `betting_matches` med `status='FINISHED'` och uppdaterar `bets_log.result`/`betting_predictions.bet_outcome`).
- När `n_samples ≥ 80` per bucket aktiveras Fas 2 → p_cal blir blandning av prior + empirisk. Då slutar `confidence_capped` ligga i Fas 1-shrinkage.
- Lägg in steget i `daily-pipeline` direkt efter `fetch-matches`.

### 6. Använd `module_reliability` i confidence

Dra in tabellens hit-rate per modul (poisson, h2h, news, ai_reasoning) i en viktad sum istället för dagens `confidence_raw = aiResult.confidence_raw`. Pseudo:

```text
raw = 100 * Σ(module_p_correct_i * weight_i) / Σ(weight_i)
```

Med Bayesiansk shrinkage (samma formel som `mem://tech/self-learning-logic`) mot prior 0.5 tills modulen har ≥30 settled bets.

### 7. UI och transparens (PredictionSection.tsx + BettingCard.tsx)

- Visa ringen i tre färger: **röd 0–44**, **gul 45–64**, **grön 65+** (idag är allt grått).
- Under ringen: "Källor: 4 stats + 2 news" baserat på `sources_used`-typer.
- Tooltip på cap-anledning så användaren ser vad som drog ner score.
- Badge "Value bet" (orange) visas direkt på matchkortet när `is_value_bet = true`.

### 8. Verifiering

- Innan/efter-snapshot: query `AVG(confidence_capped)` för senaste 50 predictions per market.
- Antal `is_value_bet = true` ska bli >0 inom 24 h.
- `pipeline_runs` ska visa "betting-settle" och "update-calibration" som `succeeded` dagligen.

## Tekniska detaljer

Filer som påverkas:

- `supabase/functions/analyze-match/index.ts` – cap-tabell, MIN_CAP-clamp, odds-fallback, sidomarknads-sources, module_reliability-viktning.
- `supabase/functions/daily-pipeline/index.ts` – lägg till steg för `betting-settle` och `update-calibration`.
- `supabase/functions/betting-settle/index.ts` – verifiera att den faktiskt skriver `result` (logga antal settled).
- `src/components/betting/PredictionSection.tsx` – färgad ring, källor-badge, cap-tooltip.
- `src/components/betting/BettingCard.tsx` – value-bet-badge.
- Ny migration: cron för `betting-settle` (varje 4 h) och `update-calibration` (efter settle).

Ingen DB-schemaändring krävs – kolumnerna finns redan.

## Förväntat resultat

Efter 1) + 2) + 3) bör snittet hoppa till ~58 direkt. Efter att settle/kalibrering körts några dagar och `module_reliability` har data tickar det vidare mot 62–65. Value bet-antalet går från 0 till 5–15/dag.
