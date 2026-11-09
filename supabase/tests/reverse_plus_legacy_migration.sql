-- Run AFTER the 3 original reverse_plus migrations and BEFORE 20261109000000 on a scratch DB:
-- seeds legacy per-user data. A second script (reverse_plus_legacy_migration_check.sql) verifies after migrating.
insert into auth.users (id) values ('aaaaaaaa-0000-0000-0000-00000000000a'), ('bbbbbbbb-0000-0000-0000-00000000000b');
-- 600 legacy signals; user B evaluated all, user A evaluated the first 100 too (same signals, other settings)
insert into public.reverse_plus_evaluations (user_id, reverse_outcome_id, symbol, timeframe, side, eval_kind, as_of_close_time, stop_loss, take_profit,
  entry_status, status_reasons, recommended_entry, leverage, signal_at, settings_snapshot, created_at, plan_issues)
select 'bbbbbbbb-0000-0000-0000-00000000000b', ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'BTCUSDT', '1h', 'SELL', 'SIGNAL_TIME',
  now() - interval '30 days' + g * interval '1 hour', 101, 99, case when g % 3 = 0 then 'INVALID' else 'WAITING' end,
  case when g % 3 = 0 then array['LIQ_BEFORE_STOP'] else '{}'::text[] end, 100.5, 50, now() - interval '30 days' + g * interval '1 hour',
  '{"leverage":"50","userB":true}'::jsonb, now() - interval '20 days' + g * interval '1 minute', '{}'
from generate_series(1, 600) g;
insert into public.reverse_plus_evaluations (user_id, reverse_outcome_id, symbol, timeframe, side, eval_kind, as_of_close_time, stop_loss, take_profit,
  entry_status, recommended_entry, leverage, signal_at, settings_snapshot, created_at, plan_issues)
select 'aaaaaaaa-0000-0000-0000-00000000000a', ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'BTCUSDT', '1h', 'SELL', 'SIGNAL_TIME',
  now() - interval '30 days' + g * interval '1 hour', 101, 99, 'READY', 100.7, 20, now() - interval '30 days' + g * interval '1 hour',
  '{"leverage":"20","userA":true}'::jsonb, now() - interval '25 days' + g * interval '1 minute', '{}'
from generate_series(1, 100) g;
-- LIVE rows + legacy PAPER trades (one open)
insert into public.reverse_plus_evaluations (user_id, reverse_outcome_id, symbol, timeframe, side, eval_kind, as_of_close_time, stop_loss, take_profit, entry_status, signal_at)
select 'bbbbbbbb-0000-0000-0000-00000000000b', ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'BTCUSDT', '1h', 'SELL', 'LIVE', now(), 101, 99, 'WAITING', now() from generate_series(590, 600) g;
insert into public.reverse_plus_trades (user_id, mode, reverse_outcome_id, symbol, timeframe, side, stop_loss, take_profit, outcome)
values ('bbbbbbbb-0000-0000-0000-00000000000b', 'PAPER', '00000000-0000-0000-0000-000000000600', 'BTCUSDT', '1h', 'SELL', 101, 99, 'OPEN'),
       ('bbbbbbbb-0000-0000-0000-00000000000b', 'ACTUAL', '00000000-0000-0000-0000-000000000600', 'BTCUSDT', '1h', 'SELL', 101, 99, 'WIN');
