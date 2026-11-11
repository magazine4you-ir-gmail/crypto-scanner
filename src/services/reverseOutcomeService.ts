import { supabase } from './supabaseClient';
import type { SignalOutcome, OutcomeSignalType, OutcomeStatus } from './outcomeService';

/**
 * Reverse Signal Lab is READ-ONLY on the client, like Signal Lab. Mirrored trades are created and resolved
 * by the Edge Functions (`scheduled-scan`, `track-signal`) from closed candles, after fees.
 *
 * A reverse trade is a normal `SignalOutcome` where
 *   signal_type = direction of the REVERSE trade (BUY -> SELL, SELL -> BUY),
 *   stop_loss   = the ORIGINAL take-profit,
 *   target1     = the ORIGINAL stop-loss.
 * That way `computeStats` and every Signal Lab widget work on it unchanged.
 */

export interface OriginResult {
  status: OutcomeStatus;
  pnl_pct: number | null;
  r_multiple: number | null;
}

export interface ReverseOutcome extends SignalOutcome {
  origin_outcome_id: string;
  /** Direction of the original signal this trade mirrors. */
  origin_signal_type: OutcomeSignalType;
  /** Result of the original trade (joined), null if it cannot be read. */
  origin: OriginResult | null;
}

const SELECT = '*, origin:signal_outcomes!origin_outcome_id(status, pnl_pct, r_multiple)';

// PostgREST returns a to-one embed as an object, but tolerate an array just in case.
function normalize(row: unknown): ReverseOutcome {
  const r = row as ReverseOutcome & { origin: OriginResult | OriginResult[] | null };
  const origin = Array.isArray(r.origin) ? (r.origin[0] ?? null) : (r.origin ?? null);
  return { ...r, origin };
}

/** Newest first. Cancelled rows (original was cancelled) are hidden. */
export async function fetchReverseOutcomes(limit = 400): Promise<ReverseOutcome[]> {
  const { data, error } = await supabase
    .from('reverse_signal_outcomes')
    .select(SELECT)
    .neq('status', 'CANCELLED')
    .order('signal_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(normalize);
}

export type ReverseStatusFilter = 'ALL' | 'OPEN' | 'WIN' | 'LOSS' | 'EXPIRED';

export interface ReversePageQuery {
  status: ReverseStatusFilter;
  /** 0-based */
  page: number;
  pageSize?: number;
  /** optional extra filters (Analysis center) */
  symbol?: string;
  timeframe?: string;
  side?: 'BUY' | 'SELL';
}

/**
 * One server-side page of reverse signals, newest first, straight from `reverse_signal_outcomes` (the same table and the
 * same CANCELLED exclusion as Reverse Signal Lab). The open / closed / profit / loss / expired state is therefore the Lab's
 * own state, never a parallel one.
 */
export async function fetchReverseOutcomePage(q: ReversePageQuery): Promise<{ rows: ReverseOutcome[]; total: number }> {
  const size = q.pageSize ?? 100;
  const from = q.page * size;
  let query = supabase
    .from('reverse_signal_outcomes')
    .select(SELECT, { count: 'exact' })
    .neq('status', 'CANCELLED');
  if (q.status !== 'ALL') query = query.eq('status', q.status);
  if (q.timeframe) query = query.eq('timeframe', q.timeframe);
  if (q.side) query = query.eq('signal_type', q.side);
  const sym = q.symbol?.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (sym) query = query.ilike('symbol', `%${sym}%`);
  const { data, error, count } = await query
    .order('signal_at', { ascending: false })
    .order('id', { ascending: false }) // stable order across pages
    .range(from, from + size - 1);
  if (error) throw new Error(error.message);
  return { rows: (data ?? []).map(normalize), total: count ?? 0 };
}

export interface ReverseCounts { open: number; win: number; loss: number; expired: number; total: number }

/** Trustworthy counts: exact head-counts on `reverse_signal_outcomes` (CANCELLED excluded, like the Lab). */
export async function fetchReverseOutcomeCounts(): Promise<ReverseCounts> {
  const one = async (status: Exclude<ReverseStatusFilter, 'ALL'>): Promise<number> => {
    const { count, error } = await supabase
      .from('reverse_signal_outcomes')
      .select('id', { count: 'exact', head: true })
      .eq('status', status);
    if (error) throw new Error(error.message);
    return count ?? 0;
  };
  const [open, win, loss, expired] = await Promise.all([one('OPEN'), one('WIN'), one('LOSS'), one('EXPIRED')]);
  return { open, win, loss, expired, total: open + win + loss + expired };
}

export async function fetchReverseOutcomeById(id: string): Promise<ReverseOutcome | null> {
  const { data, error } = await supabase.from('reverse_signal_outcomes').select(SELECT).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? normalize(data) : null;
}

export async function fetchReverseOutcomesBySymbol(symbol: string, limit = 30): Promise<ReverseOutcome[]> {
  const { data, error } = await supabase
    .from('reverse_signal_outcomes')
    .select(SELECT)
    .eq('symbol', symbol)
    .neq('status', 'CANCELLED')
    .order('signal_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(normalize);
}

/**
 * The ORIGINAL trades behind a list of reverse trades, shaped like `SignalOutcome` so `computeStats` can score
 * them: same trades, same moments, original direction and original stop/target.
 * Rows whose original is still OPEN are kept OPEN; rows whose original is unreadable are skipped.
 */
export function originalsOf(rows: ReverseOutcome[]): SignalOutcome[] {
  const out: SignalOutcome[] = [];
  for (const r of rows) {
    if (!r.origin) continue;
    out.push({
      ...r,
      signal_type: r.origin_signal_type,
      stop_loss: r.target1,
      target1: r.stop_loss,
      status: r.origin.status,
      pnl_pct: r.origin.pnl_pct,
      r_multiple: r.origin.r_multiple,
    });
  }
  return out;
}
