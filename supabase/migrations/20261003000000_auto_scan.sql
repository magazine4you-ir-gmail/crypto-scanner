/*
  # Auto scan tables

  1. scan_runs     – one row per scheduled scan (status, counts, errors)
  2. scan_results  – latest result per (symbol, timeframe), overwritten every run
  Signal types: BUY, SELL (= Short), WAIT, NO_TRADE

  Security: RLS enabled. Logged-in users can read; only the Edge Function
  (service role) can write.
*/

create table if not exists public.scan_runs (
  id              uuid primary key default gen_random_uuid(),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  status          text not null default 'running' check (status in ('running','ok','partial','failed')),
  universe_source text,
  timeframes      text[] not null default '{}',
  symbols_total   integer not null default 0,
  scanned         integer not null default 0,
  failed          integer not null default 0,
  buy_count       integer not null default 0,
  sell_count      integer not null default 0,
  wait_count      integer not null default 0,
  error           text
);

create index if not exists idx_scan_runs_started on public.scan_runs (started_at desc);

create table if not exists public.scan_results (
  id                uuid primary key default gen_random_uuid(),
  run_id            uuid references public.scan_runs(id) on delete set null,
  symbol            text not null,
  base_asset        text not null,
  market_rank       integer,
  timeframe         text not null,
  signal_type       text not null check (signal_type in ('BUY','SELL','WAIT','NO_TRADE')),
  bias              text check (bias in ('LONG','SHORT')),
  score             integer not null,
  bull_score        integer,
  bear_score        integer,
  regime            text,
  trend             text,
  structure         text,
  risk_level        text,
  price             numeric not null,
  rsi               numeric,
  atr_pct           numeric,
  rel_volume        numeric,
  entry_low         numeric,
  entry_high        numeric,
  stop_loss         numeric,
  target1           numeric,
  target2           numeric,
  target3           numeric,
  risk_reward       numeric,
  candle_close_time timestamptz,
  signal_since      timestamptz not null default now(),
  scanned_at        timestamptz not null default now(),
  unique (symbol, timeframe)
);

create index if not exists idx_scan_results_type_score on public.scan_results (signal_type, score desc);

alter table public.scan_runs enable row level security;
alter table public.scan_results enable row level security;

drop policy if exists "Authenticated users can read scan runs" on public.scan_runs;
create policy "Authenticated users can read scan runs"
  on public.scan_runs for select to authenticated using (true);

drop policy if exists "Authenticated users can read scan results" on public.scan_results;
create policy "Authenticated users can read scan results"
  on public.scan_results for select to authenticated using (true);

-- OPTIONAL: let visitors who are NOT logged in see the scan page too.
-- Uncomment, run once, and the page works for everyone:
--
-- create policy "Public can read scan runs"    on public.scan_runs    for select to anon using (true);
-- create policy "Public can read scan results" on public.scan_results for select to anon using (true);
