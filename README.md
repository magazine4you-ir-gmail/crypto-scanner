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

### Signal Lab (paper trading)
* Registered **once per signal** (first scan where the type flips to BUY/SELL) — unique index per signal candle.
* Resolved **on the server** from closed candles after the signal candle: stop is checked before target in the same bar, gaps exit at the open, 0.25 % round-trip cost is deducted, expiry after N bars.
* The browser is read-only; nobody can edit statistics (RLS write policies were removed).

### Reverse Signal Lab (`/reverse-lab`)
Every trade registered in Signal Lab (auto scan **and** manual tracking) gets exactly ONE mirrored paper trade:
* direction flips (**BUY → SELL/short**, **SELL → BUY**), same entry,
* **reverse stop-loss = original take-profit** and **reverse take-profit = original stop-loss**,
* resolved by the same `resolveTrade` (stop checked first, gaps exit at the open, 0.25 % cost, same expiry) from the same closed candles.

Implementation: pure geometry in `engine.ts` (`reversePlan`, `buildReverseOutcomeRow`, covered by `reverse.test.ts`); table `reverse_signal_outcomes` (1 : 1 with `signal_outcomes` via `origin_outcome_id`, read-only for browsers).
* `scheduled-scan` resolves originals and mirrors in one candle pass, back-fills any missing mirror (also for old signals) and cancels the mirror when the original is cancelled (opposite signal).
* `track-signal` registers the mirror right after a manual track (best effort; the hourly scan heals a miss).
* The original tables, statistics and pages are not touched. The page shows the reverse statistics and an *original vs reverse* comparison on the very same trades.
* Honest limits: fees hurt both sides, so the two results are not exact opposites; if one bar touches both levels it is a LOSS for both (stop-first rule); a gap through the original stop is booked at the open for the original but at the planned target for the reverse.

## Setup

1. `npm install`, copy `.env.example` → `.env`.
2. Apply the migrations in `supabase/migrations/` (SQL editor or `supabase db push`). `20261010000000_hardening_and_outcomes_v2.sql` closes the security hole on `signal_outcomes`; `20261019000000_reverse_signal_lab.sql` adds the Reverse Signal Lab table.
3. Deploy the functions (CLI — they import `../_shared/engine.ts`, so the dashboard editor is **not** suitable):
   ```bash
   supabase secrets set CRON_SECRET=<long random string>
   supabase functions deploy scheduled-scan --no-verify-jwt
   supabase functions deploy market-data --no-verify-jwt
   supabase functions deploy track-signal --no-verify-jwt
   ```
   (Apply the reverse-lab migration BEFORE or together with the deploy. If the functions are deployed first nothing breaks: the reverse step is skipped until the table exists.)
4. Schedule the scan: edit and run `supabase/cron_setup.sql` once (pg_cron + pg_net, minute :01 every hour).
5. Test a run: `curl -X POST -H "x-cron-secret: <CRON_SECRET>" "https://<PROJECT_REF>.supabase.co/functions/v1/scheduled-scan?force=1"`.

## Scripts
`npm run dev` · `npm run build` · `npm run lint` · `npm run typecheck` · `npm test`

## Notes
* SELL means a **short**. On spot you can only sell what you own; the "No futures" badge appears when the coin has no USDT perpetual on Binance Futures.
* Prices in Auto Scan are the **close of the last closed candle**, not the live price.
* Nothing here is financial advice; backtests and paper results do not guarantee future results.

## Signal audit (verify tracking + stop sizes offline)

1. Open **Signal Lab** and press **Audit export** (needs to be signed in). It saves `signal-audit-<date>.json`
   with every `signal_outcomes` row plus the closed candles around each signal. No database backup needed.
2. Run `npm run audit -- signal-audit-<date>.json` (add `--all-sources` to include manual tracking).
3. Read `audit-report.md` (and `audit-report.csv` for per-signal rows):
   - **A)** re-runs the server logic on real candles: is every stored result correct?
   - **B)** what-if stops/targets, mirror test and a time-matched random baseline: stop too small, or no edge?


## Reverse Signal Plus (independent module)

Standalone entry-timing / position-sizing / risk-control analysis for the existing reverse signal (analysis + paper trading only, no orders). It does not change any existing signal logic or statistic. See [docs/REVERSE_PLUS.md](docs/REVERSE_PLUS.md). Disable with `VITE_REVERSE_PLUS_ENABLED=false`.
