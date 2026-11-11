# Reverse Signal Plus

A standalone module that analyses the **existing** reverse signal: it chooses the best entry price *inside the existing
entry zone*, sizes the position from the real distance to the (unchanged) reverse stop, plans scaled entries under ONE
risk budget, scores entry quality and records its own PAPER / ACTUAL results. **Analysis only — no order is ever sent.**

## Product behaviour (current UI)
* **One source of truth:** the signal list and each signal's state (open / closed with profit / closed with loss / expired) come from
  `reverse_signal_outcomes` — the same table, CANCELLED exclusion, newest-first order and filters (همه / باز / سود / زیان / منقضی) as Reverse Signal Lab.
  Default view = OPEN only, 100 per page, server-side paging. Counts are exact head-counts on that table, so the open count equals the Lab's.
  `reverse_plus_evaluations` is only enrichment (suggested entry, quality %, last price); it never defines a count.
* **No INVALID status anywhere.** Low RR, high leverage, low quality, liquidation caution and contract issues are neutral numbers / developer `reasons`;
  they never hide or reject a signal. Legacy stored rows with `entry_status = 'INVALID'` are treated as "waiting" and never displayed.
* **Two tabs only:** Signals and Analysis center (same card; Analysis adds counts + symbol / direction / timeframe filters).
  History, Trades, Performance and Settings tabs were removed together with their fetches.
* **Local calculator** on `/reverse-plus/signal/:id`: leverage, sizing mode (fixed risk / fixed notional) and amount drive margin, notional,
  risk, quantity and the liquidation estimate. "Always calculate with these values" stores them in `localStorage` of that browser only
  (key `reversePlus.scenario.v1`); the list cards use the same values. There is no per-user server-side settings storage.

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
| UI | `src/pages/ReversePlusPage.tsx` (list), `src/pages/ReversePlusSignalPage.tsx` (detail + local calculator), `src/components/ReversePlusFeed.tsx` + `ReversePlusSignalCard.tsx` (the ONE list card), `src/reversePlus/*` (pure summary + browser-only scenario prefs), `src/i18n/reversePlusTranslations.ts` (fa/en) |
| Switch | `VITE_REVERSE_PLUS_ENABLED=false` (UI) · `REVERSE_PLUS_ENABLED=false` (function). Per-user `enabled` is LEGACY and no longer gates anything |

## Rules implemented
* **Entry zone ≠ stop.** Candidates are sampled only inside the stored zone; RR is computed per candidate; the best net-RR
  price is *recommended*. RR is always based on the **recommended entry**, never on an actual fill (`rr_basis`).
* **RR grade (default reference 0.7), net of costs — informational only, never a gate:** `<min` BELOW_MIN · `min..1` REVIEW · `>=1` FAVORABLE.
  `risk = |e−stop| + e·(fee+slip) + stop·(fee+slip)`, `reward = |target−e| − e·(fee+slip) − target·fee`.
* **Scaled entries:** the risk budget (`min(balance·risk%, maxRisk)`) is **split** between steps, each step sized from its
  own distance to the FINAL stop, net of fees + slippage; total net risk ≤ budget is an enforced invariant (fuzz-tested).
  No martingale. Quantities are floored to the contract `stepSize`; `minQty` / `minNotional` reject steps.
* **Liquidation:** isolated estimate with an *assumed* maintenance margin; checked for every partial-fill state. If it
  comes before the stop it is reported as an informational reason (`LIQ_BEFORE_STOP`) and shown as a neutral number; the signal is never hidden or rejected. Leverage is **never raised or lowered silently**; `max safe leverage` is shown.
* **Entry quality (0–100, `rpq-1`):** nine explainable factors. A heuristic index, **not a win probability**. It is
  computed from candles closed at the evaluation time only (tested for look-ahead). Validate it with
  "performance by score bucket" before trusting it.
* **Paper trading:** closed candles after the signal only; fills at the limit price; stop checked before target; gap exits
  at the open; a target touched in the candle of a fill is ignored; target before fill → NO_FILL.
* **Actual trading:** manual record of real fills/exit/fees; PnL and R computed exactly. PAPER and ACTUAL are never merged.
* **Idempotency:** unique indexes + `upsert ... ignoreDuplicates`; SIGNAL_TIME evaluations are write-once.
* **Public / central model (migration 20261109000000):** one evaluation per signal with the reference config in
  `reverse_plus_public_config`, stored with `user_id = NULL` and readable by every signed-in user. Signals issued before
  `public_since` are historical: SIGNAL_TIME snapshot only, never a PAPER trade. `reverse_plus_settings` is personal only
  (used for the user's own ACTUAL records) and never changes public results. Legacy per-user rows are kept untouched.
  RLS test: `supabase/tests/reverse_plus_public_rls.sql`.

## Deploy
1. Apply the migrations `supabase/migrations/20261101*_reverse_plus_*.sql` and `20261109000000_reverse_plus_public.sql` (rollback: `supabase/rollback/reverse_plus_down.sql`).
2. `supabase functions deploy reverse-plus-eval --no-verify-jwt`
3. Edit and run `supabase/reverse_plus_cron_setup.sql` (separate job; the old cron is untouched).
4. No user action is needed: signals appear for everybody after the first run.
5. First run manually: `curl -X POST -H "x-cron-secret: $CRON_SECRET" https://<ref>.supabase.co/functions/v1/reverse-plus-eval`

## Known limitations (be aware)
* **Structural RR.** The original target is 2× the stop distance, so the reverse RR is ≈0.5–0.7 (≈0.5 after costs). With the
  default reference minimum 0.7 most signals are below it (shown as an informational RR, not as a rejection); such trades need a ≥ ~65 % win rate to break even.
* **50× is usually infeasible** with the reverse stop (≈3 ATR away): liquidation comes first (shown as a neutral note). Use the shown max safe leverage.
* **Liquidation price is an estimate** (public API has no maintenance-margin tiers); cross-margin liquidation is not computed.
* **Contract filters** (tick/step/minQty/minNotional) come from public `fapi/v1/exchangeInfo`. If unreachable (e.g. region
  block) sizes are flagged **estimate** and not rounded. Max leverage per symbol is unknown (needs a signed endpoint).
* BTC-quoted pairs and symbols without a USDT perpetual get an informational `NO_FUTURES_CONTRACT` reason (no server plan; the browser still calculates).
* DB `numeric` is exact; PostgREST returns it as JSON numbers (~15–17 significant digits), so the browser shows rounded values.
* The paper simulation uses hourly-or-coarser candles; intra-candle order is unknown, hence the conservative rules above.
* The Edge Function was type-checked but **not executed against a live Supabase / Binance** in this environment.
* No result here is evidence of profitability; scores and statistics need real forward data (≥30 trades per bucket).
