import { supabase } from './supabaseClient';

/**
 * Signal Lab is READ-ONLY on the client. Paper trades are registered and resolved by the
 * `scheduled-scan` Edge Function (service role) from closed candles, after fees.
 */

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
  candle_close_time: string | null;
  status: OutcomeStatus;
  exit_price: number | null;
  exit_at: string | null;
  pnl_pct: number | null;
  pnl_gross_pct: number | null;
  r_multiple: number | null;
  bars_held: number | null;
  source: string;
  notes: string | null;
}

/** Newest first. Cancelled rows (legacy duplicates / superseded signals) are hidden. */
export async function fetchOutcomes(limit = 400): Promise<SignalOutcome[]> {
  const { data, error } = await supabase
    .from('signal_outcomes')
    .select('*')
    .neq('status', 'CANCELLED')
    .order('signal_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as SignalOutcome[];
}

export async function fetchOutcomeById(id: string): Promise<SignalOutcome | null> {
  const { data, error } = await supabase.from('signal_outcomes').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SignalOutcome) ?? null;
}

export async function fetchOutcomesBySymbol(symbol: string, limit = 30): Promise<SignalOutcome[]> {
  const { data, error } = await supabase
    .from('signal_outcomes')
    .select('*')
    .eq('symbol', symbol)
    .neq('status', 'CANCELLED')
    .order('signal_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as SignalOutcome[];
}

interface Bucket {
  wins: number;
  losses: number;
  expired: number;
  winRate: number;
  avgR: number;
}

export interface OutcomeStats {
  totalClosed: number;
  wins: number;
  losses: number;
  expired: number;
  open: number;
  /** wins / (wins + losses) */
  winRate: number;
  /** average net PnL per closed trade, % */
  avgPnl: number;
  totalPnl: number;
  profitFactor: number;
  /** average net result per closed trade in R (1R = initial risk), expired trades included */
  expectancyR: number;
  /** win rate needed to break even at the observed average win/loss in R */
  breakEvenWinRate: number;
  byTimeframe: Record<string, Bucket>;
  byScoreBucket: Record<string, Bucket>;
  byDirection: Record<string, Bucket>;
}

function emptyBucket(): Bucket {
  return { wins: 0, losses: 0, expired: 0, winRate: 0, avgR: 0 };
}

export function computeStats(rows: SignalOutcome[]): OutcomeStats {
  const open = rows.filter((r) => r.status === 'OPEN').length;
  const closed = rows.filter((r) => r.status === 'WIN' || r.status === 'LOSS' || r.status === 'EXPIRED');
  const wins = closed.filter((r) => r.status === 'WIN');
  const losses = closed.filter((r) => r.status === 'LOSS');
  const expired = closed.filter((r) => r.status === 'EXPIRED');

  const pnl = (r: SignalOutcome) => Number(r.pnl_pct ?? 0);
  const totalPnl = closed.reduce((s, r) => s + pnl(r), 0);
  const avgPnl = closed.length ? totalPnl / closed.length : 0;

  // profit factor over ALL closed trades (expired ones included), net of fees
  const grossWin = closed.reduce((s, r) => s + Math.max(0, pnl(r)), 0);
  const grossLoss = Math.abs(closed.reduce((s, r) => s + Math.min(0, pnl(r)), 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;

  const decided = wins.length + losses.length;
  const winRate = decided > 0 ? (wins.length / decided) * 100 : 0;

  const rOf = (r: SignalOutcome) => Number(r.r_multiple ?? 0);
  const expectancyR = closed.length ? closed.reduce((s, r) => s + rOf(r), 0) / closed.length : 0;
  const avgWinR = wins.length ? wins.reduce((s, r) => s + rOf(r), 0) / wins.length : 0;
  const avgLossR = losses.length ? Math.abs(losses.reduce((s, r) => s + rOf(r), 0) / losses.length) : 1;
  const breakEvenWinRate = avgWinR + avgLossR > 0 ? (avgLossR / (avgWinR + avgLossR)) * 100 : 0;

  const bucketOf = (score: number) => (score >= 80 ? '80+' : score >= 70 ? '70-79' : score >= 60 ? '60-69' : '<60');
  const byTimeframe: Record<string, Bucket> = {};
  const byScoreBucket: Record<string, Bucket> = {};
  const byDirection: Record<string, Bucket> = {};
  const sums = new Map<Bucket, { r: number; n: number }>();

  const add = (map: Record<string, Bucket>, key: string, r: SignalOutcome) => {
    const b = (map[key] ??= emptyBucket());
    if (r.status === 'WIN') b.wins++;
    else if (r.status === 'LOSS') b.losses++;
    else b.expired++;
    const acc = sums.get(b) ?? { r: 0, n: 0 };
    acc.r += rOf(r);
    acc.n++;
    sums.set(b, acc);
  };
  for (const r of closed) {
    add(byTimeframe, r.timeframe, r);
    add(byScoreBucket, bucketOf(r.score), r);
    add(byDirection, r.signal_type, r);
  }
  for (const map of [byTimeframe, byScoreBucket, byDirection]) {
    for (const b of Object.values(map)) {
      const d = b.wins + b.losses;
      b.winRate = d ? (b.wins / d) * 100 : 0;
      const acc = sums.get(b);
      b.avgR = acc && acc.n ? acc.r / acc.n : 0;
    }
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
    expectancyR,
    breakEvenWinRate,
    byTimeframe,
    byScoreBucket,
    byDirection,
  };
}
