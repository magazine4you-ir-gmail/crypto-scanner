// Power Mix — BTC day-power classification (PURE: candles + config + "now" in, labels out; no network, no storage).
//
// Reference asset: BTCUSDT, 30-minute candles. Every window move is the NET move: (close of the window's last candle − open of
// its first candle) / open of its first candle, in %.
//
//   Very Strong : London and US both |move| >= threshold, SAME direction
//   Mixed       : London and US both |move| >= threshold, OPPOSITE directions
//   Power       : exactly one of the two windows reaches the threshold
//   Neutral     : neither reaches it
//
// A signal is classified by ITS OWN generation time (never by the current time):
//   * generated in Dead Hours  -> classified immediately by the BTC move from 00:00 Tehran to the signal time
//                                  (>= threshold = Power, else Neutral) and flagged "dead hours"
//   * otherwise                -> needs both key windows to be closed; until then it is PENDING (with an approximate tendency)
//                                  and once the US window closes the class is locked
import { DAY_MS, MINUTE_MS, roundToSecond, tehranDayKey, tehranDayStart } from './tehranTime';
import type { DayClass, PowerMixConfig, SidePick } from './config';

export interface BtcCandle {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export const STEP_MS = 30 * MINUTE_MS;
const EPS = 1e-9;
const BASELINE_DAYS = 14;
const MIN_BASELINE_DAYS = 5;

export type DayState = 'FINAL' | 'PENDING' | 'NO_DATA';
export type Tendency = 'UP' | 'DOWN' | 'FLAT';

export interface SignalDayInfo {
  dayKey: string;
  dayStart: number;
  state: DayState;
  /** null while PENDING / NO_DATA */
  dayClass: DayClass | null;
  deadHours: boolean;
  lowVolume: boolean;
  /** net BTC move of the London / US window in %, null when the window has no data yet */
  londonPct: number | null;
  usPct: number | null;
  /** dead-hours signals: 00:00 -> signal time.  pending: 00:00 -> now.  otherwise null */
  dayMovePct: number | null;
  /** PENDING only: where the day is heading right now */
  tendency: Tendency | null;
}

export interface LiveStatus {
  nowMs: number;
  info: SignalDayInfo;
  /** last known BTC price */
  price: number | null;
  londonComplete: boolean;
  usComplete: boolean;
  /** what to use right now: a side, or WAIT when nothing can be said yet */
  pick: SidePick | 'WAIT';
  /** true when the pick is only based on the approximate tendency of a still-pending day */
  approximate: boolean;
}

interface WindowStats { movePct: number | null; complete: boolean; missing: boolean; volume: number }

export function buildIndex(candles: BtcCandle[]): Map<number, BtcCandle> {
  const m = new Map<number, BtcCandle>();
  for (const c of candles) if (Number.isFinite(c.openTime) && Number.isFinite(c.open) && Number.isFinite(c.close)) m.set(c.openTime, c);
  return m;
}

export function classifyWindows(londonPct: number | null, usPct: number | null, thresholdPct: number): DayClass {
  const l = londonPct !== null && Math.abs(londonPct) >= thresholdPct - EPS;
  const u = usPct !== null && Math.abs(usPct) >= thresholdPct - EPS;
  if (l && u) return Math.sign(londonPct as number) === Math.sign(usPct as number) ? 'VERY_STRONG' : 'MIXED';
  if (l || u) return 'POWER';
  return 'NEUTRAL';
}

export function tendencyOf(movePct: number | null, thresholdPct: number): Tendency | null {
  if (movePct === null) return null;
  if (movePct >= thresholdPct - EPS) return 'UP';
  if (movePct <= -thresholdPct + EPS) return 'DOWN';
  return 'FLAT';
}

export function createDayAnalyzer(candles: BtcCandle[], cfg: PowerMixConfig, nowMs: number) {
  const idx = buildIndex(candles);
  const winCache = new Map<string, WindowStats>();

  const windowStats = (startMs: number, endMs: number): WindowStats => {
    const key = `${startMs}:${endMs}`;
    const hit = winCache.get(key);
    if (hit) return hit;
    let missing = false;
    let volume = 0;
    let last: BtcCandle | null = null;
    const first = idx.get(startMs) ?? null;
    for (let t = startMs; t < endMs && t < nowMs; t += STEP_MS) {
      const c = idx.get(t);
      if (!c) { missing = true; continue; }
      volume += c.volume || 0;
      last = c;
    }
    const closed = nowMs >= endMs;
    const movePct = first && last && first.open > 0 ? ((last.close - first.open) / first.open) * 100 : null;
    const out: WindowStats = { movePct, complete: closed && !missing && movePct !== null, missing: closed && missing, volume };
    winCache.set(key, out);
    return out;
  };

  const dayWindows = (dayStart: number) => ({
    london: windowStats(dayStart + cfg.london.start * MINUTE_MS, dayStart + cfg.london.end * MINUTE_MS),
    us: windowStats(dayStart + cfg.us.start * MINUTE_MS, dayStart + cfg.us.end * MINUTE_MS),
  });

  /** close of the last candle that OPENED before `ms` (and on/after day start) — i.e. the price at that moment */
  const priceAt = (dayStart: number, ms: number): number | null => {
    let t = Math.floor((Math.min(ms, nowMs) - 1) / STEP_MS) * STEP_MS;
    for (let i = 0; i < 6 && t >= dayStart; i++, t -= STEP_MS) {
      const c = idx.get(t);
      if (c) return c.close;
    }
    return null;
  };

  const dayMovePct = (dayStart: number, ms: number): number | null => {
    const open = idx.get(dayStart)?.open;
    const p = priceAt(dayStart, ms);
    return open && open > 0 && p !== null ? ((p - open) / open) * 100 : null;
  };

  const volumeBaseline = (dayStart: number): number | null => {
    const vols: number[] = [];
    for (let k = 1; k <= BASELINE_DAYS; k++) {
      const w = dayWindows(dayStart - k * DAY_MS);
      if (w.london.complete && w.us.complete) vols.push(w.london.volume + w.us.volume);
    }
    if (vols.length < MIN_BASELINE_DAYS) return null;
    vols.sort((a, b) => a - b);
    const mid = Math.floor(vols.length / 2);
    return vols.length % 2 ? vols[mid] : (vols[mid - 1] + vols[mid]) / 2;
  };

  const isLowVolume = (dayStart: number): boolean => {
    if (cfg.lowVolumeRatio <= 0) return false;
    const w = dayWindows(dayStart);
    if (!w.london.complete || !w.us.complete) return false;
    const base = volumeBaseline(dayStart);
    return base !== null && base > 0 && w.london.volume + w.us.volume < base * cfg.lowVolumeRatio;
  };

  const isDead = (tod: number) => (tod >= cfg.dead.start && tod < cfg.dead.end) || tod >= cfg.dead.lateStart;

  function classify(signalMs: number): SignalDayInfo {
    const T = roundToSecond(signalMs);
    const dayStart = tehranDayStart(T);
    const tod = (T - dayStart) / MINUTE_MS;
    const dead = isDead(tod);
    const w = dayWindows(dayStart);
    const base = {
      dayKey: tehranDayKey(T), dayStart, deadHours: dead,
      lowVolume: isLowVolume(dayStart),
      londonPct: w.london.movePct, usPct: w.us.movePct,
    };

    if (dead) {
      const mv = dayMovePct(dayStart, T);
      if (mv === null) return { ...base, state: 'NO_DATA', dayClass: null, dayMovePct: null, tendency: null };
      return { ...base, state: 'FINAL', dayClass: Math.abs(mv) >= cfg.thresholdPct - EPS ? 'POWER' : 'NEUTRAL', dayMovePct: mv, tendency: null };
    }

    if (w.london.complete && w.us.complete) {
      return { ...base, state: 'FINAL', dayClass: classifyWindows(w.london.movePct, w.us.movePct, cfg.thresholdPct), dayMovePct: null, tendency: null };
    }
    if (w.london.missing || w.us.missing) return { ...base, state: 'NO_DATA', dayClass: null, dayMovePct: null, tendency: null };

    const mv = dayMovePct(dayStart, nowMs);
    return { ...base, state: 'PENDING', dayClass: null, dayMovePct: mv, tendency: tendencyOf(mv, cfg.thresholdPct) };
  }

  function live(): LiveStatus {
    const info = classify(nowMs);
    const w = dayWindows(info.dayStart);
    let price: number | null = null;
    for (let t = Math.floor(nowMs / STEP_MS) * STEP_MS, i = 0; i < 6; i++, t -= STEP_MS) {
      const c = idx.get(t);
      if (c) { price = c.close; break; }
    }
    let pick: LiveStatus['pick'] = 'WAIT';
    let approximate = false;
    if (info.state === 'FINAL' && info.dayClass) pick = cfg.selection[info.dayClass];
    else if (info.state === 'PENDING' && info.tendency) {
      approximate = true;
      pick = info.tendency === 'FLAT' ? cfg.selection.NEUTRAL : cfg.selection.POWER;
    }
    return { nowMs, info, price, londonComplete: w.london.complete, usComplete: w.us.complete, pick, approximate };
  }

  return { classify, live, candleCount: idx.size };
}

export type DayAnalyzer = ReturnType<typeof createDayAnalyzer>;
