-- ============================================================
-- Watchlist thesis & alerts
-- Lets users attach their own written thesis, a stop-loss and a
-- target/riktkurs to each watchlist case. The app uses stop_loss to
-- warn when the thesis is broken ("Tesen bruten" / "Stop-loss nådd").
-- The watchlist_cases table already exists with RLS — just add columns.
-- ============================================================

ALTER TABLE public.watchlist_cases
  ADD COLUMN IF NOT EXISTS thesis_note text,    -- user's written rationale for the case
  ADD COLUMN IF NOT EXISTS stop_loss numeric,   -- user-set stop-loss price (thesis-break trigger)
  ADD COLUMN IF NOT EXISTS target_price numeric; -- user-set target / riktkurs
