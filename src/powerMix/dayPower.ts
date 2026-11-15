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
// Two classification modes for a signal at time T:
//   * locked (default / historical stats) — waits until the US window is closed (relative to "now"), then uses the full day.
//   * executable — uses ONLY information available at T (completed windows up to T, else day-move 00:00→T). Never waits for the future.
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
export type ClassifyMode = 'locked' | 'executable';

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
  /** dead-hours / executable mid-day: 00:00 -> signal time. pending locked: 00:00 -> now. otherwise null */
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

  /** Window stats as of `asOfMs` (not always global now — needed for executable mode). */
  const windowStats = (startMs: number, endMs: number, asOfMs: number): WindowStats => {
    const key = `${startMs}:${endMs}:${asOfMs}`;
    const hit = winCache.get(key);
    if (hit) return hit;
    let missing = false;
    let volume = 0;
    let last: BtcCandle | null = null;
    const first = idx.get(startMs) ?? null;
    for (let t = startMs; t < endMs && t < asOfMs; t += STEP_MS) {
      const c = idx.get(t);
      if (!c) { missing = true; continue; }
      volume += c.volume || 0;
      last = c;
    }
    const closed = asOfMs >= endMs;
    const movePct = first && last && first.open > 0 ? ((last.close - first.open) / first.open) * 100 : null;
    const out: WindowStats = { movePct, complete: closed && !missing && movePct !== null, missing: closed && missing, volume };
    winCache.set(key, out);
    return out;
  };

  const dayWindows = (dayStart: number, asOfMs: number) => ({
    london: windowStats(dayStart + cfg.london.start * MINUTE_MS, dayStart + cfg.london.end * MINUTE_MS, asOfMs),
    us: windowStats(dayStart + cfg.us.start * MINUTE_MS, dayStart + cfg.us.end * MINUTE_MS, asOfMs),
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
      const w = dayWindows(dayStart - k * DAY_MS, nowMs);
      if (w.london.complete && w.us.complete) vols.push(w.london.volume + w.us.volume);
    }
    if (vols.length < MIN_BASELINE_DAYS) return null;
    vols.sort((a, b) => a - b);
    const mid = Math.floor(vols.length / 2);
    return vols.length % 2 ? vols[mid] : (vols[mid - 1] + vols[mid]) / 2;
  };

  const isLowVolume = (dayStart: number, asOfMs: number): boolean => {
    if (cfg.lowVolumeRatio <= 0) return false;
    const w = dayWindows(dayStart, asOfMs);
    if (!w.london.complete || !w.us.complete) return false;
    const base = volumeBaseline(dayStart);
    return base !== null && base > 0 && w.london.volume + w.us.volume < base * cfg.lowVolumeRatio;
  };

  const isDead = (tod: number) => (tod >= cfg.dead.start && tod < cfg.dead.end) || tod >= cfg.dead.lateStart;

  function classifyDeadOrNoData(
    base: Omit<SignalDayInfo, 'state' | 'dayClass' | 'dayMovePct' | 'tendency'>,
    T: number,
  ): SignalDayInfo {
    const mv = dayMovePct(base.dayStart, T);
    if (mv === null) return { ...base, state: 'NO_DATA', dayClass: null, dayMovePct: null, tendency: null };
    return {
      ...base,
      state: 'FINAL',
      dayClass: Math.abs(mv) >= cfg.thresholdPct - EPS ? 'POWER' : 'NEUTRAL',
      dayMovePct: mv,
      tendency: null,
    };
  }

  /**
   * Locked mode (historical / end-of-day knowledge):
   * windows are measured against global nowMs so past days become FINAL with full London+US.
   */
  function classifyLocked(signalMs: number): SignalDayInfo {
    const T = roundToSecond(signalMs);

// مبدأ قدرت روز / حرکت روز = 03:30 تهران
const dayStart = cryptoDayStart(T);

// ساعت روی دیوار تهران برای لندن/آمریکا/مرده (00:00 تقویم تهران)
const calDayStart = tehranDayStart(T);
const tod = (T - calDayStart) / MINUTE_MS; // همان 0..1440 قبلی
    const dead = isDead(tod);
    const w = dayWindows(dayStart, nowMs);
    const base = {
      dayKey: tehranDayKey(T), dayStart, deadHours: dead,
      lowVolume: isLowVolume(dayStart, nowMs),
      londonPct: w.london.movePct, usPct: w.us.movePct,
    };

    if (dead) return classifyDeadOrNoData(base, T);

    if (w.london.complete && w.us.complete) {
      return { ...base, state: 'FINAL', dayClass: classifyWindows(w.london.movePct, w.us.movePct, cfg.thresholdPct), dayMovePct: null, tendency: null };
    }
    if (w.london.missing || w.us.missing) return { ...base, state: 'NO_DATA', dayClass: null, dayMovePct: null, tendency: null };

    const mv = dayMovePct(dayStart, nowMs);
    return { ...base, state: 'PENDING', dayClass: null, dayMovePct: mv, tendency: tendencyOf(mv, cfg.thresholdPct) };
  }

  /**
   * Executable mode (only info known at signal time T):
   * - dead hours: same as locked
   * - both key windows already closed by T: full classifyWindows
   * - only some windows closed by T: classifyWindows on completed ones only (incomplete = null)
   * - none closed yet: day-move 00:00→T → POWER / NEUTRAL
   * Never PENDING: a live trader must pick a side at T.
   */
  function classifyExecutable(signalMs: number): SignalDayInfo {
    const T = roundToSecond(signalMs);
    const asOf = Math.min(T, nowMs);
    const dayStart = tehranDayStart(T);
    const tod = (T - dayStart) / MINUTE_MS;
    const dead = isDead(tod);
    const w = dayWindows(dayStart, asOf);
    const base = {
      dayKey: tehranDayKey(T), dayStart, deadHours: dead,
      lowVolume: isLowVolume(dayStart, asOf),
      londonPct: w.london.movePct, usPct: w.us.movePct,
    };

    if (dead) return classifyDeadOrNoData(base, T);

    // Completed windows only — do not feed partial in-progress window moves as if they were final.
    const londonDone = w.london.complete ? w.london.movePct : null;
    const usDone = w.us.complete ? w.us.movePct : null;

    if (w.london.complete && w.us.complete) {
      if (w.london.missing || w.us.missing) return { ...base, state: 'NO_DATA', dayClass: null, dayMovePct: null, tendency: null };
      return {
        ...base,
        state: 'FINAL',
        dayClass: classifyWindows(londonDone, usDone, cfg.thresholdPct),
        dayMovePct: null,
        tendency: null,
      };
    }

    if (w.london.complete || w.us.complete) {
      // One window finished before the signal; the other has not — class from the finished one only.
      if ((w.london.complete && w.london.missing) || (w.us.complete && w.us.missing)) {
        return { ...base, state: 'NO_DATA', dayClass: null, dayMovePct: null, tendency: null };
      }
      return {
        ...base,
        state: 'FINAL',
        dayClass: classifyWindows(londonDone, usDone, cfg.thresholdPct),
        dayMovePct: dayMovePct(dayStart, T),
        tendency: null,
      };
    }

    // Neither key window closed yet at T → same geometry as dead-hours (00:00 → T).
    return classifyDeadOrNoData(base, T);
  }

  function classify(signalMs: number, mode: ClassifyMode = 'locked'): SignalDayInfo {
    return mode === 'executable' ? classifyExecutable(signalMs) : classifyLocked(signalMs);
  }

  function live(): LiveStatus {
    // Live recommendation for a trader acting *now* = executable classification at now.
    const infoExec = classifyExecutable(nowMs);
    const infoLocked = classifyLocked(nowMs);
    const w = dayWindows(infoLocked.dayStart, nowMs);
    let price: number | null = null;
    for (let t = Math.floor(nowMs / STEP_MS) * STEP_MS, i = 0; i < 6; i++, t -= STEP_MS) {
      const c = idx.get(t);
      if (c) { price = c.close; break; }
    }

    let pick: LiveStatus['pick'] = 'WAIT';
    let approximate = false;

    if (infoExec.state === 'FINAL' && infoExec.dayClass) {
      pick = cfg.selection[infoExec.dayClass];
      // Still show approximate hint while locked mode would still be pending (day not fully closed).
      approximate = infoLocked.state === 'PENDING';
    } else if (infoLocked.state === 'PENDING' && infoLocked.tendency) {
      // Fallback if executable had no data
      approximate = true;
      pick = infoLocked.tendency === 'FLAT' ? cfg.selection.NEUTRAL : cfg.selection.POWER;
    }

    // Card shows locked windows progress + executable pick.
    return {
      nowMs,
      info: infoLocked.state === 'PENDING' ? infoLocked : infoExec,
      price,
      londonComplete: w.london.complete,
      usComplete: w.us.complete,
      pick,
      approximate,
    };
  }

  return { classify, classifyLocked, classifyExecutable, live, candleCount: idx.size };
}

export type DayAnalyzer = ReturnType<typeof createDayAnalyzer>;
