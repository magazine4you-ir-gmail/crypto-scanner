// Reverse Signal Plus — evaluator work policy. PURE functions (no I/O), shared by the Edge Function and the tests.
//
// They only decide WHETHER / IN WHICH ORDER the evaluator does work. They never compute an evaluation, an entry,
// a stop, a target, a backtest or a paper trade, so they cannot change any result.

/** The stored LIVE row, reduced to what the skip decision needs (read with a 3-column SELECT). */
export interface LiveRowState {
  /** ms of `as_of_close_time` (close time of the last closed candle the row was computed from) */
  asOfMs: number;
  /** ms of `updated_at` (last time the row was written) */
  updatedMs: number;
}

export interface LiveSkipInput {
  live: LiveRowState | undefined;
  /** evaluator clock, ms (the same `now` the candle filter `closeTime < now` uses) */
  nowMs: number;
  /** timeframe length, ms */
  tfMs: number;
  /** ms of reverse_plus_public_config.updated_at, or null when unknown -> never skip */
  cfgUpdatedMs: number | null;
  /** rewrite at least this often even if nothing is known to have changed; 0 = never skip (legacy behaviour) */
  forceRefreshMs: number;
}

/**
 * True only when rewriting the LIVE row would store exactly what it already holds:
 *  - the row exists;
 *  - the central configuration has not been edited since the row was written (the row was computed with it);
 *  - no NEWER candle can have closed: the next candle of this timeframe closes at asOf + tfMs and the engine only
 *    uses candles with closeTime < now (engine.closedCandles), so while asOf + tfMs >= now the input candles are
 *    identical and `analyse()` is deterministic;
 *  - the safety refresh window has not elapsed (bounds the effect of exchange contract-filter changes).
 * Anything uncertain returns false, i.e. the row is rewritten exactly as before.
 */
export function isLiveRowCurrent(i: LiveSkipInput): boolean {
  const l = i.live;
  if (!l || i.forceRefreshMs <= 0 || i.cfgUpdatedMs === null) return false;
  if (![l.asOfMs, l.updatedMs, i.nowMs, i.tfMs].every(Number.isFinite) || i.tfMs <= 0) return false;
  if (l.updatedMs < i.cfgUpdatedMs) return false;
  if (l.asOfMs + i.tfMs < i.nowMs) return false;
  if (i.nowMs - l.updatedMs >= i.forceRefreshMs) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// work ordering (so that old signals are not starved when the time budget is exhausted)
// ---------------------------------------------------------------------------------------------
export interface WorkFlags {
  needFirst: boolean;
  needSim: boolean;
  needPaper: boolean;
  needLive: boolean;
  needBt: boolean;
}

export interface WorkItem<T> {
  item: T;
  /** stable identity (the reverse signal id) — used only to derive the per-run order of the backlog */
  id: string;
  flags: WorkFlags;
  /** ms of signal_at (newest = largest) */
  signalMs: number;
  /** ms of the stored LIVE as_of (0 when there is none) */
  liveAsOfMs: number;
}

/** 0 = most urgent. A new signal must never wait behind maintenance work. */
export function priorityOf(f: WorkFlags): number {
  if (f.needFirst) return 0; // new signal: its SIGNAL_TIME snapshot (+ first LIVE) — detection speed
  if (f.needSim) return 1; // open paper trade: close it on time
  if (f.needPaper) return 2; // missing paper trade of an evaluated, non-historical signal
  if (f.needLive) return 3; // LIVE refresh
  return 4; // historical backtest backlog
}

/** FNV-1a 32-bit + avalanche — deterministic, no randomness (reproducible in tests and in logs). */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // murmur3 finalizer (avalanche): without it ids that differ only in the trailing run number give correlated orders
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Orders the work of one run.
 *  prio 0/1/2: newest signal first (same as before).
 *  prio 3    : the STALEST LIVE row first, so every row is eventually served even if a run ends on the budget.
 *  prio 4    : the historical backtest backlog, in an order that is different on every run (a deterministic hash of
 *              signal id + run slot). With newest-first the same head of the backlog was retried forever whenever
 *              the time budget ran out (and "not enough candles yet" signals kept blocking it); with a per-run order
 *              every signal has a fair chance each run, so nothing is starved permanently.
 */
export function orderWork<T>(items: WorkItem<T>[], slot: number): WorkItem<T>[] {
  const buckets: WorkItem<T>[][] = [[], [], [], [], []];
  for (const w of items) buckets[priorityOf(w.flags)].push(w);
  const byNewest = (a: WorkItem<T>, b: WorkItem<T>) => b.signalMs - a.signalMs;
  buckets[0].sort(byNewest);
  buckets[1].sort(byNewest);
  buckets[2].sort(byNewest);
  buckets[3].sort((a, b) => a.liveAsOfMs - b.liveAsOfMs || byNewest(a, b));
  buckets[4].sort((a, b) => fnv1a(`${a.id}|${slot}`) - fnv1a(`${b.id}|${slot}`));
  return buckets.flat();
}

// ---------------------------------------------------------------------------------------------
// small utilities
// ---------------------------------------------------------------------------------------------
export function envFlag(raw: string | undefined | null, fallback: boolean): boolean {
  if (raw === undefined || raw === null || raw.trim() === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

export function envNumber(raw: string | undefined | null, fallback: number): number {
  if (raw === undefined || raw === null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** The hourly full reconciliation slot: exactly one 5-minute bucket per hour, whatever the cron alignment. */
export function isFullReconcileSlot(nowMs: number, intervalMs = 300_000, perHour = 12): boolean {
  return Math.floor(nowMs / intervalMs) % perHour === 0;
}

/** Run number used to rotate backlogs (changes every `intervalMs`). */
export function runSlot(nowMs: number, intervalMs = 300_000): number {
  return Math.floor(nowMs / intervalMs);
}
