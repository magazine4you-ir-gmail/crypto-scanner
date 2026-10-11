import { supabase } from './supabaseClient';

export type ScanSignalType = 'BUY' | 'SELL' | 'WAIT' | 'NO_TRADE';

export interface ScanResultRow {
  id: string;
  symbol: string;
  base_asset: string;
  market_rank: number | null;
  timeframe: string;
  signal_type: ScanSignalType;
  bias: 'LONG' | 'SHORT' | null;
  score: number;
  bull_score: number | null;
  bear_score: number | null;
  regime: string | null;
  trend: string | null;
  structure: string | null;
  risk_level: string | null;
  price: number;
  rsi: number | null;
  atr_pct: number | null;
  rel_volume: number | null;
  entry_low: number | null;
  entry_high: number | null;
  stop_loss: number | null;
  target1: number | null;
  target2: number | null;
  target3: number | null;
  risk_reward: number | null;
  shortable: boolean | null;
  candle_close_time: string | null;
  signal_since: string;
  scanned_at: string;
}

export interface ScanRunRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'ok' | 'partial' | 'failed';
  universe_source: string | null;
  timeframes: string[];
  timeframes_scanned: string[] | null;
  symbols_total: number;
  scanned: number;
  failed: number;
  buy_count: number;
  sell_count: number;
  wait_count: number;
  outcomes_opened: number | null;
  outcomes_closed: number | null;
  error: string | null;
}

export async function fetchScanResults(): Promise<ScanResultRow[]> {
  const { data, error } = await supabase
    .from('scan_results')
    .select('*')
    .order('signal_since', { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []) as ScanResultRow[];
}

/** Newest BUY/SELL signals (used by the dashboard). */
export async function fetchRecentActionable(limit = 10): Promise<ScanResultRow[]> {
  const { data, error } = await supabase
    .from('scan_results')
    .select('*')
    .in('signal_type', ['BUY', 'SELL'])
    .order('signal_since', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as ScanResultRow[];
}

export async function fetchLatestScanRun(): Promise<ScanRunRow | null> {
  const { data, error } = await supabase
    .from('scan_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ScanRunRow | null) ?? null;
}
