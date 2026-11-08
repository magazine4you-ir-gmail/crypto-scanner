# Reverse Signal Plus

A standalone module that analyses the **existing** reverse signal: it chooses the best entry price *inside the existing
entry zone*, sizes the position from the real distance to the (unchanged) reverse stop, plans scaled entries under ONE
risk budget, scores entry quality and records its own PAPER / ACTUAL results. **Analysis only — no order is ever sent.**

## What it never changes
Original signal, `reversePlan`, entry zone, support/resistance, reverse stop / target, `signal_outcomes`,
`reverse_signal_outcomes`, their statistics and history. Proof: `node scripts/verify-independence.mjs` and
`src/reversePlus/__tests__/independence.test.ts` (byte-identical signal fingerprint vs the baseline tag `pre-reverse-plus`).

## Architecture
| Layer | Path |
|---|---|
| Pure module (fixed-point BigInt, 18 decimals) | `supabase/functions/_shared/reversePlus/*` |
| Edge Function (own schedule) | `supabase/functions/reverse-plus-eval/index.ts` |
| Tables (new, no FK to old ones) | `reverse_plus_settings`, `reverse_plus_evaluations`, `reverse_plus_trades` |
| UI | `src/pages/ReversePlusPage.tsx`, `src/services/reversePlusService.ts`, `src/i18n/reversePlusTranslations.ts` (fa/en) |
| Switch | `VITE_REVERSE_PLUS_ENABLED=false` (UI) · `REVERSE_PLUS_ENABLED=false` (function) · per-user `enabled` |

## Rules implemented
* **Entry zone ≠ stop.** Candidates are sampled only inside the stored zone; RR is computed per candidate; the best net-RR
  price is *recommended*. RR is always based on the **recommended entry**, never on an actual fill (`rr_basis`).
* **RR gate (default 0.7, configurable), net of costs:** `<min` INVALID · `min..1` REVIEW (warning) · `>=1` FAVORABLE.
  `risk = |e−stop| + e·(fee+slip) + stop·(fee+slip)`, `reward = |target−e| − e·(fee+slip) − target·fee`.
* **Scaled entries:** the risk budget (`min(balance·risk%, maxRisk)`) is **split** between steps, each step sized from its
  own distance to the FINAL stop, net of fees + slippage; total net risk ≤ budget is an enforced invariant (fuzz-tested).
  No martingale. Quantities are floored to the contract `stepSize`; `minQty` / `minNotional` reject steps.
* **Liquidation:** isolated estimate with an *assumed* maintenance margin; checked for every partial-fill state. If it
  comes before the stop → INVALID (`LIQ_BEFORE_STOP`). Leverage is **never raised or lowered silently**; `max safe leverage` is shown.
* **Entry quality (0–100, `rpq-1`):** nine explainable factors. A heuristic index, **not a win probability**. It is
  computed from candles closed at the evaluation time only (tested for look-ahead). Validate it with
  "performance by score bucket" before trusting it.
* **Paper trading:** closed candles after the signal only; fills at the limit price; stop checked before target; gap exits
  at the open; a target touched in the candle of a fill is ignored; target before fill → NO_FILL.
* **Actual trading:** manual record of real fills/exit/fees; PnL and R computed exactly. PAPER and ACTUAL are never merged.
* **Idempotency:** unique indexes + `upsert ... ignoreDuplicates`; SIGNAL_TIME evaluations are write-once.
* **Forward-only:** only signals created after the user enabled the module are evaluated.

## Deploy
1. Apply the 3 migrations `supabase/migrations/20261101*_reverse_plus_*.sql` (rollback: `supabase/rollback/reverse_plus_down.sql`).
2. `supabase functions deploy reverse-plus-eval --no-verify-jwt`
3. Edit and run `supabase/reverse_plus_cron_setup.sql` (separate job; the old cron is untouched).
4. Open **Reverse Signal Plus → Settings**, tick *Enable module*, save.
5. First run manually: `curl -X POST -H "x-cron-secret: $CRON_SECRET" https://<ref>.supabase.co/functions/v1/reverse-plus-eval`

## Known limitations (be aware)
* **Structural RR.** The original target is 2× the stop distance, so the reverse RR is ≈0.5–0.7 (≈0.5 after costs). With the
  default minimum 0.7 most signals will be INVALID; lowering it admits trades that need a ≥ ~65 % win rate to break even.
* **50× is usually infeasible** with the reverse stop (≈3 ATR away): liquidation comes first → INVALID. Use the shown max safe leverage.
* **Liquidation price is an estimate** (public API has no maintenance-margin tiers); cross-margin liquidation is not computed.
* **Contract filters** (tick/step/minQty/minNotional) come from public `fapi/v1/exchangeInfo`. If unreachable (e.g. region
  block) sizes are flagged **estimate** and not rounded. Max leverage per symbol is unknown (needs a signed endpoint).
* BTC-quoted pairs and symbols without a USDT perpetual get an explicit INVALID (`NO_FUTURES_CONTRACT`).
* DB `numeric` is exact; PostgREST returns it as JSON numbers (~15–17 significant digits), so the browser shows rounded values.
* The paper simulation uses hourly-or-coarser candles; intra-candle order is unknown, hence the conservative rules above.
* The Edge Function was type-checked but **not executed against a live Supabase / Binance** in this environment.
* No result here is evidence of profitability; scores and statistics need real forward data (≥30 trades per bucket).
