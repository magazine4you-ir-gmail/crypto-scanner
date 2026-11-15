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
// THE DAY: one trading day = one crypto day = 03:30 Tehran -> 03:30 Tehran (00:00 UTC -> 00:00 UTC). The statistics reset at 03:30 Tehran.
//   * London / US windows and dead hours are Tehran wall-clock minutes of the Tehran date on which that crypto day opened.
//     A signal at 01:00 Tehran therefore belongs to the PREVIOUS crypto day (minutes = 25:00) and is a late / dead-hours signal.
//   * "move since day start" is measured from the crypto-day open (03:30 Tehran).
//
// Two classification modes for a signal at time T:
//   * locked      — waits until the US window is closed (relative to "now"), then uses the full calendar windows.
//   * executable  — uses ONLY information available at T. Never waits for the future.
import {
  DAY_MS, MINUTE_MS, roundToSecond,
  cryptoDayStart, cryptoDayKey, cryptoCalendarStart,
} from './tehranTime';
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
  /** UTC ms of crypto-day open (00:00 UTC / 03:30 Tehran) */
  dayStart: number;
  state: DayState;
  /** null while PENDING / NO_DATA */
  dayClass: DayClass | null;
  deadHours: boolean;
  lowVolume: boolean;
  /** net BTC move of the London / US window in %, null when the window has no data yet */
  londonPct: number | null;
  usPct: number | null;
  /** move from crypto-day open (03:30 Tehran) to signal/now, when relevant */
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
  /** true when the pick can still change before the US window locks (locked mode still pending) */
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

  /** Window stats as of `asOfMs`. */
  const windowStats = (startMs: number, endMs: number, asOfMs: number): WindowStats => {
    const key = `${startMs}:${endMs}:${asOfMs}`;
    const hit = winCache.get(key);
    if (hit) return hit;
    let missing = false;
    let volume = 0;
    let last: BtcCandle | null = null;
    const first = idx.get(startMs) ?? null;
    for (let t = startMs; t < endMs && t < asOfMs; t += STEP_MS) {
      // a candle still forming at a PAST moment carries its future close -> never use it. (At "now" the forming candle is the live price.)
      if (t + STEP_MS > asOfMs && asOfMs < nowMs) break;
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

  /**
   * London / US windows are Tehran WALL CLOCK times in config (minutes since 00:00 Tehran).
   * `calDayStart` must be cryptoCalendarStart(...): 00:00 Tehran of the date on which the signal's crypto day opened.
   */
  const dayWindows = (calDayStart: number, asOfMs: number) => ({
    london: windowStats(calDayStart + cfg.london.start * MINUTE_MS, calDayStart + cfg.london.end * MINUTE_MS, asOfMs),
    us: windowStats(calDayStart + cfg.us.start * MINUTE_MS, calDayStart + cfg.us.end * MINUTE_MS, asOfMs),
  });

  /**
   * Last price KNOWN at moment `ms`: the close of the last 30m candle that had already CLOSED by `ms`.
   * (Using the candle that contains `ms` would leak up to 30 minutes of the future into the class.)
   * Exception: at "now" the forming candle is the live price. `anchorStart` limits how far back we search.
   */
  const priceAt = (anchorStart: number, ms: number): number | null => {
    const at = Math.min(ms, nowMs);
    const base = Math.floor(at / STEP_MS) * STEP_MS;
    let t = at >= nowMs ? base : base - STEP_MS;
    for (let i = 0; i < 12 && t >= anchorStart; i++, t -= STEP_MS) {
      const c = idx.get(t);
      if (c) return c.close;
    }
    return null;
  };

  /** Net move from the crypto-day open (03:30 Tehran / 00:00 UTC) to `ms`. In the first 30 minutes of the day nothing has closed yet -> 0. */
  const dayMovePct = (cryptoStart: number, ms: number): number | null => {
    const open = idx.get(cryptoStart)?.open;
    if (!open || !(open > 0)) return null;
    const p = priceAt(cryptoStart, ms);
    if (p !== null) return ((p - open) / open) * 100;
    return ms - cryptoStart < STEP_MS ? 0 : null;
  };

  const volumeBaseline = (calDayStart: number): number | null => {
    const vols: number[] = [];
    for (let k = 1; k <= BASELINE_DAYS; k++) {
      const w = dayWindows(calDayStart - k * DAY_MS, nowMs);
      if (w.london.complete && w.us.complete) vols.push(w.london.volume + w.us.volume);
    }
    if (vols.length < MIN_BASELINE_DAYS) return null;
    vols.sort((a, b) => a - b);
    const mid = Math.floor(vols.length / 2);
    return vols.length % 2 ? vols[mid] : (vols[mid - 1] + vols[mid]) / 2;
  };

  const isLowVolume = (calDayStart: number, asOfMs: number): boolean => {
    if (cfg.lowVolumeRatio <= 0) return false;
    const w = dayWindows(calDayStart, asOfMs);
    if (!w.london.complete || !w.us.complete) return false;
    const base = volumeBaseline(calDayStart);
    return base !== null && base > 0 && w.london.volume + w.us.volume < base * cfg.lowVolumeRatio;
  };

  /**
   * `tod` = Tehran wall-clock minutes counted from 00:00 of the date the crypto day opened: 210 (03:30) ... 1650 (27:30).
   * Everything from 24:00 to 27:30 (00:00-03:30 Tehran) is the tail of the previous day and is always >= lateStart -> dead.
   */
  const isDead = (tod: number) => (tod >= cfg.dead.start && tod < cfg.dead.end) || tod >= cfg.dead.lateStart;

  function classifyDeadOrNoData(
    base: Omit<SignalDayInfo, 'state' | 'dayClass' | 'dayMovePct' | 'tendency'>,
    cryptoStart: number,
    T: number,
  ): SignalDayInfo {
    const mv = dayMovePct(cryptoStart, T);
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
   * Locked mode: windows measured against global nowMs so past days become FINAL with full London+US.
   * Day power / day-move open = crypto day (03:30 Tehran).
   */
  function classifyLocked(signalMs: number): SignalDayInfo {
    const T = roundToSecond(signalMs);
    const cryptoStart = cryptoDayStart(T);
    const calDayStart = cryptoCalendarStart(T);
    const tod = (T - calDayStart) / MINUTE_MS;
    const dead = isDead(tod);
    const w = dayWindows(calDayStart, nowMs);
    const base = {
      dayKey: cryptoDayKey(T),
      dayStart: cryptoStart,
      deadHours: dead,
      lowVolume: isLowVolume(calDayStart, nowMs),
      londonPct: w.london.movePct,
      usPct: w.us.movePct,
    };

    if (dead) return classifyDeadOrNoData(base, cryptoStart, T);

    if (w.london.complete && w.us.complete) {
      return {
        ...base,
        state: 'FINAL',
        dayClass: classifyWindows(w.london.movePct, w.us.movePct, cfg.thresholdPct),
        dayMovePct: dayMovePct(cryptoStart, T),
        tendency: null,
      };
    }
    if (w.london.missing || w.us.missing) {
      return { ...base, state: 'NO_DATA', dayClass: null, dayMovePct: null, tendency: null };
    }

    const mv = dayMovePct(cryptoStart, nowMs);
    return {
      ...base,
      state: 'PENDING',
      dayClass: null,
      dayMovePct: mv,
      tendency: tendencyOf(mv, cfg.thresholdPct),
    };
  }

  /**
   * Executable mode: only info known at signal time T.
   * - dead hours → move from crypto open to T
   * - both windows closed by T → full classifyWindows
   * - only some windows closed by T → classifyWindows on completed ones only
   * - none closed yet → move crypto open → T → POWER / NEUTRAL
   * Never PENDING when price data exists.
   */
  function classifyExecutable(signalMs: number): SignalDayInfo {
    const T = roundToSecond(signalMs);
    const asOf = Math.min(T, nowMs);
    const cryptoStart = cryptoDayStart(T);
    const calDayStart = cryptoCalendarStart(T);
    const tod = (T - calDayStart) / MINUTE_MS;
    const dead = isDead(tod);
    const w = dayWindows(calDayStart, asOf);
    const base = {
      dayKey: cryptoDayKey(T),
      dayStart: cryptoStart,
      deadHours: dead,
      lowVolume: isLowVolume(calDayStart, asOf),
      londonPct: w.london.movePct,
      usPct: w.us.movePct,
    };

    if (dead) return classifyDeadOrNoData(base, cryptoStart, T);

    // a window that is already closed at T but has a gap in its candles can never be guessed -> NO_DATA (same rule as locked mode)
    if (w.london.missing || w.us.missing) {
      return { ...base, state: 'NO_DATA', dayClass: null, dayMovePct: null, tendency: null };
    }

    const londonDone = w.london.complete ? w.london.movePct : null;
    const usDone = w.us.complete ? w.us.movePct : null;

    // at least one window is closed at T: classify with what is closed (US still open / not started -> only London counts)
    if (w.london.complete || w.us.complete) {
      return {
        ...base,
        state: 'FINAL',
        dayClass: classifyWindows(londonDone, usDone, cfg.thresholdPct),
        dayMovePct: dayMovePct(cryptoStart, T),
        tendency: null,
      };
    }

    // no window closed yet: only the move since the crypto-day open is known
    return classifyDeadOrNoData(base, cryptoStart, T);
  }

  function classify(signalMs: number, mode: ClassifyMode = 'locked'): SignalDayInfo {
    return mode === 'executable' ? classifyExecutable(signalMs) : classifyLocked(signalMs);
  }

  function live(): LiveStatus {
    const infoExec = classifyExecutable(nowMs);
    const infoLocked = classifyLocked(nowMs);
    const calDayStart = cryptoCalendarStart(nowMs);
    const w = dayWindows(calDayStart, nowMs);

    let price: number | null = null;
    for (let t = Math.floor(nowMs / STEP_MS) * STEP_MS, i = 0; i < 6; i++, t -= STEP_MS) {
      const c = idx.get(t);
      if (c) { price = c.close; break; }
    }

    let pick: LiveStatus['pick'] = 'WAIT';
    let approximate = false;

    if (infoExec.state === 'FINAL' && infoExec.dayClass) {
      pick = cfg.selection[infoExec.dayClass];
      approximate = infoLocked.state === 'PENDING';
    } else if (infoLocked.state === 'PENDING' && infoLocked.tendency) {
      approximate = true;
      pick = infoLocked.tendency === 'FLAT' ? cfg.selection.NEUTRAL : cfg.selection.POWER;
    }

    // Card: show locked progress of windows while day is open; otherwise executable final info.
    const info = infoLocked.state === 'PENDING' ? infoLocked : infoExec;

    return {
      nowMs,
      info,
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
