create temp table chk (name text, ok boolean, detail text);
insert into chk select 'legacy per-user rows untouched (700 SIGNAL_TIME + 11 LIVE)', count(*) filter (where eval_kind='SIGNAL_TIME') = 700 and count(*) filter (where eval_kind='LIVE') = 11, count(*)::text from public.reverse_plus_evaluations where user_id is not null;
insert into chk select 'central copy = one per signal (600), all SIGNAL_TIME', count(*) = 600 and count(distinct reverse_outcome_id) = 600 and bool_and(eval_kind='SIGNAL_TIME'), count(*)::text from public.reverse_plus_evaluations where user_id is null;
insert into chk select 'copy provenance flagged', bool_and(source='LEGACY_USER_COPY'), '' from public.reverse_plus_evaluations where user_id is null;
insert into chk select 'earliest legacy row wins (signals 1..100 -> user B created 20d ago vs A 25d ago => A wins)', count(*) = 100, count(*)::text from public.reverse_plus_evaluations where user_id is null and (settings_snapshot->>'userA')::boolean;
insert into chk select 'analysis fields preserved (status, reasons, entry, TP, SL, snapshot)', count(*) = 0, count(*)::text
  from public.reverse_plus_evaluations c join public.reverse_plus_evaluations o on o.reverse_outcome_id=c.reverse_outcome_id and o.user_id is not null and o.settings_snapshot = c.settings_snapshot
  where c.user_id is null and (c.entry_status is distinct from o.entry_status or c.stop_loss is distinct from o.stop_loss or c.take_profit is distinct from o.take_profit or c.recommended_entry is distinct from o.recommended_entry or c.status_reasons is distinct from o.status_reasons);
insert into chk select 'legacy trades untouched (PAPER OPEN + ACTUAL)', count(*) = 2 and count(*) filter (where outcome='OPEN') = 1, count(*)::text from public.reverse_plus_trades where user_id is not null;
insert into chk select 'no central trades created by migration', count(*) = 0, count(*)::text from public.reverse_plus_trades where user_id is null;
insert into chk select 'config row seeded', count(*) = 1, count(*)::text from public.reverse_plus_public_config;
insert into chk select 'only expected SELECT policies on evaluations/trades', count(*) filter (where cmd='SELECT') = 2 and count(*) filter (where cmd in ('INSERT','UPDATE','DELETE','ALL')) = 3, string_agg(policyname||':'||cmd, ', ' order by policyname)
  from pg_policies where schemaname='public' and tablename in ('reverse_plus_evaluations','reverse_plus_trades');
select name, case when ok then 'PASS' else 'FAIL' end status, detail from chk order by 1;
