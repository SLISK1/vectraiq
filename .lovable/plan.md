

# Implementera självlärande system -- score-predictions fyller module_reliability

## Problem idag

Systemet har alla byggstenar pa plats men de ar inte ihopkopplade:

1. **`score-predictions`** sektion 5 (module_reliability) ar en stub -- den hamtar scored predictions men skriver aldrig nagot till `module_reliability`-tabellen
2. **`signals`-tabellen** skrivs over varje korning sa det finns ingen historisk koppling mellan vilka moduler som sa vad och vad som faktiskt hande
3. **`generate-signals`** laser aldrig fran `module_reliability` -- den anvander hardkodade vikter
4. **`module_reliability`-tabellen** ar tom (0 rader)
5. Klientsidan (`engine.ts`) laser redan fran `module_reliability` och justerar vikter -- men tabellen ar tom sa det gor inget

## Losning

### Steg 1: Ny tabell `signal_snapshots` -- bevara modulprediktioner

Varje gang `generate-signals` kor behover vi spara en snapshot av vad varje modul sa, kopplad till `asset_predictions`-raden. Detta gor det mojligt att i efterhand avgora vilka moduler som hade ratt.

```text
signal_snapshots
  id            uuid PK
  prediction_id uuid FK -> asset_predictions.id
  symbol_id     uuid FK -> symbols.id  
  module        text (technical, sentiment, quant, etc.)
  direction     enum (UP/DOWN/NEUTRAL)
  strength      int
  confidence    int
  horizon       enum
  created_at    timestamptz
```

RLS: SELECT for alla (samma som signals), INSERT/UPDATE/DELETE blockerade for anon.

### Steg 2: Uppdatera `generate-signals` -- spara snapshots + lasa reliability

1. **Spara snapshots**: Nar `asset_predictions` skapas, spara ocksa en rad per modul i `signal_snapshots` med samma `prediction_id`
2. **Lasa module_reliability**: Hamta alla rader fran `module_reliability` vid starten och anvand dem for att justera modulvikter (precis som `engine.ts` redan gor klientsidigt)
3. **Viktjustering**: Om en modul har hit_rate under 52% pa aktuell horisont+asset_type, sank vikten till 50%. Over 60% far 20% bonus.

### Steg 3: Implementera sektion 5 i `score-predictions` -- fyll module_reliability

Ersatt stubben med riktig logik:

1. Hamta alla scored `asset_predictions` (senaste 90 dagar) dar `hit IS NOT NULL`
2. For varje prediction, hamta tillhorande `signal_snapshots`
3. Avgora per modul om den hade ratt:
   - Modulens `direction` matchar `outcome` (UP/DOWN) -> hit
   - Modulens `direction` = NEUTRAL -> varken hit eller miss (exkluderas)
4. Aggregera per `(module, horizon, asset_type)`:
   - `total_predictions`: antal icke-NEUTRAL
   - `correct_predictions`: antal hits
   - `hit_rate`: correct / total
   - `reliability_weight`: 1.2 om hit_rate > 60%, 1.0 om 52-60%, 0.5 om < 52%
5. Upsert till `module_reliability` (ON CONFLICT `module, horizon, asset_type`)

### Steg 4: UI -- visa "Larsignaler" i StatsPanel

`StatsPanel.tsx` laser redan fran `module_reliability` och visar det -- men tabellen ar tom. Nar datan borjar fyllas pa kommer panelen automatiskt visa vilka moduler som presterar bast. Lagg till:

- En kort text som forklarar att vikterna justeras automatiskt
- Visa senaste uppdateringstid fran `module_reliability.last_updated`
- Markera moduler som ar nedgraderade (reliability_weight < 1.0) med en varningsikon

## Tekniska detaljer

### Databasmigrering

```sql
-- 1. signal_snapshots tabell
CREATE TABLE public.signal_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id uuid NOT NULL,
  symbol_id uuid NOT NULL,
  module text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('UP','DOWN','NEUTRAL')),
  strength integer NOT NULL,
  confidence integer NOT NULL,
  horizon text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_signal_snapshots_prediction ON signal_snapshots(prediction_id);
CREATE INDEX idx_signal_snapshots_module_horizon ON signal_snapshots(module, horizon);

-- RLS
ALTER TABLE signal_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "signal_snapshots_select_all" ON signal_snapshots FOR SELECT USING (true);
CREATE POLICY "signal_snapshots_deny_insert" ON signal_snapshots FOR INSERT WITH CHECK (false);
CREATE POLICY "signal_snapshots_deny_update" ON signal_snapshots FOR UPDATE USING (false);
CREATE POLICY "signal_snapshots_deny_delete" ON signal_snapshots FOR DELETE USING (false);

-- 2. Unique constraint pa module_reliability
ALTER TABLE module_reliability 
  ADD CONSTRAINT module_reliability_unique UNIQUE (module, horizon, asset_type);
```

### Filer att andra

1. **`supabase/functions/generate-signals/index.ts`**
   - Hamta `module_reliability` vid start
   - Justera vikter per modul baserat pa reliability_weight
   - Spara `signal_snapshots` nar prediction skapas

2. **`supabase/functions/score-predictions/index.ts`**
   - Ersatt stub i sektion 5 med full aggregeringslogik
   - Hamta `signal_snapshots` for scored predictions
   - Berakna hit_rate per (module, horizon, asset_type)
   - Upsert till `module_reliability`

3. **`src/components/StatsPanel.tsx`**
   - Lagg till forklarande text om automatisk viktjustering
   - Visa nedgraderade moduler med varningsikon
   - Visa tidsstampel for senaste uppdatering

### Dataflode

```text
generate-signals kor (t.ex. 10:00 UTC)
  |
  +-- Laser module_reliability -> justerar vikter
  +-- Kor analysmoduler med justerade vikter
  +-- Sparar signals (for live-visning)
  +-- Sparar asset_predictions (for scoring)
  +-- Sparar signal_snapshots (for laring)
  
  ...tid gar, horisonten lopar ut...

score-predictions kor (dagligen)
  |
  +-- Sektion 3: Scorar asset_predictions (hit/miss)
  +-- Sektion 5 (NY): Hamtar signal_snapshots for scored predictions
  +-- Beraknar per-modul hit_rate
  +-- Upsertar module_reliability
  
  ...nasta gang generate-signals kor...
  
generate-signals laser uppdaterad module_reliability
  -> Moduler som gjort fel far lagre vikt
  -> Moduler som traffat ratt far hogre vikt
  -> Systemet forbattras over tid
```

### Prioritetsordning

1. Databasmigrering (signal_snapshots + unique constraint)
2. generate-signals: spara snapshots + lasa reliability
3. score-predictions: implementera sektion 5
4. StatsPanel: forbattra visning

