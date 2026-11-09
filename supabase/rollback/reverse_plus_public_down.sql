-- Reverts 20261109000000_reverse_plus_public.sql. Central (user_id IS NULL) rows are deleted; per-user rows are kept.
drop policy if exists "rp eval select public or own" on public.reverse_plus_evaluations;
drop policy if exists "rp trades select public or own" on public.reverse_plus_trades;
delete from public.reverse_plus_evaluations where user_id is null;
delete from public.reverse_plus_trades where user_id is null;
drop index if exists public.idx_rp_eval_owner_unique;
drop index if exists public.idx_rp_eval_public_kind_time;
drop index if exists public.idx_rp_trades_owner_unique;
drop index if exists public.idx_rp_trades_public_outcome;
alter table public.reverse_plus_evaluations drop column if exists owner_key;
alter table public.reverse_plus_trades drop column if exists owner_key;
alter table public.reverse_plus_trades drop constraint if exists rp_trades_central_is_paper;
alter table public.reverse_plus_evaluations alter column user_id set not null;
alter table public.reverse_plus_trades alter column user_id set not null;
create policy "rp eval select own" on public.reverse_plus_evaluations for select to authenticated using (auth.uid() = user_id);
create policy "rp trades select own" on public.reverse_plus_trades for select to authenticated using (auth.uid() = user_id);
drop table if exists public.reverse_plus_public_config;
drop table if exists public.reverse_plus_backtests;
alter table public.reverse_plus_evaluations drop column if exists source;
