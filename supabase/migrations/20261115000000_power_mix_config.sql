/*
  # Power Mix Lab (میکس هوشمند) — global configuration

  ONE small table with ONE row: the global defaults of the Power Mix page (threshold, London / US / dead-hours windows,
  which side counts on which day class). Times are minutes since 00:00 Asia/Tehran and must be multiples of 30
  (the BTC reference candles are 30 minutes long).

  Nothing existing is altered: signal_outcomes, reverse_signal_outcomes, the Edge Functions and the cron jobs are untouched.
  Signed-in users can only READ this row (no insert / update / delete policy); the admin changes it in the SQL editor
  (see supabase/admin/power_mix_config.sql). Each user can additionally override the values for their own view in the browser.

  The BTC day power itself is NOT stored: it is computed in the browser from BTCUSDT 30m candles that the existing
  `market-data` Edge Function already serves, so it always follows the configured windows / threshold.
*/

create table if not exists public.power_mix_config (
  id                   boolean primary key default true check (id),          -- single-row table
  threshold_pct        numeric not null default 2    check (threshold_pct >= 0.1 and threshold_pct <= 20),
  london_start_min     integer not null default 690  check (london_start_min between 0 and 1410 and london_start_min % 30 = 0),
  london_end_min       integer not null default 870  check (london_end_min between 30 and 1440 and london_end_min % 30 = 0),
  us_start_min         integer not null default 990  check (us_start_min between 0 and 1410 and us_start_min % 30 = 0),
  us_end_min           integer not null default 1170 check (us_end_min between 30 and 1440 and us_end_min % 30 = 0),
  dead_start_min       integer not null default 120  check (dead_start_min between 0 and 1410 and dead_start_min % 30 = 0),
  dead_end_min         integer not null default 660  check (dead_end_min between 30 and 1440 and dead_end_min % 30 = 0),
  dead_late_start_min  integer not null default 1290 check (dead_late_start_min between 30 and 1440 and dead_late_start_min % 30 = 0),
  sel_very_strong      text not null default 'original' check (sel_very_strong in ('original', 'reverse', 'none')),
  sel_power            text not null default 'original' check (sel_power       in ('original', 'reverse', 'none')),
  sel_mixed            text not null default 'original' check (sel_mixed       in ('original', 'reverse', 'none')),
  sel_neutral          text not null default 'reverse'  check (sel_neutral     in ('original', 'reverse', 'none')),
  low_volume_ratio     numeric not null default 0.5 check (low_volume_ratio >= 0 and low_volume_ratio <= 1),
  updated_at           timestamptz not null default now(),
  -- London must end before US starts; dead hours = [start, end) and [late_start, 24:00)
  constraint power_mix_windows_ok check (
    london_start_min < london_end_min and london_end_min <= us_start_min and us_start_min < us_end_min
    and dead_start_min < dead_end_min and dead_end_min <= dead_late_start_min
  )
);

-- the single default row (idempotent)
insert into public.power_mix_config (id) values (true) on conflict (id) do nothing;

alter table public.power_mix_config enable row level security;

-- read-only for signed-in users; NO insert / update / delete policy -> only the service role / SQL editor can change it
drop policy if exists "Authenticated can read power mix config" on public.power_mix_config;
create policy "Authenticated can read power mix config"
  on public.power_mix_config for select to authenticated using (true);
