import { supabase } from './supabaseClient';
import type { SignalResult } from '@/types/signal';

export interface ManualScanRun {
  id: string;
  user_id: string;
  is_public: boolean;
  universe: number;
  timeframe: string;
  status: 'running' | 'ok' | 'partial' | 'failed';
  symbols_total: number;
  scanned: number;
  failed: number;
  buy_count: number;
  sell_count: number;
  wait_count: number;
  no_trade_count: number;
  settings_snapshot: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface ManualScanResultRow {
  id: string;
  run_id: string;
  symbol: string;
  base_asset: string;
  market_rank: number | null;
  signal_type: string;
  bias: string | null;
  score: number;
  regime: string | null;
  trend: string | null;
  structure: string | null;
  risk_level: string | null;
  price: number;
  entry_low: number | null;
  entry_high: number | null;
  stop_loss: number | null;
  target1: number | null;
  target2: number | null;
  target3: number | null;
  risk_reward: number | null;
  candle_close_time: string | null;
  payload: SignalResult | null;
  created_at: string;
}

export async function createManualScanRun(input: {
  universe: number;
  timeframe: string;
  symbolsTotal: number;
  isPublic?: boolean;
  settingsSnapshot?: Record<string, unknown>;
}): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Login required to save scan');

  const { data, error } = await supabase
    .from('manual_scan_runs')
    .insert({
      user_id: auth.user.id,
      universe: input.universe,
      timeframe: input.timeframe,
      symbols_total: input.symbolsTotal,
      is_public: input.isPublic ?? false,
      settings_snapshot: input.settingsSnapshot ?? null,
      status: 'running',
    })
    .select('id')
    .single();

  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function finishManualScanRun(
  runId: string,
  meta: {
    status: 'ok' | 'partial' | 'failed';
    scanned: number;
    failed: number;
    buy_count: number;
    sell_count: number;
    wait_count: number;
    no_trade_count: number;
    error?: string | null;
  },
): Promise<void> {
  const { error } = await supabase
    .from('manual_scan_runs')
    .update({
      ...meta,
      finished_at: new Date().toISOString(),
    })
    .eq('id', runId);
  if (error) throw new Error(error.message);
}

export async function insertManualScanResults(
  runId: string,
  rows: Array<{ result: SignalResult; rank: number }>,
): Promise<void> {
  if (rows.length === 0) return;

  const chunkSize = 100;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const slice = rows.slice(i, i + chunkSize);
    const payload = slice.map(({ result: r, rank }) => ({
      run_id: runId,
      symbol: r.symbol,
      base_asset: r.symbol.replace(/USDT$/i, ''),
      market_rank: rank,
      signal_type: r.signalType,
      bias: r.bias,
      score: r.score,
      regime: r.regime,
      trend: r.trend,
      structure: r.structure,
      risk_level: r.riskLevel,
      price: r.priceAtSignal,
      entry_low: r.risk?.entryLow ?? null,
      entry_high: r.risk?.entryHigh ?? null,
      stop_loss: r.risk?.stopLoss ?? null,
      target1: r.risk?.target1 ?? null,
      target2: r.risk?.target2 ?? null,
      target3: r.risk?.target3 ?? null,
      risk_reward: r.risk?.riskReward ?? null,
      candle_close_time: r.candleCloseTime
        ? new Date(r.candleCloseTime).toISOString()
        : null,
      payload: r,
    }));

    const { error } = await supabase.from('manual_scan_results').insert(payload);
    if (error) throw new Error(error.message);
  }
}

/** My runs + public runs from others */
export async function listManualScanRuns(limit = 30): Promise<ManualScanRun[]> {
  const { data, error } = await supabase
    .from('manual_scan_runs')
    .select('*')
    .in('status', ['ok', 'partial'])
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as ManualScanRun[];
}

export async function fetchManualScanResults(runId: string): Promise<ManualScanResultRow[]> {
  const { data, error } = await supabase
    .from('manual_scan_results')
    .select('*')
    .eq('run_id', runId)
    .order('score', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ManualScanResultRow[];
}

export async function fetchManualScanRun(runId: string): Promise<ManualScanRun | null> {
  const { data, error } = await supabase
    .from('manual_scan_runs')
    .select('*')
    .eq('id', runId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ManualScanRun) ?? null;
}

// ---------- local fallback (no login / offline) ----------

const LS_KEY = 'manual_scan_last_v1';

export function saveLastScanLocal(data: {
  universe: number;
  timeframe: string;
  results: Array<{ result: SignalResult; rank: number }>;
  skipped: number;
  at: number;
}) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch {
    /* quota */
  }
}

export function loadLastScanLocal(): {
  universe: number;
  timeframe: string;
  results: Array<{ result: SignalResult; rank: number }>;
  skipped: number;
  at: number;
} | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
