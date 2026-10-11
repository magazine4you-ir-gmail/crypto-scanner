/*
  # Hardening + Signal Lab v2

  1. SECURITY: signal_outcomes was writable (UPDATE / INSERT) by ANY signed-in user, which let anyone
     tamper with the shared statistics. Writes now happen only through the Edge Function (service role).
  2. signal_outcomes: new columns (candle_close_time, r_multiple, pnl_gross_pct) and a UNIQUE index per
     signal candle so the same signal can never be registered twice.
  3. Legacy cleanup: duplicates created by the old scanner and manual-scan rows are marked CANCELLED
     (kept for audit, excluded from statistics).
  4. scan_runs: only ONE run can be 'running' at a time (atomic lock) + counters for outcomes.
  5. scan_results: `shortable` flag (does the coin have a USDT perpetual on Binance Futures?).
  6. signals: SELL allowed, users can delete their own rows (the table used to grow forever).
*/

-- 1. close the write holes ---------------------------------------------------------------
drop policy if exists "Authenticated can update signal outcomes" on public.signal_outcomes;
drop policy if exists "Authenticated can insert signal outcomes" on public.signal_outcomes;

-- 2. new columns + uniqueness -------------------------------------------------------------
alter table public.signal_outcomes add column if not exists candle_close_time timestamptz;
alter table public.signal_outcomes add column if not exists r_multiple numeric;
alter table public.signal_outcomes add column if not exists pnl_gross_pct numeric;

-- 3. legacy cleanup ----------------------------------------------------------------------
with ranked as (
  select id,
         row_number() over (
           partition by symbol, timeframe, signal_type, stop_loss, target1
           order by signal_at
         ) as rn
  from public.signal_outcomes
  where source = 'auto_scan'
)
update public.signal_outcomes o
   set status = 'CANCELLED',
       notes = 'legacy duplicate of the same signal',
       exit_at = coalesce(o.exit_at, now())
  from ranked r
 where o.id = r.id and r.rn > 1;

update public.signal_outcomes
   set status = 'CANCELLED',
       notes = 'legacy manual scan (excluded from shared statistics)',
       exit_at = coalesce(exit_at, now())
 where source = 'manual_scan' and status <> 'CANCELLED';

create unique index if not exists idx_signal_outcomes_candle_unique
  on public.signal_outcomes (symbol, timeframe, signal_type, candle_close_time);

-- 4. scan_runs: single running lock ---------------------------------------------------------
update public.scan_runs
   set status = 'failed', error = coalesce(error, 'closed by migration'), finished_at = now()
 where status = 'running';

alter table public.scan_runs add column if not exists outcomes_opened integer not null default 0;
alter table public.scan_runs add column if not exists outcomes_closed integer not null default 0;
alter table public.scan_runs add column if not exists timeframes_scanned text[] not null default '{}';

create unique index if not exists idx_scan_runs_single_running
  on public.scan_runs ((true)) where status = 'running';

-- 5. scan_results ----------------------------------------------------------------------------
alter table public.scan_results add column if not exists shortable boolean;

-- 6. signals (skipped automatically if the table does not exist in this database) ----------------
do $$
declare c record;
begin
  if to_regclass('public.signals') is null then
    raise notice 'public.signals not found - section 6 skipped';
    return;
  end if;

  for c in
    select conname from pg_constraint
     where conrelid = 'public.signals'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%signal_type%'
  loop
    execute format('alter table public.signals drop constraint %I', c.conname);
  end loop;

  alter table public.signals
    add constraint signals_signal_type_check
    check (signal_type in ('BUY', 'SELL', 'WAIT', 'EXIT', 'NO_TRADE'));

  drop policy if exists "delete_own_signals" on public.signals;
  create policy "delete_own_signals" on public.signals
    for delete to authenticated using (auth.uid() = created_by);
end $$;
