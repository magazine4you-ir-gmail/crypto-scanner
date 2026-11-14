// Power Mix — Tehran (Asia/Tehran) calendar helpers.
// Iran has had no daylight-saving time since 2022, so Tehran is a fixed UTC+03:30. All Power Mix windows are expressed
// as "minutes since 00:00 Tehran" and every candle / signal timestamp is a UTC millisecond value.

export const TEHRAN_OFFSET_MIN = 210; // +03:30
export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;
const OFFSET_MS = TEHRAN_OFFSET_MIN * MINUTE_MS;

/** UTC ms of 00:00 Tehran of the Tehran calendar day that contains `ms`. */
export function tehranDayStart(ms: number): number {
  return Math.floor((ms + OFFSET_MS) / DAY_MS) * DAY_MS - OFFSET_MS;
}

/** Minutes since 00:00 Tehran (fractional). */
export function tehranMinutes(ms: number): number {
  return (ms - tehranDayStart(ms)) / MINUTE_MS;
}

/** "YYYY-MM-DD" of the Tehran calendar day (Gregorian; the UI formats it for the user's language). */
export function tehranDayKey(ms: number): string {
  return new Date(tehranDayStart(ms) + OFFSET_MS).toISOString().slice(0, 10);
}

/** 690 -> "11:30"; 1440 -> "24:00" */
export function formatHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Candle timestamps and signal times can differ by a few ms (…59.999 vs …00.000). Rounds to the nearest second. */
export function roundToSecond(ms: number): number {
  return Math.round(ms / 1000) * 1000;
}
