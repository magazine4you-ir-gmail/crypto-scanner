-- Manual scan runs (persist browser scanner results)

create table if not exists public.manual_scan_runs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  is_public       boolean not null default false,
  universe        integer not null check (universe in (10, 20, 50, 100)),
  timeframe       text not null,
  status          text not null default 'running'
                    check (status in ('running', 'ok', 'partial', 'failed')),
  symbols_total   integer not null default 0,
  scanned         integer not null default 0,
  failed          integer not null default 0,
  buy_count       integer not null default 0,
  sell_count      integer not null default 0,
  wait_count      integer not null default 0,
  no_trade_count  integer not null default 0,
  settings_snapshot jsonb,
  error           text,
  created_at      timestamptz not null default now(),
  finished_at     timestamptz
);

create index if not exists idx_manual_scan_runs_user_created
  on public.manual_scan_runs (user_id, created_at desc);

create index if not exists idx_manual_scan_runs_public_created
  on public.manual_scan_runs (created_at desc)
  where is_public = true and status in ('ok', 'partial');

create table if not exists public.manual_scan_results (
  id                uuid primary key default gen_random_uuid(),
  run_id            uuid not null references public.manual_scan_runs(id) on delete cascade,
  symbol            text not null,
  base_asset        text not null,
  market_rank       integer,
  signal_type       text not null check (signal_type in ('BUY','SELL','WAIT','NO_TRADE','EXIT')),
  bias              text,
  score             integer not null default 0,
  regime            text,
  trend             text,
  structure         text,
  risk_level        text,
  price             numeric not null,
  entry_low         numeric,
  entry_high        numeric,
  stop_loss         numeric,
  target1           numeric,
  target2           numeric,
  target3           numeric,
  risk_reward       numeric,
  candle_close_time timestamptz,
  payload           jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists idx_manual_scan_results_run
  on public.manual_scan_results (run_id);

create index if not exists idx_manual_scan_results_run_score
  on public.manual_scan_results (run_id, score desc);

alter table public.manual_scan_runs enable row level security;
alter table public.manual_scan_results enable row level security;

-- runs: owner full access; public runs readable by authenticated
drop policy if exists "manual_scan_runs_select" on public.manual_scan_runs;
create policy "manual_scan_runs_select"
  on public.manual_scan_runs for select to authenticated
  using (user_id = auth.uid() or is_public = true);

drop policy if exists "manual_scan_runs_insert" on public.manual_scan_runs;
create policy "manual_scan_runs_insert"
  on public.manual_scan_runs for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "manual_scan_runs_update" on public.manual_scan_runs;
create policy "manual_scan_runs_update"
  on public.manual_scan_runs for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "manual_scan_runs_delete" on public.manual_scan_runs;
create policy "manual_scan_runs_delete"
  on public.manual_scan_runs for delete to authenticated
  using (user_id = auth.uid());

-- results: readable if parent run is owned or public
drop policy if exists "manual_scan_results_select" on public.manual_scan_results;
create policy "manual_scan_results_select"
  on public.manual_scan_results for select to authenticated
  using (
    exists (
      select 1 from public.manual_scan_runs r
      where r.id = run_id and (r.user_id = auth.uid() or r.is_public = true)
    )
  );

drop policy if exists "manual_scan_results_insert" on public.manual_scan_results;
create policy "manual_scan_results_insert"
  on public.manual_scan_results for insert to authenticated
  with check (
    exists (
      select 1 from public.manual_scan_runs r
      where r.id = run_id and r.user_id = auth.uid()
    )
  );

drop policy if exists "manual_scan_results_delete" on public.manual_scan_results;
create policy "manual_scan_results_delete"
  on public.manual_scan_results for delete to authenticated
  using (
    exists (
      select 1 from public.manual_scan_runs r
      where r.id = run_id and r.user_id = auth.uid()
    )
  );
