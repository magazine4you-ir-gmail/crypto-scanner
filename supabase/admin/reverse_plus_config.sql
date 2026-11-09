-- Reverse Plus central reference configuration — ADMIN ONLY (run in the Supabase SQL editor as the project owner / service_role).
-- Normal app users have SELECT only (RLS); the browser can never change this row.
select * from public.reverse_plus_public_config;

-- change reference parameters (affects only FUTURE central evaluations; SIGNAL_TIME rows are write-once snapshots):
-- update public.reverse_plus_public_config set leverage = 20, min_rr = 0.7, updated_at = now() where id;

-- move the live/historical boundary (signals BEFORE this time are historical: SIGNAL_TIME + backtest only, no LIVE / PAPER).
-- Moving it EARLIER makes older signals eligible for LIVE/PAPER (never rewrites past rows). Moving it LATER is not recommended.
-- update public.reverse_plus_public_config set public_since = '2026-11-09T00:00:00Z' where id;
