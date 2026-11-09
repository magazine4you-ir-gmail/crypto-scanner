// Reverse Signal Plus — historical backtest of ONE signal from REAL closed candles, in chronological order.
//
// Anti-hindsight rules (all enforced + unit-tested):
//  * Only candles that open AFTER the signal candle closed are used; they are sorted and de-duplicated by time.
//  * Entry is a LIMIT at `entry`; it is filled only when a candle's range actually reaches it (never before).
//  * A signal is never a WIN/LOSS unless a fill happened (NO_ENTRY / EXPIRED / UNKNOWN / AMBIGUOUS are separate).
//  * If one candle contains both outcomes and the intra-candle order is unknown, NO optimistic guess is made:
//    the order is resolved from lower-timeframe candles (callback) or the result is AMBIGUOUS.
//  * Missing data -> UNKNOWN (never assumed to be a win or a loss).
//  * Stop gaps exit at the (worse) open; target exits at the target price (gaps in our favour are not credited).
import { D, max, min, type Dec } from './money.ts';
import type { Side } from './types.ts';

export const BACKTEST_ENGINE_VERSION = 'bt-1';

export interface BtCandle { openTime: number; closeTime: number; open: number; high: number; low: number; close: number }
export type BtOutcome = 'WIN' | 'LOSS' | 'BREAKEVEN' | 'NO_ENTRY' | 'EXPIRED' | 'AMBIGUOUS' | 'UNKNOWN';
export type BtReason =
  | 'TARGET_HIT' | 'STOP_HIT' | 'STOP_HIT_GAP'
  | 'ENTRY_NOT_REACHED' | 'TARGET_BEFORE_ENTRY' | 'HOLD_WINDOW_EXPIRED'
  | 'SAME_CANDLE_ORDER_UNKNOWN' | 'FILL_CANDLE_ORDER_UNKNOWN'
  | 'INSUFFICIENT_DATA_ENTRY' | 'INSUFFICIENT_DATA_POSITION_OPEN' | 'INVALID_GEOMETRY' | 'NO_CANDLES';

export interface BacktestInput {
  side: Side;
  entry: Dec;
  stop: Dec;
  target: Dec;
  /** close time (ms) of the candle on which the signal was issued; only candles opening after it are used */
  signalCloseTime: number;
  candles: BtCandle[];
  /** max candles in which the entry may be reached */
  entryWindowBars: number;
  /** max candles the position may stay open */
  maxHoldBars: number;
  /** lower-timeframe candles INSIDE one candle (e.g. 1m for a 1h candle); null when unavailable */
  lowerTf?: (c: BtCandle) => BtCandle[] | null;
}

export interface BacktestResult {
  outcome: BtOutcome;
  reason: BtReason;
  entryTime: number | null;
  entryPrice: Dec | null;
  exitTime: number | null;
  exitPrice: Dec | null;
  exitReason: 'TARGET' | 'STOP' | null;
  barsToEntry: number | null;
  barsHeld: number | null;
  /** most adverse / favourable price between the fill and the exit (see worst/best rules in the header) */
  worstPrice: Dec | null;
  bestPrice: Dec | null;
  lowerTfUsed: boolean;
  candlesUsed: number;
}

const empty = (n: number): BacktestResult => ({
  outcome: 'UNKNOWN', reason: 'NO_CANDLES', entryTime: null, entryPrice: null, exitTime: null, exitPrice: null, exitReason: null,
  barsToEntry: null, barsHeld: null, worstPrice: null, bestPrice: null, lowerTfUsed: false, candlesUsed: n,
});

export function geometryValid(side: Side, entry: Dec, stop: Dec, target: Dec): boolean {
  return side === 'SELL' ? target < entry && entry < stop : stop < entry && entry < target;
}

/** chronological, de-duplicated, only candles that open after the signal candle closed */
export function usableCandles(candles: BtCandle[], signalCloseTime: number): BtCandle[] {
  const sorted = [...candles]
    .filter((c) => Number.isFinite(c.high) && Number.isFinite(c.low) && c.high >= c.low && c.openTime > signalCloseTime)
    .sort((a, b) => a.openTime - b.openTime);
  const out: BtCandle[] = [];
  for (const c of sorted) if (!out.length || c.openTime > out[out.length - 1].openTime) out.push(c);
  return out;
}

