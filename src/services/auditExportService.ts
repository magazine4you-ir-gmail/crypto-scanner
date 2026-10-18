import { supabase } from './supabaseClient';
import { fetchKlines } from './marketData';
import type { Timeframe } from '@/types/market';
import {
  TRADE_COST_PCT,
  EXPIRY_BARS,
  DEFAULT_RISK_CONFIG,
  DEFAULT_THRESHOLDS,
  DEFAULT_WEIGHTS,
  timeframeMs,
} from '@engine';

/**
 * Signal audit export.
 *
 * Builds ONE json file with (a) every row of `signal_outcomes` (cancelled ones too) and (b) the closed
 * candles around each signal, so the whole signal -> paper trade chain can be re-verified offline
 * with `npm run audit -- <file>` without needing a database backup.
 *
 * Runs in the browser with the signed-in user's session (RLS already lets authenticated users read
 * signal_outcomes); candles come through the same cached `market-data` proxy the charts use.
 */

/** The server scans with 300 candles; the audit needs the same window to reproduce the signal. */
const ENGINE_WINDOW = 300;
const PAGE = 1000;
const FETCH_LIMIT = 1000; // Binance maximum per request
const CONCURRENCY = 4;

export interface AuditExport {
  format: 'signal-audit/v1';
  exportedAt: string;
  app: {
    tradeCostPct: number;
    expiryBars: Record<string, number>;
    engineWindow: number;
    riskConfig: typeof DEFAULT_RISK_CONFIG;
    thresholds: typeof DEFAULT_THRESHOLDS;
    weights: typeof DEFAULT_WEIGHTS;
  };
  outcomes: Record<string, unknown>[];
  /** key "SYMBOL|tf" -> rows [openTime, open, high, low, close, volume, closeTime] */
  candles: Record<string, { complete: boolean; rows: number[][] }>;
  warnings: string[];
}

export interface AuditProgress {
  phase: 'outcomes' | 'candles' | 'done';
  done: number;
  total: number;
}

async function fetchAllOutcomes(): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('signal_outcomes')
      .select('*')
      .order('signal_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    all.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export async function buildAuditExport(onProgress?: (p: AuditProgress) => void): Promise<AuditExport> {
  onProgress?.({ phase: 'outcomes', done: 0, total: 1 });
  const outcomes = await fetchAllOutcomes();
  onProgress?.({ phase: 'outcomes', done: 1, total: 1 });

  // pair -> earliest signal candle close we must be able to reproduce
  const needFrom = new Map<string, number>();
  for (const o of outcomes) {
    const key = `${o.symbol}|${o.timeframe}`;
    const t = Date.parse(String(o.candle_close_time ?? o.signal_at));
    if (Number.isFinite(t)) needFrom.set(key, Math.min(needFrom.get(key) ?? Infinity, t));
  }

  const keys = [...needFrom.keys()];
  const candles: AuditExport['candles'] = {};
  const warnings: string[] = [];
  const now = Date.now();
  let done = 0;
  onProgress?.({ phase: 'candles', done, total: keys.length });

  let next = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, keys.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= keys.length) return;
      const key = keys[i];
      const [symbol, tf] = key.split('|');
      try {
        const raw = await withRetry(() => fetchKlines(symbol, tf as Timeframe, FETCH_LIMIT));
        const closed = raw.filter((c) => c.closeTime < now);
        const wanted = needFrom.get(key)! - ENGINE_WINDOW * timeframeMs(tf);
        const complete = closed.length > 0 && closed[0].openTime <= wanted;
        if (!complete) warnings.push(`${key}: history does not reach back far enough (signals older than ~${FETCH_LIMIT - ENGINE_WINDOW} candles)`);
        candles[key] = {
          complete,
          rows: closed
            .filter((c) => c.openTime >= wanted)
            .map((c) => [c.openTime, c.open, c.high, c.low, c.close, c.volume, c.closeTime]),
        };
      } catch (e) {
        warnings.push(`${key}: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        done++;
        onProgress?.({ phase: 'candles', done, total: keys.length });
      }
    }
  });
  await Promise.all(workers);

  onProgress?.({ phase: 'done', done: keys.length, total: keys.length });
  return {
    format: 'signal-audit/v1',
    exportedAt: new Date().toISOString(),
    app: {
      tradeCostPct: TRADE_COST_PCT,
      expiryBars: EXPIRY_BARS,
      engineWindow: ENGINE_WINDOW,
      riskConfig: DEFAULT_RISK_CONFIG,
      thresholds: DEFAULT_THRESHOLDS,
      weights: DEFAULT_WEIGHTS,
    },
    outcomes,
    candles,
    warnings,
  };
}

export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
