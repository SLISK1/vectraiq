
-- Update cron jobs to generate signals for all horizons
SELECT cron.alter_job(15, command := $$
  SELECT net.http_post(
    url:='https://togoiyrzglwbuskghcve.supabase.co/functions/v1/generate-signals',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvZ29peXJ6Z2x3YnVza2doY3ZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzMjU4MDYsImV4cCI6MjA4NTkwMTgwNn0.OY8CnYrTfjHPaWP12lQYTFFr1VGrCFlNQQ78ERTpKMU"}'::jsonb,
    body:='{"limit": 50, "offset": 0, "allHorizons": true}'::jsonb
  ) AS request_id;
$$);

SELECT cron.alter_job(16, command := $$
  SELECT net.http_post(
    url:='https://togoiyrzglwbuskghcve.supabase.co/functions/v1/generate-signals',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvZ29peXJ6Z2x3YnVza2doY3ZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzMjU4MDYsImV4cCI6MjA4NTkwMTgwNn0.OY8CnYrTfjHPaWP12lQYTFFr1VGrCFlNQQ78ERTpKMU"}'::jsonb,
    body:='{"limit": 50, "offset": 50, "allHorizons": true}'::jsonb
  ) AS request_id;
$$);

SELECT cron.alter_job(17, command := $$
  SELECT net.http_post(
    url:='https://togoiyrzglwbuskghcve.supabase.co/functions/v1/generate-signals',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvZ29peXJ6Z2x3YnVza2doY3ZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzMjU4MDYsImV4cCI6MjA4NTkwMTgwNn0.OY8CnYrTfjHPaWP12lQYTFFr1VGrCFlNQQ78ERTpKMU"}'::jsonb,
    body:='{"limit": 50, "offset": 100, "allHorizons": true}'::jsonb
  ) AS request_id;
$$);

SELECT cron.alter_job(18, command := $$
  SELECT net.http_post(
    url:='https://togoiyrzglwbuskghcve.supabase.co/functions/v1/generate-signals',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvZ29peXJ6Z2x3YnVza2doY3ZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzMjU4MDYsImV4cCI6MjA4NTkwMTgwNn0.OY8CnYrTfjHPaWP12lQYTFFr1VGrCFlNQQ78ERTpKMU"}'::jsonb,
    body:='{"limit": 50, "offset": 150, "allHorizons": true}'::jsonb
  ) AS request_id;
$$);

SELECT cron.alter_job(19, command := $$
  SELECT net.http_post(
    url:='https://togoiyrzglwbuskghcve.supabase.co/functions/v1/generate-signals',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvZ29peXJ6Z2x3YnVza2doY3ZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzMjU4MDYsImV4cCI6MjA4NTkwMTgwNn0.OY8CnYrTfjHPaWP12lQYTFFr1VGrCFlNQQ78ERTpKMU"}'::jsonb,
    body:='{"limit": 50, "offset": 200, "allHorizons": true}'::jsonb
  ) AS request_id;
$$);
