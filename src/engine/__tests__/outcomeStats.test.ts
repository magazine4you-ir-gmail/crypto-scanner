import { describe, it, expect, vi } from 'vitest';

vi.mock('@/services/supabaseClient', () => ({ supabase: {} }));

import { computeStats, type SignalOutcome } from '@/services/outcomeService';

function row(over: Partial<SignalOutcome>): SignalOutcome {
  return {
    id: Math.random().toString(36),
    symbol: 'BTCUSDT',
    base_asset: 'BTC',
    timeframe: '4h',
    signal_type: 'BUY',
    score: 75,
    price_at_signal: 100,
    entry_low: null,
    entry_high: null,
    stop_loss: 95,
    target1: 110,
    target2: null,
    risk_reward: 2,
    signal_at: '2026-10-01T00:00:00Z',
    candle_close_time: '2026-10-01T00:00:00Z',
    status: 'OPEN',
    exit_price: null,
    exit_at: null,
    pnl_pct: null,
    pnl_gross_pct: null,
    r_multiple: null,
    bars_held: null,
    source: 'auto_scan',
    notes: null,
    ...over,
  };
}

describe('computeStats', () => {
  it('computes win rate, expectancy in R and break-even win rate', () => {
    const rows = [
      row({ status: 'WIN', pnl_pct: 9.75, r_multiple: 1.95 }),
      row({ status: 'WIN', pnl_pct: 9.75, r_multiple: 1.95 }),
      row({ status: 'LOSS', pnl_pct: -5.25, r_multiple: -1.05 }),
      row({ status: 'EXPIRED', pnl_pct: 0.5, r_multiple: 0.1 }),
      row({ status: 'OPEN' }),
      row({ status: 'CANCELLED' }),
    ];
    const s = computeStats(rows);
    expect(s.open).toBe(1);
    expect(s.totalClosed).toBe(4);
    expect(s.winRate).toBeCloseTo((2 / 3) * 100, 6);
    expect(s.expectancyR).toBeCloseTo((1.95 + 1.95 - 1.05 + 0.1) / 4, 6);
    expect(s.breakEvenWinRate).toBeCloseTo((1.05 / (1.95 + 1.05)) * 100, 6);
    expect(s.byDirection.BUY.wins).toBe(2);
  });

  it('handles an empty list', () => {
    const s = computeStats([]);
    expect(s.totalClosed).toBe(0);
    expect(s.profitFactor).toBe(0);
  });
});
