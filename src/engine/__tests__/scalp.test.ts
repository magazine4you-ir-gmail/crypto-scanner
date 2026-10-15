import { describe, it, expect } from 'vitest';
import {
  analyzeScalp,
  backtestScalp,
  buildVolumeProfile,
  deltaRatio,
  detectSweep,
  findFvgs,
  findOrderBlocks,
  htfBias,
  pricePattern,
  DEFAULT_SCALP_CONFIG,
} from '@scalp';
import { atr, findSwingPoints, type Candle } from '@engine';

const MIN = 60_000;

function cd(i: number, o: number, h: number, l: number, c: number, v = 100, start = 1_700_000_000_000): Candle {
  const openTime = start + i * MIN;
  return { openTime, open: o, high: h, low: l, close: c, volume: v, closeTime: openTime + MIN - 1 };
}

/** Deterministic range-bound market (period ~56 bars, amplitude 2.5) with jittered wicks. */
function rangeSeries(n: number): Candle[] {
  const out: Candle[] = [];
  let prev = 100;
  for (let i = 0; i < n; i++) {
    const p = 100 + 2.5 * Math.sin(i / 9) + 0.4 * Math.sin(i / 2.3);
    const o = prev;
    out.push(cd(i, o, Math.max(o, p) + 0.12 + ((i * 7) % 5) * 0.04, Math.min(o, p) - 0.12 - ((i * 3) % 5) * 0.04, p, 100 + (i % 5) * 4));
    prev = p;
  }
  return out;
}

/**
 * Textbook long: range trough (swing low) -> small bounce -> drift down -> one candle that raids the low,
 * engulfs, and closes above the last minor high (sweep + engulfing + market-structure shift).
 */
function longReversal(): { candles: Candle[]; low: number } {
  let cs = rangeSeries(200);
  const lows = cs.slice(120).map((c) => c.low);
  const k = 120 + lows.indexOf(Math.min(...lows));
  cs = cs.slice(0, k + 3);
  const S = cs[k].low;
  let i = cs.length;
  const add = (o: number, h: number, l: number, c: number, v = 100) => cs.push(cd(i++, o, h, l, c, v));
  add(cs[cs.length - 1].close, S + 0.7, S + 0.4, S + 0.62);
  add(S + 0.62, S + 0.64, S + 0.5, S + 0.55);
  add(S + 0.55, S + 0.58, S + 0.28, S + 0.3);
  add(S + 0.3, S + 0.78, S - 0.1, S + 0.74, 350);
  return { candles: cs, low: S };
}

const mirror = (cs: Candle[]): Candle[] =>
  cs.map((c) => ({ ...c, open: 200 - c.open, high: 200 - c.low, low: 200 - c.high, close: 200 - c.close }));

describe('volume profile', () => {
  it('finds the POC, a value area around it, and conserves volume', () => {
    const cs: Candle[] = [];
    for (let i = 0; i < 60; i++) {
      // heavy trading at 100, thin trading at the extremes 95 and 105
      const heavy = i % 2 === 0;
      cs.push(cd(i, 100, heavy ? 100.4 : 105, heavy ? 99.6 : 95, 100, heavy ? 500 : 20));
    }
    const vp = buildVolumeProfile(cs, 40)!;
    expect(vp).not.toBeNull();
    expect(Math.abs(vp.poc - 100)).toBeLessThan(vp.step * 1.5);
    expect(vp.val).toBeLessThan(vp.poc);
    expect(vp.vah).toBeGreaterThan(vp.poc);
    const binSum = vp.bins.reduce((s, b) => s + b.volume, 0);
    const total = cs.reduce((s, c) => s + c.volume, 0);
    expect(binSum).toBeCloseTo(total, 6);
    expect(vp.totalVolume).toBeCloseTo(total, 6);
  });

  it('returns null for degenerate data', () => {
    expect(buildVolumeProfile([], 40)).toBeNull();
    const flat = Array.from({ length: 30 }, (_, i) => cd(i, 100, 100, 100, 100, 10));
    expect(buildVolumeProfile(flat, 40)).toBeNull();
  });
});

