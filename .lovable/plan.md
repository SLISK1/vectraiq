

# Fix: Avslutade matcher begränsade + Backtest slutat uppdatera

## Problem 1: Avslutade matcher begränsade till 20 stycken
**Fil**: `src/pages/BettingPage.tsx`, rad 105-126

Frågan som hämtar avslutade matcher har två begränsningar:
- Tittar bara **7 dagar bakåt** (`7 * 24 * 60 * 60 * 1000`)
- Har ett **tak på 20 matcher** (`.limit(20)`)

Det innebär att du aldrig kan se fler än 20 avslutade matcher, och matcher äldre än en vecka försvinner helt.

**Fix**: Utöka till 30 dagar bakåt och höj limiten till 100.

## Problem 2: Backtest fastnar på 40 (1X2)
**Fil**: `supabase/functions/score-predictions/index.ts`, rad 82-89

`score-predictions`-funktionen hämtar matcher som saknar resultat med `.limit(60)`. Men den viktigare begränsningen är att den bara letar 30 dagar bakåt efter resultat via football-data.org (3 x 10-dagarsintervall). Matcher äldre än 30 dagar som missade scoring förblir ospårade.

Dessutom hittar den bara matcher där `home_score IS NULL` -- om en match aldrig fick sitt resultat uppdaterat under de första 30 dagarna, scorar den aldrig.

**Fix**:
- Utöka till 60 dagars bakåtsökning (6 x 10-dagarsintervall)
- Höj limiten från 60 till 200 stale matches
- Gör att score-predictions inte filtrerar bort side bets (market != '1X2') vid outcome-scoring -- de ska bara hanteras av betting-settle

## Problem 3: Sidomarknader (0 sidospel) uppdateras inte
**Fil**: `supabase/functions/score-predictions/index.ts`

`score-predictions` sätter `outcome`-fältet på ALLA betting_predictions (inklusive side bets). Men backtest-panelen hämtar side bets via `bet_outcome`-fältet (som sätts av `betting-settle`). Problemet: `score-predictions` sätter `outcome` till 'home_win'/'away_win'/'draw' på side bets -- men sedan hoppar `betting-settle` över dem eftersom den bara tittar efter `bet_outcome IS NULL`, inte `outcome IS NULL`.

Tittar man på `betting-settle` rad 86-91 hämtas predictions med `.is("bet_outcome", null)` -- detta borde fungera. Men `score-predictions` (rad 169-173) har redan kört och satt `outcome` utan att filtrera ut side bets. Det skapar ingen direkt konflikt, men det visar att `betting-settle` faktiskt kör men hittar antingen inga finished matches eller att matcherna saknar score.

Den verkliga orsaken: `betting-settle` kräver att matchen har `status = 'FINISHED'` (rad ~108, case-sensitive check: `m.status === "FINISHED" || m.status === "finished"`). Men `score-predictions` sätter status till lowercase `'finished'` (rad 145). Om matchen aldrig gick igenom `score-predictions` först, har den fortfarande `status: 'upcoming'` och `betting-settle` hittar inga matcher att settla.

**Fix**: I `betting-settle`, matcha även mot matcher som har scores satta (home_score/away_score NOT NULL) oavsett status-texten. Alternativt: lägg till en explicit kontroll i score-predictions som skippar side bets (market != '1X2') när den sätter outcome.

## Sammanfattning av ändringar

| Fil | Ändring |
|-----|---------|
| `src/pages/BettingPage.tsx` | Utöka finished-query till 30 dagar + limit 100 |
| `supabase/functions/score-predictions/index.ts` | 6 chunks (60 dagar), limit 200, filtrera bort side bets vid outcome-scoring |
| `supabase/functions/betting-settle/index.ts` | Matcha finished matches bredare (home_score NOT NULL istället för bara status-check) |

