-- Power Mix config RLS check. Run in the SQL editor (it rolls back). Every row must show ok = true.
begin;
create temp table result (name text, ok boolean, detail text);
grant all on result to authenticated;

insert into result select 'seed row exists', count(*) = 1, count(*)::text from public.power_mix_config;
insert into result select 'defaults: threshold 2, London 690-870, US 990-1170, dead 120/660/1290',
  threshold_pct = 2 and london_start_min = 690 and london_end_min = 870 and us_start_min = 990 and us_end_min = 1170
  and dead_start_min = 120 and dead_end_min = 660 and dead_late_start_min = 1290, ''
  from public.power_mix_config;

-- act as a signed-in, non-admin user
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

insert into result select 'authenticated can read', count(*) = 1, count(*)::text from public.power_mix_config;

with u as (update public.power_mix_config set threshold_pct = 9 returning 1)
insert into result select 'authenticated cannot update', count(*) = 0, count(*)::text from u;

do $$ begin
  begin insert into public.power_mix_config (id) values (false); insert into result values ('authenticated cannot insert', false, 'inserted');
  exception when others then insert into result values ('authenticated cannot insert', true, sqlerrm); end;
end $$;

with d as (delete from public.power_mix_config returning 1)
insert into result select 'authenticated cannot delete', count(*) = 0, count(*)::text from d;

reset role;
insert into result select 'row unchanged after the attempts', threshold_pct = 2, threshold_pct::text from public.power_mix_config;

select * from result order by name;
rollback;