describe('smart-money building blocks', () => {
  it('detects a bullish FVG and drops it once price closes through it', () => {
    const base = [cd(0, 100, 101, 99, 100.5), cd(1, 100.5, 104, 100.4, 103.8), cd(2, 103.8, 105, 102, 104.5)]; // gap 101..102
    const zones = findFvgs(base, 1, 'LONG', 30, 0.25);
    expect(zones).toHaveLength(1);
    expect(zones[0].low).toBeCloseTo(101);
    expect(zones[0].high).toBeCloseTo(102);
    const broken = [...base, cd(3, 104.5, 104.6, 100, 100.5)];
    expect(findFvgs(broken, 1, 'LONG', 30, 0.25)).toHaveLength(0);
  });

  it('finds an order block (last bearish candle before a displacement up)', () => {
    const cs: Candle[] = [];
    for (let i = 0; i < 8; i++) cs.push(cd(i, 100, 100.6, 99.6, 100.1));
    cs.push(cd(8, 100.1, 100.2, 99.0, 99.3)); // bearish -> order block
    cs.push(cd(9, 99.3, 102.5, 99.2, 102.3)); // displacement, breaks the 5-bar high
    cs.push(cd(10, 102.3, 102.8, 102.0, 102.5));
    const obs = findOrderBlocks(cs, 0.8, 'LONG', 30);
    expect(obs.length).toBeGreaterThan(0);
    expect(obs[0].low).toBeCloseTo(99.0);
    expect(obs[0].high).toBeCloseTo(100.2);
  });

  it('classifies price-action triggers', () => {
    const engulf = [cd(0, 101, 101.2, 99.8, 100), cd(1, 99.9, 101.6, 99.7, 101.5)];
    expect(pricePattern(engulf, 'LONG', 1)).toBe('ENGULFING');
    const pin = [cd(0, 100, 100.4, 99.8, 100.1), cd(1, 100, 100.2, 98.8, 100.1)];
    expect(pricePattern(pin, 'LONG', 1)).toBe('PIN_BAR');
    const bearPin = [cd(0, 100, 100.4, 99.8, 99.9), cd(1, 100, 101.2, 99.9, 99.95)];
    expect(pricePattern(bearPin, 'SHORT', 1)).toBe('PIN_BAR');
    const tiny = [cd(0, 100, 100.05, 99.95, 100), cd(1, 100, 100.05, 99.95, 100.02)];
    expect(pricePattern(tiny, 'LONG', 1)).toBeNull();
  });

  it('reads taker-buy delta only when the feed provides it', () => {
    expect(deltaRatio({ ...cd(0, 1, 1, 1, 1, 100), takerBuyVolume: 75 })).toBeCloseTo(0.5);
    expect(deltaRatio(cd(0, 1, 1, 1, 1, 100))).toBeNull();
  });

  it('detects the liquidity sweep in the textbook fixture, and not before it happens', () => {
    const { candles, low } = longReversal();
    const a = atr(candles, 14)[candles.length - 1]!;
    const sweep = detectSweep(candles, findSwingPoints(candles, 2), a, 'LONG');
    expect(sweep).not.toBeNull();
    expect(sweep!.level).toBeCloseTo(low, 6);
    expect(sweep!.extreme).toBeLessThan(low);
    const before = candles.slice(0, -1);
    expect(detectSweep(before, findSwingPoints(before, 2), a, 'LONG')).toBeNull();
  });
});

describe('htf bias', () => {
  it('follows EMA alignment', () => {
    const up = Array.from({ length: 80 }, (_, i) => cd(i, 100 + i, 101 + i, 99 + i, 100.5 + i));
    const down = Array.from({ length: 80 }, (_, i) => cd(i, 200 - i, 201 - i, 199 - i, 199.5 - i));
    expect(htfBias(up)).toBe('BULLISH');
    expect(htfBias(down)).toBe('BEARISH');
    expect(htfBias(up.slice(0, 30))).toBe('NEUTRAL');
  });
});

