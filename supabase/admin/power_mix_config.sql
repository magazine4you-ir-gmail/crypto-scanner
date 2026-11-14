-- Power Mix Lab global defaults — ADMIN ONLY (run in the Supabase SQL editor as the project owner / service_role).
-- Normal app users have SELECT only (RLS). Every user can still override these values for their OWN view in the browser.
select * from public.power_mix_config;

-- threshold (%) a London / US window needs to count as "strong":
-- update public.power_mix_config set threshold_pct = 2, updated_at = now() where id;

-- windows, minutes since 00:00 Tehran (multiples of 30): London 11:30-14:30 = 690..870, US 16:30-19:30 = 990..1170
-- update public.power_mix_config set london_start_min = 690, london_end_min = 870, us_start_min = 990, us_end_min = 1170, updated_at = now() where id;

-- dead hours = [02:00, 11:00) and from 21:30:  120 / 660 / 1290
-- update public.power_mix_config set dead_start_min = 120, dead_end_min = 660, dead_late_start_min = 1290, updated_at = now() where id;

-- which side is the valid signal per day class ('original' | 'reverse' | 'none'):
-- update public.power_mix_config set sel_very_strong = 'original', sel_power = 'original', sel_mixed = 'original', sel_neutral = 'reverse', updated_at = now() where id;

-- low-volume label: day's London+US volume below this fraction of the 14-day median (0 = off):
-- update public.power_mix_config set low_volume_ratio = 0.5, updated_at = now() where id;
