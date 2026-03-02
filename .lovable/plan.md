# Betting Winrate-förbättring + Sidomarknader Fix — IMPLEMENTERAD ✅

## Genomförda ändringar

### ✅ Steg 1: DB-migration — predicted_winner nullable
`ALTER TABLE betting_predictions ALTER COLUMN predicted_winner DROP NOT NULL;`

### ✅ Steg 2: Side bet-insert fix
Alla side bet-rader (OU_GOALS, BTTS, CORNERS_OU, CARDS_OU, HT_OU_GOALS, FIRST_TO_SCORE) har nu `predicted_winner: null` explicit.

### ✅ Steg 3: Draw-avoidance strategi
- 3a: Draw-filter med edge-gating (<3% edge → byt till marknadsfavorit)
- 3b: Home advantage fallback (ingen H2H/standings → hemmavinst 42%)
- 3c: Confidence-weighted value filter (confidence <45 eller edge <-5% → marknadsfavorit)

### ✅ Steg 4: Poisson-förbättring
- Form-viktning: 60% senaste 5 matcher, 40% säsongssnitt
- Form-baserad attack/defense-estimering (W≈1.8 mål, D≈1.1, L≈0.6)

### ✅ Steg 5: CLV-feedback i prompt
AI:n informeras om historisk träffsäkerhet per marknad (HOME 61%, AWAY 50%, DRAW 33%) med instruktion att undvika draw.

### ✅ Steg 6: Retroaktiv side bet-data
SQL-migration skapade OU_GOALS, BTTS, HT_OU_GOALS och CORNERS_OU-rader från befintliga 1X2-prediktioners key_factors.

## Förväntad effekt
- **1X2 winrate**: 50.5% → ~55-58%
- **Sidomarknader**: 0 → hundratals settleable rader
- **ROI**: Stabilare genom eliminering av negativ-edge draws