describe('analyzeScalp', () => {
  it('needs enough clean data', () => {
    expect(analyzeScalp(rangeSeries(60))).toBeNull();
    const flat = Array.from({ length: 150 }, (_, i) => cd(i, 100, 100, 100, 100, 10));
    expect(analyzeScalp(flat)).toBeNull();
  });

  it('sees sweep + MSS + engulfing but waits when the score is just below the bar', () => {
    const { candles } = longReversal();
    const a = analyzeScalp(candles, { timeframe: '1m' })!;
    expect(a.model).toBe('REVERSAL');
    expect(a.sweep).not.toBeNull();
    expect(a.mss).toBe(true);
    expect(a.pattern).toBe('ENGULFING');
    expect(a.type).toBe('WAIT');
    expect(a.reasons.map((r) => r.code)).toEqual(['LOW_SCORE']);
  });

  it('gives a BUY when the higher timeframe agrees, with a consistent plan', () => {
    const { candles } = longReversal();
    const a = analyzeScalp(candles, { timeframe: '1m', htfBias: 'BULLISH' })!;
    expect(a.type).toBe('BUY');
    expect(a.reasons).toHaveLength(0);
    const p = a.plan!;
    expect(p.stop).toBeLessThan(a.sweep!.extreme); // stop sits beyond the raid wick
    expect(p.entry).toBeCloseTo(candles[candles.length - 1].close);
    expect(p.target).toBeGreaterThan(p.entry);
    expect(p.rewardR).toBeLessThanOrEqual(DEFAULT_SCALP_CONFIG.targetR + 1e-9); // no greed
    expect(p.netRR).toBeLessThan(p.rewardR); // fees are charged
    expect(p.netRR).toBeGreaterThanOrEqual(DEFAULT_SCALP_CONFIG.minNetRR);
    // risk budget: size * (stop distance + round-trip fee) == riskPercent of capital
    const fee = p.entry * (DEFAULT_SCALP_CONFIG.costPct / 100);
    const risked = p.positionSize * (p.stopDistance + fee);
    expect(risked).toBeCloseTo(DEFAULT_SCALP_CONFIG.capital * (DEFAULT_SCALP_CONFIG.riskPercent / 100), 6);
    expect(p.notional).toBeLessThanOrEqual(DEFAULT_SCALP_CONFIG.capital); // spot: no hidden leverage
    expect(p.maxBars).toBe(15);
  });

  it('mirrors into a SELL', () => {
    const { candles } = longReversal();
    const a = analyzeScalp(mirror(candles), { timeframe: '1m', htfBias: 'BEARISH' })!;
    expect(a.type).toBe('SELL');
    expect(a.plan!.stop).toBeGreaterThan(a.plan!.entry);
    expect(a.plan!.target).toBeLessThan(a.plan!.entry);
  });

  it('refuses shorts when disabled and trades against the HTF only when allowed', () => {
    const { candles } = longReversal();
    const noShort = analyzeScalp(mirror(candles), { timeframe: '1m', htfBias: 'BEARISH', config: { allowShort: false } })!;
    expect(noShort.type).not.toBe('SELL');

    const opposed = analyzeScalp(candles, { timeframe: '1m', htfBias: 'BEARISH' })!;
    expect(opposed.type).toBe('NO_TRADE');
    expect(opposed.reasons.map((r) => r.code)).toContain('HTF_OPPOSED');

    const relaxed = analyzeScalp(candles, { timeframe: '1m', htfBias: 'BEARISH', config: { htfStrict: false, minScore: 55 } })!;
    expect(relaxed.type).toBe('BUY');
  });

  it('kills the trade when fees would eat the edge', () => {
    const { candles } = longReversal();
    const a = analyzeScalp(candles, { timeframe: '1m', htfBias: 'BULLISH', config: { costPct: 1 } })!;
    expect(a.type).not.toBe('BUY');
    expect(a.reasons.map((r) => r.code)).toContain('COST_TOO_HIGH');
  });

  it('needs volume confirmation', () => {
    const { candles } = longReversal();
    const quiet = candles.map((c, i) => (i >= candles.length - 3 ? { ...c, volume: 40 } : c));
    const a = analyzeScalp(quiet, { timeframe: '1m', htfBias: 'BULLISH' })!;
    expect(a.type).not.toBe('BUY');
    expect(a.reasons.map((r) => r.code)).toContain('LOW_VOLUME');
  });

  it('blocks a long when aggressive sellers dominate the trigger candle', () => {
    const { candles } = longReversal();
    const last = candles[candles.length - 1];
    const sellers = [...candles.slice(0, -1), { ...last, takerBuyVolume: last.volume * 0.2 }];
    const a = analyzeScalp(sellers, { timeframe: '1m', htfBias: 'BULLISH' })!;
    expect(a.type).not.toBe('BUY');
    expect(a.reasons.map((r) => r.code)).toContain('FLOW_AGAINST');
  });

  it('does nothing in a quiet range without a setup', () => {
    const a = analyzeScalp(rangeSeries(200), { timeframe: '1m' })!;
    expect(a.type === 'BUY' || a.type === 'SELL').toBe(false);
  });
});

