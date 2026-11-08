/*
  # Reverse Signal Plus — evaluations (entry analysis + quality score + position plan)

  One row per (user, existing reverse signal, kind):
    SIGNAL_TIME : computed ONCE, from the candles closed at the signal candle. Never updated (insert ... on
                  conflict do nothing) -> no repainting, no look-ahead. This is the record statistics use.
    LIVE        : the same analysis re-computed on the latest closed candle (operational view; overwritten).

  `reverse_outcome_id` / `origin_outcome_id` are SOFT references (no foreign key): this module never constrains
  or cascades into reverse_signal_outcomes / signal_outcomes.
  Only the Edge Function (service role) writes; browsers can only read their own rows.
*/

create table if not exists public.reverse_plus_evaluations (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users (id) on delete cascade,
  reverse_outcome_id     uuid not null,
  origin_outcome_id      uuid,
  symbol                 text not null,
  timeframe              text not null,
  side                   text not null check (side in ('BUY', 'SELL')),
  eval_kind              text not null check (eval_kind in ('SIGNAL_TIME', 'LIVE')),
  as_of_close_time       timestamptz not null,
  current_price          numeric,
  -- levels copied READ-ONLY from the existing signal (never recomputed or changed)
  zone_low               numeric,
  zone_high              numeric,
  reverse_entry          numeric,
  stop_loss              numeric not null,
  take_profit            numeric not null,
  -- analysis
  recommended_entry      numeric,
  entry_range_low        numeric,
  entry_range_high       numeric,
  distance_to_entry_pct  numeric,
  risk_distance          numeric,
  reward_distance        numeric,
  rr_gross               numeric,
  rr_net                 numeric,
  rr_basis               text not null default 'RECOMMENDED_ENTRY',
  min_rr_used            numeric,
  entry_status           text not null check (entry_status in ('WAITING', 'APPROACHING', 'READY', 'INVALID', 'EXPIRED')),
  status_reasons         text[] not null default '{}',
  -- quality (heuristic index, versioned)
  quality_score          integer check (quality_score is null or quality_score between 0 and 100),
  quality_grade          text,
  quality_version        text,
  quality_coverage       numeric,
  quality_factors        jsonb,
  -- position plan (all steps share ONE risk budget)
  leverage               numeric,
  risk_amount            numeric,
  total_notional         numeric,
  total_margin           numeric,
  avg_entry              numeric,
  entries_count          integer,
  max_safe_leverage      numeric,
  liq_estimate           numeric,
  plan                   jsonb,
  plan_issues            text[] not null default '{}',
  contract_known         boolean,
  settings_snapshot      jsonb,
  signal_at              timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- idempotency: re-running the function can never create a second evaluation of the same kind
create unique index if not exists idx_rp_eval_unique
  on public.reverse_plus_evaluations (user_id, reverse_outcome_id, eval_kind);

create index if not exists idx_rp_eval_user_kind_time
  on public.reverse_plus_evaluations (user_id, eval_kind, signal_at desc);

alter table public.reverse_plus_evaluations enable row level security;

drop policy if exists "rp eval select own" on public.reverse_plus_evaluations;
create policy "rp eval select own" on public.reverse_plus_evaluations
  for select to authenticated using (auth.uid() = user_id);
-- no insert / update / delete policy: only the service role writes
