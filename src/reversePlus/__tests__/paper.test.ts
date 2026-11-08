import { describe, expect, it } from 'vitest';
import { D, toString } from '../../../supabase/functions/_shared/reversePlus/money';
import { simulatePaper } from '../../../supabase/functions/_shared/reversePlus/paperTrade';
import type { PaperInput } from '../../../supabase/functions/_shared/reversePlus/paperTrade';
import { computeActual } from '../../../supabase/functions/_shared/reversePlus/actualTrade';
import { cost } from './fixtures';
import { mkCandle } from './helpers';

// reverse SELL: limits at 100 (0.3) and 100.3 (0.35), stop 103, target 98.5
const mk = (rows: [number, number, number, number][], extra: Partial<PaperInput> = {}): PaperInput => ({
  side: 'SELL',
  steps: [{ price: D(100), qty: D('0.3') }, { price: D('100.3'), qty: D('0.35') }],
  stop: D(103),
  target: D('98.5'),
  cost,
  candlesAfter: rows.map((r, i) => mkCandle(i + 1, r[0], r[1], r[2], r[3])),
  asOfCloseTime: Number.MAX_SAFE_INTEGER,
  maxFillBars: 48,
  maxHoldBars: 48,
  ...extra,
});

describe('paper trading — scaled SELL', () => {
  it('fills step by step, averages the entry and books a WIN net of fees + slippage', () => {
    const r = simulatePaper(mk([[99.5, 100.1, 99.4, 99.8], [99.8, 100.4, 99.0, 99.5], [99.5, 99.6, 98.4, 98.6]]));
    expect(r.status).toBe('WIN');
    expect(r.fills.map((f) => toString(f.price))).toEqual(['100', '100.3']);
    expect(r.fills[0].time).toBeLessThan(r.fills[1].time);
    expect(toString(r.avgEntry!)).toBe(toString((D('0.3') * D(100) + D('0.35') * D('100.3')) / D('0.65')));
    expect(toString(r.grossPnl!)).toBe('1.08');
    expect(toString(r.fees!)).toBe('0.064565');
    expect(toString(r.slippageCost!)).toBe('0.013021');
    expect(toString(r.netPnl!)).toBe('1.002414');
    expect(Number(r.finalR) / 1e18).toBeCloseTo(Number(r.netPnl) / Number(r.riskAtStop), 9);
    expect(Number(r.finalR) / 1e18).toBeGreaterThan(0.4);
    expect(Number(r.finalR) / 1e18).toBeLessThan(0.7); // reverse trades have RR < 1: a win is worth about +0.5R
    expect(toString(r.exitPrice!)).toBe('98.5');
  });

  it('stop is checked BEFORE the target in the same candle -> LOSS', () => {
    const r = simulatePaper(mk([[99.5, 100.4, 99.4, 99.9], [100, 103.5, 98.0, 99]]));
    expect(r.status).toBe('LOSS');
    expect(toString(r.exitPrice!)).toBe('103');
    expect(Number(r.netPnl) / 1e18).toBeLessThan(0);
    expect(Number(r.finalR) / 1e18).toBeLessThan(0);
  });

  it('a gap through the stop exits at the OPEN (worse than the stop)', () => {
    const r = simulatePaper(mk([[99.5, 100.4, 99.4, 99.9], [104, 105, 103.5, 104.5]]));
    expect(r.status).toBe('LOSS');
    expect(toString(r.exitPrice!)).toBe('104');
    expect(r.notes).toContain('GAP_THROUGH_STOP');
  });

  it('a target touched in the same candle in which a step fills is NOT counted (unknown order)', () => {
    const r = simulatePaper(mk([[99.5, 100.4, 98.0, 99.9]]));
    expect(r.status).toBe('OPEN');
    expect(r.notes).toContain('TARGET_IGNORED_SAME_CANDLE_AS_FILL');
  });

  it('target reached before any fill cancels the plan: no profit is invented', () => {
    const r = simulatePaper(mk([[99.5, 99.9, 98.0, 98.2]]));
    expect(r.status).toBe('NO_FILL');
    expect(r.fills).toHaveLength(0);
    expect(r.notes).toContain('TARGET_REACHED_BEFORE_FILL');
  });

  it('no fill inside the window -> NO_FILL; before that it stays PENDING', () => {
    const quiet = [[99, 99.5, 98.9, 99.2]] as [number, number, number, number][];
    expect(simulatePaper(mk(quiet)).status).toBe('PENDING');
    const many = Array.from({ length: 5 }, () => quiet[0]);
    expect(simulatePaper(mk(many, { maxFillBars: 3 })).status).toBe('NO_FILL');
  });

  it('expires after the holding window and exits at the close', () => {
    const rows: [number, number, number, number][] = [[99.5, 100.4, 99.4, 99.9], [99.9, 100.1, 99.5, 99.7], [99.7, 100, 99.4, 99.6]];
    const r = simulatePaper(mk(rows, { maxHoldBars: 3 }));
    expect(r.status).toBe('EXPIRED');
    expect(toString(r.exitPrice!)).toBe('99.6');
  });

  it('look-ahead protection: candles closing after asOf are ignored', () => {
    const rows: [number, number, number, number][] = [[99.5, 100.4, 99.4, 99.9], [99.9, 100.1, 98.0, 98.2]];
    const input = mk(rows);
    const cut = simulatePaper({ ...input, asOfCloseTime: input.candlesAfter[0].closeTime });
    expect(cut.status).toBe('OPEN');
    const full = simulatePaper(input);
    expect(full.status).toBe('WIN');
  });

  it('is deterministic / idempotent (same input -> identical result)', () => {
    const input = mk([[99.5, 100.4, 99.4, 99.9], [99.9, 100.1, 98.0, 98.2]]);
    expect(simulatePaper(input)).toEqual(simulatePaper(input));
  });

  it('BUY side mirror books a LONG win correctly', () => {
    const r = simulatePaper({
      side: 'BUY', steps: [{ price: D('99.7'), qty: D('0.35') }], stop: D(97), target: D('101.5'), cost,
      candlesAfter: [mkCandle(1, 100, 100.1, 99.6, 99.9), mkCandle(2, 99.9, 101.6, 99.8, 101.5)],
      asOfCloseTime: Number.MAX_SAFE_INTEGER, maxFillBars: 10, maxHoldBars: 10,
    });
    expect(r.status).toBe('WIN');
    expect(toString(r.grossPnl!)).toBe('0.63'); // 0.35 * (101.5 - 99.7)
  });
});

