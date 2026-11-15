import { describe, it, expect } from 'vitest';
import { createDayAnalyzer } from '../dayPower';
import { DEFAULT_POWER_MIX_CONFIG, sanitizeConfig } from '../config';
import { DAY0, dayWithMoves, history, makeDay, tehran, hm } from './helpers';
import { DAY_MS } from '../tehranTime';

const cfg = DEFAULT_POWER_MIX_CONFIG;
const END_OF_DAY = tehran(DAY0, 23, 59);

describe('day power classification', () => {
  const cases: Array<[string, number, number, string]> = [
    ['very strong (same direction, up)', 2.5, 3, 'VERY_STRONG'],
    ['very strong (same direction, down)', -2.5, -3, 'VERY_STRONG'],
    ['mixed direction', 2.5, -2.5, 'MIXED'],
    ['power: only London', 2.4, 0.5, 'POWER'],
    ['power: only US (down)', 0.3, -2.2, 'POWER'],
    ['neutral', 1.2, -0.8, 'NEUTRAL'],
  ];
  for (const [name, l, u, expected] of cases) {
    it(name, () => {
      const a = createDayAnalyzer(dayWithMoves(DAY0, l, u), cfg, END_OF_DAY);
      const info = a.classify(tehran(DAY0, 12, 0)); // a signal generated during London
      expect(info.state).toBe('FINAL');
      expect(info.dayClass).toBe(expected);
      expect(info.deadHours).toBe(false);
    });
  }

  it('threshold is inclusive (exactly 2% counts) and configurable', () => {
    const a = createDayAnalyzer(dayWithMoves(DAY0, 2, 0), cfg, END_OF_DAY);
    expect(a.classify(tehran(DAY0, 18, 0)).dayClass).toBe('POWER');
    const strict = createDayAnalyzer(dayWithMoves(DAY0, 2, 0), sanitizeConfig({ thresholdPct: 3 }), END_OF_DAY);
    expect(strict.classify(tehran(DAY0, 18, 0)).dayClass).toBe('NEUTRAL');
  });

  it('classifies by the signal day, not by the current day', () => {
    const candles = [...dayWithMoves(DAY0 - 86_400_000, 3, 3), ...dayWithMoves(DAY0, 0.1, 0.1)];
    const a = createDayAnalyzer(candles, cfg, END_OF_DAY);
    expect(a.classify(tehran(DAY0 - 86_400_000, 17, 0)).dayClass).toBe('VERY_STRONG');
    expect(a.classify(tehran(DAY0, 17, 0)).dayClass).toBe('NEUTRAL');
  });

  it('the trading day resets at 03:30 Tehran (00:00 UTC): 03:29 is the old day, 03:30 the new one', () => {
    const a = createDayAnalyzer(dayWithMoves(DAY0, 3, 3), cfg, END_OF_DAY);
    expect(a.classify(tehran(DAY0, 3, 30)).dayKey).toBe('2026-11-10');
    expect(a.classify(tehran(DAY0, 3, 29)).dayKey).toBe('2026-11-09');
    expect(a.classify(tehran(DAY0, 0, 30)).dayKey).toBe('2026-11-09'); // 00:30 Tehran is still the previous day
  });
});

describe('dead hours', () => {
  // the move is measured from the crypto-day open (03:30 Tehran)
  const quiet = makeDay(DAY0, [[0, 100_000], [hm(3, 30), 100_000], [hm(5), 101_000], [1440, 101_000]]); // +1.0% by 05:00
  const hot = makeDay(DAY0, [[0, 100_000], [hm(3, 30), 100_000], [hm(5), 102_500], [1440, 102_500]]);   // +2.5% by 05:00

  it('< threshold since day start -> Neutral + dead label', () => {
    const info = createDayAnalyzer(quiet, cfg, END_OF_DAY).classify(tehran(DAY0, 5, 0));
    expect(info).toMatchObject({ state: 'FINAL', dayClass: 'NEUTRAL', deadHours: true });
    expect(info.dayMovePct).toBeCloseTo(1, 5);
  });

  it('>= threshold since day start -> Power + dead label', () => {
    const info = createDayAnalyzer(hot, cfg, END_OF_DAY).classify(tehran(DAY0, 5, 0));
    expect(info).toMatchObject({ state: 'FINAL', dayClass: 'POWER', deadHours: true });
  });

  it('dead hours are 03:30-11:00 and from 21:30 (incl. 00:00-03:30, the tail of the previous day); 11:00 itself is not dead', () => {
    const a = createDayAnalyzer(dayWithMoves(DAY0, 0, 0), cfg, END_OF_DAY);
    expect(a.classify(tehran(DAY0, 1, 59)).deadHours).toBe(true);
    expect(a.classify(tehran(DAY0, 2, 0)).deadHours).toBe(true);
    expect(a.classify(tehran(DAY0, 10, 59)).deadHours).toBe(true);
    expect(a.classify(tehran(DAY0, 11, 0)).deadHours).toBe(false);
    expect(a.classify(tehran(DAY0, 21, 29)).deadHours).toBe(false);
    expect(a.classify(tehran(DAY0, 21, 30)).deadHours).toBe(true);
  });

  it('a candle close stored as 10:59:59.999 behaves like 11:00', () => {
    const a = createDayAnalyzer(dayWithMoves(DAY0, 0, 0), cfg, END_OF_DAY);
    expect(a.classify(tehran(DAY0, 11, 0) - 1).deadHours).toBe(false);
  });
});

