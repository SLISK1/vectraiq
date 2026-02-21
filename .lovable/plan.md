

# Fixa och utöka odds-integration i analyze-match

## Problemanalys

Odds-hämtning finns redan (rad 282-311) men har tre brister:

| Problem | Effekt |
|---------|--------|
| `SPORT_ODDS_KEY` saknar manga ligor | Matcher i t.ex. Allsvenskan, Eredivisie far aldrig odds |
| `marketImpliedProb` beraknas alltid for hemmavinst | `model_edge` blir fel nar AI:n tippar borta/oavgjort |
| Bara h2h-marknaden hamtas | Side predictions (total goals, BTTS) saknar marknadsodds att jamfora mot |

## Plan

### 1. Utoka `SPORT_ODDS_KEY` med fler ligor

Lagg till alla ligor som The Odds API stodjer:

```text
Allsvenskan -> soccer_sweden_allsvenskan
Superettan -> soccer_sweden_superettan
Eredivisie -> soccer_netherlands_eredivisie
Primeira Liga -> soccer_portugal_primeira_liga
Premiership -> soccer_spl (Skottland)
Belgian Pro League -> soccer_belgium_first_div
Super Lig -> soccer_turkey_super_league
MLS -> soccer_usa_mls
World Cup -> soccer_fifa_world_cup
```

Lagg aven till en fallback-sokning mot The Odds API:s sportlista om ingen mappning matchar.

### 2. Fixa `marketImpliedProb` for predicted winner

Nuvarande kod (rad 301-305):
```text
marketImpliedProb = rawHome / total  // Alltid hemmavinst!
```

Andras till att berakna implied probability for ALLA tre utfall och spara alla tre:

```text
marketImpliedProbHome = rawHome / total
marketImpliedProbDraw = rawDraw / total
marketImpliedProbAway = rawAway / total
```

Sedan beraknas `model_edge` baserat pa `predicted_winner`:
- Om predicted_winner = "home": edge = predictedProb - marketImpliedProbHome
- Om predicted_winner = "away": edge = predictedProb - marketImpliedProbAway
- Om predicted_winner = "draw": edge = predictedProb - marketImpliedProbDraw

### 3. Hamta odds for sidmarknader (totals + BTTS)

Utoka The Odds API-anropet till att inkludera fler marknader:

```text
markets=h2h,totals,btts
```

Spara totals-odds (over/under 2.5) och BTTS-odds i odds-kontexten som skickas till AI-prompten. Detta ger AI:n marknadsdata att jamfora sina side_predictions mot.

### 4. Inkludera sidodds i prompten

Utoka `oddsContext`-stringen med:

```text
SIDE MARKET ODDS:
  Over 2.5 goals: {overOdds} | Under 2.5 goals: {underOdds}
  BTTS Yes: {bttsYesOdds} | BTTS No: {bttsNoOdds}
```

### 5. Berakna side market edges

Lagg till logik som beraknar edge for sidmarknaderna ocksa, och spara dem i prediction-objektet (i `key_factors` eller som separata falt).

## Tekniska detaljer

### Fil som andras
- `supabase/functions/analyze-match/index.ts`

### Specifika andringspunkter

1. **Rad 8-18**: Utoka `SPORT_ODDS_KEY` med ~10 fler ligor
2. **Rad 289**: Andra API-anropet till `markets=h2h,totals,btts`
3. **Rad 296-306**: Uppdatera `findMatchInOdds` for att returnera totals + BTTS-odds utover h2h
4. **Rad 301-305**: Berakna implied prob for alla tre utfall
5. **Rad 322-324**: Utoka `oddsContext` med sidmarknadernas odds
6. **Rad 456**: Fixa `modelEdge`-berakningen baserat pa predicted_winner
7. **Rad 582-606**: Utoka `findMatchInOdds` for att extrahera totals + BTTS

### Uppdaterad `findMatchInOdds` returntyp

```text
{
  home: number,
  draw: number | null,
  away: number,
  totals?: { line: number, over: number, under: number },
  btts?: { yes: number, no: number }
}
```

### Ingen databasandring kravs
Alla nya varden sparas i befintliga JSONB-kolumner (`key_factors`, `sources_used`) eller i de redan existerande odds-kolumnerna.

