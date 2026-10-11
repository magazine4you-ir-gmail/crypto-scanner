-- =====================================================================================
-- Hourly schedule for the auto scan.  Run ONCE in the Supabase SQL editor.
-- (Not a migration on purpose: it contains your project URL and secret.)
--
-- Before running:
--   1. supabase secrets set CRON_SECRET=<long-random-string>
--   2. supabase functions deploy scheduled-scan --no-verify-jwt
--   3. replace <PROJECT_REF> and <CRON_SECRET> below
-- =====================================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- remove an older schedule with the same name (safe if it does not exist)
select cron.unschedule('scheduled-scan-hourly')
 where exists (select 1 from cron.job where jobname = 'scheduled-scan-hourly');

-- minute :01 so the candle that closed at :00 is definitely available on Binance
select cron.schedule(
  'scheduled-scan-hourly',
  '1 * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/scheduled-scan',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

-- check:   select * from cron.job;      select * from cron.job_run_details order by start_time desc limit 5;
-- manual run (ignores the "already scanned" shortcut):  add ?force=1 to the URL
