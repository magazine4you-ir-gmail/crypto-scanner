import { describe, it, expect } from 'vitest';
import { createDayAnalyzer } from '../dayPower';
import { DEFAULT_POWER_MIX_CONFIG, sanitizeConfig } from '../config';
import { DAY0, dayWithMoves, history, makeDay, tehran, hm } from './helpers';

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

  it('Tehran day boundary: 20:30 UTC is 00:00 of the next Tehran day', () => {
    const a = createDayAnalyzer(dayWithMoves(DAY0, 3, 3), cfg, END_OF_DAY);
    expect(a.classify(DAY0 + 60_000).dayKey).toBe('2026-11-10');
    expect(a.classify(DAY0 - 60_000).dayKey).toBe('2026-11-09');
  });
});

describe('dead hours', () => {
  const quiet = makeDay(DAY0, [[0, 100_000], [hm(5), 101_000], [1440, 101_000]]); // +1.0% by 05:00
  const hot = makeDay(DAY0, [[0, 100_000], [hm(5), 102_500], [1440, 102_500]]);   // +2.5% by 05:00

  it('< threshold since day start -> Neutral + dead label', () => {
    const info = createDayAnalyzer(quiet, cfg, END_OF_DAY).classify(tehran(DAY0, 5, 0));
    expect(info).toMatchObject({ state: 'FINAL', dayClass: 'NEUTRAL', deadHours: true });
    expect(info.dayMovePct).toBeCloseTo(1, 5);
  });

  it('>= threshold since day start -> Power + dead label', () => {
    const info = createDayAnalyzer(hot, cfg, END_OF_DAY).classify(tehran(DAY0, 5, 0));
    expect(info).toMatchObject({ state: 'FINAL', dayClass: 'POWER', deadHours: true });
  });

  it('dead hours are [02:00, 11:00) and from 21:30; 11:00 itself is not dead', () => {
    const a = createDayAnalyzer(dayWithMoves(DAY0, 0, 0), cfg, END_OF_DAY);
    expect(a.classify(tehran(DAY0, 1, 59)).deadHours).toBe(false);
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
