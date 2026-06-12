
-- Helper functions for vault-based cron auth.
-- 1) seed_cron_service_token(p_token): SECURITY DEFINER, owned by postgres,
--    upserts the service-role token into vault under the name 'cron_service_token'.
--    Only callable from the service-role edge function (we revoke from anon/authenticated).
-- 2) _cron_service_token(): SECURITY DEFINER, returns the decrypted secret for
--    cron commands. Postgres-only EXECUTE.

CREATE OR REPLACE FUNCTION public.seed_cron_service_token(p_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM vault.secrets WHERE name = 'cron_service_token';
  IF v_id IS NULL THEN
    SELECT vault.create_secret(p_token, 'cron_service_token') INTO v_id;
  ELSE
    PERFORM vault.update_secret(v_id, p_token);
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_cron_service_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_cron_service_token(text) TO service_role;

CREATE OR REPLACE FUNCTION public._cron_service_token()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, vault
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_service_token' LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public._cron_service_token() FROM PUBLIC, anon, authenticated;
-- postgres role (used by pg_cron) inherits ownership privileges
