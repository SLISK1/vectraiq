
-- 1. signal_snapshots tabell
CREATE TABLE public.signal_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id uuid NOT NULL REFERENCES public.asset_predictions(id),
  symbol_id uuid NOT NULL REFERENCES public.symbols(id),
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

-- 2. Unique constraint på module_reliability
ALTER TABLE module_reliability 
  ADD CONSTRAINT module_reliability_unique UNIQUE (module, horizon, asset_type);
