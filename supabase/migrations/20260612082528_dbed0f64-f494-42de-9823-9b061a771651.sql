CREATE TABLE IF NOT EXISTS public.data_quality_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol_id uuid REFERENCES public.symbols(id) ON DELETE CASCADE,
  ticker text,
  issue_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info','warning','critical')),
  detail jsonb,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_data_quality_issues_open
  ON public.data_quality_issues(resolved, detected_at DESC);

GRANT SELECT ON public.data_quality_issues TO anon;
GRANT SELECT ON public.data_quality_issues TO authenticated;
GRANT ALL    ON public.data_quality_issues TO service_role;

ALTER TABLE public.data_quality_issues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "data_quality_issues_select_all" ON public.data_quality_issues;
CREATE POLICY "data_quality_issues_select_all"
  ON public.data_quality_issues FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "data_quality_issues_deny_insert" ON public.data_quality_issues;
CREATE POLICY "data_quality_issues_deny_insert"
  ON public.data_quality_issues FOR INSERT TO anon, authenticated WITH CHECK (false);

DROP POLICY IF EXISTS "data_quality_issues_deny_update" ON public.data_quality_issues;
CREATE POLICY "data_quality_issues_deny_update"
  ON public.data_quality_issues FOR UPDATE TO anon, authenticated USING (false);

DROP POLICY IF EXISTS "data_quality_issues_deny_delete" ON public.data_quality_issues;
CREATE POLICY "data_quality_issues_deny_delete"
  ON public.data_quality_issues FOR DELETE TO anon, authenticated USING (false);