describe('pending and locking', () => {
  it('is pending while the US window is open, with an approximate tendency, and locks after it closes', () => {
    const candles = dayWithMoves(DAY0, 2.5, 3);
    const during = createDayAnalyzer(candles, cfg, tehran(DAY0, 17, 0));
    const info = during.classify(tehran(DAY0, 12, 0));
    expect(info.state).toBe('PENDING');
    expect(info.dayClass).toBeNull();
    expect(info.tendency).toBe('UP');

    const afterClose = createDayAnalyzer(candles, cfg, tehran(DAY0, 19, 30));
    expect(afterClose.classify(tehran(DAY0, 12, 0)).state).toBe('FINAL');
  });

  it('tendency is flat for a quiet day and down for a falling one', () => {
    const flat = createDayAnalyzer(dayWithMoves(DAY0, 0.2, 0.1), cfg, tehran(DAY0, 13, 0));
    expect(flat.classify(tehran(DAY0, 12, 0)).tendency).toBe('FLAT');
    const down = createDayAnalyzer(dayWithMoves(DAY0, -3, 0), cfg, tehran(DAY0, 15, 0));
    expect(down.classify(tehran(DAY0, 12, 0)).tendency).toBe('DOWN');
  });

  it('missing candles after a window closed -> NO_DATA (never a guessed class)', () => {
    const candles = dayWithMoves(DAY0, 3, 3).filter((c) => c.openTime !== tehran(DAY0, 12, 0));
    const info = createDayAnalyzer(candles, cfg, END_OF_DAY).classify(tehran(DAY0, 13, 0));
    expect(info.state).toBe('NO_DATA');
    expect(info.dayClass).toBeNull();
  });
});

describe('low volume label', () => {
  it('flags a day whose key-window volume is far below the recent median', () => {
    const candles = [...history(10, 100), ...dayWithMoves(DAY0, 3, 3, 20)];
    const a = createDayAnalyzer(candles, cfg, END_OF_DAY);
    expect(a.classify(tehran(DAY0, 12, 0)).lowVolume).toBe(true);
  });
  it('does not flag a normal day, and needs enough history', () => {
    const normal = createDayAnalyzer([...history(10, 100), ...dayWithMoves(DAY0, 3, 3, 100)], cfg, END_OF_DAY);
    expect(normal.classify(tehran(DAY0, 12, 0)).lowVolume).toBe(false);
    const noHistory = createDayAnalyzer(dayWithMoves(DAY0, 3, 3, 1), cfg, END_OF_DAY);
    expect(noHistory.classify(tehran(DAY0, 12, 0)).lowVolume).toBe(false);
  });
  it('is off when the ratio is 0', () => {
    const off = sanitizeConfig({ lowVolumeRatio: 0 });
    const a = createDayAnalyzer([...history(10, 100), ...dayWithMoves(DAY0, 3, 3, 1)], off, END_OF_DAY);
    expect(a.classify(tehran(DAY0, 12, 0)).lowVolume).toBe(false);
  });
});

