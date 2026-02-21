

# Fix: Betting backtest-data saknas

## Rotorsak

Två buggar blockerar all backtest-data:

1. **`fetch-matches` tittar bara framåt** (idag + 7 dagar). Matcher som redan spelats hamnar utanför fönstret och får aldrig sina resultat uppdaterade. Vissa matcher visar fortfarande `status: 'upcoming'` trots att de avgjorts.

2. **Inget scorar `betting_predictions`**. Funktionen `score-predictions` hanterar bara aktie/krypto-prediktioner (`asset_predictions` + `watchlist_cases`) men rör aldrig `betting_predictions`. Kolumnen `outcome` sätts aldrig, och BacktestPanel filtrerar på `outcome IS NOT NULL` — alltså noll resultat.

---

## Lösning

### 1. `fetch-matches` — hämta även resultat bakåt

Utöka datumfönstret till att även titta **3 dagar bakåt** för att fånga resultat för matcher som redan spelats:

```
dateFrom = idag - 3 dagar
dateTo   = idag + 7 dagar
```

Football-Data.org returnerar slutresultat (`score.fullTime`) för avslutade matcher. Nuvarande kod sparar redan `home_score` och `away_score` i upsert-logiken (rad 305-306), men de når aldrig databasen eftersom matcherna aldrig hämtas igen.

### 2. `score-predictions` — ny sektion för betting

Lägg till en tredje sektion i `score-predictions` som:

```
1. Hämta alla betting_matches med status = 'finished' 
   OCH home_score IS NOT NULL OCH away_score IS NOT NULL
2. Hitta matchande betting_predictions WHERE outcome IS NULL 
   OCH match_id i listan ovan
3. Beräkna outcome:
   - home_score > away_score → 'home'
   - home_score < away_score → 'away'
   - home_score = away_score → 'draw'
4. UPDATE betting_predictions SET outcome, scored_at = now()
```

### 3. Kör engångs-fix för befintliga matcher

Eftersom `fetch-matches` redan har uppdaterat vissa matcher till `status: 'finished'` med korrekta scores, behöver vi bara trigga scoring. Matcherna som fortfarande visar `upcoming` trots att de spelats fixas automatiskt vid nästa `fetch-matches`-körning med det utökade fönstret.

---

## Filer som ändras

| Fil | Ändring |
|---|---|
| `supabase/functions/fetch-matches/index.ts` | Ändra `dateFrom` till `idag - 3 dagar` istället för bara `idag` |
| `supabase/functions/score-predictions/index.ts` | Lägg till sektion 3: scora `betting_predictions` baserat på matchresultat |

---

## Teknisk detalj

I `score-predictions/index.ts`, ny logik efter befintlig watchlist-scoring:

```
// 3. Score betting_predictions
const { data: finishedMatches } = await supabase
  .from('betting_matches')
  .select('id, home_score, away_score')
  .eq('status', 'finished')
  .not('home_score', 'is', null)
  .not('away_score', 'is', null);

// Hämta oscorade predictions för dessa matcher
const matchIds = finishedMatches.map(m => m.id);
const { data: unscoredBets } = await supabase
  .from('betting_predictions')
  .select('id, match_id, predicted_winner')
  .is('outcome', null)
  .in('match_id', matchIds);

// Beräkna och uppdatera outcome per prediction
for (const pred of unscoredBets) {
  const match = finishedMatches.find(m => m.id === pred.match_id);
  const outcome = match.home_score > match.away_score ? 'home'
    : match.home_score < match.away_score ? 'away' : 'draw';
  
  await supabase.from('betting_predictions')
    .update({ outcome, scored_at: now })
    .eq('id', pred.id);
}
```

I `fetch-matches/index.ts`:

```
// Ändra rad 58-59 från:
const dateFrom = today.toISOString().split("T")[0];
// Till:
const threeDaysAgo = new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000);
const dateFrom = threeDaysAgo.toISOString().split("T")[0];
```
