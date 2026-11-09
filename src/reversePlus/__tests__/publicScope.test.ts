import { describe, expect, it } from 'vitest';
import { centralOnly, isHistoricalSignal, mayCreatePaperTrade, visibleTrades } from '../../../supabase/functions/_shared/reversePlus/index';

const SINCE = '2026-11-09T00:00:00.000Z';

describe('public scope: historical vs live', () => {
  it('signals before public_since are historical and never get a PAPER trade', () => {
    expect(isHistoricalSignal('2026-11-08T23:59:59.000Z', SINCE)).toBe(true);
    expect(mayCreatePaperTrade('2026-11-08T23:59:59.000Z', SINCE)).toBe(false);
  });
  it('signals at or after public_since may get a PAPER trade', () => {
    expect(isHistoricalSignal(SINCE, SINCE)).toBe(false);
    expect(mayCreatePaperTrade(SINCE, SINCE)).toBe(true);
    expect(mayCreatePaperTrade('2026-11-09T05:00:00.000Z', SINCE)).toBe(true);
  });
  it('missing data is never treated as a green light', () => {
    expect(mayCreatePaperTrade(null, SINCE)).toBe(false);
    expect(mayCreatePaperTrade('2026-11-09T05:00:00.000Z', null)).toBe(false);
    expect(isHistoricalSignal('garbage', SINCE)).toBe(false);
  });
});

describe('public scope: visibility is independent of any per-user switch', () => {
  const rows = [
    { id: 1, user_id: null, mode: 'PAPER' },
    { id: 2, user_id: 'A', mode: 'PAPER' }, // legacy per-user paper row
    { id: 3, user_id: 'B', mode: 'PAPER' }, // legacy per-user paper row
    { id: 4, user_id: 'B', mode: 'ACTUAL' },
    { id: 5, user_id: 'A', mode: 'ACTUAL' },
  ];
  it('user A (module never enabled) and user B (enabled) see the same central PAPER trades', () => {
    const a = visibleTrades(rows, 'A').filter((r) => r.mode === 'PAPER');
    const b = visibleTrades(rows, 'B').filter((r) => r.mode === 'PAPER');
    expect(a).toEqual(b);
    expect(a.map((r) => r.id)).toEqual([1]);
  });
  it('ACTUAL trades stay private to their owner', () => {
    expect(visibleTrades(rows, 'A').filter((r) => r.mode === 'ACTUAL').map((r) => r.id)).toEqual([5]);
    expect(visibleTrades(rows, 'B').filter((r) => r.mode === 'ACTUAL').map((r) => r.id)).toEqual([4]);
    expect(visibleTrades(rows, null).filter((r) => r.mode === 'ACTUAL')).toEqual([]);
  });
  it('evaluations: only central rows, no duplicates from legacy per-user rows', () => {
    const ev = [{ user_id: null }, { user_id: 'A' }, { user_id: 'B' }];
    expect(centralOnly(ev)).toEqual([{ user_id: null }]);
  });
});
