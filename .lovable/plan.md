

## Automatisk scoring via pg_cron

### Bakgrund
Edge function `score-predictions` finns redan och hanterar scoring av asset_predictions, watchlist_cases och betting_predictions. Den behöver bara schemaläggas att köras automatiskt varje timme.

### Implementering

**1. SQL via insert-verktyget (ej migration)**

Skapa ett pg_cron-jobb som anropar `score-predictions` varje hel timme via `pg_net`:

```sql
SELECT cron.schedule(
  'score-predictions-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://togoiyrzglwbuskghcve.supabase.co/functions/v1/score-predictions',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer <ANON_KEY>"}'::jsonb,
    body := '{"time": "' || now()::text || '"}'::jsonb
  ) AS request_id;
  $$
);
```

Anon-nyckeln används eftersom `verify_jwt = false` redan finns i `supabase/config.toml` for `score-predictions`.

**2. Verifiera att pg_cron och pg_net extensions är aktiverade**

Kör `CREATE EXTENSION IF NOT EXISTS pg_cron` och `CREATE EXTENSION IF NOT EXISTS pg_net` innan schemat skapas.

### Tekniska detaljer
- Schemat: `0 * * * *` = varje hel timme
- Endpoint: redan konfigurerad med `verify_jwt = false`
- Auth: edge function validerar `x-internal-call` header ELLER service role key, men med `verify_jwt = false` passerar anropet igenom direkt till funktionslogiken
- Inga kodändringar krävs -- bara ett SQL-insert för cron-jobbet

