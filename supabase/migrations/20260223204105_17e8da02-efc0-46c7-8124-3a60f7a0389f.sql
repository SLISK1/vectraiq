
CREATE TABLE public.api_usage_tracker (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  date_key text NOT NULL,
  searches_used integer NOT NULL DEFAULT 0,
  last_updated timestamptz NOT NULL DEFAULT now(),
  UNIQUE(category, date_key)
);

ALTER TABLE public.api_usage_tracker ENABLE ROW LEVEL SECURITY;

CREATE POLICY "api_usage_select_all" ON public.api_usage_tracker FOR SELECT USING (true);
CREATE POLICY "api_usage_deny_insert" ON public.api_usage_tracker FOR INSERT WITH CHECK (false);
CREATE POLICY "api_usage_deny_update" ON public.api_usage_tracker FOR UPDATE USING (false);
CREATE POLICY "api_usage_deny_delete" ON public.api_usage_tracker FOR DELETE USING (false);
