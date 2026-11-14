import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_POWER_MIX_CONFIG as D, sanitizeConfig, configFromRow, loadLocalOverride, saveLocalOverride, clearLocalOverride, POWER_MIX_STORAGE_KEY } from '../config';
import { formatHHMM, tehranDayStart, tehranMinutes } from '../tehranTime';

describe('config', () => {
  it('has the documented defaults', () => {
    expect(D.thresholdPct).toBe(2);
    expect(D.london).toEqual({ start: 690, end: 870 });
    expect(D.us).toEqual({ start: 990, end: 1170 });
    expect(D.dead).toEqual({ start: 120, end: 660, lateStart: 1290 });
    expect(D.selection).toMatchObject({ VERY_STRONG: 'original', POWER: 'original', NEUTRAL: 'reverse' });
  });
  it('garbage falls back to defaults and never throws', () => {
    expect(sanitizeConfig(null)).toEqual(D);
    expect(sanitizeConfig('x')).toEqual(D);
    expect(sanitizeConfig({ thresholdPct: 'a', london: { start: 900, end: 800 }, selection: { POWER: 'banana' } })).toEqual(D);
  });
  it('clamps the threshold, snaps times to 30 min, rejects overlapping windows', () => {
    expect(sanitizeConfig({ thresholdPct: 99 }).thresholdPct).toBe(20);
    expect(sanitizeConfig({ london: { start: 700, end: 880 } }).london).toEqual({ start: 690, end: 870 });
    expect(sanitizeConfig({ london: { start: 600, end: 1050 } })).toEqual(D); // London would run into US
  });
  it('accepts a valid selection change', () => {
    expect(sanitizeConfig({ selection: { NEUTRAL: 'original', MIXED: 'none' } }).selection).toMatchObject({ NEUTRAL: 'original', MIXED: 'none', POWER: 'original' });
  });
  it('maps a table row', () => {
    const c = configFromRow({ threshold_pct: '3', london_start_min: 720, london_end_min: 840, us_start_min: 1000, us_end_min: 1140, dead_start_min: 60, dead_end_min: 600, dead_late_start_min: 1320, sel_very_strong: 'original', sel_power: 'none', sel_mixed: 'reverse', sel_neutral: 'reverse', low_volume_ratio: '0.4' });
    expect(c.thresholdPct).toBe(3);
    expect(c.selection.POWER).toBe('none');
    expect(c.lowVolumeRatio).toBe(0.4);
    expect(configFromRow(null)).toEqual(D);
  });
});

describe('local override', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    } as unknown as Storage;
  });
  it('round-trips and clears', () => {
    expect(loadLocalOverride()).toBeNull();
    saveLocalOverride(sanitizeConfig({ thresholdPct: 3 }));
    expect(loadLocalOverride()?.thresholdPct).toBe(3);
    clearLocalOverride();
    expect(loadLocalOverride()).toBeNull();
  });
  it('ignores corrupted storage', () => {
    localStorage.setItem(POWER_MIX_STORAGE_KEY, '{oops');
    expect(loadLocalOverride()).toBeNull();
  });
});

describe('tehran time', () => {
  it('formats and converts', () => {
    expect(formatHHMM(690)).toBe('11:30');
    expect(formatHHMM(1440)).toBe('24:00');
    const noon = Date.UTC(2026, 10, 10, 8, 30); // 12:00 Tehran
    expect(tehranMinutes(noon)).toBe(720);
    expect(tehranDayStart(noon)).toBe(Date.UTC(2026, 10, 9, 20, 30));
  });
});