describe('actual trading record (manual) — kept separate from paper', () => {
  it('computes real net PnL and R from the typed fills', () => {
    const r = computeActual({
      side: 'SELL', fills: [{ price: D('100.1'), qty: D('0.3') }, { price: D('100.3'), qty: D('0.3') }],
      exitPrice: D('98.7'), stop: D(103), feesTotal: D('0.05'), feePct: D('0.05'),
    })!;
    expect(toString(r.qty)).toBe('0.6');
    expect(toString(r.grossPnl)).toBe('0.9'); // 0.3*1.4 + 0.3*1.6
    expect(toString(r.fees)).toBe('0.05');
    expect(toString(r.netPnl)).toBe('0.85');
    expect(r.outcome).toBe('WIN');
    expect(Number(r.finalR) / 1e18).toBeGreaterThan(0);
  });

  it('uses the fee percentage when the real fee is not typed, handles LONG losses and invalid input', () => {
    const r = computeActual({ side: 'BUY', fills: [{ price: D(100), qty: D(1) }], exitPrice: D(98), stop: D(97), feesTotal: null, feePct: D('0.05') })!;
    expect(toString(r.fees)).toBe('0.099');
    expect(r.outcome).toBe('LOSS');
    expect(computeActual({ side: 'BUY', fills: [], exitPrice: D(1), stop: null, feesTotal: null, feePct: D(0) })).toBeNull();
    expect(computeActual({ side: 'BUY', fills: [{ price: D(1), qty: D(1) }], exitPrice: D(2), stop: null, feesTotal: null, feePct: D(0) })!.finalR).toBeNull();
  });
});
