/*
  # Reverse Signal Lab (آزمایشگاه سیگنال معکوس)

  Every Signal Lab trade (auto scan + manual tracking) gets ONE mirrored paper trade:
    - direction flipped (BUY -> SELL, SELL -> BUY)
    - same entry
    - stop-loss  = original take-profit (target1)
    - take-profit = original stop-loss
  It is resolved by the same engine (`resolveTrade`) with the same fees / expiry as the original.

  Rows are created and resolved ONLY by the Edge Functions (service role):
    - scheduled-scan : backfills missing reverse rows, mirrors cancellations, resolves OPEN rows
    - track-signal   : creates the reverse row right after a manual track
  The browser is read-only (no insert / update policy), exactly like signal_outcomes.

  The original table `signal_outcomes` is NOT modified, so existing statistics are untouched.
*/

create table if not exists public.reverse_signal_outcomes (
  id                 uuid primary key default gen_random_uuid(),
  -- the original trade this one mirrors (1 : 1)
  origin_outcome_id  uuid not null references public.signal_outcomes (id) on delete cascade,
  symbol             text not null,
  base_asset         text not null,
  timeframe          text not null,
  -- direction of the REVERSE trade, and of the original signal it comes from
  signal_type        text not null check (signal_type in ('BUY', 'SELL')),
  origin_signal_type text not null check (origin_signal_type in ('BUY', 'SELL')),
  score              integer not null,
  price_at_signal    numeric not null,
  entry_low          numeric,
  entry_high         numeric,
  -- reverse levels: stop_loss = original target1, target1 = original stop_loss
  stop_loss          numeric not null,
  target1            numeric not null,
  risk_reward        numeric,
  signal_at          timestamptz not null default now(),
  candle_close_time  timestamptz,
  status             text not null default 'OPEN'
                     check (status in ('OPEN', 'WIN', 'LOSS', 'EXPIRED', 'CANCELLED')),
  exit_price         numeric,
  exit_at            timestamptz,
  pnl_pct            numeric,
  pnl_gross_pct      numeric,
  r_multiple         numeric,
  bars_held          integer,
  source             text not null default 'auto_scan',
  tracked_by         uuid references auth.users (id) on delete set null,
  notes              text
);

-- one reverse trade per original trade (also makes the Edge Function inserts idempotent)
create unique index if not exists idx_reverse_outcomes_origin_unique
  on public.reverse_signal_outcomes (origin_outcome_id);

create index if not exists idx_reverse_outcomes_status_at
  on public.reverse_signal_outcomes (status, signal_at desc);

create index if not exists idx_reverse_outcomes_symbol_tf
  on public.reverse_signal_outcomes (symbol, timeframe, status);

create index if not exists idx_reverse_outcomes_source_at
  on public.reverse_signal_outcomes (source, signal_at desc);

alter table public.reverse_signal_outcomes enable row level security;

-- read-only for signed-in users; NO insert / update / delete policy -> only the service role can write
drop policy if exists "Authenticated can read reverse outcomes" on public.reverse_signal_outcomes;
create policy "Authenticated can read reverse outcomes"
  on public.reverse_signal_outcomes for select to authenticated using (true);
