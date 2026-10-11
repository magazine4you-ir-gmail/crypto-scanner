# Signal Terminal — Crypto Scanner

React + Vite + TypeScript frontend, Supabase (Postgres + Edge Functions) backend, deployable on Cloudflare.

## Architecture

```
supabase/functions/_shared/engine.ts   ← the ONLY signal engine (indicators, S/R, regime, scoring, risk plan, trade resolution)
        ▲                       ▲
        │ "@engine" alias       │ import "../_shared/engine.ts"
src/ (manual scanner,           supabase/functions/scheduled-scan (hourly auto scan + Signal Lab)
 asset page, backtest)
```

Because both sides use the same file, the manual scanner, the auto scan and the backtest always agree.

### Rules the engine follows
* Only **closed candles** are analysed (no repainting).
* **R/R is real**: reward is measured up to the first S/R level; BUY/SELL requires `R/R ≥ min_risk_reward`.
* Stop = ATR stop, tightened to structure only if it stays ≥ 0.8 ATR away. Position size is capped at your capital (no hidden leverage).
* Volatility thresholds depend on the timeframe (1h ≠ 1d).
* Support/resistance are pooled from all swings; a broken resistance becomes support.
* `RANGE` regime (EMAs not aligned or ADX < 20) can show `WAIT` but never `BUY/SELL`.
* Your Settings (thresholds, risk %, min R/R) are applied to manual analysis and the backtest. The server scan uses the defaults so that Signal Lab statistics stay comparable.

### Manual tracking (all users)
* "Track" button on BUY/SELL signals (manual scanner + asset page) → Edge Function `track-signal`.
* The browser sends only `{symbol, timeframe}`; the server recomputes the signal on the latest closed candle (default settings) and registers it with `source = manual_track`. Prices cannot be forged.
* Limits per user: 20 open, 50 per 24h. Trackable timeframes: 15m, 30m, 1h, 4h, 1d.
* Signal Lab statistics have a source filter (auto scan / manual tracking / all) and are never mixed by default.
* Dashboard users without the CLI: `npm run bundle:functions` builds single-file versions in `supabase/single-file/` to paste into the dashboard editor.

### Signal Lab (paper trading)
* Registered **once per signal** (first scan where the type flips to BUY/SELL) — unique index per signal candle.
* Resolved **on the server** from closed candles after the signal candle: stop is checked before target in the same bar, gaps exit at the open, 0.25 % round-trip cost is deducted, expiry after N bars.
* The browser is read-only; nobody can edit statistics (RLS write policies were removed).

## Setup

1. `npm install`, copy `.env.example` → `.env`.
2. Apply the migrations in `supabase/migrations/` (SQL editor or `supabase db push`). The newest one, `20261010000000_hardening_and_outcomes_v2.sql`, closes the security hole on `signal_outcomes` and cleans legacy duplicates.
3. Deploy the functions (CLI — they import `../_shared/engine.ts`, so the dashboard editor is **not** suitable):
   ```bash
   supabase secrets set CRON_SECRET=<long random string>
   supabase functions deploy scheduled-scan --no-verify-jwt
   supabase functions deploy market-data --no-verify-jwt
   supabase functions deploy track-signal --no-verify-jwt
   ```
4. Schedule the scan: edit and run `supabase/cron_setup.sql` once (pg_cron + pg_net, minute :01 every hour).
5. Test a run: `curl -X POST -H "x-cron-secret: <CRON_SECRET>" "https://<PROJECT_REF>.supabase.co/functions/v1/scheduled-scan?force=1"`.

## Scripts
`npm run dev` · `npm run build` · `npm run lint` · `npm run typecheck` · `npm test`

## Notes
* SELL means a **short**. On spot you can only sell what you own; the "No futures" badge appears when the coin has no USDT perpetual on Binance Futures.
* Prices in Auto Scan are the **close of the last closed candle**, not the live price.
* Nothing here is financial advice; backtests and paper results do not guarantee future results.
