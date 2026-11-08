/*
  # Reverse Signal Plus — per-user settings (independent module)

  New, standalone table. NOTHING existing is altered: signal_outcomes, reverse_signal_outcomes, user_settings,
  scan_results ... are untouched. Dropping this table (see supabase/rollback/reverse_plus_down.sql) removes the
  module without any effect on Signal Lab / Reverse Signal Lab.

  Monetary values are `numeric` (exact decimal in Postgres).
  `enabled` is the per-user kill switch: when false the Edge Function does no work for the user.
  `enabled_at` is set by a trigger (clients cannot forge it): only signals created AFTER it are evaluated, so
  the module is forward-tested and never back-filled with hindsight.
*/

create table if not exists public.reverse_plus_settings (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  enabled            boolean not null default false,
  enabled_at         timestamptz,
  account_balance    numeric not null default 100   check (account_balance > 0),
  risk_pct           numeric not null default 1     check (risk_pct > 0 and risk_pct <= 100),
  max_risk_per_trade numeric not null default 1     check (max_risk_per_trade > 0),
  leverage           numeric not null default 50    check (leverage >= 1 and leverage <= 125),
  margin_mode        text    not null default 'ISOLATED' check (margin_mode in ('ISOLATED', 'CROSS')),
  fee_pct            numeric not null default 0.05  check (fee_pct >= 0 and fee_pct <= 5),
  slippage_pct       numeric not null default 0.02  check (slippage_pct >= 0 and slippage_pct <= 5),
  max_entries        integer not null default 3     check (max_entries between 1 and 10),
  max_margin_pct     numeric not null default 50    check (max_margin_pct > 0 and max_margin_pct <= 100),
  min_rr             numeric not null default 0.7   check (min_rr >= 0 and min_rr <= 10),
  assumed_mmr_pct    numeric not null default 0.5   check (assumed_mmr_pct >= 0 and assumed_mmr_pct < 50),
  liq_safety_factor  numeric not null default 0.8   check (liq_safety_factor > 0 and liq_safety_factor <= 1),
  approach_pct       numeric not null default 0.5   check (approach_pct > 0 and approach_pct <= 10),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_reverse_plus_settings_enabled
  on public.reverse_plus_settings (enabled) where enabled;

create or replace function public.reverse_plus_settings_guard()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.enabled and (tg_op = 'INSERT' or not coalesce(old.enabled, false)) then
    new.enabled_at := now();           -- forward testing starts NOW, never earlier
  elsif tg_op = 'UPDATE' then
    new.enabled_at := old.enabled_at;  -- clients cannot move it
  end if;
  if not new.enabled and tg_op = 'INSERT' then
    new.enabled_at := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_reverse_plus_settings_guard on public.reverse_plus_settings;
create trigger trg_reverse_plus_settings_guard
  before insert or update on public.reverse_plus_settings
  for each row execute function public.reverse_plus_settings_guard();

alter table public.reverse_plus_settings enable row level security;

drop policy if exists "rp settings select own" on public.reverse_plus_settings;
create policy "rp settings select own" on public.reverse_plus_settings
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "rp settings insert own" on public.reverse_plus_settings;
create policy "rp settings insert own" on public.reverse_plus_settings
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "rp settings update own" on public.reverse_plus_settings;
create policy "rp settings update own" on public.reverse_plus_settings
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "rp settings delete own" on public.reverse_plus_settings;
create policy "rp settings delete own" on public.reverse_plus_settings
  for delete to authenticated using (auth.uid() = user_id);
