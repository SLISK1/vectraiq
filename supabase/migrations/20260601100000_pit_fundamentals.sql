-- ============================================================
-- Point-in-time fundamentals: append-only snapshots
-- ============================================================
-- Fundamentals are currently merged into symbols.metadata.fundamentals
-- as an OVERWRITING blob with no as-of date — so backtests reading them
-- see TODAY's restated numbers at every past date (lookahead bias).
-- This append-only store records what was KNOWN on a given date.

-- fundamentals_snapshots: one row per (symbol, as-of date, source)
--   Populated by fetch-fundamentals alongside the legacy metadata write.
CREATE TABLE IF NOT EXISTS public.fundamentals_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol_id uuid NOT NULL REFERENCES public.symbols(id) ON DELETE CASCADE,
  as_of date NOT NULL DEFAULT current_date,    -- the date this data was KNOWN/fetched
  report_date date,                            -- fiscal period end, if the API provides it (else null)
  fundamentals jsonb NOT NULL,                 -- same object currently merged into symbols.metadata.fundamentals
  source text NOT NULL DEFAULT 'fmp',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (symbol_id, as_of, source)
);
CREATE INDEX IF NOT EXISTS idx_fundamentals_snapshots_symbol_asof
  ON public.fundamentals_snapshots(symbol_id, as_of DESC);
ALTER TABLE public.fundamentals_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fundamentals_snapshots_select_all"
  ON public.fundamentals_snapshots FOR SELECT USING (true);
