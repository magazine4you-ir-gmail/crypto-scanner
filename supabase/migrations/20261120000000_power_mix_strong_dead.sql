/*
  # Power Mix Lab — "Strong" tier + separate dead-hours pick

  Adds three columns to the single-row table `power_mix_config` (all have defaults, so existing behaviour is unchanged):
    strong_pct   numeric  0 = off (classic 4 classes). > 0 = strength ladder (must be above threshold_pct).
    sel_strong   text     which side counts on "Strong" days.
    sel_dead     text     which side counts for signals issued in dead hours ('by_class' = follow the day class, the old behaviour).
  Nothing else is touched: no signal tables, Edge Functions or cron jobs.
*/
alter table public.power_mix_config add column if not exists strong_pct numeric not null default 0;
alter table public.power_mix_config add column if not exists sel_strong text not null default 'original';
alter table public.power_mix_config add column if not exists sel_dead   text not null default 'byClass';

alter table public.power_mix_config drop constraint if exists power_mix_strong_ok;
alter table public.power_mix_config add constraint power_mix_strong_ok check (strong_pct = 0 or (strong_pct > threshold_pct and strong_pct <= 40));
alter table public.power_mix_config drop constraint if exists power_mix_sel_strong_ok;
alter table public.power_mix_config add constraint power_mix_sel_strong_ok check (sel_strong in ('original', 'reverse', 'none'));
alter table public.power_mix_config drop constraint if exists power_mix_sel_dead_ok;
alter table public.power_mix_config add constraint power_mix_sel_dead_ok check (sel_dead in ('original', 'reverse', 'none', 'byClass'));
