// Reverse Signal Plus — candle-by-candle replay of a backtested signal. Pure: it only SLICES the real candles that the
// backtest used and reveals the real events (entry / exit) when the replay cursor reaches their candle. No synthetic motion.
import type { BacktestResult, BtCandle } from './backtest.ts';

export type ReplayEventKind = 'SIGNAL' | 'ENTRY' | 'TARGET' | 'STOP' | 'AMBIGUOUS' | 'END';
export interface ReplayEvent { kind: ReplayEventKind; time: number; price: number | null }

export interface ReplayState {
  /** candles revealed so far (the cursor candle included) */
  visible: BtCandle[];
  events: ReplayEvent[];
  status: 'WAITING_FOR_ENTRY' | 'POSITION_OPEN' | 'TP_HIT' | 'SL_HIT' | 'NO_ENTRY' | 'EXPIRED' | 'AMBIGUOUS' | 'UNKNOWN';
  finished: boolean;
}

const num = (v: bigint | null): number | null => (v === null ? null : Number(v) / 1e18);

/** `cursor` = number of candles revealed (0..candles.length). Candles must be the ones AFTER the signal, chronological. */
export function replayAt(candles: BtCandle[], bt: BacktestResult, signalTime: number, cursor: number): ReplayState {
  const k = Math.max(0, Math.min(cursor, candles.length));
  const visible = candles.slice(0, k);
  const lastTime = visible.length ? visible[visible.length - 1].closeTime : signalTime;
  const events: ReplayEvent[] = [{ kind: 'SIGNAL', time: signalTime, price: null }];
  const entered = bt.entryTime !== null && bt.entryTime <= (visible.length ? visible[visible.length - 1].openTime : -1);
  if (entered) events.push({ kind: 'ENTRY', time: bt.entryTime as number, price: num(bt.entryPrice) });
  const exited = bt.exitTime !== null && bt.exitTime <= lastTime;
  if (exited && bt.exitReason) events.push({ kind: bt.exitReason === 'TARGET' ? 'TARGET' : 'STOP', time: bt.exitTime as number, price: num(bt.exitPrice) });
  const finished = k >= candles.length || exited;
  let status: ReplayState['status'] = entered ? 'POSITION_OPEN' : 'WAITING_FOR_ENTRY';
  if (exited) status = bt.exitReason === 'TARGET' ? 'TP_HIT' : 'SL_HIT';
  else if (finished || k >= candles.length) {
    status = bt.outcome === 'NO_ENTRY' ? 'NO_ENTRY' : bt.outcome === 'EXPIRED' ? 'EXPIRED' : bt.outcome === 'AMBIGUOUS' ? 'AMBIGUOUS' : bt.outcome === 'UNKNOWN' ? 'UNKNOWN' : status;
    if (bt.outcome === 'AMBIGUOUS') events.push({ kind: 'AMBIGUOUS', time: lastTime, price: null });
  }
  return { visible, events, status, finished };
}

/** Index (1-based candle count) at which the story ends: exit candle, or all candles. */
export function replayEndCursor(candles: BtCandle[], bt: BacktestResult): number {
  if (bt.exitTime === null) return candles.length;
  const i = candles.findIndex((c) => c.closeTime >= (bt.exitTime as number));
  return i < 0 ? candles.length : i + 1;
}
