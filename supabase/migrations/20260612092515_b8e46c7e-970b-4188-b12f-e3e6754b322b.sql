select cron.schedule(
  'paper-snapshot-daily',
  '15 22 * * *',
  $$
  select net.http_post(
    url := 'https://togoiyrzglwbuskghcve.supabase.co/functions/v1/paper-snapshot',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_service_token' limit 1)
    ),
    body := '{}'::jsonb
  );
  $$
);