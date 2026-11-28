import { supabase } from './supabaseClient';
import { cachedRequest } from './requestCache';
import { fetchKlines, fetchKlinesRange, isLiveEnd, LIVE_MAX_AGE_SECONDS } from './marketData';
import type { SignalOutcome } from './outcomeService';
import type { ReverseOutcome } from './reverseOutcomeService';
import { configFromRow, DEFAULT_POWER_MIX_CONFIG, type PowerMixConfig } from '@/powerMix/config';
import { STEP_MS, type BtcCandle } from '@/powerMix/dayPower';
import { DAY_MS, tehranDayStart } from '@/powerMix/tehranTime';
import type { MixPair } from '@/powerMix/mix';
import { BACKTEST_COLS, type PlusBacktest } from './reversePlusService';
import { BACKTEST_ENGINE_VERSION } from '../../supabase/functions/_shared/reversePlus/index';

/**
 * Power Mix client service — READ-ONLY. It writes nothing and creates no signals.
 *  - signals: `reverse_signal_outcomes` joined to its original in `signal_outcomes` (1:1), CANCELLED rows excluded, exactly like the Labs
 *  - BTC reference: BTCUSDT 30m candles through the existing `market-data` gateway (`fetchKlinesRange`)
 *  - config: the global defaults row `power_mix_config` (missing table / row -> built-in defaults)
 */

const PAGE = 500;
const CANDLES_PER_CALL = 1000;
const BASELINE_DAYS = 15; // volume baseline for the low-volume label
const MAX_LOOKBACK_DAYS = 200;

const SELECT = '*, origin:signal_outcomes!origin_outcome_id(*)';

/** Hard ceiling of the history the page loads (the page says so when it is reached instead of silently cutting the history). */
export const MAX_MIX_ROWS = 5000;

export interface MixPairsResult { pairs: MixPair[]; /** true when more signals exist than were loaded */ truncated: boolean }

/** The signal history changes when a scan closes a signal (hourly): reuse it across remounts / navigation for a minute. */
export const MIX_PAIRS_TTL_MS = 60_000;

/** Newest first. A pair needs a readable, non-cancelled original; anything else cannot be scored and is skipped. */
export async function fetchMixPairs(maxRows = MAX_MIX_ROWS, opts: { force?: boolean } = {}): Promise<MixPairsResult> {
  return cachedRequest(`mix:pairs:${maxRows}`, MIX_PAIRS_TTL_MS, () => fetchMixPairsUncached(maxRows), { force: opts.force });
}

async function fetchMixPairsUncached(maxRows: number): Promise<MixPairsResult> {
  const out: MixPair[] = [];
  let truncated = false;
  for (let from = 0; from < maxRows; from += PAGE) {
    const { data, error } = await supabase
      .from('reverse_signal_outcomes')
      .select(SELECT)
      .neq('status', 'CANCELLED')
      .order('signal_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, Math.min(from + PAGE, maxRows) - 1);
    if (error) throw new Error(error.message);
    for (const raw of data ?? []) {
      const { origin, ...rest } = raw as Record<string, unknown> & { origin: SignalOutcome | SignalOutcome[] | null };
      const original = Array.isArray(origin) ? (origin[0] ?? null) : origin;
      if (!original || original.status === 'CANCELLED') continue;
      const reverse = { ...rest, origin: { status: original.status, pnl_pct: original.pnl_pct, r_multiple: original.r_multiple } } as unknown as ReverseOutcome;
      out.push({ reverse, original });
    }
    if ((data?.length ?? 0) < PAGE) break;
    if (from + PAGE >= maxRows) truncated = true;
  }
  return { pairs: out, truncated };
}

/**
 * A backtest row of the CURRENT engine version is written once and never changes (the evaluator inserts it with
 * ignoreDuplicates), so once read it is kept for the whole session. A signal without a row is asked again only after
 * `BACKTEST_MISS_TTL_MS` (the evaluator may have produced it meanwhile). Rows of an older engine version are never
 * treated as final.
 */
export const BACKTEST_MISS_TTL_MS = 5 * 60_000;
const btFinal = new Map<string, PlusBacktest>();
const btMissAt = new Map<string, number>();
export function resetBacktestCache(): void { btFinal.clear(); btMissAt.clear(); }

/**
 * Central Reverse Plus backtests (the "optimised" reverse result) of many signals, read-only.
 * Missing rows are normal (not evaluated yet) — those signals fall back to their Reverse Lab result.
 */
export async function fetchBacktestsForIds(ids: string[], opts: { force?: boolean; now?: () => number } = {}): Promise<Map<string, PlusBacktest>> {
  const now = (opts.now ?? Date.now)();
  if (opts.force) { for (const id of ids) { btFinal.delete(id); btMissAt.delete(id); } }
  const out = new Map<string, PlusBacktest>();
  const need: string[] = [];
  for (const id of ids) {
    const hit = btFinal.get(id);
    if (hit) { out.set(id, hit); continue; }
    const missed = btMissAt.get(id);
    if (missed !== undefined && now - missed < BACKTEST_MISS_TTL_MS) continue;
    need.push(id);
  }
  const chunks: string[][] = [];
  for (let i = 0; i < need.length; i += 100) chunks.push(need.slice(i, i + 100));
  const found = new Set<string>();
  for (let i = 0; i < chunks.length; i += 4) {
    const res = await Promise.all(chunks.slice(i, i + 4).map((chunk) =>
      supabase.from('reverse_plus_backtests').select(BACKTEST_COLS).in('reverse_outcome_id', chunk)));
    for (const { data, error } of res) {
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as unknown as PlusBacktest[]) {
        const prev = out.get(row.reverse_outcome_id);
        // one row per signal: prefer the current engine version if several exist
        if (!prev || (row.engine_version === BACKTEST_ENGINE_VERSION && prev.engine_version !== BACKTEST_ENGINE_VERSION)) out.set(row.reverse_outcome_id, row);
        found.add(row.reverse_outcome_id);
      }
    }
  }
  for (const id of need) {
    const row = out.get(id);
    if (row && row.engine_version === BACKTEST_ENGINE_VERSION) btFinal.set(id, row);
    if (!found.has(id)) btMissAt.set(id, now);
  }
  return out;
}

