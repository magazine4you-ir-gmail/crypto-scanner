import { describe, expect, it } from 'vitest';
import {
  envFlag, envNumber, isFullReconcileSlot, isLiveRowCurrent, orderWork, priorityOf, runSlot,
  type LiveSkipInput, type WorkFlags, type WorkItem,
} from '../../../supabase/functions/_shared/reversePlus/evalPolicy';
import { D } from '../../../supabase/functions/_shared/reversePlus/money';
import { buildPlusAnalysis } from '../../../supabase/functions/_shared/reversePlus/plan';
import { UNKNOWN_CONTRACT } from '../../../supabase/functions/_shared/reversePlus/types';
import { jsonSafe } from '../../../supabase/functions/_shared/reversePlus/index';
import { closedCandles, timeframeMs } from '../../../supabase/functions/_shared/engine';
import { settings } from './fixtures';
import { series } from './helpers';

const H = 3_600_000;
const MIN = 60_000;

const base = (over: Partial<LiveSkipInput> = {}): LiveSkipInput => ({
  live: { asOfMs: 1_000_000, updatedMs: 1_000_500 },
  nowMs: 1_000_000 + 30 * MIN,
  tfMs: H,
  cfgUpdatedMs: 900_000,
  forceRefreshMs: 6 * H,
  ...over,
});

describe('LIVE row "unchanged" rule (isLiveRowCurrent)', () => {
  it('is true only when the stored row cannot differ from a rewrite', () => {
    expect(isLiveRowCurrent(base())).toBe(true);
  });
  it('a missing LIVE row is always written', () => {
    expect(isLiveRowCurrent(base({ live: undefined }))).toBe(false);
  });
  it('a newer closed candle forces a rewrite (asOf + timeframe < now)', () => {
    expect(isLiveRowCurrent(base({ nowMs: 1_000_000 + H - 1 }))).toBe(true);
    expect(isLiveRowCurrent(base({ nowMs: 1_000_000 + H + 1 }))).toBe(false);
  });
  it('an edited public configuration forces a rewrite', () => {
    expect(isLiveRowCurrent(base({ cfgUpdatedMs: 1_000_501 }))).toBe(false);
    expect(isLiveRowCurrent(base({ cfgUpdatedMs: 1_000_500 }))).toBe(true);
  });
  it('unknown config timestamp -> legacy behaviour (never skip)', () => {
    expect(isLiveRowCurrent(base({ cfgUpdatedMs: null }))).toBe(false);
  });
  it('the safety refresh rewrites even an unchanged row; 0 disables skipping entirely', () => {
    const l = { asOfMs: 1_000_000, updatedMs: 1_000_500 };
    expect(isLiveRowCurrent(base({ live: l, nowMs: l.updatedMs + 6 * H - 1, tfMs: 24 * H }))).toBe(true);
    expect(isLiveRowCurrent(base({ live: l, nowMs: l.updatedMs + 6 * H, tfMs: 24 * H }))).toBe(false);
    expect(isLiveRowCurrent(base({ forceRefreshMs: 0 }))).toBe(false);
  });
  it('garbage timestamps never skip', () => {
    expect(isLiveRowCurrent(base({ live: { asOfMs: NaN, updatedMs: 1 } }))).toBe(false);
    expect(isLiveRowCurrent(base({ tfMs: 0 }))).toBe(false);
  });
});