interface Flags { entry: boolean; target: boolean; stop: boolean }

function flags(side: Side, c: BtCandle, entry: Dec, stop: Dec, target: Dec): Flags {
  const hi = D(c.high), lo = D(c.low);
  return side === 'SELL'
    ? { entry: hi >= entry, target: lo <= target, stop: hi >= stop }
    : { entry: lo <= entry, target: hi >= target, stop: lo <= stop };
}

type Step =
  | { kind: 'CONTINUE' }
  | { kind: 'DONE'; r: Partial<BacktestResult> & { outcome: BtOutcome; reason: BtReason } };

/** One pass over `list`. `st` carries the position state across candles (and into a lower-TF re-walk). */
interface State { filled: boolean; entryTime: number | null; fillIndex: number | null; worst: Dec | null; best: Dec | null; lowerUsed: boolean }

function stopExit(side: Side, c: BtCandle, stop: Dec): { price: Dec; gap: boolean } {
  const o = D(c.open);
  if (side === 'SELL') return o > stop ? { price: o, gap: true } : { price: stop, gap: false };
  return o < stop ? { price: o, gap: true } : { price: stop, gap: false };
}

function adverse(side: Side, c: BtCandle): Dec { return side === 'SELL' ? D(c.high) : D(c.low); }
function favourable(side: Side, c: BtCandle): Dec { return side === 'SELL' ? D(c.low) : D(c.high); }
const worse = (side: Side, a: Dec | null, b: Dec): Dec => (a === null ? b : side === 'SELL' ? max(a, b) : min(a, b));
const better = (side: Side, a: Dec | null, b: Dec): Dec => (a === null ? b : side === 'SELL' ? min(a, b) : max(a, b));

function walkCandle(
  side: Side, c: BtCandle, idx: number, p: BacktestInput, st: State, depth: number,
): Step {
  const { entry, stop, target } = p;
  const f = flags(side, c, entry, stop, target);

  const exitWin = (): Step => ({ kind: 'DONE', r: {
    outcome: 'WIN', reason: 'TARGET_HIT', exitTime: c.closeTime, exitPrice: target, exitReason: 'TARGET',
    // order inside the exit candle is unknown -> the whole candle's adverse extreme is counted (pessimistic, never optimistic)
    worstPrice: worse(side, st.worst, adverse(side, c)), bestPrice: better(side, st.best, target),
  } });
  const exitLoss = (): Step => {
    const x = stopExit(side, c, stop);
    return { kind: 'DONE', r: {
      outcome: 'LOSS', reason: x.gap ? 'STOP_HIT_GAP' : 'STOP_HIT', exitTime: c.closeTime, exitPrice: x.price, exitReason: 'STOP',
      worstPrice: worse(side, st.worst, x.price), bestPrice: st.best,
    } };
  };
  const resolveLower = (waiting: boolean): Step => {
    const sub = depth === 0 && p.lowerTf ? p.lowerTf(c) : null;
    if (!sub || sub.length === 0) {
      return { kind: 'DONE', r: { outcome: 'AMBIGUOUS', reason: waiting ? 'FILL_CANDLE_ORDER_UNKNOWN' : 'SAME_CANDLE_ORDER_UNKNOWN',
        entryTime: st.entryTime, worstPrice: st.worst, bestPrice: st.best } };
    }
    st.lowerUsed = true;
    const inside = usableCandles(sub, c.openTime - 1).filter((s) => s.openTime <= c.closeTime);
    for (const s of inside) {
      const r = walkCandle(side, s, idx, p, st, depth + 1);
      if (r.kind === 'DONE') return r;
    }
    return { kind: 'CONTINUE' };
  };

  if (!st.filled) {
    if (!f.entry) {
      if (f.target) return { kind: 'DONE', r: { outcome: 'NO_ENTRY', reason: 'TARGET_BEFORE_ENTRY' } };
      return { kind: 'CONTINUE' };
    }
    // entry reached in this candle
    if (f.target) return resolveLower(true); // fill vs. target order unknown
    st.filled = true; st.entryTime = c.openTime; st.fillIndex = idx;
    st.worst = adverse(side, c);
    st.best = entry; // the favourable extreme of the fill candle may have happened BEFORE the fill -> not counted
    if (f.stop) return exitLoss(); // price cannot reach the stop without first crossing the entry
    return { kind: 'CONTINUE' };
  }

  // position open
  if (f.target && f.stop) return resolveLower(false);
  if (f.stop) return exitLoss();
  if (f.target) return exitWin();
  st.worst = worse(side, st.worst, adverse(side, c));
  st.best = better(side, st.best, favourable(side, c));
  return { kind: 'CONTINUE' };
}

