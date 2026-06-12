CREATE INDEX IF NOT EXISTS idx_odds_snapshots_oddset
  ON public.odds_snapshots (match_id, market)
  WHERE source = 'oddset';