-- Multi-user RLS check for the public Reverse Plus model.
-- Needs: roles `authenticated`, function auth.uid(), and the 3 reverse_plus migrations + 20261109000000_reverse_plus_public.sql applied.
-- Run in a scratch database / branch (it inserts and deletes test rows inside one transaction and rolls back).
begin;
-- two test users
insert into auth.users (id) values ('aaaaaaaa-0000-0000-0000-00000000000a'), ('bbbbbbbb-0000-0000-0000-00000000000b') on conflict do nothing;

-- central rows written as service role (superuser here)
insert into public.reverse_plus_evaluations (user_id, reverse_outcome_id, symbol, timeframe, side, eval_kind, as_of_close_time, stop_loss, take_profit, entry_status)
values (null, gen_random_uuid(), 'BTCUSDT', '1H', 'SELL', 'SIGNAL_TIME', now(), 101, 99, 'WAITING');
insert into public.reverse_plus_trades (user_id, mode, reverse_outcome_id, symbol, timeframe, side, stop_loss, take_profit)
values (null, 'PAPER', gen_random_uuid(), 'BTCUSDT', '1H', 'SELL', 101, 99);
-- B's private ACTUAL trade and legacy private evaluation
insert into public.reverse_plus_trades (user_id, mode, reverse_outcome_id, symbol, timeframe, side, stop_loss, take_profit)
values ('bbbbbbbb-0000-0000-0000-00000000000b', 'ACTUAL', gen_random_uuid(), 'ETHUSDT', '1H', 'BUY', 1, 2);
-- B enabled the module, A did not
insert into public.reverse_plus_settings (user_id, enabled) values ('bbbbbbbb-0000-0000-0000-00000000000b', true);
insert into public.reverse_plus_settings (user_id, enabled) values ('aaaaaaaa-0000-0000-0000-00000000000a', false);

create temp table result (name text, ok boolean, detail text);
grant all on result to authenticated;

-- 1+3: both users see the same central rows
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-00000000000a', true);
insert into result select 'A sees central evaluation', count(*) = 1, count(*)::text from public.reverse_plus_evaluations;
insert into result select 'A sees central PAPER trade, not B ACTUAL', count(*) = 1, count(*)::text from public.reverse_plus_trades;
insert into result select 'A sees public config', count(*) = 1, count(*)::text from public.reverse_plus_public_config;
insert into result select 'A sees only own settings', count(*) = 1, count(*)::text from public.reverse_plus_settings;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-00000000000b', true);
insert into result select 'B sees central evaluation', count(*) = 1, count(*)::text from public.reverse_plus_evaluations;
insert into result select 'B sees central PAPER + own ACTUAL', count(*) = 2, count(*)::text from public.reverse_plus_trades;

-- 7: users cannot write public data
do $$ begin
  begin insert into public.reverse_plus_evaluations (user_id, reverse_outcome_id, symbol, timeframe, side, eval_kind, as_of_close_time, stop_loss, take_profit, entry_status)
        values (null, gen_random_uuid(), 'X', '1H', 'BUY', 'LIVE', now(), 1, 2, 'WAITING');
        insert into result values ('user cannot insert central evaluation', false, 'insert allowed');
  exception when others then insert into result values ('user cannot insert central evaluation', true, sqlerrm); end;
  begin insert into public.reverse_plus_trades (user_id, mode, reverse_outcome_id, symbol, timeframe, side, stop_loss, take_profit)
        values (null, 'PAPER', gen_random_uuid(), 'X', '1H', 'BUY', 1, 2);
        insert into result values ('user cannot insert central trade', false, 'insert allowed');
  exception when others then insert into result values ('user cannot insert central trade', true, sqlerrm); end;
  begin insert into public.reverse_plus_trades (user_id, mode, reverse_outcome_id, symbol, timeframe, side, stop_loss, take_profit)
        values ('aaaaaaaa-0000-0000-0000-00000000000a', 'PAPER', gen_random_uuid(), 'X', '1H', 'BUY', 1, 2);
        insert into result values ('user cannot insert PAPER trade', false, 'insert allowed');
  exception when others then insert into result values ('user cannot insert PAPER trade', true, sqlerrm); end;
  begin insert into public.reverse_plus_public_config (id) values (false);
        insert into result values ('user cannot write config', false, 'insert allowed');
  exception when others then insert into result values ('user cannot write config', true, sqlerrm); end;
end $$;
with u as (update public.reverse_plus_trades set net_pnl = 999 where user_id is null returning 1)
insert into result select 'user cannot update central trade', count(*) = 0, count(*)::text from u;
with u as (update public.reverse_plus_public_config set min_rr = 0 returning 1)
insert into result select 'user cannot update config', count(*) = 0, count(*)::text from u;
with d as (delete from public.reverse_plus_evaluations returning 1)
insert into result select 'user cannot delete evaluations', count(*) = 0, count(*)::text from d;

-- 5: B disabling the module changes nothing for A
reset role;
update public.reverse_plus_settings set enabled = false where user_id = 'bbbbbbbb-0000-0000-0000-00000000000b';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-00000000000a', true);
insert into result select 'A still sees central evaluation after B disabled', count(*) = 1, count(*)::text from public.reverse_plus_evaluations;

-- idempotent central upsert via owner_key
reset role;
insert into public.reverse_plus_evaluations (user_id, reverse_outcome_id, symbol, timeframe, side, eval_kind, as_of_close_time, stop_loss, take_profit, entry_status)
values (null, '11111111-1111-1111-1111-111111111111', 'SOLUSDT', '1H', 'BUY', 'SIGNAL_TIME', now(), 1, 2, 'WAITING')
on conflict (owner_key, reverse_outcome_id, eval_kind) do nothing;
insert into public.reverse_plus_evaluations (user_id, reverse_outcome_id, symbol, timeframe, side, eval_kind, as_of_close_time, stop_loss, take_profit, entry_status)
values (null, '11111111-1111-1111-1111-111111111111', 'SOLUSDT', '1H', 'BUY', 'SIGNAL_TIME', now(), 1, 2, 'WAITING')
on conflict (owner_key, reverse_outcome_id, eval_kind) do nothing;
insert into result select 'central upsert is idempotent', count(*) = 1, count(*)::text from public.reverse_plus_evaluations where reverse_outcome_id = '11111111-1111-1111-1111-111111111111';

select name, case when ok then 'PASS' else 'FAIL' end as status, detail from result order by 1;
rollback;
