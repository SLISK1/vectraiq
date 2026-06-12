
-- Move the cron auth helpers out of the public (Data API) schema.
CREATE SCHEMA IF NOT EXISTS cron_internal;

DROP FUNCTION IF EXISTS public.seed_cron_service_token(text);
DROP FUNCTION IF EXISTS public._cron_service_token();

CREATE OR REPLACE FUNCTION cron_internal.seed_cron_service_token(p_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = cron_internal, vault
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

REVOKE ALL ON FUNCTION cron_internal.seed_cron_service_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cron_internal.seed_cron_service_token(text) TO service_role;

CREATE OR REPLACE FUNCTION cron_internal._cron_service_token()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = cron_internal, vault
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_service_token' LIMIT 1;
$$;

REVOKE ALL ON FUNCTION cron_internal._cron_service_token() FROM PUBLIC;

-- Expose the seeding function over the Data API (rpc) without exposing the schema:
-- a thin public wrapper that only service_role can execute.
CREATE OR REPLACE FUNCTION public.seed_cron_service_token(p_token text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cron_internal.seed_cron_service_token(p_token);
$$;

REVOKE ALL ON FUNCTION public.seed_cron_service_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_cron_service_token(text) TO service_role;
