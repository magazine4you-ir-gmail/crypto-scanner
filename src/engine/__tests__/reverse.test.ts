import { describe, it, expect } from 'vitest';
import {
  reversePlan,
  buildReverseOutcomeRow,
  oppositeSide,
  resolveTrade,
  EXPIRY_BARS,
  type Candle,
  type OriginOutcome,
} from '@engine';

const bar = (i: number, o: number, h: number, l: number, c: number): Candle => ({
  openTime: i * 3_600_000,
  closeTime: (i + 1) * 3_600_000 - 1,
  open: o,
  high: h,
  low: l,
  close: c,
  volume: 1,
});

function origin(over: Partial<OriginOutcome> = {}): OriginOutcome {
  return {
    id: 'o-1',
    symbol: 'ETHUSDT',
    base_asset: 'ETH',
    timeframe: '1h',
    signal_type: 'BUY',
    score: 74,
    price_at_signal: 100,
    entry_low: 99.5,
    entry_high: 100,
    stop_loss: 96,
    target1: 108,
    signal_at: '2026-10-19T10:00:00.000Z',
    candle_close_time: '2026-10-19T09:59:59.999Z',
    source: 'auto_scan',
    tracked_by: null,
    ...over,
  };
}

describe('reversePlan', () => {
  it('BUY -> SELL: same entry, stop = original target, target = original stop', () => {
    const p = reversePlan({ signalType: 'BUY', entry: 100, stop: 96, target: 108 })!;
    expect(p.signalType).toBe('SELL');
    expect(p.direction).toBe('SHORT');
    expect(p.entry).toBe(100);
    expect(p.stop).toBe(108);
    expect(p.target).toBe(96);
    // original risk 4 / reward 8 -> the reverse risks 8 to make 4
    expect(p.riskReward).toBeCloseTo(0.5, 9);
  });

  it('SELL -> BUY mirrors the same way', () => {
    const p = reversePlan({ signalType: 'SELL', entry: 100, stop: 104, target: 92 })!;
    expect(p.signalType).toBe('BUY');
    expect(p.direction).toBe('LONG');
    expect(p.stop).toBe(92);
    expect(p.target).toBe(104);
    expect(p.riskReward).toBeCloseTo(0.5, 9);
  });

  it('reversing twice gives back the original levels', () => {
    const a = { signalType: 'BUY' as const, entry: 100, stop: 96, target: 108 };
    const r = reversePlan(a)!;
    const back = reversePlan({ signalType: r.signalType, entry: r.entry, stop: r.stop, target: r.target })!;
    expect(back.signalType).toBe('BUY');
    expect(back.stop).toBe(a.stop);
    expect(back.target).toBe(a.target);
  });

  it('works on BTC-pair price scale (1e-6)', () => {
    const p = reversePlan({ signalType: 'BUY', entry: 0.05, stop: 0.048, target: 0.054 })!;
    expect(p.stop).toBeCloseTo(0.054, 12);
    expect(p.target).toBeCloseTo(0.048, 12);
  });

  it('refuses inconsistent or corrupt originals', () => {
    expect(reversePlan({ signalType: 'BUY', entry: 100, stop: 108, target: 96 })).toBeNull(); // levels on the wrong side
    expect(reversePlan({ signalType: 'SELL', entry: 100, stop: 96, target: 108 })).toBeNull();
    expect(reversePlan({ signalType: 'BUY', entry: 100, stop: 100, target: 108 })).toBeNull(); // zero risk
    expect(reversePlan({ signalType: 'BUY', entry: NaN, stop: 96, target: 108 })).toBeNull();
    expect(reversePlan({ signalType: 'BUY', entry: 100, stop: -1, target: 108 })).toBeNull();
  });

  it('oppositeSide flips', () => {
    expect(oppositeSide('BUY')).toBe('SELL');
    expect(oppositeSide('SELL')).toBe('BUY');
  });
});

describe('buildReverseOutcomeRow', () => {
  it('builds the mirrored row and carries source / tracked_by / timestamps over', () => {
    const row = buildReverseOutcomeRow(origin({ source: 'manual_track', tracked_by: 'user-1' }))!;
    expect(row).toMatchObject({
      origin_outcome_id: 'o-1',
      symbol: 'ETHUSDT',
      timeframe: '1h',
      signal_type: 'SELL',
      origin_signal_type: 'BUY',
      price_at_signal: 100,
      stop_loss: 108,
      target1: 96,
      status: 'OPEN',
      source: 'manual_track',
      tracked_by: 'user-1',
      signal_at: '2026-10-19T10:00:00.000Z',
      candle_close_time: '2026-10-19T09:59:59.999Z',
    });
  });

  it('returns null for an unusable origin (no trade is created)', () => {
    expect(buildReverseOutcomeRow(origin({ stop_loss: 110 }))).toBeNull();
  });
});

