/*
  # Manual signal tracking (for all users)

  Users press "Track" on a BUY/SELL signal. The Edge Function `track-signal` (service role) re-runs the
  analysis itself on the latest CLOSED candle and registers the paper trade — the browser never sends
  prices, so nobody can forge entries/stops/targets. Statistics are filtered by `source`
  ('auto_scan' vs 'manual_track') so the two are never mixed by accident.

  Changes:
  1. signal_outcomes.tracked_by  — who asked for the tracking (used for per-user limits)
  2. "one OPEN signal" unique index now also includes `source`, so a manual track and the auto scan
     can both be open for the same coin without blocking each other.
     (The per-candle unique index from the previous migration still prevents counting one signal twice.)
*/

alter table public.signal_outcomes
  add column if not exists tracked_by uuid references auth.users (id) on delete set null;

drop index if exists public.idx_signal_outcomes_open_unique;
create unique index if not exists idx_signal_outcomes_open_unique
  on public.signal_outcomes (symbol, timeframe, signal_type, source)
  where status = 'OPEN';

create index if not exists idx_signal_outcomes_tracked_by
  on public.signal_outcomes (tracked_by, signal_at desc)
  where tracked_by is not null;
