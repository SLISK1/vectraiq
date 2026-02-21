
# Liga-filter och utokade match-prediktioner

## 1. Liga-filter pa BettingPage

Lagg till ett filter-rad under sport-valjaren som visar alla unika ligor fran matcherna i databasen. Anvandaren kan valja en eller flera ligor, eller "Alla" for att visa samtliga.

**Implementering i `src/pages/BettingPage.tsx`:**
- Ny state: `selectedLeague` (string | 'all')
- Extrahera unika ligor fran `matches` array efter laddning
- Visa knappar/badges for varje liga (Premier League, La Liga, Bundesliga, Serie A, Ligue 1, Champions League, etc.)
- Filtrera matchlistan pa vald liga innan rendering
- DB-queryn filtrar ocksa pa liga om inte "Alla" ar valt, for battre prestanda

**UI-design:**
- Horisontell scroll-rad med liga-badges under sport-valjaren
- "Alla" knapp forst, sedan varje liga med match-antal i parentes
- Samma stil som sport-valjarna men i `variant="outline"` storlek `sm`

---

## 2. Utokade prediktioner (hornor, kort, mål, frisparkar)

Utoka AI-analysen sa att `analyze-match` aven returnerar sidoprediktioner for:
- **Totalt antal mal** (Over/Under 2.5)
- **Hornor** (Over/Under 9.5)
- **Kort** (Over/Under 3.5)
- **Bada lagen gor mal** (BTTS Ja/Nej)

### Andringar i `supabase/functions/analyze-match/index.ts`:

Utoka prompten med extra JSON-falt:

```
"side_predictions": {
  "total_goals": { "line": 2.5, "prediction": "over"|"under", "prob": 0.0-1.0, "reasoning": "..." },
  "btts": { "prediction": "yes"|"no", "prob": 0.0-1.0, "reasoning": "..." },
  "corners": { "line": 9.5, "prediction": "over"|"under", "prob": 0.0-1.0, "reasoning": "..." },
  "cards": { "line": 3.5, "prediction": "over"|"under", "prob": 0.0-1.0, "reasoning": "..." }
}
```

Spara `side_predictions` i `betting_predictions.key_factors` JSONB-kolumnen (inget schemabyte behovs — `key_factors` ar redan JSONB).

### Andringar i `src/components/betting/MatchDetailModal.tsx`:

Lagg till en ny sektion "Sidoprediktioner" som visar:
- Over/Under 2.5 mal med sannolikhet
- BTTS (Bada lagen gor mal)
- Hornor Over/Under 9.5
- Kort Over/Under 3.5

Varje rad visar prediktion + sannolikhet i % + kort motivering.

### Andringar i `src/components/betting/MatchCard.tsx`:

Visa ett kompakt sammandrag av sidoprediktionerna under huvudprediktionen — t.ex. ikoner med "O2.5" "BTTS" etc. som smaknappar/badges.

---

## Filer som andras

| Fil | Andring |
|---|---|
| `src/pages/BettingPage.tsx` | Lagg till `selectedLeague` state, liga-filter UI, filtrera matcher |
| `src/components/betting/MatchCard.tsx` | Visa sidoprediktions-badges i kompakt format |
| `src/components/betting/MatchDetailModal.tsx` | Ny sektion for sidoprediktioner med detaljer |
| `supabase/functions/analyze-match/index.ts` | Utoka prompt med side_predictions, spara i key_factors |

---

## Tekniska detaljer

### Liga-filter (BettingPage)

```tsx
// Ny state
const [selectedLeague, setSelectedLeague] = useState<string>('all');

// Extrahera ligor fran matches
const leagues = [...new Set(matches.map(m => m.league))];

// Filtrera
const filteredMatches = selectedLeague === 'all' 
  ? matches 
  : matches.filter(m => m.league === selectedLeague);
```

### Prompt-utvidgning (analyze-match)

Prompten utvidgas med:
```
Also predict these side markets based on the statistical data:
- Total goals: Over/Under 2.5 (use Poisson with the calculated goal expectations)
- BTTS (Both Teams To Score): based on goals scored/conceded per game
- Corners: Over/Under 9.5 (estimate from league averages and team attacking style)
- Cards: Over/Under 3.5 (estimate from league discipline stats and match importance)

Include in your JSON response:
"side_predictions": {
  "total_goals": { "line": 2.5, "prediction": "over"|"under", "prob": <float>, "reasoning": "<short Swedish>" },
  "btts": { "prediction": "yes"|"no", "prob": <float>, "reasoning": "<short Swedish>" },
  "corners": { "line": 9.5, "prediction": "over"|"under", "prob": <float>, "reasoning": "<short Swedish>" },
  "cards": { "line": 3.5, "prediction": "over"|"under", "prob": <float>, "reasoning": "<short Swedish>" }
}
```

Sidoprediktionerna sparas i `key_factors` JSONB-kolumnen som ett extra objekt, sa att inget databasschema behover andras:

```ts
key_factors: {
  factors: aiResult.key_factors || [],
  side_predictions: aiResult.side_predictions || null,
}
```

### MatchDetailModal — ny sektion

En "Sidomarknader"-sektion med 4 rader i en grid som visar:
- Ikon + label (t.ex. fotboll-ikon + "Mal O/U 2.5")
- Prediktion (Over/Under)
- Sannolikhet i procent
- Kort motivering

### MatchCard — kompakta badges

Under huvudprediktionen visas smaknappar som:
`[O2.5 67%] [BTTS 58%] [Hornor U9.5 55%]`
