// Reverse Signal Plus — ACTUAL trading record (manual entry of the real fills). Never mixed with PAPER.
//
// The user types the real prices / quantities / fees; this module only computes gross PnL, net PnL and the
// real R. Slippage is already inside the real prices, so no extra slippage is applied here.
import { ZERO, abs, add, cmp, div, fraction, mul, sub, sum } from './money.ts';
import type { Dec } from './money.ts';
import type { Side } from './types.ts';

export interface ActualFill {
  price: Dec;
  qty: Dec;
}

export interface ActualInput {
  side: Side;
  fills: ActualFill[];
  exitPrice: Dec;
  /** the unchanged reverse stop of the signal (defines 1R) */
  stop: Dec | null;
  /** real fees paid in total (USDT). When null the percentage below is used. */
  feesTotal: Dec | null;
  feePct: Dec;
}

export interface ActualResult {
  qty: Dec;
  avgEntry: Dec;
  grossPnl: Dec;
  fees: Dec;
  netPnl: Dec;
  /** loss the SAME fills would have produced at the stop, incl. fees: 1R. null without a stop. */
  riskAtStop: Dec | null;
  finalR: Dec | null;
  outcome: 'WIN' | 'LOSS' | 'BREAKEVEN';
}

export function computeActual(input: ActualInput): ActualResult | null {
  const fills = input.fills.filter((f) => f.qty > ZERO && f.price > ZERO);
  if (fills.length === 0 || input.exitPrice <= ZERO) return null;
  const sell = input.side === 'SELL';
  const qty = sum(fills.map((f) => f.qty));
  const avgEntry = div(sum(fills.map((f) => mul(f.qty, f.price))), qty);
  const grossPnl = sum(fills.map((f) => mul(f.qty, sell ? sub(f.price, input.exitPrice) : sub(input.exitPrice, f.price))));
  const feeRate = fraction(input.feePct);
  const fees =
    input.feesTotal !== null ? input.feesTotal : sum(fills.map((f) => mul(f.qty, mul(add(f.price, input.exitPrice), feeRate))));
  const netPnl = sub(grossPnl, fees);
  let riskAtStop: Dec | null = null;
  if (input.stop !== null && input.stop > ZERO) {
    riskAtStop = sum(
      fills.map((f) => add(mul(f.qty, abs(sub(f.price, input.stop!))), mul(f.qty, mul(add(f.price, input.stop!), feeRate)))),
    );
  }
  const finalR = riskAtStop !== null && riskAtStop > ZERO ? div(netPnl, riskAtStop) : null;
  const c = cmp(netPnl, ZERO);
  return { qty, avgEntry, grossPnl, fees, netPnl, riskAtStop, finalR, outcome: c > 0 ? 'WIN' : c < 0 ? 'LOSS' : 'BREAKEVEN' };
}
