

# Betting Winrate-forbattring + Sidomarknader Fix

## Nuvarande problem (verifierat med databasanalys)

### Problem 1: Sidomarknader har NOLL data
Kolumnen `predicted_winner` ar `NOT NULL` i `betting_predictions`. Nar `analyze-match` infogar side bets (OU_GOALS, BTTS etc.) inkluderas INTE `predicted_winner` -- inserten misslyckas tyst. Darfor finns 0 rader med `market != '1X2'`.

### Problem 2: 50% traffsakerhet (1X2)
Databasanalys visar:
- **Home**: 28/46 ratt = **60.9%** -- bra!
- **Away**: 16/32 ratt = **50%** -- OK
- **Draw**: 9/27 ratt = **33%** -- katastrofalt
- Draw-prediktioners genomsnittliga edge: **-14.9%** (marknaden sager "nej")
- Modellen forutsager draw 25.7% av gangerna men traffar bara 33% av dem

Oavgjort-prediktionerna drar ner hela winrate fran ~57% (home+away) till 50.5%.

---

## Forbattringsplan

### Steg 1: Fixa sidomarknader (databasandring)
Gor `predicted_winner` nullable sa att side bet-rader kan infogas utan att ange vinnare.

```sql
ALTER TABLE betting_predictions ALTER COLUMN predicted_winner DROP NOT NULL;
```

### Steg 2: Uppdatera side bet-inserten
I `analyze-match/index.ts`, lagg till `predicted_winner: null` explicit pa alla side bet-rader (rad 926-1005) for att undvika framtida problem.

### Steg 3: Draw-avoidance strategi (storsta winrate-effekten)
I `analyze-match/index.ts`, implementera bevisbaserade regler som anvands av framgangsrika bettingsystem:

**3a: Draw-filter med evidens-gating**
- Om modellen forutsager "draw" OCH `model_edge < 0.03` (3%) -- avvisa prediktionen och valj nast basta alternativ (home/away)
- Om modellen forutsager "draw" OCH det saknas H2H-data + standings -- byt till home (hemmaplanfordel)
- Motivering: Draw ar den svaraste marknaden att forutsaga. Professionella modeller (Pinnacle, Betfair) visar att draws kraver >3% edge for att vara lonsamma

**3b: Home advantage bias-korrektion**
- Om tabellplacering saknas: fallback till hemmavinst med `predicted_prob = 0.42` (ligagenomsnitt)
- Anledning: I top-5-ligor vinner hemmalaget ~46% av matcherna; draw ar bara ~26%

**3c: Confidence-weighted value filter**
- Lata prediktioner med `confidence_capped < 45` ELLER `model_edge < -0.05` default:a till marknadens favorit istallet for modellens gissning
- Detta hindrar lagkonfidensguesswork fran att ra vinst

### Steg 4: Poisson-forbattring for side markets
Forbattra Poisson-modellens precision genom att inkludera:
- **Home/Away-split**: Anvand hemma-/borta-specifik malstatistik istallet for overlag (manga lag ar starka hemma men svaga borta)
- **Form-viktning**: Senaste 5 matchers malsnitt viktas 60/40 mot sasongssnittet
- Nuvarande implementation anvander redan Poisson men med oversall-snitt (rad 1288-1325)

### Steg 5: Closing Line Value-feedback till prompten
Ge AI:n feedback om historisk prestation per marknad i prompten:
- "Din historiska traffsakerhet for HOME: 61%, AWAY: 50%, DRAW: 33%. Undvik draw-prediktioner om du inte har stark statistisk grund."
- Detta ger LLM:en implicit kalibrering

### Steg 6: Retroaktivt skapa side bets for avslutade matcher
Kor en engangsmigration som skapar side bet-rader fran redan sparade `key_factors.side_predictions` i befintliga 1X2-rader (om de finns). Sedan kor `betting-settle` for att settla dem.

---

## Sammanfattning av filandringar

| Fil | Andring |
|-----|---------|
| **Migration SQL** | `ALTER TABLE predicted_winner DROP NOT NULL` |
| **`analyze-match/index.ts`** | 1) Draw-filter med edge-gating. 2) Explicit `predicted_winner: null` pa side bets. 3) Home advantage fallback. 4) Historisk traffsakerhet i prompt. |
| **`score-predictions/index.ts`** | Liten justering: logga side bet-scoring |
| **Engangsskript (SQL)** | Aterskap side bet-rader fran befintliga 1X2-prediktioners `key_factors->side_predictions` |

## Forvantad effekt
- **1X2 winrate**: Fran 50.5% till uppskattningsvis 55-58% (genom att eliminera 18 felaktiga draw-prediktioner)
- **Sidomarknader**: Fran 0 rader till ~400+ settleable side bets (4 marknader x 105 matcher)
- **ROI**: Forvantad forbattring fran +43% till stabilare genom att undvika negativ-edge bets