describe('backtestScalp', () => {
  /** Several textbook setups glued onto a drifting range, so the backtest has real trades to resolve. */
  function busySeries(): Candle[] {
    const out: Candle[] = [];
    let t = 0;
    for (let block = 0; block < 6; block++) {
      const { candles } = longReversal();
      const shift = block * 0.3;
      for (const c of candles.slice(0, 200 + block * 0)) {
        out.push({ ...c, open: c.open + shift, high: c.high + shift, low: c.low + shift, close: c.close + shift, openTime: 1_700_000_000_000 + t * MIN, closeTime: 1_700_000_000_000 + t * MIN + MIN - 1 });
        t++;
      }
    }
    return out;
  }

  it('is internally consistent and deterministic', () => {
    const cs = busySeries();
    const opts = { timeframe: '1m', htfBias: 'BULLISH' as const };
    const r1 = backtestScalp(cs, opts);
    const r2 = backtestScalp(cs, opts);
    expect(r1.stats).toEqual(r2.stats);

    const s = r1.stats;
    expect(s.trades).toBeGreaterThan(0);
    expect(s.wins + s.losses + s.expired).toBe(s.trades);
    for (const v of [s.winRate, s.expectancyR, s.totalR, s.maxDrawdownR, s.avgBars]) expect(Number.isFinite(v)).toBe(true);
    for (let i = 1; i < r1.trades.length; i++) expect(r1.trades[i].entryTime).toBeGreaterThan(r1.trades[i - 1].entryTime);
    for (const t of r1.trades) {
      if (t.direction === 'LONG') {
        expect(t.stop).toBeLessThan(t.entry);
        expect(t.target).toBeGreaterThan(t.entry);
      } else {
        expect(t.stop).toBeGreaterThan(t.entry);
        expect(t.target).toBeLessThan(t.entry);
      }
    }
  });

  it('reports why setups were rejected', () => {
    const cs = busySeries();
    const strictCost = backtestScalp(cs, { timeframe: '1m', htfBias: 'BULLISH', config: { costPct: 1 } });
    expect(strictCost.stats.setupsSeen).toBeGreaterThan(0);
    expect(strictCost.stats.rejectCounts.COST_TOO_HIGH ?? 0).toBeGreaterThan(0);
  });

  it('stops trading for the day after the daily loss cap', () => {
    const cs = busySeries();
    const capped = backtestScalp(cs, { timeframe: '1m', htfBias: 'BULLISH' }, { maxDailyLossR: 0.0001 });
    const free = backtestScalp(cs, { timeframe: '1m', htfBias: 'BULLISH' }, { maxDailyLossR: 1000 });
    expect(capped.stats.trades).toBeLessThanOrEqual(free.stats.trades);
  });
});

describe('trade resolution through the backtest', () => {
  const opts = { timeframe: '1m', htfBias: 'BULLISH' as const };

  function withTail(tail: (entry: number, stop: number, target: number, start: number) => Candle[]) {
    const { candles } = longReversal();
    const plan = analyzeScalp(candles, opts)!.plan!;
    const full = [...candles, ...tail(plan.entry, plan.stop, plan.target, candles.length)];
    return { plan, result: backtestScalp(full, opts) };
  }
  const feeR = (plan: { entry: number; stopDistance: number }) => (plan.entry * (DEFAULT_SCALP_CONFIG.costPct / 100)) / plan.stopDistance;

  it('books a WIN at the target, net of fees', () => {
    const { plan, result } = withTail((e, _s, t, i) => [cd(i, e, t + 0.2, e - 0.05, t, 150)]);
    const trade = result.trades[0];
    expect(trade.status).toBe('WIN');
    expect(trade.exit).toBeCloseTo(plan.target);
    expect(trade.rMultiple!).toBeCloseTo(plan.rewardR - feeR(plan), 6);
    expect(result.stats.winRate).toBe(100);
  });

  it('books a LOSS at the stop (-1R minus fees) even if the target was also inside the bar', () => {
    const { plan, result } = withTail((e, s, t, i) => [cd(i, e, t + 0.5, s - 0.2, e, 150)]);
    const trade = result.trades[0];
    expect(trade.status).toBe('LOSS'); // stop is checked first: the conservative assumption
    expect(trade.exit).toBeCloseTo(plan.stop);
    expect(trade.rMultiple!).toBeCloseTo(-1 - feeR(plan), 6);
  });

  it('applies the time stop (no greed, no hoping)', () => {
    const { plan, result } = withTail((e, _s, _t, i) =>
      Array.from({ length: 16 }, (_, k) => cd(i + k, e, e + 0.05, e - 0.05, e + (k % 2 ? 0.01 : -0.01), 100)),
    );
    const trade = result.trades[0];
    expect(trade.status).toBe('EXPIRED');
    expect(trade.bars).toBe(plan.maxBars);
    expect(Math.abs(trade.rMultiple!)).toBeLessThan(0.5);
  });
});

