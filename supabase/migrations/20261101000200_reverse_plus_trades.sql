/*
  # Reverse Signal Plus — trades (PAPER simulation and ACTUAL manual records)

  mode = 'PAPER'  : created and resolved ONLY by the Edge Function from closed candles (service role).
  mode = 'ACTUAL' : typed in by the user (real fills). The user may insert / update / delete only their OWN ACTUAL rows.
  The two modes are NEVER merged in any statistic.

  Soft references (no foreign keys) to the existing signal tables, so this module cannot affect them.
  One PAPER trade and one ACTUAL trade per (user, reverse signal) -> idempotent.
*/

create table if not exists public.reverse_plus_trades (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  mode                text not null check (mode in ('PAPER', 'ACTUAL')),
  reverse_outcome_id  uuid not null,
  origin_outcome_id   uuid,
  evaluation_id       uuid,
  symbol              text not null,
  timeframe           text not null,
  side                text not null check (side in ('BUY', 'SELL')),
  quality_score       integer check (quality_score is null or quality_score between 0 and 100),
  recommended_entry   numeric,
  stop_loss           numeric not null,
  take_profit         numeric not null,
  leverage            numeric,
  margin_used         numeric,
  entries_planned     integer,
  entries_filled      integer,
  qty_total           numeric,
  avg_entry           numeric,
  fills               jsonb not null default '[]'::jsonb,   -- [{price, qty, time}] actual or simulated fills
  plan                jsonb,                                -- planned steps (PAPER)
  exit_price          numeric,
  exit_at             timestamptz,
  gross_pnl           numeric,
  fees                numeric,
  slippage_cost       numeric,
  net_pnl             numeric,
  risk_at_stop        numeric,                              -- 1R of this trade
  final_r             numeric,
  outcome             text not null default 'PENDING'
                      check (outcome in ('PENDING', 'OPEN', 'WIN', 'LOSS', 'EXPIRED', 'BREAKEVEN', 'NO_FILL', 'CANCELLED')),
  signal_at           timestamptz,
  opened_at           timestamptz,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists idx_rp_trades_unique_mode
  on public.reverse_plus_trades (user_id, mode, reverse_outcome_id);

create index if not exists idx_rp_trades_user_mode_outcome
  on public.reverse_plus_trades (user_id, mode, outcome);

alter table public.reverse_plus_trades enable row level security;

drop policy if exists "rp trades select own" on public.reverse_plus_trades;
create policy "rp trades select own" on public.reverse_plus_trades
  for select to authenticated using (auth.uid() = user_id);

-- ACTUAL records are typed by the user; PAPER rows can only be written by the service role.
drop policy if exists "rp trades insert own actual" on public.reverse_plus_trades;
create policy "rp trades insert own actual" on public.reverse_plus_trades
  for insert to authenticated with check (auth.uid() = user_id and mode = 'ACTUAL');

drop policy if exists "rp trades update own actual" on public.reverse_plus_trades;
create policy "rp trades update own actual" on public.reverse_plus_trades
  for update to authenticated using (auth.uid() = user_id and mode = 'ACTUAL')
  with check (auth.uid() = user_id and mode = 'ACTUAL');

drop policy if exists "rp trades delete own actual" on public.reverse_plus_trades;
create policy "rp trades delete own actual" on public.reverse_plus_trades
  for delete to authenticated using (auth.uid() = user_id and mode = 'ACTUAL');
