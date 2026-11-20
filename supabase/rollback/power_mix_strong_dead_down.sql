alter table public.power_mix_config drop constraint if exists power_mix_strong_ok, drop constraint if exists power_mix_sel_strong_ok, drop constraint if exists power_mix_sel_dead_ok;
alter table public.power_mix_config drop column if exists strong_pct, drop column if exists sel_strong, drop column if exists sel_dead;
