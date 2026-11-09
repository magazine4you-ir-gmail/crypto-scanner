// Reverse Signal Plus — performance statistics over backtested trades (HISTORICAL / LIVE / PAPER / ACTUAL are never mixed:
// the caller passes one homogeneous list).  Win rate excludes NO_ENTRY / AMBIGUOUS / EXPIRED / UNKNOWN from the
// denominator; their counts are reported separately.
import { ZERO, abs, add, div, sub, toNumber, type Dec } from './money.ts';
import type { TradeMetrics } from './leverage.ts';
import type { Side } from './types.ts';

export interface StatInput { m: TradeMetrics; symbol: string; timeframe: string; side: Side; signalAt: string | null; leverage: number }

export interface BtStats {
  total: number;
  wins: number; losses: number; breakeven: number; noEntry: number; expired: number; ambiguous: number; unknown: number;
  liquidations: number;
  /** wins / (wins + losses + breakeven). Null when there is no closed trade. */
  winRate: number | null;
  lossRate: number | null;
  noEntryRate: number | null;
  netPnl: Dec; avgPnl: Dec | null; avgRoiPct: Dec | null; avgR: number | null;
  /** gross profit / gross loss; null when there is no loss and no profit; Infinity when profit without loss */
  profitFactor: number | null;
  maxDrawdown: Dec;
  best: Dec | null; worst: Dec | null;
  avgHoldingMs: number | null;
  avgRr: number | null;
  lowSample: boolean;
}

export const MIN_BT_SAMPLE = 30;

export function computeBacktestStats(rows: StatInput[]): BtStats {
  const c = (o: TradeMetrics['outcome']) => rows.filter((r) => r.m.outcome === o).length;
  const closed = rows.filter((r) => r.m.closed && r.m.netPnl !== null);
  const wins = closed.filter((r) => r.m.outcome === 'WIN').length;
  const losses = closed.filter((r) => r.m.outcome === 'LOSS').length;
  const breakeven = c('BREAKEVEN');
  const denom = wins + losses + breakeven;
  const pnls = closed.map((r) => r.m.netPnl as Dec);
  const net = pnls.reduce((s, v) => add(s, v), ZERO);
  const grossProfit = pnls.filter((v) => v > ZERO).reduce((s, v) => add(s, v), ZERO);
  const grossLoss = pnls.filter((v) => v < ZERO).reduce((s, v) => add(s, abs(v)), ZERO);
  // max drawdown on the equity curve ordered by exit time (peak-to-trough of cumulative net PnL, starting at 0)
  const ordered = [...closed].sort((a, b) => (a.m.exitTime ?? 0) - (b.m.exitTime ?? 0));
  let eq = ZERO, peak = ZERO, dd = ZERO;
  for (const r of ordered) {
    eq = add(eq, r.m.netPnl as Dec);
    if (eq > peak) peak = eq;
    if (sub(peak, eq) > dd) dd = sub(peak, eq);
  }
  const rs = closed.map((r) => r.m.rMultiple).filter((v): v is Dec => v !== null).map(toNumber);
  const rois = closed.map((r) => r.m.roiPct).filter((v): v is Dec => v !== null);
  const holds = closed.map((r) => r.m.holdingMs).filter((v): v is number => v !== null);
  const rrs = closed.map((r) => toNumber(r.m.scenario.rrNet)).filter((v) => Number.isFinite(v) && v > 0);
  const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  return {
    total: rows.length, wins, losses, breakeven, noEntry: c('NO_ENTRY'), expired: c('EXPIRED'), ambiguous: c('AMBIGUOUS'), unknown: c('UNKNOWN'),
    liquidations: closed.filter((r) => r.m.liquidated).length,
    winRate: denom ? (wins / denom) * 100 : null,
    lossRate: denom ? (losses / denom) * 100 : null,
    noEntryRate: rows.length ? (c('NO_ENTRY') / rows.length) * 100 : null,
    netPnl: net, avgPnl: closed.length ? div(net, add(ZERO, BigInt(closed.length) * 10n ** 18n)) : null,
    avgRoiPct: rois.length ? div(rois.reduce((s, v) => add(s, v), ZERO), BigInt(rois.length) * 10n ** 18n) : null,
    avgR: avg(rs),
    profitFactor: grossLoss > ZERO ? toNumber(div(grossProfit, grossLoss)) : grossProfit > ZERO ? Infinity : null,
    maxDrawdown: dd,
    best: pnls.length ? pnls.reduce((a, b) => (b > a ? b : a)) : null,
    worst: pnls.length ? pnls.reduce((a, b) => (b < a ? b : a)) : null,
    avgHoldingMs: avg(holds), avgRr: avg(rrs), lowSample: denom < MIN_BT_SAMPLE,
  };
}

export function groupStats(rows: StatInput[], key: (r: StatInput) => string): Record<string, BtStats> {
  const g = new Map<string, StatInput[]>();
  for (const r of rows) { const k = key(r); g.set(k, [...(g.get(k) ?? []), r]); }
  return Object.fromEntries([...g.entries()].map(([k, v]) => [k, computeBacktestStats(v)]));
}
