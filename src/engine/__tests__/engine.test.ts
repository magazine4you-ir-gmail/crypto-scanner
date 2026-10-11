import { describe, it, expect } from 'vitest';
import {
  analyzeCore,
  closedCandles,
  computeRiskPlan,
  DEFAULT_RISK_CONFIG,
  findSupportResistance,
  findSwingPoints,
  lastBoundary,
  nearestResistance,
  nearestSupport,
  relativeVolume,
  resolveTrade,
  volatilityProfile,
  type Candle,
  type SRLevel,
} from '@engine';

const HOUR = 3_600_000;

function candle(i: number, o: number, h: number, l: number, c: number, v = 100, start = 1_700_000_000_000): Candle {
  const openTime = start + i * HOUR;
  return { openTime, open: o, high: h, low: l, close: c, volume: v, closeTime: openTime + HOUR - 1 };
}

/** Smooth trend with small pullbacks; deterministic. */
function trendSeries(n: number, startPrice: number, driftPct: number): Candle[] {
  const out: Candle[] = [];
  let p = startPrice;
  for (let i = 0; i < n; i++) {
    const wave = Math.sin(i / 3) * 0.004;
    const o = p;
    const c = p * (1 + driftPct + wave);
    out.push(candle(i, o, Math.max(o, c) * 1.003, Math.min(o, c) * 0.997, c, 100 + (i % 7) * 10));
    p = c;
  }
  return out;
}

describe('candle helpers', () => {
  it('drops the still-forming candle', () => {
    const now = 1_700_000_000_000 + 3 * HOUR + 1000;
    const cs = [candle(0, 1, 1, 1, 1), candle(1, 1, 1, 1, 1), candle(2, 1, 1, 1, 1), candle(3, 1, 1, 1, 1)];
    // candle 3 opens exactly at now-1000 -> still forming
    expect(closedCandles(cs, now)).toHaveLength(3);
  });

  it('computes the last candle boundary per timeframe', () => {
    const now = Date.UTC(2026, 9, 10, 14, 37, 12);
    expect(lastBoundary('1h', now)).toBe(Date.UTC(2026, 9, 10, 14, 0, 0));
    expect(lastBoundary('4h', now)).toBe(Date.UTC(2026, 9, 10, 12, 0, 0));
    expect(lastBoundary('1d', now)).toBe(Date.UTC(2026, 9, 10, 0, 0, 0));
    // 2026-10-10 is a Saturday -> weekly candle opened Monday 2026-10-05
    expect(lastBoundary('1w', now)).toBe(Date.UTC(2026, 9, 5, 0, 0, 0));
  });

  it('relative volume compares with the PREVIOUS 20 candles only', () => {
    const vols = [...Array(20).fill(10), 40];
    const rv = relativeVolume(vols, 20);
    expect(rv[19]).toBeNull();
    expect(rv[20]).toBeCloseTo(4, 6);
  });

  it('scales the volatility thresholds with the timeframe', () => {
    expect(volatilityProfile('1h').high).toBeLessThan(volatilityProfile('4h').high);
    expect(volatilityProfile('4h').high).toBeLessThan(volatilityProfile('1d').high);
    expect(volatilityProfile('4h').ok).toBeCloseTo(5, 6); // same behaviour as the old fixed 5%/6% on 4h
  });
});

describe('support / resistance', () => {
  it('treats a broken resistance as support (role reversal)', () => {
    // price rallies from 100, tops at 110, falls back, then breaks above 110 and trades at 120
    const cs: Candle[] = [];
    const path = [100, 104, 108, 110, 107, 104, 106, 109, 111, 114, 118, 120, 119, 120, 121, 120, 121, 122, 121, 120];
    path.forEach((p, i) => cs.push(candle(i, p, p * 1.004, p * 0.996, p)));
    const swings = findSwingPoints(cs, 2);
    const levels = findSupportResistance(cs, swings);
    const price = cs[cs.length - 1].close;
    const support = nearestSupport(levels, price);
    expect(support).not.toBeNull();
    // the old 110 top must now be reachable as a support below price
    expect(levels.some((l) => l.type === 'SUPPORT' && Math.abs(l.price - 110) / 110 < 0.03)).toBe(true);
  });
});

describe('risk plan', () => {
  const flat = Array.from({ length: 60 }, (_, i) => candle(i, 100, 101, 99, 100));
  const atr = 2;

  it('never places the stop inside the noise', () => {
    // a support only 0.1% below price would previously give a 0.3%-wide stop
    const levels: SRLevel[] = [{ price: 99.9, type: 'SUPPORT', strength: 3, touches: 3 }];
    const plan = computeRiskPlan('LONG', flat, levels, atr, DEFAULT_RISK_CONFIG, '1h')!;
    const stopDistance = 100 - plan.stopLoss;
    expect(stopDistance).toBeGreaterThanOrEqual(atr * DEFAULT_RISK_CONFIG.minStopAtr - 1e-9);
  });

  it('reports a REAL risk/reward clipped at the nearest resistance', () => {
    const levels: SRLevel[] = [{ price: 103, type: 'RESISTANCE', strength: 2, touches: 2 }];
    const plan = computeRiskPlan('LONG', flat, levels, atr, DEFAULT_RISK_CONFIG, '1h')!;
    // stop distance = 1.5 ATR = 3 -> target1 would be +6, but resistance is only +3 away
    expect(plan.riskReward).toBeLessThan(2);
    expect(plan.obstacle).toBe(103);
  });

  it('keeps R/R at 2 when nothing is in the way', () => {
    const plan = computeRiskPlan('LONG', flat, [], atr, DEFAULT_RISK_CONFIG, '1h')!;
    expect(plan.riskReward).toBeCloseTo(2, 6);
  });

  it('caps the position so notional never exceeds capital (no hidden leverage)', () => {
    const cfg = { ...DEFAULT_RISK_CONFIG, minStopAtr: 0.01, atrMultiplier: 0.01, riskPercent: 5 };
    const plan = computeRiskPlan('LONG', flat, [], atr, cfg, '1h')!;
    expect(plan.positionSize * 100).toBeLessThanOrEqual(cfg.capital + 1e-6);
  });

  it('mirrors correctly for shorts', () => {
    const plan = computeRiskPlan('SHORT', flat, [], atr, DEFAULT_RISK_CONFIG, '1h')!;
    expect(plan.stopLoss).toBeGreaterThan(100);
    expect(plan.target1).toBeLessThan(100);
    expect(plan.riskReward).toBeCloseTo(2, 6);
  });
});

