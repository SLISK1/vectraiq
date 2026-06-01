-- ============================================================
-- Data Quality / Sanity-Check layer (plan-improvement #10)
-- Records issues found in price_history BEFORE data reaches the
-- signal layer: future dates, non-positive prices, implausible
-- (unadjusted-split) jumps, staleness and missing data.
-- Populated by the validate-data edge function (daily-pipeline).
-- This is a write-only sink for issues — validate-data NEVER mutates
-- price_history; it only reads it and inserts rows here.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.data_quality_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol_id uuid REFERENCES public.symbols(id) ON DELETE CASCADE,
  ticker text,
  issue_type text NOT NULL,                    -- future_date | nonpositive_price | implausible_jump | stale_symbol | no_data
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  detail jsonb,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved boolean NOT NULL DEFAULT false
);

-- Open issues, newest first — the panel/hook query path.
CREATE INDEX IF NOT EXISTS idx_data_quality_issues_open
  ON public.data_quality_issues(resolved, detected_at DESC);

-- Public-read + service-role-write pattern, copied VERBATIM from the cache
-- tables in 20260306120000_signal_quality_upgrade.sql (single FOR SELECT
-- USING (true); writes go through the service role which bypasses RLS).
ALTER TABLE public.data_quality_issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "data_quality_issues_select_all"
  ON public.data_quality_issues FOR SELECT USING (true);
