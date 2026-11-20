// Power Mix — calendar range filter on TRADING DAYS. A trading day is one crypto day (03:30 Tehran → 03:30 Tehran) and is named by the
// Gregorian date on which it opens, "YYYY-MM-DD" (the same key as SignalDayInfo.dayKey). Both ends are inclusive; null = open end.
// The picker may show these dates as Jalali, but everything stored / compared here is the Gregorian key. PURE.
import { cryptoDayKey } from './tehranTime';

export interface DateRange { from: string | null; to: string | null }
export const ALL_TIME: DateRange = { from: null, to: null };

const KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseKey(key: string): { y: number; m: number; d: number } | null {
  const m = KEY.exec(key);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? { y, m: mo, d } : null; // rejects 2026-02-31
}

export const isValidKey = (key: string | null | undefined): key is string => typeof key === 'string' && parseKey(key) !== null;

export function makeKey(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function addDays(key: string, days: number): string {
  const p = parseKey(key);
  if (!p) return key;
  return new Date(Date.UTC(p.y, p.m - 1, p.d + days)).toISOString().slice(0, 10);
}

/** ISO keys sort like dates, so a string compare is a date compare. An invalid end is treated as open. */
export function keyInRange(dayKey: string, r: DateRange): boolean {
  if (isValidKey(r.from) && dayKey < r.from) return false;
  if (isValidKey(r.to) && dayKey > r.to) return false;
  return true;
}

/** from <= to (when both are set) */
export function isOrdered(r: DateRange): boolean {
  return !(isValidKey(r.from) && isValidKey(r.to)) || r.from <= r.to;
}

/** "last N trading days including today's"; `null` = all time. */
export function presetRange(days: number | null, nowMs: number): DateRange {
  if (days === null) return ALL_TIME;
  const today = cryptoDayKey(nowMs);
  return { from: addDays(today, -(days - 1)), to: today };
}

export const sameRange = (a: DateRange, b: DateRange) => a.from === b.from && a.to === b.to;
export const singleDay = (key: string): DateRange => ({ from: key, to: key });