export function runBacktest(input: BacktestInput): BacktestResult {
  const { side, entry, stop, target } = input;
  const list = usableCandles(input.candles, input.signalCloseTime);
  if (!geometryValid(side, entry, stop, target)) return { ...empty(list.length), reason: 'INVALID_GEOMETRY' };
  if (list.length === 0) return empty(0);

  const st: State = { filled: false, entryTime: null, fillIndex: null, worst: null, best: null, lowerUsed: false };
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (!st.filled && i >= input.entryWindowBars) break;
    if (st.filled && st.fillIndex !== null && i - st.fillIndex >= input.maxHoldBars) {
      return finish(st, list.length, { outcome: 'EXPIRED', reason: 'HOLD_WINDOW_EXPIRED' }, null);
    }
    const step = walkCandle(side, c, i, input, st, 0);
    if (step.kind === 'DONE') {
      const barsHeld = st.fillIndex === null ? null : i - st.fillIndex + 1;
      return finish(st, list.length, step.r, barsHeld);
    }
  }
  if (!st.filled) {
    // entry window over (or data ended inside it)
    const covered = Math.min(list.length, input.entryWindowBars);
    return covered >= input.entryWindowBars
      ? finish(st, list.length, { outcome: 'NO_ENTRY', reason: 'ENTRY_NOT_REACHED' }, null)
      : finish(st, list.length, { outcome: 'UNKNOWN', reason: 'INSUFFICIENT_DATA_ENTRY' }, null);
  }
  const held = st.fillIndex === null ? 0 : list.length - st.fillIndex;
  return held >= input.maxHoldBars
    ? finish(st, list.length, { outcome: 'EXPIRED', reason: 'HOLD_WINDOW_EXPIRED' }, null)
    : finish(st, list.length, { outcome: 'UNKNOWN', reason: 'INSUFFICIENT_DATA_POSITION_OPEN' }, null);
}

function finish(
  st: State, used: number,
  r: Partial<BacktestResult> & { outcome: BtOutcome; reason: BtReason }, barsHeld: number | null,
): BacktestResult {
  const filledIdx = st.fillIndex;
  return {
    outcome: r.outcome, reason: r.reason,
    entryTime: r.entryTime ?? st.entryTime,
    entryPrice: null, // filled in below by the caller-independent rule: the limit price
    exitTime: r.exitTime ?? null, exitPrice: r.exitPrice ?? null, exitReason: r.exitReason ?? null,
    barsToEntry: filledIdx === null ? null : filledIdx + 1,
    barsHeld,
    worstPrice: r.worstPrice ?? (st.filled ? st.worst : null),
    bestPrice: r.bestPrice ?? (st.filled ? st.best : null),
    lowerTfUsed: st.lowerUsed, candlesUsed: used,
  };
}

/** Convenience wrapper: same as runBacktest but fills `entryPrice` (the limit price) when a fill happened. */
export function backtestSignal(input: BacktestInput): BacktestResult {
  const r = runBacktest(input);
  return r.barsToEntry !== null ? { ...r, entryPrice: input.entry } : r;
}

export const isClosedTrade = (r: Pick<BacktestResult, 'outcome'>): boolean => r.outcome === 'WIN' || r.outcome === 'LOSS' || r.outcome === 'BREAKEVEN';

/** Entry-window / max-hold bars per timeframe (same table the evaluator uses). */
export const EXPIRY_BARS_BY_TF: Record<string, number> = { '1m': 240, '5m': 144, '15m': 96, '30m': 96, '1h': 48, '4h': 30, '1d': 20, '1w': 12 };
