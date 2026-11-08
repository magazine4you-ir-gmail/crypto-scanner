-- Removes Reverse Signal Plus completely. Safe: nothing else references these objects.
drop table if exists public.reverse_plus_trades;
drop table if exists public.reverse_plus_evaluations;
drop table if exists public.reverse_plus_settings;
drop function if exists public.reverse_plus_settings_guard();
-- also (if scheduled): select cron.unschedule('reverse-plus-eval-hourly');
