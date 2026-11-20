import { describe, it, expect, vi } from 'vitest';
vi.mock('@/services/supabaseClient', () => ({ supabase: {} }));
import { classifyWindows, createDayAnalyzer } from '../dayPower';
import { DEFAULT_POWER_MIX_CONFIG as D, sanitizeConfig, selectionFor, isValidConfig, configFromRow } from '../config';
import { readThermo, needlePosition } from '../thermo';
import { addDays, keyInRange, parseKey, presetRange, isOrdered } from '../dateRange';
import { gregorianToJalali as g2j, jalaliToGregorian as j2g, jalaliMonthLength } from '../jalali';
import { labTrade, computeMixStats } from '../tradeCalc';
import { FALLBACK_PUBLIC_CONFIG } from '@/reversePlus/fallbackConfig';
import { defaultPrefs } from '@/reversePlus/scenarioPrefs';
import type { SignalOutcome } from '@/services/outcomeService';
import { DAY0, dayWithMoves, tehran } from './helpers';

describe('strength ladder', () => {
  it('is identical to the classic model while strongPct = 0', () => {
    expect(classifyWindows(3, 3, 2)).toBe('VERY_STRONG');
    expect(classifyWindows(3, -3, 2)).toBe('MIXED');
    expect(classifyWindows(3, 0.2, 2)).toBe('POWER');
    expect(classifyWindows(0.5, 0.2, 2)).toBe('NEUTRAL');
  });
  it('power 1.5 / strong 3: ladder with alignment', () => {
    expect(classifyWindows(0.5, 0.4, 1.5, 3)).toBe('NEUTRAL');
    expect(classifyWindows(1.6, 0.2, 1.5, 3)).toBe('POWER');
    expect(classifyWindows(3.2, -0.1, 1.5, 3)).toBe('STRONG');     // big, the other session went the other way
    expect(classifyWindows(3.2, 0, 1.5, 3)).toBe('STRONG');
    expect(classifyWindows(3.2, 0.1, 1.5, 3)).toBe('VERY_STRONG'); // same direction, combined 3.3
    expect(classifyWindows(2, 2, 1.5, 3)).toBe('VERY_STRONG');     // combined 4 and same direction
    expect(classifyWindows(-2, -2, 1.5, 3)).toBe('VERY_STRONG');
    expect(classifyWindows(2, -2, 1.5, 3)).toBe('MIXED');          // conflict keeps priority
    expect(classifyWindows(3.1, null, 1.5, 3)).toBe('STRONG');     // only London closed: alignment unknown
  });
  it('config: strongPct must be 0 or above the power threshold', () => {
    expect(sanitizeConfig({ strongPct: 3 }).strongPct).toBe(3);
    expect(sanitizeConfig({ strongPct: 1 }).strongPct).toBe(0);
    expect(isValidConfig({ ...D, strongPct: 1 })).toBe(false);
    expect(isValidConfig({ ...D, strongPct: 3 })).toBe(true);
    expect(configFromRow({ strong_pct: '3', sel_strong: 'reverse', sel_dead: 'none' })).toMatchObject({ strongPct: 3, selection: { STRONG: 'reverse', DEAD: 'none' } });
  });
  it('a day in the analyzer uses the ladder', () => {
    const cfg = sanitizeConfig({ thresholdPct: 1.5, strongPct: 3 });
    const a = createDayAnalyzer(dayWithMoves(DAY0, 3.4, -0.2), cfg, tehran(DAY0, 23, 0) + 86_400_000);
    expect(a.classifyLocked(tehran(DAY0, 12, 0)).dayClass).toBe('STRONG');
  });
});

describe('dead-hours pick', () => {
  it('follows the class by default and has its own value when set', () => {
    expect(selectionFor(D, 'NEUTRAL', true)).toBe('reverse');
    const c = sanitizeConfig({ selection: { DEAD: 'none' } });
    expect(selectionFor(c, 'NEUTRAL', true)).toBe('none');
    expect(selectionFor(c, 'NEUTRAL', false)).toBe('reverse');
    expect(sanitizeConfig({ selection: { DEAD: 'banana' } }).selection.DEAD).toBe('byClass');
  });
});

