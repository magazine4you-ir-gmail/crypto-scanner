// Reverse Signal Plus — PAPER trading simulator (scaled limit entries, stop / target, costs).
//
// Uses ONLY closed candles that come AFTER the plan was created (the caller passes them, and `asOfCloseTime`
// cuts anything that was not closed yet). Conservative rules, because a candle does not tell the order of events:
//   * a step fills when a candle touches its limit price; the fill is booked AT the limit price (never better);
//   * if a candle touches the STOP it is a loss — stop is checked BEFORE the target (also when stop and target
//     are touched in the same candle) and before anything else;
//   * a stop touched in the same candle in which a step fills counts as hit (all touched steps are filled);
//   * a target touched in the same candle in which a new step fills is NOT counted (ordering unknown);
//   * gap through the stop exits at the open (worse than the stop), never at the stop;
//   * the target is reached before any step filled -> trade cancelled (NO_FILL), no profit is invented.
import { D, ZERO, add, cmp, div, fraction, mul, sub, sum } from './money.ts';
import type { Dec } from './money.ts';
import type { Candle } from '../engine.ts';
import { sizeAtRisk } from './positionCalc.ts';
import type { CostConfig, Side } from './types.ts';

export type PaperStatus = 'PENDING' | 'OPEN' | 'WIN' | 'LOSS' | 'EXPIRED' | 'NO_FILL';

export interface PaperStepPlan {
  price: Dec;
  qty: Dec;
}

export interface PaperFill {
  index: number;
  price: Dec;
  qty: Dec;
  /** closeTime (ms) of the candle that touched the limit — the earliest moment we KNOW it was filled */
  time: number;
}

export interface PaperInput {
  side: Side;
  steps: PaperStepPlan[];
  stop: Dec;
  target: Dec;
  cost: CostConfig;
  /** candles AFTER the plan was created, ascending */
  candlesAfter: Candle[];
  asOfCloseTime: number;
  /** a plan with no fill within this many bars is cancelled */
  maxFillBars: number;
  /** after the first fill the trade expires after this many bars (exit at close) */
  maxHoldBars: number;
}

export interface PaperResult {
  status: PaperStatus;
  fills: PaperFill[];
  qtyFilled: Dec;
  avgEntry: Dec | null;
  exitPrice: Dec | null;
  exitTime: number | null;
  grossPnl: Dec | null;
  fees: Dec | null;
  slippageCost: Dec | null;
  netPnl: Dec | null;
  /** planned net risk of the FILLED quantity at the stop (the 1R of this trade) */
  riskAtStop: Dec | null;
  finalR: Dec | null;
  barsToFirstFill: number | null;
  barsHeld: number | null;
  notes: string[];
}

const empty = (status: PaperStatus, notes: string[]): PaperResult => ({
  status, fills: [], qtyFilled: ZERO, avgEntry: null, exitPrice: null, exitTime: null, grossPnl: null,
  fees: null, slippageCost: null, netPnl: null, riskAtStop: null, finalR: null, barsToFirstFill: null, barsHeld: null, notes,
});

export function simulatePaper(input: PaperInput): PaperResult {
  const { side, stop, target, cost } = input;
  const candles = input.candlesAfter.filter((c) => c.closeTime <= input.asOfCloseTime);
  const sell = side === 'SELL';
  const fills: PaperFill[] = [];
  const filledIdx = new Set<number>();
  let firstFillBar: number | null = null;
  const notes: string[] = [];

  let exit: { price: Dec; time: number; kind: 'STOP' | 'TARGET' | 'EXPIRY'; bars: number } | null = null;

  for (let i = 0; i < candles.length && !exit; i++) {
    const c = candles[i];
    const bar = i + 1;
    if (fills.length === 0 && bar > input.maxFillBars) return empty('NO_FILL', ['FILL_WINDOW_EXPIRED']);

    const high = D(c.high);
    const low = D(c.low);
    let filledNow = false;
    input.steps.forEach((s, idx) => {
      if (filledIdx.has(idx)) return;
      const touched = sell ? cmp(high, s.price) >= 0 : cmp(low, s.price) <= 0;
      if (touched) {
        filledIdx.add(idx);
        fills.push({ index: idx, price: s.price, qty: s.qty, time: c.closeTime });
        filledNow = true;
      }
    });
    if (filledNow && firstFillBar === null) firstFillBar = bar;

    const stopHit = sell ? cmp(high, stop) >= 0 : cmp(low, stop) <= 0;
    const targetHit = sell ? cmp(low, target) <= 0 : cmp(high, target) >= 0;

    if (fills.length === 0) {
      if (targetHit) return empty('NO_FILL', ['TARGET_REACHED_BEFORE_FILL']);
      continue;
    }
    if (stopHit) {
      const open = D(c.open);
      const gapped = sell ? cmp(open, stop) > 0 : cmp(open, stop) < 0;
      exit = { price: gapped ? open : stop, time: c.closeTime, kind: 'STOP', bars: bar };
      if (gapped) notes.push('GAP_THROUGH_STOP');
    } else if (targetHit && !filledNow) {
      exit = { price: target, time: c.closeTime, kind: 'TARGET', bars: bar };
    } else {
      if (targetHit && filledNow) notes.push('TARGET_IGNORED_SAME_CANDLE_AS_FILL');
      if (firstFillBar !== null && bar - firstFillBar + 1 >= input.maxHoldBars) {
        exit = { price: D(c.close), time: c.closeTime, kind: 'EXPIRY', bars: bar };
      }
    }
  }

  if (fills.length === 0) return { ...empty('PENDING', notes), notes };
  if (!exit) {
    const q = sum(fills.map((f) => f.qty));
    return {
      ...empty('OPEN', notes),
      fills,
      qtyFilled: q,
      avgEntry: div(sum(fills.map((f) => mul(f.qty, f.price))), q),
      barsToFirstFill: firstFillBar,
    };
  }

  // ---- result ----------------------------------------------------------------------------
  const f = fraction(cost.feePct);
  const s = fraction(cost.slippagePct);
  const qtyFilled = sum(fills.map((x) => x.qty));
  const avgEntry = div(sum(fills.map((x) => mul(x.qty, x.price))), qtyFilled);
  const perUnit = (entry: Dec) => (sell ? sub(entry, exit!.price) : sub(exit!.price, entry));
  const grossPnl = sum(fills.map((x) => mul(x.qty, perUnit(x.price))));
  const fees = sum(fills.map((x) => mul(x.qty, mul(add(x.price, exit!.price), f))));
  // entry slippage always; exit slippage on market exits (stop / expiry), none on the limit target
  const entrySlip = sum(fills.map((x) => mul(x.qty, mul(x.price, s))));
  const exitSlip = exit.kind === 'TARGET' ? ZERO : mul(qtyFilled, mul(exit.price, s));
  const slippageCost = add(entrySlip, exitSlip);
  const netPnl = sub(sub(grossPnl, fees), slippageCost);
  const riskAtStop = sum(fills.map((x) => sizeAtRisk(x.price, stop, x.qty, cost, D(1)).netRisk));
  const finalR = riskAtStop > ZERO ? div(netPnl, riskAtStop) : null;

  const status: PaperStatus = exit.kind === 'STOP' ? 'LOSS' : exit.kind === 'TARGET' ? 'WIN' : 'EXPIRED';
  return {
    status, fills, qtyFilled, avgEntry, exitPrice: exit.price, exitTime: exit.time, grossPnl, fees, slippageCost,
    netPnl, riskAtStop, finalR, barsToFirstFill: firstFillBar, barsHeld: exit.bars - (firstFillBar ?? exit.bars) + 1, notes,
  };
}

