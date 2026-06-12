
-- Tighten public SELECT policies → authenticated only
DROP POLICY IF EXISTS api_cache_select_all ON public.api_cache;
CREATE POLICY api_cache_select_authenticated ON public.api_cache FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS api_usage_select_all ON public.api_usage_tracker;
CREATE POLICY api_usage_select_authenticated ON public.api_usage_tracker FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS features_select_all ON public.features;
CREATE POLICY features_select_authenticated ON public.features FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS bets_log_select_all ON public.bets_log;
CREATE POLICY bets_log_select_authenticated ON public.bets_log FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS coupon_recommendations_select_all ON public.coupon_recommendations;
CREATE POLICY coupon_recs_select_authenticated ON public.coupon_recommendations FOR SELECT TO authenticated USING (true);

REVOKE SELECT ON public.api_cache FROM anon;
REVOKE SELECT ON public.api_usage_tracker FROM anon;
REVOKE SELECT ON public.features FROM anon;
REVOKE SELECT ON public.bets_log FROM anon;
REVOKE SELECT ON public.coupon_recommendations FROM anon;

-- Admin role on profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;
UPDATE public.profiles SET is_admin = true WHERE is_admin = false; -- existing users are admins (single-user app)

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT is_admin FROM public.profiles WHERE user_id = _user_id LIMIT 1), false)
$$;

-- Lock down SECURITY DEFINER functions: only service_role may execute
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.upsert_betting_cal_bucket(text, smallint, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.seed_cron_service_token(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;