describe('skipping is exact: identical inputs => identical stored LIVE content', () => {
  // The evaluator feeds analyse() with: candles before the signal + closedCandles(after, now) up to asOf.
  // While asOf + tf >= now, closedCandles(...) is the same set, so the analysis is the same.
  const all = series(400, { drift: 0.0004, noise: 0.7, seed: 5 });
  const signalIdx = 250;
  const signalClose = all[signalIdx].closeTime;
  const before = all.slice(0, signalIdx + 1);
  const after = all.slice(signalIdx + 1);
  const price = all[signalIdx].close;

  const liveAnalysis = (nowMs: number) => {
    const used = closedCandles(after, nowMs);
    const asOf = used.length ? used[used.length - 1].closeTime : signalClose;
    const last = used.length ? used[used.length - 1] : before[before.length - 1];
    const a = buildPlusAnalysis({
      side: 'SELL', timeframe: '1h', zoneLow: D(price.toFixed(4)), zoneHigh: D((price * 1.003).toFixed(4)), refEntry: D(price.toFixed(4)),
      stop: D((price * 1.03).toFixed(4)), target: D((price * 0.985).toFixed(4)), currentPrice: D(last.close.toFixed(4)),
      candles: [...before, ...used], asOfCloseTime: asOf, ageBars: Math.max(0, Math.floor((asOf - signalClose) / H)), expiryBars: 48,
      settings: { ...settings, leverage: D(10), minRr: D('0.4') }, contract: UNKNOWN_CONTRACT, futuresAvailable: true,
      stopTouched: false, targetTouched: false,
    });
    return { asOf, json: JSON.stringify(jsonSafe({ s: a.status, e: a.entry, q: a.quality, p: a.plan })) };
  };

  it('buildPlusAnalysis is deterministic for the same candles', () => {
    const now = all[signalIdx + 20].closeTime + 5 * MIN;
    expect(liveAnalysis(now).json).toBe(liveAnalysis(now).json);
  });

  it('every run between two candle closes would store exactly the same row', () => {
    const written = all[signalIdx + 20].closeTime + 5 * MIN; // the run that stored the row
    const stored = liveAnalysis(written);
    for (let t = written; t < stored.asOf + H; t += 5 * MIN) {
      const cur = isLiveRowCurrent({
        live: { asOfMs: stored.asOf, updatedMs: written }, nowMs: t, tfMs: H, cfgUpdatedMs: 0, forceRefreshMs: 6 * H,
      });
      if (t < stored.asOf + H) {
        expect(cur).toBe(true);
        expect(liveAnalysis(t)).toEqual(stored); // the rewrite would be byte-identical -> safe to skip
      }
    }
  });

  it('as soon as a new candle has closed the rule says "rewrite" and the content really differs', () => {
    const written = all[signalIdx + 20].closeTime + 5 * MIN;
    const stored = liveAnalysis(written);
    const t = stored.asOf + H + 1;
    expect(isLiveRowCurrent({ live: { asOfMs: stored.asOf, updatedMs: written }, nowMs: t, tfMs: H, cfgUpdatedMs: 0, forceRefreshMs: 6 * H })).toBe(false);
    const next = liveAnalysis(t);
    expect(next.asOf).toBe(stored.asOf + H);
    expect(next.json).not.toBe(stored.json);
  });

  it('agrees with engine.closedCandles for every timeframe and many clock positions (property test)', () => {
    for (const tf of ['5m', '15m', '30m', '1h', '4h', '1d']) {
      const ms = timeframeMs(tf);
      const t0 = 1_700_000_000_000 - (1_700_000_000_000 % ms);
      const cs = Array.from({ length: 60 }, (_, i) => ({
        openTime: t0 + i * ms, closeTime: t0 + (i + 1) * ms - 1, open: 1, high: 1, low: 1, close: 1, volume: 1,
      }));
      for (let k = 0; k < 200; k++) {
        const written = t0 + 5 * ms + Math.floor((k * 7919) % (30 * ms));
        const storedCount = closedCandles(cs, written).length;
        const asOf = storedCount ? cs[storedCount - 1].closeTime : 0;
        for (const now of [written, written + 1, written + Math.floor(ms / 3), written + ms - 1, written + ms, written + 2 * ms]) {
          const cur = isLiveRowCurrent({ live: { asOfMs: asOf, updatedMs: written }, nowMs: now, tfMs: ms, cfgUpdatedMs: 0, forceRefreshMs: 1e12 });
          if (cur) expect(closedCandles(cs, now).length).toBe(storedCount); // "current" must never hide a closed candle
        }
      }
    }
  });
});

