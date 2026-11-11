import { describe, expect, it } from 'vitest';
import { D } from '../../../supabase/functions/_shared/reversePlus/money';
import { QUALITY_MAX, QUALITY_VERSION, computeEntryQuality, gradeOf } from '../../../supabase/functions/_shared/reversePlus/quality';
import { buildPlusAnalysis } from '../../../supabase/functions/_shared/reversePlus/plan';
import { UNKNOWN_CONTRACT } from '../../../supabase/functions/_shared/reversePlus/types';
import { settings } from './fixtures';
import { series } from './helpers';

const base = series(260, { drift: 0.0008, noise: 0.6, seed: 11 });
const asOf = base[199].closeTime;
const input = (candles = base, at = asOf) => ({
  candles, asOfCloseTime: at, timeframe: '1h', side: 'SELL' as const, recommendedEntry: base[199].close * 1.002,
  stop: base[199].close * 1.03, target: base[199].close * 0.985,
});

describe('entry quality score', () => {
  it('weights add up to 100 and grades follow the documented bands', () => {
    expect(Object.values(QUALITY_MAX).reduce((a, b) => a + b, 0)).toBe(100);
    expect([gradeOf(80), gradeOf(79), gradeOf(65), gradeOf(64), gradeOf(50), gradeOf(49)]).toEqual([
      'HIGH', 'REVIEW', 'REVIEW', 'CAUTION', 'CAUTION', 'NO_ENTRY',
    ]);
  });

  it('is explainable: every factor carries points, max and a bilingual reason', () => {
    const q = computeEntryQuality(input());
    expect(q.version).toBe(QUALITY_VERSION);
    expect(q.score).not.toBeNull();
    expect(q.score!).toBeGreaterThanOrEqual(0);
    expect(q.score!).toBeLessThanOrEqual(100);
    expect(q.factors.length).toBe(9);
    for (const f of q.factors) {
      expect(f.earned).toBeLessThanOrEqual(f.max);
      expect(f.reason.fa.length).toBeGreaterThan(0);
      expect(f.reason.en.length).toBeGreaterThan(0);
    }
    expect(q.note.en).toMatch(/not a win probability/);
  });

  it('NO LOOK-AHEAD: candles after the evaluation time never change the score', () => {
    const at200 = computeEntryQuality(input(base.slice(0, 200)));
    const withFuture = computeEntryQuality(input(base)); // 60 extra future candles present, same asOf
    expect(withFuture).toEqual(at200);
    const wild = base.map((c, i) => (i >= 200 ? { ...c, close: c.close * 3, high: c.high * 3, low: c.low * 0.3 } : c));
    expect(computeEntryQuality(input(wild))).toEqual(at200);
  });

  it('is deterministic (no repainting between runs)', () => {
    expect(computeEntryQuality(input())).toEqual(computeEntryQuality(input()));
  });

  it('too little data -> INSUFFICIENT_DATA, never a made-up score', () => {
    const q = computeEntryQuality(input(base.slice(0, 30), base[29].closeTime));
    expect(q.score).toBeNull();
    expect(q.grade).toBe('INSUFFICIENT_DATA');
  });

  it('the score is direction-aware: a SELL and a BUY reverse of the same chart are scored differently', () => {
    const sell = computeEntryQuality(input());
    const buy = computeEntryQuality({ ...input(), side: 'BUY', recommendedEntry: base[199].close * 0.998, stop: base[199].close * 0.97, target: base[199].close * 1.015 });
    expect(JSON.stringify(sell.factors.map((f) => f.earned))).not.toBe(JSON.stringify(buy.factors.map((f) => f.earned)));
  });
});

describe('orchestrator (buildPlusAnalysis)', () => {
  const price = base[199].close;
  const mk = (over = {}) => ({
    side: 'SELL' as const, timeframe: '1h', zoneLow: D(price.toFixed(4)), zoneHigh: D((price * 1.003).toFixed(4)), refEntry: D(price.toFixed(4)),
    stop: D((price * 1.03).toFixed(4)), target: D((price * 0.985).toFixed(4)), currentPrice: D(price.toFixed(4)), candles: base,
    asOfCloseTime: asOf, ageBars: 0, expiryBars: 48, settings: { ...settings, leverage: D(10), minRr: D('0.4') }, contract: UNKNOWN_CONTRACT,
    futuresAvailable: true, ...over,
  });

  it('never modifies the stored zone / stop / target it was given', () => {
    const input = mk();
    const snapshot = JSON.stringify(input, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    const a = buildPlusAnalysis(input);
    expect(JSON.stringify(input, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).toBe(snapshot);
    expect(a.entry.zoneLow).toBe(input.zoneLow);
    expect(a.entry.zoneHigh).toBe(input.zoneHigh);
  });

  it('no USDT perpetual -> explicit informational reason, no fake plan, status untouched', () => {
    const a = buildPlusAnalysis(mk({ futuresAvailable: false }));
    expect(a.plan).toBeNull();
    expect(a.status).toBe(a.entry.status);
    expect(a.reasons).toContain('NO_FUTURES_CONTRACT');
  });

  it('50x on a ~3% stop -> LIQ_BEFORE_STOP is reported as information; the status is never promoted to INVALID', () => {
    const a = buildPlusAnalysis(mk({ settings: { ...settings, minRr: D('0.4') } }));
    expect(a.plan?.issues).toContain('LIQ_BEFORE_STOP');
    expect(a.reasons).toContain('LIQ_BEFORE_STOP');
    expect(a.status).toBe(a.entry.status);
    expect(['WAITING', 'APPROACHING', 'READY', 'EXPIRED']).toContain(a.status);
  });
});
