import { describe, expect, it } from 'vitest';
import { D, toNumber, toString } from '../../../supabase/functions/_shared/reversePlus/money';
import { compareModes, computePlusStats, partitionByMode, scoreBucketOf } from '../../../supabase/functions/_shared/reversePlus/stats';
import type { StatRow } from '../../../supabase/functions/_shared/reversePlus/stats';

const row = (outcome: StatRow['outcome'], pnl: string | null, r: number | null, over: Partial<StatRow> = {}): StatRow => ({
  outcome, netPnl: pnl === null ? null : D(pnl), finalR: r, timeframe: '1h', qualityScore: 72, closedAt: '2026-01-01T00:00:00Z', ...over,
});

describe('Reverse Signal Plus statistics', () => {
  const rows: StatRow[] = [
    row('WIN', '1.5', 1.5, { closedAt: '2026-01-01T00:00:00Z' }),
    row('LOSS', '-1', -1, { closedAt: '2026-01-02T00:00:00Z', timeframe: '4h', qualityScore: 55 }),
    row('LOSS', '-1', -1, { closedAt: '2026-01-03T00:00:00Z', qualityScore: 85 }),
    row('WIN', '0.5', 0.5, { closedAt: '2026-01-04T00:00:00Z', qualityScore: 85 }),
    row('EXPIRED', '-0.2', -0.2, { closedAt: '2026-01-05T00:00:00Z', qualityScore: null }),
    row('NO_FILL', null, null),
    row('OPEN', null, null),
  ];
  const s = computePlusStats(rows);

  it('win rate, expectancy, profit factor, averages, net PnL, drawdown', () => {
    expect(s.n).toBe(5);
    expect(s.winRate).toBeCloseTo(50, 6);
    expect(s.expectancyR).toBeCloseTo((1.5 - 1 - 1 + 0.5 - 0.2) / 5, 9);
    expect(s.profitFactor).toBeCloseTo(2 / 2.2, 9);
    expect(toString(s.avgWin)).toBe('1');
    expect(toString(s.avgLoss)).toBe('0.733333333333333333');
    expect(toString(s.netPnl)).toBe('-0.2');
    // equity: 1.5, 0.5, -0.5, 0, -0.2 -> peak 1.5, trough -0.5 => drawdown 2
    expect(toString(s.maxDrawdown)).toBe('2');
    expect(s.noFill).toBe(1);
    expect(s.open).toBe(1);
  });

  it('flags small samples instead of pretending significance', () => {
    expect(s.lowSample).toBe(true);
    expect(Object.values(s.byScoreBucket).every((b) => b.lowSample)).toBe(true);
  });

  it('breaks results down by timeframe and by entry-quality bucket', () => {
    expect(s.byTimeframe['1h'].n).toBe(4);
    expect(s.byTimeframe['4h'].n).toBe(1);
    expect(s.byScoreBucket['80-100'].n).toBe(2);
    expect(s.byScoreBucket['50-64'].n).toBe(1);
    expect(s.byScoreBucket['N/A'].n).toBe(1);
    expect(scoreBucketOf(79)).toBe('65-79');
    expect(scoreBucketOf(49)).toBe('<50');
  });

  it('empty input is safe', () => {
    const e = computePlusStats([]);
    expect(e.n).toBe(0);
    expect(e.winRate).toBe(0);
    expect(toNumber(e.maxDrawdown)).toBe(0);
  });

  it('PAPER and ACTUAL rows are separated before any statistic is computed', () => {
    const mixed = [{ mode: 'PAPER' as const, id: 1 }, { mode: 'ACTUAL' as const, id: 2 }, { mode: 'PAPER' as const, id: 3 }];
    const p = partitionByMode(mixed);
    expect(p.paper.map((x) => x.id)).toEqual([1, 3]);
    expect(p.actual.map((x) => x.id)).toEqual([2]);
  });

  it('three-way comparison only uses signals closed in all three systems', () => {
    const c = compareModes([
      { originId: 'a', originalStatus: 'LOSS', originalR: -1, reverseStatus: 'WIN', reverseR: 0.5, plusOutcome: 'WIN', plusR: 0.8 },
      { originId: 'b', originalStatus: 'WIN', originalR: 2, reverseStatus: 'LOSS', reverseR: -1, plusOutcome: 'LOSS', plusR: -1 },
      { originId: 'c', originalStatus: 'OPEN', originalR: null, reverseStatus: 'OPEN', reverseR: null, plusOutcome: 'WIN', plusR: 1 },
      { originId: 'd', originalStatus: 'WIN', originalR: 2, reverseStatus: 'LOSS', reverseR: -1, plusOutcome: null, plusR: null },
    ]);
    expect(c.common).toBe(2);
    expect(c.original.expectancyR).toBeCloseTo(0.5, 9);
    expect(c.reverse.expectancyR).toBeCloseTo(-0.25, 9);
    expect(c.plus.totalR).toBeCloseTo(-0.2, 9);
  });
});