describe('work ordering', () => {
  const f = (o: Partial<WorkFlags> = {}): WorkFlags => ({ needFirst: false, needSim: false, needPaper: false, needLive: false, needBt: false, ...o });
  const item = (id: string, flags: WorkFlags, signalMs: number, liveAsOfMs = 0): WorkItem<string> => ({ item: id, id, flags, signalMs, liveAsOfMs });

  it('new signals are always served before maintenance work', () => {
    const out = orderWork([
      item('bt', f({ needBt: true }), 9), item('live', f({ needLive: true }), 9, 5), item('sim', f({ needSim: true }), 1),
      item('new-old', f({ needFirst: true }), 2), item('new', f({ needFirst: true }), 8), item('paper', f({ needPaper: true }), 1),
    ], 0).map((w) => w.item);
    expect(out).toEqual(['new', 'new-old', 'sim', 'paper', 'live', 'bt']);
    expect(priorityOf(f({ needFirst: true, needBt: true }))).toBe(0);
  });

  it('stale LIVE rows go first', () => {
    const out = orderWork([item('fresh', f({ needLive: true }), 5, 900), item('stale', f({ needLive: true }), 1, 100)], 0).map((w) => w.item);
    expect(out).toEqual(['stale', 'fresh']);
  });

  it('a backlog larger than one budget is worked through over successive runs (no permanent starvation)', () => {
    const backlog = Array.from({ length: 40 }, (_, i) => item(`b${i}`, f({ needBt: true }), 1000 - i));
    const served = new Set<string>();
    const budgetPerRun = 6;
    const startSlot = runSlot(1_700_000_000_000);
    let runs = 0;
    while (served.size < 40 && runs < 100) {
      for (const w of orderWork(backlog, startSlot + runs).slice(0, budgetPerRun)) served.add(w.item);
      runs++;
    }
    expect(served.size).toBe(40); // the oldest item (b39) and the newest (b0) are both reached
    expect(served.has('b39')).toBe(true);
    expect(runs).toBeLessThan(100);
  });

  it('the backlog order changes from run to run but is reproducible for the same run', () => {
    const backlog = Array.from({ length: 30 }, (_, i) => item(`b${i}`, f({ needBt: true }), i));
    const a = orderWork(backlog, 100).map((w) => w.item);
    expect(orderWork(backlog, 100).map((w) => w.item)).toEqual(a);
    expect(orderWork(backlog, 101).map((w) => w.item)).not.toEqual(a);
  });

  it('does not lose or duplicate items', () => {
    const items = Array.from({ length: 25 }, (_, i) => item(`x${i}`, f(i % 2 ? { needBt: true } : { needLive: true }), i, i * 3));
    const out = orderWork(items, 7).map((w) => w.item).sort();
    expect(out).toEqual(items.map((w) => w.item).sort());
  });
});

describe('env helpers and slots', () => {
  it('envFlag', () => {
    expect(envFlag(undefined, true)).toBe(true);
    expect(envFlag('', false)).toBe(false);
    expect(envFlag('FALSE', true)).toBe(false);
    expect(envFlag(' on ', false)).toBe(true);
    expect(envFlag('banana', true)).toBe(true);
  });
  it('envNumber ignores invalid values', () => {
    expect(envNumber(undefined, 360)).toBe(360);
    expect(envNumber('15', 360)).toBe(15);
    expect(envNumber('-1', 360)).toBe(360);
    expect(envNumber('x', 360)).toBe(360);
    expect(envNumber('0', 360)).toBe(0);
  });
  it('exactly one 5-minute bucket per hour is the full-reconcile slot, whatever the cron offset', () => {
    const hourStart = Math.floor(1_700_000_000_000 / H) * H;
    for (const offset of [0, 1, 2, 3, 4]) {
      let hits = 0;
      for (let t = hourStart + offset * MIN; t < hourStart + H + offset * MIN; t += 5 * MIN) if (isFullReconcileSlot(t)) hits++;
      expect(hits).toBe(1);
    }
  });
});
