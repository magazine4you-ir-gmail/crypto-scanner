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

### BTC pairs and USDT + BTC confluence
Every scanner works on **USDT pairs (ETHUSDT) and BTC pairs (ETHBTC)** with the same engine, scoring and risk plan. A BTC pair is simply a price series measured in bitcoin (the engine is scale-free, covered by a test at 1e-6 price scale).
* **Manual scan** (`/scanner`): choose *USDT + BTC*, *USDT* or *BTC*; pair filter includes *USDT + BTC aligned*.
* **Auto scan** (`scheduled-scan`): USDT pairs for the top 100 coins + BTC pairs for the top 50 coins (`BTC_TOP_N`). BTC-pair liquidity is converted to USD before the filter (floor $300k vs $2M for USDT pairs). No new tables or columns: rows are keyed by `symbol`, the quote is derived from it.
* **Confluence** (`src/engine/confluence.ts`): per coin and timeframe the two legs are combined: `BUY+BUY` strong buy (rising in dollars *and* beating bitcoin), `SELL+SELL` strong sell, `BUY(USDT)+SELL(BTC)` lagging buy (up only because BTC lifts the market), `SELL(USDT)+BUY(BTC)` relative strength, otherwise USDT-only / BTC-only. Shown as a badge in the manual scanner, the auto scan (own tab) and the asset page.
* **SELL on a BTC pair is not a short**: it means "sell the coin for BTC" (rotation) and is labelled that way; the *no futures* flag only applies to USDT pairs.
* Signal Lab / `track-signal` accept BTC pairs; their P/L is measured in BTC. Prices below 0.001 are shown with 8 decimals.

### Fast Scalp (`/scalp`)
Separate strategy module `supabase/functions/_shared/scalp.ts` (alias `@scalp`, dependency-free like the engine). Short timeframes only (1m / 5m / 15m), closed candles only.
* **Volume profile** from the candles (POC, value area VAH/VAL, HVN/LVN) · **smart-money**: liquidity sweep, MSS, FVG, order block · **price action** trigger: engulfing / pin bar / momentum · relative-volume confirmation and optional taker-buy delta · higher-timeframe bias filter (1m→15m, 5m→1h, 15m→4h).
* Two models: `REVERSAL` (sweep + reclaim) and `CONTINUATION` (trend pullback into FVG/OB/volume node). BUY/SELL needs every gate; a setup that only lacks the trigger candle or score is `WAIT`.
* **No greed**: one target (default 1.5R), clipped in front of the first wall (POC/HVN/swing), time stop after 10–15 bars. **Controlled risk**: structural stop beyond the raid wick, stop-size limits, risk % sizing capped at capital (no leverage), net R/R after fees, daily-loss cap and cooldown in the backtest.
* **Fees are part of the strategy**: default 0.10 % round trip. When fees would eat more than 30 % of 1R the trade is rejected (`COST_TOO_HIGH`). On 1m the ATR is often smaller than the fee, so expect few or no signals there: that is the filter working.
* The backtest page section reports *why* setups were rejected. Random-walk sanity check (no edge exists): ~50 % win rate and ~0R expectancy without fees, i.e. no look-ahead.
* Not covered: real order-book / footprint data (candles only), server-side scalp scanning, live execution.

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
