import { DAY_MS, MINUTE_MS } from '../tehranTime';
import { STEP_MS, type BtcCandle } from '../dayPower';

/** 2026-11-10 00:00 Tehran = 2026-11-09 20:30 UTC */
export const DAY0 = Date.UTC(2026, 10, 9, 20, 30, 0);

type Path = Array<[minute: number, price: number]>;

function interp(path: Path, m: number): number {
  if (m <= path[0][0]) return path[0][1];
  for (let i = 1; i < path.length; i++) {
    if (m <= path[i][0]) {
      const [m0, p0] = path[i - 1];
      const [m1, p1] = path[i];
      return p0 + ((p1 - p0) * (m - m0)) / (m1 - m0);
    }
  }
  return path[path.length - 1][1];
}

/** 48 thirty-minute candles of one Tehran day following a piecewise-linear price path (minute-of-day -> price). */
export function makeDay(dayStart: number, path: Path, volume = 100): BtcCandle[] {
  const out: BtcCandle[] = [];
  for (let m = 0; m < 1440; m += 30) {
    const o = interp(path, m);
    const c = interp(path, m + 30);
    out.push({ openTime: dayStart + m * MINUTE_MS, closeTime: dayStart + (m + 30) * MINUTE_MS - 1, open: o, high: Math.max(o, c), low: Math.min(o, c), close: c, volume });
  }
  return out;
}

const P = 100_000;
const at = (min: number) => min * MINUTE_MS;
export const hm = (h: number, m = 0) => h * 60 + m;

/** London (11:30-14:30) and US (16:30-19:30) net moves in %, flat everywhere else. */
export function dayWithMoves(dayStart: number, londonPct: number, usPct: number, volume = 100): BtcCandle[] {
  const l1 = P * (1 + londonPct / 100);
  const u1 = l1 * (1 + usPct / 100);
  return makeDay(dayStart, [[0, P], [hm(11, 30), P], [hm(14, 30), l1], [hm(16, 30), l1], [hm(19, 30), u1], [1440, u1]], volume);
}

/** `n` quiet-but-normal-volume days before DAY0, used as the volume baseline. */
export function history(n: number, volume = 100): BtcCandle[] {
  const out: BtcCandle[] = [];
  for (let k = n; k >= 1; k--) out.push(...dayWithMoves(DAY0 - k * DAY_MS, 0.5, 0.5, volume));
  return out;
}

export const tehran = (dayStart: number, h: number, m = 0) => dayStart + at(hm(h, m));
export { STEP_MS };