export async function fetchPowerMixConfig(opts: { force?: boolean } = {}): Promise<PowerMixConfig> {
  return cachedRequest('mix:config', 5 * 60_000, fetchPowerMixConfigUncached, { force: opts.force });
}

async function fetchPowerMixConfigUncached(): Promise<PowerMixConfig> {
  try {
    const { data, error } = await supabase.from('power_mix_config').select('*').maybeSingle();
    if (error || !data) return DEFAULT_POWER_MIX_CONFIG; // not migrated yet / unreadable: the defaults keep the page working
    return configFromRow(data as Record<string, unknown>);
  } catch {
    return DEFAULT_POWER_MIX_CONFIG;
  }
}

function toBtc(c: { openTime: number; closeTime: number; open: number; high: number; low: number; close: number; volume: number }): BtcCandle {
  return { openTime: c.openTime, closeTime: c.closeTime, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
}

/** A chunk that lies completely in the past holds only closed candles: it can never change. */
export const BTC_SETTLED_TTL_MS = 30 * 60_000;
/** The chunk that contains "now" still moves: keep it for one polling step only (de-duplicates concurrent callers). */
export const BTC_TAIL_TTL_MS = 25_000;

/**
 * BTCUSDT 30m candles for [fromMs, toMs], fetched in aligned chunks. Chunks entirely in the past are kept in the browser
 * for the session (immutable closed candles), so reopening the page does not download months of candles again.
 */
export async function fetchBtcCandles(fromMs: number, toMs: number): Promise<BtcCandle[]> {
  const span = CANDLES_PER_CALL * STEP_MS;
  const first = Math.floor(fromMs / span) * span;
  const starts: number[] = [];
  for (let s = first; s <= toMs; s += span) starts.push(s);

  const map = new Map<number, BtcCandle>();
  let lastError: unknown = null;
  let ok = 0;
  // "to" is the present when the caller passes (about) Date.now(). Decided ONCE, before the first (possibly slow) batch,
  // so a slow earlier batch cannot turn the last chunk into an exact-timestamp request that no other caller can share.
  const toIsNow = isLiveEnd(toMs);
  for (let i = 0; i < starts.length; i += 3) {
    const batch = starts.slice(i, i + 3);
    const res = await Promise.allSettled(batch.map((s) => {
      const settled = s + span - 1 < toMs - STEP_MS;
      const end = Math.min(s + span - 1, toMs);
      // the chunk that ends at "now" is asked as a live window (same candles, shareable request); every other chunk keeps its exact end
      const endArg = toIsNow && end === toMs ? Date.now() : end;
      return cachedRequest(`mix:btc30m:${s}:${settled ? 'h' : 't'}`, settled ? BTC_SETTLED_TTL_MS : BTC_TAIL_TTL_MS,
        () => fetchKlinesRange('BTCUSDT', '30m', s, endArg, CANDLES_PER_CALL));
    }));
    for (const r of res) {
      if (r.status === 'fulfilled') { ok++; for (const c of r.value) map.set(c.openTime, toBtc(c)); } else lastError = r.reason;
    }
  }
  if (ok === 0 && lastError) throw lastError instanceof Error ? lastError : new Error(String(lastError));
  return [...map.values()].sort((a, b) => a.openTime - b.openTime);
}

/**
 * The latest BTCUSDT 30m candles for the 60 s live refresh: "the last 100 candles" (~2 days) is one small, stable request.
 * The old refresh asked for [now - 2 days, now] through the aligned-chunk path, i.e. up to ~1000 candles every minute.
 */
export async function fetchRecentBtcCandles(count = 100): Promise<BtcCandle[]> {
  const c = await fetchKlines('BTCUSDT', '30m', count, { maxAgeSeconds: LIVE_MAX_AGE_SECONDS });
  return c.map(toBtc).sort((a, b) => a.openTime - b.openTime);
}

/** Candle range the page needs: from the oldest signal's day (minus the volume baseline) to now. */
export function candleRangeFor(oldestSignalMs: number | null, nowMs: number): { from: number; to: number } {
  const floor = nowMs - MAX_LOOKBACK_DAYS * DAY_MS;
  const wanted = (oldestSignalMs ?? nowMs) - BASELINE_DAYS * DAY_MS;
  return { from: tehranDayStart(Math.max(wanted, floor)), to: nowMs };
}
