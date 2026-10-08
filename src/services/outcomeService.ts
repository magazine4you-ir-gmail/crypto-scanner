import { supabase } from './supabaseClient';
import { fetchKlines } from './marketData';
import type { Timeframe } from '@/types/market';

export type OutcomeStatus = 'OPEN' | 'WIN' | 'LOSS' | 'EXPIRED' | 'CANCELLED';
export type OutcomeSignalType = 'BUY' | 'SELL';

export interface SignalOutcome {
  id: string;
  symbol: string;
  base_asset: string;
  timeframe: string;
  signal_type: OutcomeSignalType;
  score: number;
  price_at_signal: number;
  entry_low: number | null;
  entry_high: number | null;
  stop_loss: number;
  target1: number;
  target2: number | null;
  risk_reward: number | null;
  signal_at: string;
  status: OutcomeStatus;
  exit_price: number | null;
  exit_at: string | null;
  pnl_pct: number | null;
  bars_held: number | null;
  source: string;
  notes: string | null;
}

const EXPIRY_BARS: Record<string, number> = {
  '15m': 96,
  '1h': 48,
  '4h': 30,
  '1d': 20,
  '1w': 12,
};

export async function fetchOutcomes(limit = 300): Promise<SignalOutcome[]> {
  const { data, error } = await supabase
    .from('signal_outcomes')
    .select('*')
    .order('signal_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as SignalOutcome[];
}

export async function fetchOpenOutcomes(): Promise<SignalOutcome[]> {
  const { data, error } = await supabase
    .from('signal_outcomes')
    .select('*')
    .eq('status', 'OPEN')
    .order('signal_at', { ascending: true })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as SignalOutcome[];
}

function computePnl(
  signalType: OutcomeSignalType,
  entry: number,
  exit: number,
): number {
  if (signalType === 'BUY') return ((exit - entry) / entry) * 100;
  return ((entry - exit) / entry) * 100;
}

/** Evaluate one OPEN outcome against recent candles. Returns patch or null if still open. */
export function evaluateAgainstCandles(
  outcome: SignalOutcome,
  candles: { high: number; low: number; close: number; closeTime: number }[],
): Partial<SignalOutcome> | null {
  const signalTs = new Date(outcome.signal_at).getTime();
  // only candles AFTER the signal
  const after = candles.filter((c) => c.closeTime > signalTs);
  if (after.length === 0) return null;

  const maxBars = EXPIRY_BARS[outcome.timeframe] ?? 40;
  const stop = Number(outcome.stop_loss);
  const target = Number(outcome.target1);
  const entry = Number(outcome.price_at_signal);
  const isBuy = outcome.signal_type === 'BUY';

  for (let i = 0; i < after.length; i++) {
    const c = after[i];
    const hitStop = isBuy ? c.low <= stop : c.high >= stop;
    const hitTarget = isBuy ? c.high >= target : c.low <= target;

    // conservative: stop first if both in same bar
    if (hitStop) {
      const exit = stop;
      return {
        status: 'LOSS',
        exit_price: exit,
        exit_at: new Date(c.closeTime).toISOString(),
        pnl_pct: computePnl(outcome.signal_type, entry, exit),
        bars_held: i + 1,
      };
    }
    if (hitTarget) {
      const exit = target;
      return {
        status: 'WIN',
        exit_price: exit,
        exit_at: new Date(c.closeTime).toISOString(),
        pnl_pct: computePnl(outcome.signal_type, entry, exit),
        bars_held: i + 1,
      };
    }

    if (i + 1 >= maxBars) {
      const exit = c.close;
      return {
        status: 'EXPIRED',
        exit_price: exit,
        exit_at: new Date(c.closeTime).toISOString(),
        pnl_pct: computePnl(outcome.signal_type, entry, exit),
        bars_held: i + 1,
        notes: 'time expiry',
      };
    }
  }

  return null;
}

/** Evaluate all OPEN outcomes and persist results. Returns number updated. */
export async function evaluateOpenOutcomes(
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const open = await fetchOpenOutcomes();
  if (open.length === 0) return 0;

  let updated = 0;
  for (let i = 0; i < open.length; i++) {
    const o = open[i];
    onProgress?.(i + 1, open.length);
    try {
      const tf = o.timeframe as Timeframe;
      const candles = await fetchKlines(o.symbol, tf, 200);
      const patch = evaluateAgainstCandles(o, candles);
      if (!patch) continue;

      const { error } = await supabase
        .from('signal_outcomes')
        .update({
          status: patch.status,
          exit_price: patch.exit_price,
          exit_at: patch.exit_at,
          pnl_pct: patch.pnl_pct,
          bars_held: patch.bars_held,
          notes: patch.notes ?? o.notes,
        })
        .eq('id', o.id)
        .eq('status', 'OPEN');

      if (!error) updated++;
    } catch {
      // skip individual failures (rate limit / missing symbol)
    }
    // light throttle to be kind to Binance
    await new Promise((r) => setTimeout(r, 120));
  }
  return updated;
}

export interface OutcomeStats {
  totalClosed: number;
  wins: number;
  losses: number;
  expired: number;
  open: number;
  winRate: number;
  avgPnl: number;
  totalPnl: number;
  profitFactor: number;
  expectancy: number;
  byTimeframe: Record<string, { wins: number; losses: number; winRate: number }>;
  byScoreBucket: Record<string, { wins: number; losses: number; winRate: number }>;
}

export function computeStats(rows: SignalOutcome[]): OutcomeStats {
  const open = rows.filter((r) => r.status === 'OPEN').length;
  const closed = rows.filter((r) => r.status === 'WIN' || r.status === 'LOSS' || r.status === 'EXPIRED');
  const wins = closed.filter((r) => r.status === 'WIN');
  const losses = closed.filter((r) => r.status === 'LOSS');
  const expired = closed.filter((r) => r.status === 'EXPIRED');

  const withPnl = closed.filter((r) => r.pnl_pct != null);
  const totalPnl = withPnl.reduce((s, r) => s + Number(r.pnl_pct), 0);
  const avgPnl = withPnl.length ? totalPnl / withPnl.length : 0;

  const grossWin = wins.reduce((s, r) => s + Math.max(0, Number(r.pnl_pct ?? 0)), 0);
  const grossLoss = Math.abs(losses.reduce((s, r) => s + Math.min(0, Number(r.pnl_pct ?? 0)), 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;

  const decided = wins.length + losses.length;
  const winRate = decided > 0 ? (wins.length / decided) * 100 : 0;
  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const expectancy = decided > 0 ? (winRate / 100) * avgWin - (1 - winRate / 100) * avgLoss : 0;

  const byTimeframe: OutcomeStats['byTimeframe'] = {};
  const byScoreBucket: OutcomeStats['byScoreBucket'] = {};

  const bucket = (score: number) => {
    if (score >= 80) return '80+';
    if (score >= 70) return '70-79';
    if (score >= 60) return '60-69';
    return '<60';
  };

  for (const r of [...wins, ...losses]) {
    const tf = r.timeframe;
    if (!byTimeframe[tf]) byTimeframe[tf] = { wins: 0, losses: 0, winRate: 0 };
    if (r.status === 'WIN') byTimeframe[tf].wins++;
    else byTimeframe[tf].losses++;

    const b = bucket(r.score);
    if (!byScoreBucket[b]) byScoreBucket[b] = { wins: 0, losses: 0, winRate: 0 };
    if (r.status === 'WIN') byScoreBucket[b].wins++;
    else byScoreBucket[b].losses++;
  }

  for (const k of Object.keys(byTimeframe)) {
    const x = byTimeframe[k];
    const d = x.wins + x.losses;
    x.winRate = d ? (x.wins / d) * 100 : 0;
  }
  for (const k of Object.keys(byScoreBucket)) {
    const x = byScoreBucket[k];
    const d = x.wins + x.losses;
    x.winRate = d ? (x.wins / d) * 100 : 0;
  }

  return {
    totalClosed: closed.length,
    wins: wins.length,
    losses: losses.length,
    expired: expired.length,
    open,
    winRate,
    avgPnl,
    totalPnl,
    profitFactor,
    expectancy,
    byTimeframe,
    byScoreBucket,
  };
}
export async function registerOutcomeFromSignal(input: {
  symbol: string;
  baseAsset: string;
  timeframe: string;
  signalType: 'BUY' | 'SELL';
  score: number;
  price: number;
  entryLow?: number | null;
  entryHigh?: number | null;
  stopLoss: number;
  target1: number;
  target2?: number | null;
  riskReward?: number | null;
  source?: string;
}): Promise<boolean> {
  const { data: existing } = await supabase
    .from('signal_outcomes')
    .select('id')
    .eq('symbol', input.symbol)
    .eq('timeframe', input.timeframe)
    .eq('signal_type', input.signalType)
    .eq('status', 'OPEN')
    .maybeSingle();

  if (existing) return false;

  const { error } = await supabase.from('signal_outcomes').insert({
    symbol: input.symbol,
    base_asset: input.baseAsset,
    timeframe: input.timeframe,
    signal_type: input.signalType,
    score: input.score,
    price_at_signal: input.price,
    entry_low: input.entryLow ?? null,
    entry_high: input.entryHigh ?? null,
    stop_loss: input.stopLoss,
    target1: input.target1,
    target2: input.target2 ?? null,
    risk_reward: input.riskReward ?? null,
    status: 'OPEN',
    source: input.source ?? 'manual_scan',
  });

  if (error) {
    console.error('registerOutcomeFromSignal', error.message);
    return false;
  }
  return true;
}
export async function fetchOutcomeById(id: string): Promise<SignalOutcome | null> {
  const { data, error } = await supabase
    .from('signal_outcomes')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SignalOutcome) ?? null;
}

export async function fetchOutcomesBySymbol(
  symbol: string,
  limit = 30,
): Promise<SignalOutcome[]> {
  const { data, error } = await supabase
    .from('signal_outcomes')
    .select('*')
    .eq('symbol', symbol)
    .order('signal_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as SignalOutcome[];
}
