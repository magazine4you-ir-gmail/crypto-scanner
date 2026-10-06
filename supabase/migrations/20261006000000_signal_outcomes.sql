/*
  Signal Lab — paper tracking of BUY/SELL signals issued by the scanner
*/

create table if not exists public.signal_outcomes (
  id                uuid primary key default gen_random_uuid(),
  symbol            text not null,
  base_asset        text not null,
  timeframe         text not null,
  signal_type       text not null check (signal_type in ('BUY', 'SELL')),
  score             integer not null,
  price_at_signal   numeric not null,
  entry_low         numeric,
  entry_high        numeric,
  stop_loss         numeric not null,
  target1           numeric not null,
  target2           numeric,
  risk_reward       numeric,
  signal_at         timestamptz not null default now(),
  status            text not null default 'OPEN'
                    check (status in ('OPEN', 'WIN', 'LOSS', 'EXPIRED', 'CANCELLED')),
  exit_price        numeric,
  exit_at           timestamptz,
  pnl_pct           numeric,
  bars_held         integer,
  source            text not null default 'auto_scan',
  notes             text
);

create index if not exists idx_signal_outcomes_status_at
  on public.signal_outcomes (status, signal_at desc);

create index if not exists idx_signal_outcomes_symbol_tf
  on public.signal_outcomes (symbol, timeframe, status);

-- only one OPEN signal per symbol+timeframe+direction
create unique index if not exists idx_signal_outcomes_open_unique
  on public.signal_outcomes (symbol, timeframe, signal_type)
  where status = 'OPEN';

alter table public.signal_outcomes enable row level security;

drop policy if exists "Authenticated can read signal outcomes" on public.signal_outcomes;
create policy "Authenticated can read signal outcomes"
  on public.signal_outcomes for select to authenticated using (true);

drop policy if exists "Authenticated can update signal outcomes" on public.signal_outcomes;
create policy "Authenticated can update signal outcomes"
  on public.signal_outcomes for update to authenticated using (true);

drop policy if exists "Authenticated can insert signal outcomes" on public.signal_outcomes;
create policy "Authenticated can insert signal outcomes"
  on public.signal_outcomes for insert to authenticated with check (true);
