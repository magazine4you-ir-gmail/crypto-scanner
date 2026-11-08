-- =====================================================================================
-- Independent schedule for Reverse Signal Plus.  Run ONCE in the Supabase SQL editor.
-- It does NOT touch the existing 'scheduled-scan-hourly' job.
--
-- Before running:
--   1. supabase secrets set CRON_SECRET=<same value as for scheduled-scan>
--   2. supabase functions deploy reverse-plus-eval --no-verify-jwt
--   3. replace <PROJECT_REF> and <CRON_SECRET> below
-- =====================================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('reverse-plus-eval-hourly')
 where exists (select 1 from cron.job where jobname = 'reverse-plus-eval-hourly');

-- minute :08, after the hourly scan (:01) has had time to register its signals
select cron.schedule(
  'reverse-plus-eval-hourly',
  '8 * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/reverse-plus-eval',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
-- check:  select * from cron.job where jobname = 'reverse-plus-eval-hourly';
-- manual: curl -X POST -H "x-cron-secret: <CRON_SECRET>" "https://<PROJECT_REF>.supabase.co/functions/v1/reverse-plus-eval"
