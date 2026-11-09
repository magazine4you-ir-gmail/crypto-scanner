import type { PlusBacktest } from '@/services/reversePlusService';
import { D, type BacktestResult } from '../../supabase/functions/_shared/reversePlus/index';

const ms = (v: string | null) => (v ? Date.parse(v) : null);
const dec = (v: number | null) => (v === null ? null : D(v));

/** stored backtest row -> engine result (Dec). Prices arrive as JSON numbers: used through D() (shortest decimal text). */
export function rowToResult(b: PlusBacktest): BacktestResult {
  return {
    outcome: b.outcome, reason: b.reason as BacktestResult['reason'], entryTime: ms(b.entry_time), entryPrice: dec(b.entry_price),
    exitTime: ms(b.exit_time), exitPrice: dec(b.exit_price), exitReason: b.exit_reason, barsToEntry: b.bars_to_entry, barsHeld: b.bars_held,
    worstPrice: dec(b.worst_price), bestPrice: dec(b.best_price), lowerTfUsed: b.lower_tf_used, candlesUsed: b.candles_used,
  };
}