describe('live status', () => {
  it('final power day -> use original; final neutral day -> use reverse', () => {
    const p = createDayAnalyzer(dayWithMoves(DAY0, 3, 0), cfg, tehran(DAY0, 20, 0)).live();
    expect(p).toMatchObject({ pick: 'original', approximate: false });
    const n = createDayAnalyzer(dayWithMoves(DAY0, 0.2, 0.2), cfg, tehran(DAY0, 20, 0)).live();
    expect(n).toMatchObject({ pick: 'reverse', approximate: false });
  });
  it('pending day -> approximate pick from the tendency; no data -> WAIT', () => {
    const pend = createDayAnalyzer(dayWithMoves(DAY0, 3, 0), cfg, tehran(DAY0, 15, 0)).live();
    expect(pend.info.state).toBe('PENDING');
    expect(pend).toMatchObject({ pick: 'original', approximate: true });
    const none = createDayAnalyzer([], cfg, tehran(DAY0, 15, 0)).live();
    expect(none.pick).toBe('WAIT');
    expect(none.price).toBeNull();
  });
  it('reports the last known price', () => {
    const l = createDayAnalyzer(dayWithMoves(DAY0, 3, 0), cfg, tehran(DAY0, 15, 10)).live();
    expect(l.price).toBeGreaterThan(100_000);
  });
});

describe('day boundary and no look-ahead (executable)', () => {
  const T0330 = tehran(DAY0, 3, 30); // 00:00 UTC: exactly when every 1d signal (and 4h/1h/15m closing then) is generated

  it('a signal exactly at the day reset is the new day with zero move — never NO_DATA', () => {
    const a = createDayAnalyzer(dayWithMoves(DAY0, 3, 3), cfg, END_OF_DAY);
    for (const mode of ['executable', 'locked'] as const) {
      expect(a.classify(T0330, mode)).toMatchObject({ state: 'FINAL', dayClass: 'NEUTRAL', deadHours: true, dayMovePct: 0 });
      expect(a.classify(T0330 - 1, mode).state).not.toBe('NO_DATA'); // candle close stored as 03:29:59.999 -> same instant
    }
  });

  it('the first half hour of the day has no closed candle yet -> move 0, not NO_DATA', () => {
    const a = createDayAnalyzer(dayWithMoves(DAY0, 3, 3), cfg, END_OF_DAY);
    expect(a.classifyExecutable(T0330 + 15 * 60_000)).toMatchObject({ state: 'FINAL', dayMovePct: 0 });
  });

  it('uses only candles CLOSED at the signal time (15m signal in the middle of a 30m candle)', () => {
    // 09:00-09:30 candle rises 100k -> 103k; at 09:15 the real price is only about 101.5k
    const spike = makeDay(DAY0, [[0, 100_000], [hm(9), 100_000], [hm(9, 30), 103_000], [1440, 103_000]]);
    const a = createDayAnalyzer(spike, cfg, END_OF_DAY);
    expect(a.classifyExecutable(tehran(DAY0, 9, 15))).toMatchObject({ dayClass: 'NEUTRAL', dayMovePct: 0 });
    expect(a.classifyExecutable(tehran(DAY0, 9, 30))).toMatchObject({ dayClass: 'POWER' });
  });

  it('a signal at 00:30 Tehran belongs to the PREVIOUS day and is a late (dead) signal in both modes', () => {
    const prev = DAY0 - DAY_MS;
    const candles = [...dayWithMoves(prev, 3, 3), ...dayWithMoves(DAY0, 0, 0)];
    const a = createDayAnalyzer(candles, cfg, tehran(DAY0, 12, 0));
    const T = tehran(DAY0, 0, 30);
    for (const mode of ['executable', 'locked'] as const) {
      const info = a.classify(T, mode);
      expect(info.dayKey).toBe('2026-11-09');
      expect(info.deadHours).toBe(true);
      expect(info.state).toBe('FINAL'); // not PENDING: it never waits for the next day's sessions
    }
  });

  it('executable class of a past signal never changes as time passes', () => {
    const candles = dayWithMoves(DAY0, 2.5, 3);
    const T = tehran(DAY0, 12, 0);
    const early = createDayAnalyzer(candles, cfg, tehran(DAY0, 12, 5)).classifyExecutable(T);
    const mid = createDayAnalyzer(candles, cfg, tehran(DAY0, 17, 0)).classifyExecutable(T);
    const late = createDayAnalyzer(candles, cfg, END_OF_DAY).classifyExecutable(T);
    expect(mid.dayClass).toBe(early.dayClass);
    expect(late.dayClass).toBe(early.dayClass);
    expect(late.dayMovePct).toBe(early.dayMovePct);
  });

  it('executable: closed window with a gap -> NO_DATA (not silently another class)', () => {
    const candles = dayWithMoves(DAY0, 3, 3).filter((c) => c.openTime !== tehran(DAY0, 12, 0));
    expect(createDayAnalyzer(candles, cfg, END_OF_DAY).classifyExecutable(tehran(DAY0, 15, 0)).state).toBe('NO_DATA');
  });
});
