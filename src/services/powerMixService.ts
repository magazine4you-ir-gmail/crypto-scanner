import { supabase } from './supabaseClient';
import { fetchKlinesRange } from './marketData';
import type { SignalOutcome } from './outcomeService';
import type { ReverseOutcome } from './reverseOutcomeService';
import { configFromRow, DEFAULT_POWER_MIX_CONFIG, type PowerMixConfig } from '@/powerMix/config';
import { STEP_MS, type BtcCandle } from '@/powerMix/dayPower';
import { DAY_MS, tehranDayStart } from '@/powerMix/tehranTime';
import type { MixPair } from '@/powerMix/mix';
import type { PlusBacktest } from './reversePlusService';
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

/** Newest first. A pair needs a readable, non-cancelled original; anything else cannot be scored and is skipped. */
export async function fetchMixPairs(maxRows = MAX_MIX_ROWS): Promise<MixPairsResult> {
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
 * Central Reverse Plus backtests (the "optimised" reverse result) of many signals, read-only.
 * Missing rows are normal (not evaluated yet) — those signals fall back to their Reverse Lab result.
 */
export async function fetchBacktestsForIds(ids: string[]): Promise<Map<string, PlusBacktest>> {
  const out = new Map<string, PlusBacktest>();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
  for (let i = 0; i < chunks.length; i += 4) {
    const res = await Promise.all(chunks.slice(i, i + 4).map((chunk) =>
      supabase.from('reverse_plus_backtests').select('*').in('reverse_outcome_id', chunk)));
    for (const { data, error } of res) {
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as PlusBacktest[]) {
        const prev = out.get(row.reverse_outcome_id);
        // one row per signal: prefer the current engine version if several exist
        if (!prev || (row.engine_version === BACKTEST_ENGINE_VERSION && prev.engine_version !== BACKTEST_ENGINE_VERSION)) out.set(row.reverse_outcome_id, row);
      }
    }
  }
  return out;
}

export async function fetchPowerMixConfig(): Promise<PowerMixConfig> {
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

/** BTCUSDT 30m candles for [fromMs, toMs], fetched in aligned chunks (so repeated calls hit the gateway cache). */
export async function fetchBtcCandles(fromMs: number, toMs: number): Promise<BtcCandle[]> {
  const span = CANDLES_PER_CALL * STEP_MS;
  const first = Math.floor(fromMs / span) * span;
  const starts: number[] = [];
  for (let s = first; s <= toMs; s += span) starts.push(s);

  const map = new Map<number, BtcCandle>();
  let lastError: unknown = null;
  let ok = 0;
  for (let i = 0; i < starts.length; i += 3) {
    const batch = starts.slice(i, i + 3);
    const res = await Promise.allSettled(batch.map((s) => fetchKlinesRange('BTCUSDT', '30m', s, Math.min(s + span - 1, toMs), CANDLES_PER_CALL)));
    for (const r of res) {
      if (r.status === 'fulfilled') { ok++; for (const c of r.value) map.set(c.openTime, toBtc(c)); } else lastError = r.reason;
    }
  }
  if (ok === 0 && lastError) throw lastError instanceof Error ? lastError : new Error(String(lastError));
  return [...map.values()].sort((a, b) => a.openTime - b.openTime);
}

/** Candle range the page needs: from the oldest signal's day (minus the volume baseline) to now. */
export function candleRangeFor(oldestSignalMs: number | null, nowMs: number): { from: number; to: number } {
  const floor = nowMs - MAX_LOOKBACK_DAYS * DAY_MS;
  const wanted = (oldestSignalMs ?? nowMs) - BASELINE_DAYS * DAY_MS;
  return { from: tehranDayStart(Math.max(wanted, floor)), to: nowMs };
}