describe('resolveTrade', () => {
  const base = { direction: 'LONG' as const, entry: 100, stop: 95, target: 110, maxBars: 5 };
  const bar = (i: number, o: number, h: number, l: number, c: number) => candle(i, o, h, l, c);

  it('returns null while the trade is still open', () => {
    expect(resolveTrade(base, [bar(0, 100, 102, 98, 101)])).toBeNull();
  });

  it('is conservative: stop wins when both levels are touched in the same bar', () => {
    const r = resolveTrade(base, [bar(0, 100, 111, 94, 100)])!;
    expect(r.status).toBe('LOSS');
    expect(r.exitPrice).toBe(95);
  });

  it('exits at the open when price gaps through the stop', () => {
    const r = resolveTrade(base, [bar(0, 90, 92, 88, 91)])!;
    expect(r.status).toBe('LOSS');
    expect(r.exitPrice).toBe(90);
    expect(r.rMultiple).toBeLessThan(-1);
  });

  it('books a win at the target and deducts costs', () => {
    const r = resolveTrade(base, [bar(0, 100, 111, 99, 108)], 0.25)!;
    expect(r.status).toBe('WIN');
    expect(r.grossPnlPct).toBeCloseTo(10, 6);
    expect(r.pnlPct).toBeCloseTo(9.75, 6);
    expect(r.rMultiple).toBeCloseTo(2 - 0.05, 6); // 10% gain on a 5% risk, minus 0.25%/5%
  });

  it('expires after maxBars at the bar close', () => {
    const bars = Array.from({ length: 5 }, (_, i) => bar(i, 100, 101, 99, 100.5));
    const r = resolveTrade(base, bars)!;
    expect(r.status).toBe('EXPIRED');
    expect(r.barsHeld).toBe(5);
    expect(r.exitPrice).toBe(100.5);
  });

  it('handles shorts', () => {
    const r = resolveTrade({ direction: 'SHORT', entry: 100, stop: 105, target: 90, maxBars: 5 }, [bar(0, 100, 101, 89, 92)], 0)!;
    expect(r.status).toBe('WIN');
    expect(r.grossPnlPct).toBeCloseTo(10, 6);
    expect(r.rMultiple).toBeCloseTo(2, 6);
  });
});

describe('analyzeCore', () => {
  it('needs at least 50 candles', () => {
    expect(analyzeCore(trendSeries(30, 100, 0.002))).toBeNull();
  });

  it('is deterministic and uses the last closed candle', () => {
    const cs = trendSeries(320, 100, 0.0015);
    const a = analyzeCore(cs, { timeframe: '1h' })!;
    const b = analyzeCore(cs, { timeframe: '1h' })!;
    expect(a).toEqual(b);
    expect(a.candleCloseTime).toBe(cs[cs.length - 1].closeTime);
    expect(a.price).toBe(cs[cs.length - 1].close);
  });

  it('prefers the long side in an uptrend and the short side in a downtrend', () => {
    const up = analyzeCore(trendSeries(320, 100, 0.002), { timeframe: '1h' })!;
    const down = analyzeCore(trendSeries(320, 1000, -0.002), { timeframe: '1h' })!;
    expect(up.bullScore).toBeGreaterThan(up.bearScore);
    expect(down.bearScore).toBeGreaterThan(down.bullScore);
    expect(up.signalType).not.toBe('SELL');
    expect(down.signalType).not.toBe('BUY');
  });

  it('never emits SELL when shorting is disabled', () => {
    const down = analyzeCore(trendSeries(320, 1000, -0.002), { timeframe: '1h', allowShort: false })!;
    expect(down.signalType).not.toBe('SELL');
  });

  it('a real BUY always carries a plan with R/R >= the configured minimum', () => {
    for (const drift of [0.0008, 0.0012, 0.002, 0.003]) {
      const a = analyzeCore(trendSeries(320, 100, drift), { timeframe: '4h' })!;
      if (a.signalType === 'BUY') {
        expect(a.risk).not.toBeNull();
        expect(a.risk!.riskReward).toBeGreaterThanOrEqual(DEFAULT_RISK_CONFIG.minRiskReward);
      }
    }
  });

  it('exposes the nearest levels role-agnostically', () => {
    const levels: SRLevel[] = [
      { price: 90, type: 'SUPPORT', strength: 1, touches: 1 },
      { price: 110, type: 'RESISTANCE', strength: 1, touches: 1 },
    ];
    expect(nearestResistance(levels, 100)).toBe(110);
    expect(nearestSupport(levels, 100)).toBe(90);
    expect(nearestSupport(levels, 120)).toBe(110);
  });
});
