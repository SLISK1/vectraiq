
# Fix: Sidomarknader settlas inte (2 root causes)

## Rotorsak 1: Saknad databasfunktion
`betting-settle` anropar `supabase.rpc("upsert_betting_cal_bucket", ...)` efter varje BTTS/OU_GOALS-settlement. Denna RPC-funktion existerar INTE i databasen. Eftersom alla uppdateringar samlas i `Promise.all`, far hela batchen att misslyckas -- inte en enda side bet settlas.

## Rotorsak 2: Timeout vid HT-scoring
76 matcher behover halvtidsresultat fran football-data.org med 6.5s fordrojning per match = ~8 minuters koretid. Edge functions har en timeout pa ca 60 sekunder, sa funktionen avbryts.

## Fix

### Steg 1: Skapa `upsert_betting_cal_bucket`-funktionen i databasen
SQL-migration som skapar den saknade RPC-funktionen, eller alternativt en tom `betting_calibration`-tabell + funktion.

Enklaste losningen: skapa en no-op funktion som inte krachar, alternativt skapa tabellen + upsert-logiken.

```sql
CREATE TABLE IF NOT EXISTS public.betting_calibration (
  market TEXT NOT NULL,
  bucket_idx INT NOT NULL,
  n_bets INT DEFAULT 0,
  n_wins INT DEFAULT 0,
  PRIMARY KEY (market, bucket_idx)
);

CREATE OR REPLACE FUNCTION public.upsert_betting_cal_bucket(
  p_market TEXT, p_bucket_idx INT, p_n_bets_delta INT, p_n_wins_delta INT
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.betting_calibration (market, bucket_idx, n_bets, n_wins)
  VALUES (p_market, p_bucket_idx, p_n_bets_delta, p_n_wins_delta)
  ON CONFLICT (market, bucket_idx) DO UPDATE SET
    n_bets = betting_calibration.n_bets + p_n_bets_delta,
    n_wins = betting_calibration.n_wins + p_n_wins_delta;
END;
$$;
```

### Steg 2: Optimera `betting-settle` for att undvika timeout
I `supabase/functions/betting-settle/index.ts`:
- **Begransnsa HT-anrop**: Max 5 HT-anrop per korning (istallet for alla 76). Ovriga HT-matcher far `void` temporart och kan settlas nasta korning.
- **Minska fordrojningen** fran 6500ms till 3000ms for de 5 anropen.
- Lagg till `console.log` sa vi kan se hur manga som settlas.

### Steg 3: Deploy och kor
Deploya den uppdaterade edge-funktionen och testa att "Scora"-knappen nu settlar sidomarknader.

## Filandringar

| Fil | Andring |
|-----|---------|
| Migration SQL | Skapa `betting_calibration`-tabell + `upsert_betting_cal_bucket`-funktion |
| `supabase/functions/betting-settle/index.ts` | Begransnsa HT-anrop till max 5 per korning, lagg till loggning |
