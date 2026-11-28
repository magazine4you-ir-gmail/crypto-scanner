/*
  # Automatic, batched purge of EXPIRED market_data_cache rows

  Why
    `market-data` writes one `market_data_cache` row per distinct request and only ever treats an expired row as a
    miss; nothing deleted expired rows, so the table grew until it was cleaned by hand.

  What (and nothing else)
    1. NO new index, on purpose: `fetched_at` is rewritten by every cache refresh, so an index on it would turn every
       refresh into a non-HOT update (extra index writes on the hottest path of this table). With stable cache keys the
       table stays small (one row per distinct request), so the once-a-day purge is a cheap sequential scan that stops
       as soon as a batch is full. The existing unique (provider, cache_key) index is unchanged.
    2. `public.purge_expired_market_cache(batch, max_batches, grace)` — deletes ONLY rows that are already expired by
       the very rule the Edge Function uses (`now - fetched_at > ttl_seconds`) AND have been expired for at least
       `grace` (default 1 hour), in small batches (`FOR UPDATE SKIP LOCKED`, so it never waits for / blocks a writer).
       A valid (not expired) row can never match. A deleted row is simply a cache miss: the Edge Function fetches
       fresh data and writes it again. No signal, evaluation, backtest or trade table is touched.
    3. a daily pg_cron job (03:17 UTC) calling it — only if pg_cron is installed; otherwise a NOTICE says what to do.

  There is NO second expiry mechanism: expiry is still decided by `ttl_seconds`, exactly as before; this only removes
  rows that are long dead. Nothing runs on page load or on app start.

  Requirements: PostgreSQL only for the function. The daily schedule needs the `pg_cron` extension (Supabase Dashboard ->
  Database -> Extensions -> pg_cron, or `create extension pg_cron;`). This migration does NOT create the extension: if it is
  missing it raises a NOTICE and schedules nothing (the function still exists and can be called manually or by any scheduler).

  Rollback: supabase/rollback/market_cache_purge_down.sql
*/

create or replace function public.purge_expired_market_cache(
  p_batch_size  integer  default 2000,
  p_max_batches integer  default 25,
  p_grace       interval default interval '1 hour'
) returns integer
language plpgsql
set search_path = public
as $$
declare
  v_deleted integer := 0;
  v_n       integer;
  v_batch   integer := 0;
begin
  if p_batch_size  not between 1 and 10000 then raise exception 'p_batch_size must be 1..10000'; end if;
  if p_max_batches not between 1 and 1000  then raise exception 'p_max_batches must be 1..1000';  end if;
  if p_grace < interval '0' then raise exception 'p_grace must not be negative'; end if;

  while v_batch < p_max_batches loop
    with doomed as (
      select id
        from public.market_data_cache
       -- same rule as the Edge Function (expired when age > ttl), plus the grace period
       where fetched_at + (ttl_seconds * interval '1 second') + p_grace < now()
       limit p_batch_size
         for update skip locked
    )
    delete from public.market_data_cache c
     using doomed d
     where c.id = d.id;

    get diagnostics v_n = row_count;
    v_deleted := v_deleted + v_n;
    v_batch   := v_batch + 1;
    exit when v_n < p_batch_size;
  end loop;

  return v_deleted;
end;
$$;

comment on function public.purge_expired_market_cache(integer, integer, interval) is
  'Deletes market_data_cache rows expired for longer than p_grace, in batches. Returns the number of rows deleted.';

-- only the database owner / cron may call it (never anon / authenticated)
revoke all on function public.purge_expired_market_cache(integer, integer, interval) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'market-cache-purge-daily';
    perform cron.schedule('market-cache-purge-daily', '17 3 * * *', $cmd$select public.purge_expired_market_cache()$cmd$);
  else
    raise notice 'pg_cron is not installed: call public.purge_expired_market_cache() once a day by any scheduler (e.g. cron.schedule with the command: select public.purge_expired_market_cache())';
  end if;
end
$$;
