
-- Create pipeline_runs table for orchestration logging
CREATE TABLE public.pipeline_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  step_results jsonb DEFAULT '{}'::jsonb,
  coverage jsonb DEFAULT '{}'::jsonb,
  errors jsonb DEFAULT '[]'::jsonb
);

-- Enable RLS
ALTER TABLE public.pipeline_runs ENABLE ROW LEVEL SECURITY;

-- Deny all public writes
CREATE POLICY "pipeline_runs_deny_insert" ON public.pipeline_runs FOR INSERT TO anon, authenticated WITH CHECK (false);
CREATE POLICY "pipeline_runs_deny_update" ON public.pipeline_runs FOR UPDATE TO anon, authenticated USING (false);
CREATE POLICY "pipeline_runs_deny_delete" ON public.pipeline_runs FOR DELETE TO anon, authenticated USING (false);

-- Select for authenticated users only
CREATE POLICY "pipeline_runs_select_authenticated" ON public.pipeline_runs FOR SELECT TO authenticated USING (true);