describe('thermometer', () => {
  const lv = { thresholdPct: 1.5, strongPct: 3 };
  it('signed value, zones, conflict', () => {
    expect(readThermo({ londonPct: 2, usPct: 2, dayMovePct: 3, deadHours: false }, lv)).toMatchObject({ value: 4, zone: 'STRONG', direction: 'BULL' });
    expect(readThermo({ londonPct: -3, usPct: -3, dayMovePct: -5, deadHours: false }, lv)).toMatchObject({ zone: 'EXTREME', direction: 'BEAR' });
    expect(readThermo({ londonPct: 0.2, usPct: 0.1, dayMovePct: 0, deadHours: false }, lv)).toMatchObject({ zone: 'NEUTRAL', direction: 'FLAT' });
    expect(readThermo({ londonPct: 2, usPct: -2, dayMovePct: 0, deadHours: false }, lv)).toMatchObject({ zone: 'NEUTRAL', conflict: true });
    expect(readThermo({ londonPct: 5, usPct: null, dayMovePct: 1.6, deadHours: true }, lv).value).toBe(1.6); // dead hours use the day move
    expect(readThermo({ londonPct: null, usPct: null, dayMovePct: null, deadHours: false }, lv).value).toBeNull();
  });
  it('needle stays inside the scale', () => {
    expect(needlePosition(0, lv)).toBe(0.5);
    expect(needlePosition(99, lv)).toBe(1);
    expect(needlePosition(-99, lv)).toBe(0);
  });
});

describe('calendar', () => {
  it('jalali conversion', () => {
    expect(g2j({ y: 2026, m: 11, d: 20 })).toEqual({ y: 1405, m: 8, d: 29 });
    expect(j2g({ y: 1405, m: 1, d: 1 })).toEqual({ y: 2026, m: 3, d: 21 });
    expect(j2g(g2j({ y: 2024, m: 2, d: 29 }))).toEqual({ y: 2024, m: 2, d: 29 });
    expect(jalaliMonthLength(1403, 12)).toBe(30);
    expect(jalaliMonthLength(1404, 12)).toBe(29);
    expect(jalaliMonthLength(1405, 7)).toBe(30);
  });
  it('range filter on trading-day keys', () => {
    expect(parseKey('2026-02-31')).toBeNull();
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    const r = { from: '2026-11-10', to: '2026-11-12' };
    expect(['2026-11-09', '2026-11-10', '2026-11-12', '2026-11-13'].map((k) => keyInRange(k, r))).toEqual([false, true, true, false]);
    expect(keyInRange('2020-01-01', { from: null, to: null })).toBe(true);
    expect(isOrdered({ from: '2026-11-12', to: '2026-11-10' })).toBe(false);
    expect(presetRange(7, Date.UTC(2026, 10, 20, 10))).toEqual({ from: '2026-11-14', to: '2026-11-20' });
  });
});

describe('trade model & stats', () => {
  const ctx = { cfg: FALLBACK_PUBLIC_CONFIG, prefs: defaultPrefs(FALLBACK_PUBLIC_CONFIG), backtests: new Map() };
  const o = (status: SignalOutcome['status'], pnl: number, r: number, i: number): SignalOutcome => ({
    id: `x${i}`, symbol: 'ETHUSDT', base_asset: 'ETH', timeframe: '1h', signal_type: 'BUY', score: 70, price_at_signal: 100, entry_low: null, entry_high: null,
    stop_loss: 95, target1: 110, target2: null, risk_reward: 2, signal_at: '2026-11-10T10:00:00Z', candle_close_time: '2026-11-10T10:00:00Z',
    status, exit_price: 110, exit_at: `2026-11-10T1${i}:00:00Z`, pnl_pct: pnl, pnl_gross_pct: pnl, r_multiple: r, bars_held: 2, source: 'auto_scan', notes: null,
  });
  it('USDT result follows the scenario (fixed risk: R x risk amount)', () => {
    const t = labTrade('original', o('WIN', 9, 2, 1), ctx);
    expect(t.status).toBe('WIN');
    expect(t.netUsd).toBeCloseTo(2 * ctx.prefs.riskAmount, 6);
    expect(t.pnlPct).toBe(9);
  });
  it('stats: net, drawdown, open / unknown never counted as closed', () => {
    const ts = [labTrade('original', o('WIN', 9, 2, 1), ctx), labTrade('original', o('LOSS', -4, -1, 2), ctx), labTrade('original', o('LOSS', -4, -1, 3), ctx), labTrade('original', o('OPEN', 0, 0, 4), ctx)];
    const s = computeMixStats(ts);
    expect(s.totalClosed).toBe(3);
    expect(s.open).toBe(1);
    const risk = ctx.prefs.riskAmount;
    expect(s.netUsd).toBeCloseTo(0, 6);                         // +2R -1R -1R
    expect(s.maxDrawdownUsd).toBeCloseTo(2 * risk, 6);          // peak +2R then -2R
    expect(s.totalR).toBeCloseTo(0, 6);
  });
});