describe('original vs reverse resolved on the same candles', () => {
  const o = origin();
  const plan = reversePlan({ signalType: 'BUY', entry: 100, stop: 96, target: 108 })!;
  const run = (candles: Candle[]) => ({
    orig: resolveTrade({ direction: 'LONG', entry: 100, stop: 96, target: 108, maxBars: 5 }, candles, 0.25),
    rev: resolveTrade({ direction: plan.direction, entry: plan.entry, stop: plan.stop, target: plan.target, maxBars: 5 }, candles, 0.25),
  });

  it('original WIN (target touched) = reverse LOSS at the same price and the same bar', () => {
    const { orig, rev } = run([bar(0, 100, 101, 99, 100), bar(1, 100, 109, 99, 108)]);
    expect(orig!.status).toBe('WIN');
    expect(rev!.status).toBe('LOSS');
    expect(rev!.exitPrice).toBe(orig!.exitPrice);
    expect(rev!.barsHeld).toBe(orig!.barsHeld);
    expect(rev!.grossPnlPct).toBeCloseTo(-orig!.grossPnlPct, 9);
  });

  it('original LOSS (stop touched) = reverse WIN at the same price and the same bar', () => {
    const { orig, rev } = run([bar(0, 100, 101, 95, 96)]);
    expect(orig!.status).toBe('LOSS');
    expect(rev!.status).toBe('WIN');
    expect(rev!.exitPrice).toBe(96);
    expect(rev!.grossPnlPct).toBeCloseTo(-orig!.grossPnlPct, 9);
  });

  it('fees hurt both sides: the net results are NOT exact opposites', () => {
    const { orig, rev } = run([bar(0, 100, 109, 99, 108)]);
    expect(orig!.pnlPct + rev!.pnlPct).toBeCloseTo(-0.5, 9); // 2 x 0.25 %
  });

  it('a bar that touches BOTH levels is a LOSS for both (stop is checked first, conservatively)', () => {
    const { orig, rev } = run([bar(0, 100, 109, 95, 100)]);
    expect(orig!.status).toBe('LOSS');
    expect(rev!.status).toBe('LOSS');
  });

  it('time expiry happens on the same bar for both', () => {
    const flat = Array.from({ length: 5 }, (_, i) => bar(i, 100, 101, 99, 100));
    const { orig, rev } = run(flat);
    expect(orig!.status).toBe('EXPIRED');
    expect(rev!.status).toBe('EXPIRED');
    expect(rev!.barsHeld).toBe(orig!.barsHeld);
  });

  it('a gap through the original stop exits the reverse at its TARGET price, not at the open', () => {
    const { orig, rev } = run([bar(0, 90, 92, 88, 91)]);
    expect(orig!.status).toBe('LOSS');
    expect(orig!.exitPrice).toBe(90); // original is hurt by the gap
    expect(rev!.status).toBe('WIN');
    expect(rev!.exitPrice).toBe(96); // reverse books its planned target (conservative: no gap bonus)
  });

  it('property: over random paths both resolve on the same bar and never both WIN', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    let resolved = 0;
    for (let n = 0; n < 400; n++) {
      const candles: Candle[] = [];
      let price = 100;
      for (let i = 0; i < EXPIRY_BARS['1h']; i++) {
        const open = price;
        const close = open * (1 + (rnd() - 0.5) * 0.02);
        const high = Math.max(open, close) * (1 + rnd() * 0.004);
        const low = Math.min(open, close) * (1 - rnd() * 0.004);
        candles.push(bar(i, open, high, low, close));
        price = close;
      }
      const orig = resolveTrade({ direction: 'LONG', entry: 100, stop: 96, target: 108, maxBars: EXPIRY_BARS['1h'] }, candles)!;
      const rev = resolveTrade({ direction: plan.direction, entry: 100, stop: plan.stop, target: plan.target, maxBars: EXPIRY_BARS['1h'] }, candles)!;
      expect(rev.barsHeld).toBe(orig.barsHeld);
      expect(orig.status === 'WIN' && rev.status === 'WIN').toBe(false);
      if (orig.status === 'WIN') expect(rev.status).toBe('LOSS');
      if (orig.status === 'EXPIRED') expect(rev.status).toBe('EXPIRED');
      resolved++;
    }
    expect(resolved).toBe(400);
    expect(o.signal_type).toBe('BUY');
  });
});
