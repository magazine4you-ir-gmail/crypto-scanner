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
