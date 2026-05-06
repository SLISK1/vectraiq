-- ============================================================
-- Schedule daily-pipeline via pg_cron
-- Runs once per day at 04:30 UTC (06:30 Stockholm winter / 07:30 summer)
-- — after US markets close, before EU markets open.
--
-- IMPORTANT: This requires the `app.settings.supabase_url` and
-- `app.settings.service_role_key` config values to be set in the
-- database. If they're not, run:
--
--   ALTER DATABASE postgres SET app.settings.supabase_url = 'https://<project>.supabase.co';
--   ALTER DATABASE postgres SET app.settings.service_role_key = '<service-role-jwt>';
--
-- Without these, pg_cron cannot authenticate the call to daily-pipeline.
-- ============================================================

-- Drop any previous schedule with the same name (idempotent re-run)
SELECT cron.unschedule('daily-pipeline-04-30')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-pipeline-04-30');

SELECT cron.schedule(
  'daily-pipeline-04-30',
  '30 4 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/daily-pipeline',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- Helpful view to see scheduled jobs
COMMENT ON SCHEMA cron IS 'Use SELECT * FROM cron.job; to inspect schedules. SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20; for run history.';
