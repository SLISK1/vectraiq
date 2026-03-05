
-- api_cache without generated column (use application-level TTL check instead)
CREATE TABLE IF NOT EXISTS public.api_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  ttl_seconds integer NOT NULL DEFAULT 3600,
  provider text
);
ALTER TABLE public.api_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "api_cache_select_all" ON public.api_cache FOR SELECT USING (true);
